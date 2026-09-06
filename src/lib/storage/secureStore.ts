/**
 * Persistent storage for key material, behind one interface.
 *
 * client/AGENTS.md: nothing platform-specific belongs in the app itself, so the
 * web (IndexedDB) and desktop (OS keychain) paths sit behind this adapter and
 * the rest of the client never knows which one it got.
 *
 * What actually gets stored here is the *wrapped* private key, never the raw
 * one. The unwrapped key lives in memory for the length of a session and is
 * dropped on lock or sign-out. That is a deliberate step past
 * client/AGENTS.md's "store the private key in IndexedDB": IndexedDB is
 * readable by any script running on the origin, so a stored raw key turns any
 * XSS into permanent identity theft, while a stored blob_A is useless without
 * the password. The cost is that a page reload asks for the password again.
 */

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

const DB_NAME = 'cipher';
const DB_VERSION = 1;
const STORE_NAME = 'secure';

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

/** Web implementation. */
export class IndexedDbSecureStore implements SecureStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(STORE_NAME)) {
            request.result.createObjectStore(STORE_NAME);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return this.dbPromise;
  }

  private async run<T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = action(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
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
