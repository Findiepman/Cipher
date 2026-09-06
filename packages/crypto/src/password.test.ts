import { describe, expect, it } from 'vitest';
import { DOMAIN } from './domain.js';
import { fromBase64, toBase64 } from './encoding.js';
import { generateKeyPair, keyFingerprint } from './keys.js';
import {
  UnwrapError,
  deriveAuthHash,
  generateRecoveryCode,
  parseWrappedKey,
  recoveryCodeHash,
  serializeWrappedKey,
  unwrapPrivateKey,
  wrapPrivateKey,
} from './password.js';

// Argon2id at the interactive tier is deliberately slow, so these suites reuse
// one derivation wherever the assertion does not need a fresh one.
const PASSWORD = 'correct horse battery staple';

describe('deriveAuthHash', () => {
  it('is deterministic for the same email and password', async () => {
    const [a, b] = await Promise.all([
      deriveAuthHash('sam@example.com', PASSWORD),
      deriveAuthHash('sam@example.com', PASSWORD),
    ]);
    expect(a).toBe(b);
  });

  it('ignores case and surrounding whitespace in the email', async () => {
    const [a, b] = await Promise.all([
      deriveAuthHash('sam@example.com', PASSWORD),
      deriveAuthHash('  SAM@Example.COM ', PASSWORD),
    ]);
    expect(a).toBe(b);
  });

  it('changes with the password and with the email', async () => {
    const [base, otherPassword, otherEmail] = await Promise.all([
      deriveAuthHash('sam@example.com', PASSWORD),
      deriveAuthHash('sam@example.com', `${PASSWORD}!`),
      deriveAuthHash('kim@example.com', PASSWORD),
    ]);
    expect(otherPassword).not.toBe(base);
    expect(otherEmail).not.toBe(base);
  });
});

describe('wrapPrivateKey', () => {
  it('round-trips the private key', async () => {
    const { privateKey } = await generateKeyPair();
    const blob = await wrapPrivateKey(privateKey, PASSWORD, DOMAIN.keywrap);
    const opened = await unwrapPrivateKey(blob, PASSWORD, DOMAIN.keywrap);
    expect(await toBase64(opened)).toBe(await toBase64(privateKey));
  });

  it('does not leak the key into the blob', async () => {
    const { privateKey } = await generateKeyPair();
    const blob = await wrapPrivateKey(privateKey, PASSWORD, DOMAIN.keywrap);
    expect(serializeWrappedKey(blob)).not.toContain(await toBase64(privateKey));
  });

  it('refuses the wrong secret', async () => {
    const { privateKey } = await generateKeyPair();
    const blob = await wrapPrivateKey(privateKey, PASSWORD, DOMAIN.keywrap);
    await expect(unwrapPrivateKey(blob, 'wrong password', DOMAIN.keywrap)).rejects.toThrow(
      UnwrapError,
    );
  });

  /**
   * The reason DOMAIN exists: blob_A and blob_B can be wrapped under the same
   * secret and still not open each other.
   */
  it('refuses the right secret under the wrong domain', async () => {
    const { privateKey } = await generateKeyPair();
    const blob = await wrapPrivateKey(privateKey, PASSWORD, DOMAIN.keywrap);
    await expect(unwrapPrivateKey(blob, PASSWORD, DOMAIN.recovery)).rejects.toThrow(UnwrapError);
  });

  it('refuses a tampered blob rather than returning garbage', async () => {
    const { privateKey } = await generateKeyPair();
    const blob = await wrapPrivateKey(privateKey, PASSWORD, DOMAIN.keywrap);

    const bytes = await fromBase64(blob.body);
    bytes.set([bytes[0]! ^ 0x01], 0);
    const tampered = { ...blob, body: await toBase64(bytes) };

    await expect(unwrapPrivateKey(tampered, PASSWORD, DOMAIN.keywrap)).rejects.toThrow(UnwrapError);
  });

  it('uses a fresh salt and nonce each time', async () => {
    const { privateKey } = await generateKeyPair();
    const [first, second] = await Promise.all([
      wrapPrivateKey(privateKey, PASSWORD, DOMAIN.keywrap),
      wrapPrivateKey(privateKey, PASSWORD, DOMAIN.keywrap),
    ]);
    expect(first.salt).not.toBe(second.salt);
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.body).not.toBe(second.body);
  });
});

describe('parseWrappedKey', () => {
  it('round-trips a serialized blob', async () => {
    const { privateKey } = await generateKeyPair();
    const blob = await wrapPrivateKey(privateKey, PASSWORD, DOMAIN.keywrap);
    expect(parseWrappedKey(serializeWrappedKey(blob))).toEqual(blob);
  });

  it('rejects anything else', () => {
    expect(() => parseWrappedKey('not json')).toThrow(UnwrapError);
    expect(() => parseWrappedKey('{"v":1}')).toThrow(UnwrapError);
    expect(() => parseWrappedKey('null')).toThrow(UnwrapError);
  });
});

describe('recovery codes', () => {
  it('has the shape the UI prints', async () => {
    expect(await generateRecoveryCode()).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){3}$/);
  });

  it('does not repeat', async () => {
    const codes = await Promise.all(Array.from({ length: 32 }, () => generateRecoveryCode()));
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('hashes the same whatever the user typed', async () => {
    const code = await generateRecoveryCode();
    const [dashed, bare] = await Promise.all([
      recoveryCodeHash(code),
      recoveryCodeHash(code.replace(/-/g, '').toLowerCase()),
    ]);
    expect(bare).toBe(dashed);
  });

  it('does not put the code in its own hash', async () => {
    const code = await generateRecoveryCode();
    const hash = await recoveryCodeHash(code);
    expect(hash).not.toContain(code.replace(/-/g, ''));
  });
});

describe('keyFingerprint', () => {
  it('is stable for a key and different across keys', async () => {
    const [a, b] = await Promise.all([generateKeyPair(), generateKeyPair()]);
    expect(await keyFingerprint(a.publicKey)).toBe(await keyFingerprint(a.publicKey));
    expect(await keyFingerprint(b.publicKey)).not.toBe(await keyFingerprint(a.publicKey));
  });

  it('is readable aloud', async () => {
    const { publicKey } = await generateKeyPair();
    expect(await keyFingerprint(publicKey)).toMatch(/^\d{5}( \d{5}){7}$/);
  });
});
