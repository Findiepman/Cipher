/**
 * The symmetric seal the vault is built on.
 *
 * Two properties matter and both are tested here rather than assumed: a round
 * trip returns exactly what went in, including the awkward inputs, and anything
 * that is not the right key throws instead of returning something that looks
 * like content. The second is the whole reason for using an authenticated
 * primitive, so it is worth a test that would fail loudly if the scheme were
 * ever swapped for a raw stream cipher.
 */
import { describe, expect, it } from 'vitest';
import {
  SealError,
  generateSecretKey,
  openWithKey,
  parseSealed,
  sealWithKey,
  serializeSealed,
} from './secret.js';

describe('sealWithKey / openWithKey', () => {
  it('round trips text of every awkward shape', async () => {
    const key = await generateSecretKey();
    const cases = ['', 'a', 'the rail is done', 'ünïcode ✓ 🔐', 'x'.repeat(20_000)];

    for (const plaintext of cases) {
      const sealed = await sealWithKey(plaintext, key);
      expect(await openWithKey(sealed, key)).toBe(plaintext);
    }
  });

  it('does not put the plaintext in the sealed body', async () => {
    const key = await generateSecretKey();
    const sealed = await sealWithKey('the bank card pin is 4021', key);

    expect(sealed.body).not.toContain('4021');
    expect(serializeSealed(sealed)).not.toContain('bank');
  });

  it('uses a fresh nonce every time, so the same note seals differently', async () => {
    const key = await generateSecretKey();
    const once = await sealWithKey('same text', key);
    const twice = await sealWithKey('same text', key);

    expect(once.nonce).not.toBe(twice.nonce);
    expect(once.body).not.toBe(twice.body);
  });

  it('refuses another key rather than returning garbage', async () => {
    const sealed = await sealWithKey('mine', await generateSecretKey());

    await expect(openWithKey(sealed, await generateSecretKey())).rejects.toBeInstanceOf(
      SealError,
    );
  });

  it('refuses a tampered body or nonce', async () => {
    const key = await generateSecretKey();
    const sealed = await sealWithKey('mine', key);

    const flipped = { ...sealed, body: flipOneByte(sealed.body) };
    await expect(openWithKey(flipped, key)).rejects.toBeInstanceOf(SealError);

    const moved = { ...sealed, nonce: flipOneByte(sealed.nonce) };
    await expect(openWithKey(moved, key)).rejects.toBeInstanceOf(SealError);
  });
});

describe('serializeSealed / parseSealed', () => {
  it('survives a trip through storage', async () => {
    const key = await generateSecretKey();
    const sealed = await sealWithKey('kept', key);

    const parsed = parseSealed(serializeSealed(sealed));

    expect(parsed).toEqual(sealed);
    expect(await openWithKey(parsed, key)).toBe('kept');
  });

  it('rejects anything that is not a sealed document', () => {
    expect(() => parseSealed('{not json')).toThrow(SealError);
    expect(() => parseSealed('{"v":1}')).toThrow(SealError);
    // A wrapped key is the other blob shape in this package. It must not pass
    // for this one: they are opened by different functions with different keys.
    expect(() =>
      parseSealed(
        JSON.stringify({ v: 1, kdf: 'argon2id13', ops: 2, mem: 64, salt: 'a', nonce: 'b', body: 'c' }),
      ),
    ).toThrow(SealError);
  });
});

/** Changes one base64 character to a different one, keeping the length. */
function flipOneByte(value: string): string {
  const at = Math.floor(value.length / 2);
  const swap = value[at] === 'A' ? 'B' : 'A';
  return value.slice(0, at) + swap + value.slice(at + 1);
}
