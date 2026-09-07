import { describe, expect, it } from 'vitest';
import { createDeviceKey, openFromDevice, sealToDevice } from './deviceKey.js';
import { generateKeyPair } from './keys.js';
import { UnwrapError } from './password.js';

const ACCOUNT = 'user-1';
const OTHER_ACCOUNT = 'user-2';

describe('device key wrapping', () => {
  it('reopens a private key sealed under the same device key', async () => {
    const { privateKey } = await generateKeyPair();
    const deviceKey = await createDeviceKey();

    const sealed = await sealToDevice(deviceKey, privateKey, ACCOUNT);
    const reopened = await openFromDevice(deviceKey, sealed, ACCOUNT);

    expect(Array.from(reopened)).toEqual(Array.from(privateKey));
  });

  /**
   * The flag this whole design rests on. If a future refactor passes
   * `extractable: true`, blob_C stops being meaningfully better than storing the
   * private key in the clear, and this is the test that notices.
   */
  it('creates a key the browser refuses to export', async () => {
    const deviceKey = await createDeviceKey();
    await expect(
      globalThis.crypto.subtle.exportKey('raw', deviceKey as CryptoKey),
    ).rejects.toThrow();
  });

  it('will not open a blob sealed for another account', async () => {
    const { privateKey } = await generateKeyPair();
    const deviceKey = await createDeviceKey();
    const sealed = await sealToDevice(deviceKey, privateKey, ACCOUNT);

    await expect(openFromDevice(deviceKey, sealed, OTHER_ACCOUNT)).rejects.toBeInstanceOf(
      UnwrapError,
    );
  });

  it('will not open a blob sealed under a different device key', async () => {
    const { privateKey } = await generateKeyPair();
    const sealed = await sealToDevice(await createDeviceKey(), privateKey, ACCOUNT);

    await expect(
      openFromDevice(await createDeviceKey(), sealed, ACCOUNT),
    ).rejects.toBeInstanceOf(UnwrapError);
  });

  it('will not open a tampered blob', async () => {
    const { privateKey } = await generateKeyPair();
    const deviceKey = await createDeviceKey();
    const sealed = JSON.parse(await sealToDevice(deviceKey, privateKey, ACCOUNT)) as {
      body: string;
    };
    // Flip the first base64 character to something else in the alphabet.
    sealed.body = (sealed.body[0] === 'A' ? 'B' : 'A') + sealed.body.slice(1);

    await expect(
      openFromDevice(deviceKey, JSON.stringify(sealed), ACCOUNT),
    ).rejects.toBeInstanceOf(UnwrapError);
  });

  it('rejects material that is not a device blob at all', async () => {
    const deviceKey = await createDeviceKey();
    await expect(openFromDevice(deviceKey, 'not json', ACCOUNT)).rejects.toBeInstanceOf(
      UnwrapError,
    );
    await expect(openFromDevice(deviceKey, '{"v":2}', ACCOUNT)).rejects.toBeInstanceOf(
      UnwrapError,
    );
  });
});
