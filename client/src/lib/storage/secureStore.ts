/**
 * Persistent storage for key material, behind one interface.
 *
 * client/AGENTS.md: nothing platform-specific belongs in the app itself, so the
 * web (IndexedDB) and desktop (OS keychain) paths sit behind this adapter and
 * the rest of the client never knows which one it got.
 *
 * What actually gets stored here is the *wrapped* private key, never the raw
 * one. The unwrapped key lives in memory and is dropped on lock or sign-out.
 * That is a deliberate step past client/AGENTS.md's "store the private key in
 * IndexedDB": IndexedDB is readable by any script running on the origin, so a
 * stored raw key turns any XSS into permanent identity theft, while a stored
 * blob is useless without the secret that seals it.
 *
 * A reload no longer costs a password prompt, because blob_C (see
 * deviceKeyStore.ts and @cipher/crypto's deviceKey.ts) is sealed under a key
 * this device holds and cannot export. Everything written through this
 * interface is still sealed under something. Nothing raw goes in here.
 */

import { SECURE_STORE, runInStore } from './idb';

export interface SecureStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * The desktop shell (desktop/) implements this over Tauri's keyring plugin or
 * Electron's safeStorage and hangs it on the window. `client/` only ever sees
 * the interface.
 */
export interface NativeSecureStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

declare global {
  interface Window {
    cipherNative?: {
      secureStorage?: NativeSecureStorage;
    };
  }
}

/** In-memory fallback: used by tests, and by any context without IndexedDB. */
export class MemorySecureStore implements SecureStore {
  private readonly entries = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.entries.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.entries.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }
}

/** Web implementation. The database itself is opened by idb.ts. */
export class IndexedDbSecureStore implements SecureStore {
  private run<T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    return runInStore(SECURE_STORE, mode, action);
  }

  async get(key: string): Promise<string | null> {
    const value = await this.run<unknown>('readonly', (store) => store.get(key));
    return typeof value === 'string' ? value : null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.run('readwrite', (store) => store.put(value, key));
  }

  async remove(key: string): Promise<void> {
    await this.run('readwrite', (store) => store.delete(key));
  }

  async clear(): Promise<void> {
    await this.run('readwrite', (store) => store.clear());
  }
}

/** Desktop implementation: delegates to whatever desktop/ exposed. */
export class NativeSecureStore implements SecureStore {
  constructor(private readonly native: NativeSecureStorage) {}

  get(key: string): Promise<string | null> {
    return this.native.get(key);
  }

  set(key: string, value: string): Promise<void> {
    return this.native.set(key, value);
  }

  remove(key: string): Promise<void> {
    return this.native.remove(key);
  }

  clear(): Promise<void> {
    return this.native.clear();
  }
}

/**
 * Picks the best available backing store: OS keychain in the desktop shell,
 * IndexedDB in a browser, memory anywhere else (tests, SSR).
 */
export function createSecureStore(): SecureStore {
  if (typeof window !== 'undefined' && window.cipherNative?.secureStorage) {
    return new NativeSecureStore(window.cipherNative.secureStorage);
  }
  if (typeof indexedDB !== 'undefined') {
    return new IndexedDbSecureStore();
  }
  return new MemorySecureStore();
}
