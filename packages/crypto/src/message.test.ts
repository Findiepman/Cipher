/**
 * Phase 1 message tests. These assert the *envelope contract* — the thing
 * client/ is coded against — not confidentiality, which does not exist yet.
 *
 * The round-trip and tamper suites packages/crypto/AGENTS.md asks for belong
 * with the phase 2 implementation and land in the same commit as it. What is
 * here is what can be true today; see password.test.ts for the parts of this
 * package that do already carry real guarantees.
 */
import { describe, expect, it } from 'vitest';
import { generateKeyPair } from './keys.js';
import {
  DecryptError,
  decryptMessage,
  encryptMessage,
  parseCiphertext,
  serializeCiphertext,
} from './message.js';

/** Fresh keys per test: no reusable private key ever lands in a fixture. */
async function pair() {
  const [alice, bob] = await Promise.all([generateKeyPair(), generateKeyPair()]);
  return { alice, bob };
}

describe('round trip', () => {
  const bodies = [
    ['empty', ''],
    ['ascii', 'the corner radius is 90% of the theme'],
    ['unicode', 'ok — het spoor ligt erin 🚄🇳🇱'],
    ['long', 'a'.repeat(64 * 1024)],
    ['json-looking', '{"v":1,"alg":"not really"}'],
  ] as const;

  for (const [name, body] of bodies) {
    it(`recovers ${name} content`, async () => {
      const { alice, bob } = await pair();
      const sealed = await encryptMessage(body, bob.publicKey, alice.privateKey);
      expect(await decryptMessage(sealed, alice.publicKey, bob.privateKey)).toBe(body);
    });
  }

  it('survives serialization', async () => {
    const { alice, bob } = await pair();
    const wire = serializeCiphertext(
      await encryptMessage('over the wire', bob.publicKey, alice.privateKey),
    );
    expect(await decryptMessage(parseCiphertext(wire), alice.publicKey, bob.privateKey)).toBe(
      'over the wire',
    );
  });
});

describe('the phase 1 envelope', () => {
  it('is tagged so nothing mistakes it for encrypted', async () => {
    const { alice, bob } = await pair();
    const sealed = await encryptMessage('hey', bob.publicKey, alice.privateKey);
    // 'aGV5' spelled out rather than via btoa(): that is a DOM global, and this
    // package has to run in Node and the browser alike.
    expect(sealed).toEqual({ v: 1, alg: 'none', nonce: null, body: 'aGV5' });
  });

  it('matches what client/ constructs by hand in its own tests', async () => {
    const { alice, bob } = await pair();
    const handRolled = JSON.stringify({ v: 1, alg: 'none', nonce: null, body: 'aGV5' });
    expect(await decryptMessage(parseCiphertext(handRolled), alice.publicKey, bob.privateKey)).toBe(
      'hey',
    );
  });

  /**
   * Not confidentiality — base64 is not a secret. It is only the guarantee that
   * a grep for a phrase over the wire or the database misses, so that the day
   * phase 2 lands nothing downstream was quietly relying on readable bodies.
   */
  it('does not put the body on the wire verbatim', async () => {
    const { alice, bob } = await pair();
    const body = 'the twelve fifteen from Utrecht is cancelled';
    const wire = serializeCiphertext(await encryptMessage(body, bob.publicKey, alice.privateKey));
    expect(wire).not.toContain(body);
    expect(wire).not.toContain('Utrecht');
  });
});

describe('failure handling', () => {
  it('refuses an algorithm it does not know rather than guessing', async () => {
    const { alice, bob } = await pair();
    const future = parseCiphertext(
      JSON.stringify({ v: 1, alg: 'crypto_box_v2', nonce: 'AAAA', body: 'aGV5' }),
    );
    await expect(decryptMessage(future, alice.publicKey, bob.privateKey)).rejects.toThrow(
      DecryptError,
    );
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
