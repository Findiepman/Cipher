/**
 * The one place that opens the `cipher` IndexedDB database.
 *
 * Two stores live in it and they hold different kinds of thing:
 *
 *   secure  strings. The wrapped private key, the outbox, anything that has an
 *           equivalent on the desktop side of `SecureStore`.
 *   device  the non-extractable `CryptoKey` that seals blob_C. A live object,
 *           never a string, which is exactly why it cannot share the interface
 *           above.
 *
 * They share one open because they must. `indexedDB.open` takes a version per
 * database, not per store, so two modules opening `cipher` at different
 * versions would deadlock: the connection held at the older version blocks the
 * upgrade the newer one is waiting on, and neither call ever settles. Add a
 * store by bumping `DB_VERSION` here and creating it in the one upgrade
 * handler below.
 */
const DB_NAME = 'cipher';
/** v1 was `secure` alone. v2 adds `device`. */
const DB_VERSION = 2;

export const SECURE_STORE = 'secure';
export const DEVICE_STORE = 'device';

let dbPromise: Promise<IDBDatabase> | null = null;

export function openCipherDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        // Guarded rather than unconditional: this runs for a fresh database and
        // for a v1 one being upgraded, and only the second already has `secure`.
        for (const name of [SECURE_STORE, DEVICE_STORE]) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    // A failed open must not be cached, or every later call gets the same
    // rejection without ever retrying.
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

/** Runs one request inside a transaction on `store` and resolves its result. */
export async function runInStore<T>(
  store: string,
  mode: IDBTransactionMode,
  action: (objectStore: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openCipherDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const request = action(transaction.objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
