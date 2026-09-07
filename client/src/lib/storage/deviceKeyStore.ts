/**
 * Custody of the device key: the thing that lets a reload skip the password.
 *
 * This is deliberately not part of `SecureStore`. That interface is
 * string-shaped because the desktop side of it is an OS keychain, and the
 * device key is a `CryptoKey` created with `extractable: false`, which cannot
 * be turned into a string by anyone, including us. Being unable to serialize it
 * is the property we are paying for, so an adapter that demanded a string would
 * have to throw the property away to satisfy its own signature.
 *
 * IndexedDB stores it by structured clone, which preserves the non-extractable
 * flag. Script on this origin can therefore hand the key back to WebCrypto and
 * decrypt with it, and cannot read the key bytes or send them anywhere.
 * `packages/crypto/src/deviceKey.ts` is honest about the limits of that.
 *
 * Every method degrades to "no device key" rather than throwing. A browser in
 * private mode, one with storage disabled or a context with no WebCrypto all
 * end up back at the password prompt, which is the previous behaviour and a
 * perfectly good place to land.
 */
import { createDeviceKey, deviceKeysSupported, type DeviceKey } from '@cipher/crypto';
import { DEVICE_STORE, runInStore } from './idb';

const KEY_NAME = 'device-key/v1';

export interface DeviceKeyStore {
  /** The key this device already holds, or null if it has none. */
  get(): Promise<DeviceKey | null>;
  /** Creates a key, replacing any existing one, and persists it. */
  create(): Promise<DeviceKey | null>;
  /**
   * Destroys the key. Every blob sealed under it becomes permanently
   * unopenable, which is the point: this is what `lock()` calls.
   */
  clear(): Promise<void>;
}

/** Web implementation. */
export class IndexedDbDeviceKeyStore implements DeviceKeyStore {
  async get(): Promise<DeviceKey | null> {
    if (!deviceKeysSupported()) return null;
    try {
      const value = await runInStore<unknown>(DEVICE_STORE, 'readonly', (store) =>
        store.get(KEY_NAME),
      );
      return isCryptoKey(value) ? value : null;
    } catch {
      return null;
    }
  }

  async create(): Promise<DeviceKey | null> {
    if (!deviceKeysSupported()) return null;
    try {
      const key = await createDeviceKey();
      await runInStore(DEVICE_STORE, 'readwrite', (store) => store.put(key, KEY_NAME));
      return key;
    } catch {
      // Most likely a browser that refuses to structured-clone a CryptoKey, or
      // one with storage blocked. Staying unlocked is a convenience, so this is
      // not an error the user needs to see.
      return null;
    }
  }

  async clear(): Promise<void> {
    try {
      await runInStore(DEVICE_STORE, 'readwrite', (store) => store.delete(KEY_NAME));
    } catch {
      // Nothing useful to do. The record sealed under it is cleared separately
      // and that is what actually gates a resume.
    }
  }
}

/** Used by tests, and by any context without IndexedDB. Dies with the page. */
export class MemoryDeviceKeyStore implements DeviceKeyStore {
  private key: DeviceKey | null = null;

  async get(): Promise<DeviceKey | null> {
    return this.key;
  }

  async create(): Promise<DeviceKey | null> {
    if (!deviceKeysSupported()) return null;
    this.key = await createDeviceKey();
    return this.key;
  }

  async clear(): Promise<void> {
    this.key = null;
  }
}

export function createDeviceKeyStore(): DeviceKeyStore {
  if (typeof indexedDB !== 'undefined') return new IndexedDbDeviceKeyStore();
  return new MemoryDeviceKeyStore();
}

/**
 * `instanceof CryptoKey` is not safe here: the constructor is absent in some
 * environments, and a value that came back from structured clone in a worker or
 * another realm would fail the check anyway.
 */
function isCryptoKey(value: unknown): value is DeviceKey {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<DeviceKey>;
  return typeof candidate.algorithm === 'object' && typeof candidate.type === 'string';
}
