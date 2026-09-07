/**
 * What happens across a reload.
 *
 * A reload is modelled the only way it can be in a test: build a second
 * KeyManager over the same two stores. The first one is the tab that was open,
 * the second is the tab that came back, and everything they share is exactly
 * what a real browser would have kept.
 */
import { generateKeyPair, toBase64, wrapPrivateKey, DOMAIN } from '@cipher/crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiClient } from '../api/client';
import { MemoryDeviceKeyStore } from '../storage/deviceKeyStore';
import { MemorySecureStore } from '../storage/secureStore';
import { KeyManager, type StoredIdentity } from './keyManager';

const PASSWORD = 'a-long-enough-password-1';
const REMEMBER_KEY = 'identity/device-unlock/v1';

function client() {
  return new ApiClient({
    baseUrl: 'http://api.test',
    authMode: 'cookie',
    fetchImpl: async () => new Response('{}', { status: 200 }),
    readCookies: () => '',
  });
}

/** The two stores a real browser profile would carry across a reload. */
function device() {
  return { store: new MemorySecureStore(), deviceKeys: new MemoryDeviceKeyStore() };
}

function manager(shared: ReturnType<typeof device>) {
  return new KeyManager(shared.store, client(), shared.deviceKeys);
}

async function identityFor(privateKey: Uint8Array, publicKey: Uint8Array): Promise<StoredIdentity> {
  const wrapped = await wrapPrivateKey(privateKey, PASSWORD, DOMAIN.keywrap);
  return {
    userId: 'user-1',
    email: 'sam@example.com',
    deviceId: 'dev-1',
    label: 'Test device',
    publicKey: await toBase64(publicKey),
    wrappedPrivateKey: JSON.stringify(wrapped),
    wrappedPrivateKeyRecovery: JSON.stringify(wrapped),
  };
}

describe('staying unlocked across a reload', () => {
  let shared: ReturnType<typeof device>;
  let identity: StoredIdentity;
  let privateKey: Uint8Array;

  beforeEach(async () => {
    shared = device();
    const pair = await generateKeyPair();
    privateKey = pair.privateKey;
    identity = await identityFor(pair.privateKey, pair.publicKey);
  }, 60_000);

  it('comes back unlocked, with the same key', async () => {
    await manager(shared).adopt(identity, Uint8Array.from(privateKey));

    const reloaded = manager(shared);
    await reloaded.restore();

    expect(reloaded.state).toBe('unlocked');
    expect(Array.from(reloaded.requirePrivateKey())).toEqual(Array.from(privateKey));
  });

  it('remembers an unlock done with the password, not just one done at login', { timeout: 60_000 }, async () => {
    // No adopt: this is the device arriving locked, as it would after the
    // remembered record expired.
    await shared.store.set('identity/v1', JSON.stringify(identity));
    const locked = manager(shared);
    await locked.restore();
    expect(locked.state).toBe('locked');

    await locked.unlock(PASSWORD);

    const reloaded = manager(shared);
    await reloaded.restore();
    expect(reloaded.state).toBe('unlocked');
  });

  it('asks for the password again after Lock', async () => {
    const open = manager(shared);
    await open.adopt(identity, Uint8Array.from(privateKey));
    await open.lock();

    const reloaded = manager(shared);
    await reloaded.restore();

    expect(reloaded.state).toBe('locked');
    // Both halves are gone, not just the one that gates the resume.
    expect(await shared.store.get(REMEMBER_KEY)).toBeNull();
    expect(await shared.deviceKeys.get()).toBeNull();
  });

  it('asks for the password again after sign-out', async () => {
    const open = manager(shared);
    await open.adopt(identity, Uint8Array.from(privateKey));
    await open.forget();

    const reloaded = manager(shared);
    await reloaded.restore();

    expect(reloaded.state).toBe('empty');
  });

  it('does not resume a record that has expired', async () => {
    await manager(shared).adopt(identity, Uint8Array.from(privateKey));
    const record = JSON.parse((await shared.store.get(REMEMBER_KEY)) as string) as {
      expiresAt: number;
    };
    record.expiresAt = Date.now() - 1;
    await shared.store.set(REMEMBER_KEY, JSON.stringify(record));

    const reloaded = manager(shared);
    await reloaded.restore();

    expect(reloaded.state).toBe('locked');
    expect(await shared.store.get(REMEMBER_KEY)).toBeNull();
  });

  it('slides the expiry forward on every resume', async () => {
    await manager(shared).adopt(identity, Uint8Array.from(privateKey));
    const first = JSON.parse((await shared.store.get(REMEMBER_KEY)) as string) as {
      expiresAt: number;
    };
    // Bring it close to expiry without crossing it, the way a fortnight of use
    // would.
    first.expiresAt = Date.now() + 1_000;
    await shared.store.set(REMEMBER_KEY, JSON.stringify(first));

    await manager(shared).restore();

    const second = JSON.parse((await shared.store.get(REMEMBER_KEY)) as string) as {
      expiresAt: number;
    };
    expect(second.expiresAt).toBeGreaterThan(first.expiresAt);
  });

  it('does not resume a record left by a different account', async () => {
    await manager(shared).adopt(identity, Uint8Array.from(privateKey));
    const record = JSON.parse((await shared.store.get(REMEMBER_KEY)) as string) as {
      userId: string;
    };
    record.userId = 'someone-else';
    await shared.store.set(REMEMBER_KEY, JSON.stringify(record));

    const reloaded = manager(shared);
    await reloaded.restore();

    expect(reloaded.state).toBe('locked');
  });

  /**
   * A device key that did not survive, which is what a cleared browser profile
   * or a private window looks like. The record is useless without it and must
   * not leave the app wedged.
   */
  it('falls back to locked when the device key is gone', async () => {
    await manager(shared).adopt(identity, Uint8Array.from(privateKey));
    await shared.deviceKeys.clear();

    const reloaded = manager(shared);
    await reloaded.restore();

    expect(reloaded.state).toBe('locked');
    expect(await shared.store.get(REMEMBER_KEY)).toBeNull();
  });

  it('never writes the raw private key into storage', async () => {
    await manager(shared).adopt(identity, Uint8Array.from(privateKey));

    const raw = (await shared.store.get(REMEMBER_KEY)) as string;
    expect(raw).not.toContain(await toBase64(privateKey));
    expect(raw).toContain('aes-256-gcm');
  });
});
