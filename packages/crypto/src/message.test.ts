/**
 * Phase 2 message tests: the round trips, the tamper cases that prove the
 * "authenticated" half of authenticated encryption, the context check, and
 * the phase 1 envelope still opening for the history written under it.
 *
 * The last block runs the published NaCl box vector through libsodium itself.
 * It cannot go through encryptMessage, whose nonce is random and whose
 * plaintext is framed, so it checks the primitive underneath rather than the
 * wrapper. That is what packages/crypto/AGENTS.md asks for: a round trip
 * against our own code would pass just as happily with a broken WASM build.
 */
import { describe, expect, it } from 'vitest';
import { fromBase64, toBase64 } from './encoding.js';
import { generateKeyPair } from './keys.js';
import {
  BOX_ALG,
  DecryptError,
  decryptMessage,
  encryptMessage,
  parseCiphertext,
  serializeCiphertext,
} from './message.js';
import { ready } from './sodium.js';

const CONTEXT = 'conversation:test';

/** Fresh keys per test: no reusable private key ever lands in a fixture. */
async function pair() {
  const [alice, bob] = await Promise.all([generateKeyPair(), generateKeyPair()]);
  return { alice, bob };
}

/// Flips one byte of a base64 field and hands the envelope back.
async function flipByteIn(value: string, at: number): Promise<string> {
  const bytes = await fromBase64(value);
  bytes[at] = (bytes[at] ?? 0) ^ 0x01;
  return toBase64(bytes);
}

describe('round trip', () => {
  const bodies = [
    ['empty', ''],
    ['ascii', 'the corner radius is 90% of the theme'],
    ['unicode', 'ok, het spoor ligt erin 🚄🇳🇱'],
    ['long', 'a'.repeat(64 * 1024)],
    ['json-looking', '{"v":1,"alg":"not really"}'],
    ['frame-looking', '{"c":"conversation:other","m":"nice try"}'],
  ] as const;

  for (const [name, body] of bodies) {
    it(`recovers ${name} content`, async () => {
      const { alice, bob } = await pair();
      const sealed = await encryptMessage(body, bob.publicKey, alice.privateKey, CONTEXT);
      expect(await decryptMessage(sealed, alice.publicKey, bob.privateKey, CONTEXT)).toBe(body);
    });
  }

  it('survives serialization', async () => {
    const { alice, bob } = await pair();
    const wire = serializeCiphertext(
      await encryptMessage('over the wire', bob.publicKey, alice.privateKey, CONTEXT),
    );
    expect(
      await decryptMessage(parseCiphertext(wire), alice.publicKey, bob.privateKey, CONTEXT),
    ).toBe('over the wire');
  });

  it('seals to yourself', async () => {
    // The sender's own copy: boxed under their own public key, opened with
    // their own private key. This is the envelope model's whole reason.
    const { alice } = await pair();
    const sealed = await encryptMessage('mine', alice.publicKey, alice.privateKey, CONTEXT);
    expect(await decryptMessage(sealed, alice.publicKey, alice.privateKey, CONTEXT)).toBe('mine');
  });
});

describe('the envelope', () => {
  it('is tagged as a box and carries a nonce of the right length', async () => {
    const { alice, bob } = await pair();
    const sodium = await ready();
    const sealed = await encryptMessage('hey', bob.publicKey, alice.privateKey, CONTEXT);

    expect(sealed.v).toBe(1);
    expect(sealed.alg).toBe(BOX_ALG);
    expect(sealed.nonce).not.toBeNull();
    expect((await fromBase64(sealed.nonce as string)).length).toBe(sodium.crypto_box_NONCEBYTES);
  });

  it('never reuses a nonce', async () => {
    const { alice, bob } = await pair();
    const first = await encryptMessage('same', bob.publicKey, alice.privateKey, CONTEXT);
    const second = await encryptMessage('same', bob.publicKey, alice.privateKey, CONTEXT);
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.body).not.toBe(second.body);
  });

  it('does not put the body, or the context, on the wire', async () => {
    const { alice, bob } = await pair();
    const body = 'the twelve fifteen from Utrecht is cancelled';
    const wire = serializeCiphertext(
      await encryptMessage(body, bob.publicKey, alice.privateKey, CONTEXT),
    );
    expect(wire).not.toContain(body);
    expect(wire).not.toContain('Utrecht');
    expect(wire).not.toContain(CONTEXT);
    // Nor base64 of the body, which is what phase 1 used to leak.
    expect(wire).not.toContain(await toBase64(new TextEncoder().encode(body)));
  });
});

describe('tampering', () => {
  it('refuses a body with one byte flipped', async () => {
    const { alice, bob } = await pair();
    const sealed = await encryptMessage('intact', bob.publicKey, alice.privateKey, CONTEXT);
    const tampered = { ...sealed, body: await flipByteIn(sealed.body, 20) };
    await expect(
      decryptMessage(tampered, alice.publicKey, bob.privateKey, CONTEXT),
    ).rejects.toThrow(DecryptError);
  });

  it('refuses a nonce with one byte flipped', async () => {
    const { alice, bob } = await pair();
    const sealed = await encryptMessage('intact', bob.publicKey, alice.privateKey, CONTEXT);
    const tampered = { ...sealed, nonce: await flipByteIn(sealed.nonce as string, 3) };
    await expect(
      decryptMessage(tampered, alice.publicKey, bob.privateKey, CONTEXT),
    ).rejects.toThrow(DecryptError);
  });

  it('refuses a truncated body', async () => {
    const { alice, bob } = await pair();
    const sealed = await encryptMessage('intact', bob.publicKey, alice.privateKey, CONTEXT);
    const bytes = await fromBase64(sealed.body);
    const tampered = { ...sealed, body: await toBase64(bytes.subarray(0, bytes.length - 1)) };
    await expect(
      decryptMessage(tampered, alice.publicKey, bob.privateKey, CONTEXT),
    ).rejects.toThrow(DecryptError);
  });

  it('cannot be opened by anyone but the recipient', async () => {
    const { alice, bob } = await pair();
    const eve = await generateKeyPair();
    const sealed = await encryptMessage('for bob', bob.publicKey, alice.privateKey, CONTEXT);
    await expect(
      decryptMessage(sealed, alice.publicKey, eve.privateKey, CONTEXT),
    ).rejects.toThrow(DecryptError);
  });

  it('cannot be passed off as coming from somebody else', async () => {
    // Bob opens with the key he believes is Alice's. If the message was
    // actually sealed by Eve, it fails: that is the sender authentication.
    const { alice, bob } = await pair();
    const eve = await generateKeyPair();
    const forged = await encryptMessage('from alice, honest', bob.publicKey, eve.privateKey, CONTEXT);
    await expect(
      decryptMessage(forged, alice.publicKey, bob.privateKey, CONTEXT),
    ).rejects.toThrow(DecryptError);
  });

  it('refuses a message moved to a different context', async () => {
    const { alice, bob } = await pair();
    const sealed = await encryptMessage('stay put', bob.publicKey, alice.privateKey, CONTEXT);
    await expect(
      decryptMessage(sealed, alice.publicKey, bob.privateKey, 'conversation:elsewhere'),
    ).rejects.toThrow(/somewhere else/);
    await expect(
      decryptMessage(sealed, alice.publicKey, bob.privateKey, 'call'),
    ).rejects.toThrow(DecryptError);
  });

  it('refuses a box envelope with no nonce', async () => {
    const { alice, bob } = await pair();
    const sealed = await encryptMessage('x', bob.publicKey, alice.privateKey, CONTEXT);
    await expect(
      decryptMessage({ ...sealed, nonce: null }, alice.publicKey, bob.privateKey, CONTEXT),
    ).rejects.toThrow(DecryptError);
    await expect(
      decryptMessage({ ...sealed, nonce: 'AAAA' }, alice.publicKey, bob.privateKey, CONTEXT),
    ).rejects.toThrow(DecryptError);
  });
});

describe('a sender with no key', () => {
  it('opens phase 1 history and refuses a box, saying why', async () => {
    const { alice, bob } = await pair();
    const legacy = parseCiphertext(JSON.stringify({ v: 1, alg: 'none', nonce: null, body: 'aGV5' }));
    expect(await decryptMessage(legacy, null, bob.privateKey, CONTEXT)).toBe('hey');

    const sealed = await encryptMessage('hey', bob.publicKey, alice.privateKey, CONTEXT);
    await expect(decryptMessage(sealed, null, bob.privateKey, CONTEXT)).rejects.toThrow(
      /no key for the sender/,
    );
  });
});

describe('phase 1 history', () => {
  it('still opens an envelope written before phase 2', async () => {
    const { alice, bob } = await pair();
    // 'aGV5' spelled out rather than via btoa(): that is a DOM global, and
    // this package has to run in Node and the browser alike.
    const legacy = parseCiphertext(JSON.stringify({ v: 1, alg: 'none', nonce: null, body: 'aGV5' }));
    expect(await decryptMessage(legacy, alice.publicKey, bob.privateKey, CONTEXT)).toBe('hey');
    // The context is not checked: phase 1 had nothing to check it against.
    expect(await decryptMessage(legacy, alice.publicKey, bob.privateKey, 'anything')).toBe('hey');
  });

  it('is never written any more', async () => {
    const { alice, bob } = await pair();
    const sealed = await encryptMessage('hey', bob.publicKey, alice.privateKey, CONTEXT);
    expect(sealed.alg).not.toBe('none');
  });
});

describe('failure handling', () => {
  it('refuses an algorithm it does not know rather than guessing', async () => {
    const { alice, bob } = await pair();
    const future = parseCiphertext(
      JSON.stringify({ v: 1, alg: 'crypto_box_v2', nonce: 'AAAA', body: 'aGV5' }),
    );
    await expect(
      decryptMessage(future, alice.publicKey, bob.privateKey, CONTEXT),
    ).rejects.toThrow(DecryptError);
  });

  it('rejects anything that is not an envelope', () => {
    expect(() => parseCiphertext('not even json')).toThrow(DecryptError);
    expect(() => parseCiphertext('{"v":2,"alg":"none","nonce":null,"body":""}')).toThrow(
      DecryptError,
    );
    expect(() => parseCiphertext('"just a string"')).toThrow(DecryptError);
    expect(() => parseCiphertext('null')).toThrow(DecryptError);
  });
});

describe('the primitive underneath', () => {
  /**
   * The box test vector from the NaCl distribution (tests/box.c), which
   * libsodium ships unchanged in test/default/box.c. Alice's secret key,
   * Bob's public key, a nonce, 131 bytes of message and the 147 bytes they
   * seal to.
   */
  const aliceSecret =
    '77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a';
  const bobPublic =
    'de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f';
  const nonce = '69696ee955b62b73cd62bda875fc73d68219e0036b7a0b37';
  const message =
    'be075fc53c81f2d5cf141316ebeb0c7b5228c52a4c62cbd44b66849b64244ffce5ecbaaf33bd751a1ac728d45e6c61296cdc3c01233561f41db66cce314adb310e3be8250c46f06dceea3a7fa1348057e2f6556ad6b1318a024a838f21af1fde048977eb48f59ffd4924ca1c60902e52f0a089bc76897040e082f937763848645e0705';
  const expected =
    'f3ffc7703f9400e52a7dfb4b3d3305d98e993b9f48681273c29650ba32fc76ce48332ea7164d96a4476fb8c531a1186ac0dfc17c98dce87b4da7f011ec48c97271d2c20f9b928fe2270d6fb863d51738b48eeee314a7cc8ab932164548e526ae90224368517acfeabd6bb3732bc0e9da99832b61ca01b6de56244a9e88d5f9b37973f622a43d14a6599b1f654cb45a74e355a5';

  it('matches the published NaCl box vector', async () => {
    const sodium = await ready();
    const sealed = sodium.crypto_box_easy(
      sodium.from_hex(message),
      sodium.from_hex(nonce),
      sodium.from_hex(bobPublic),
      sodium.from_hex(aliceSecret),
    );
    expect(sodium.to_hex(sealed)).toBe(expected);
  });
});
