/**
 * Keeps every non-profile setting in step with the account, both ways.
 *
 * Draws nothing. Mounted once inside `authenticated`, beside ProfileSync, which
 * owns the friend-facing half; this owns the rest, the whole settings blob the
 * server holds and never reads.
 *
 * The shape of the problem is a two-way sync with no merge: last write wins.
 * Each device keeps two small facts in its own localStorage, per account, that
 * never travel in the blob: `at`, the server timestamp it last agreed with, and
 * `dirty`, whether it is holding an edit the server has not taken yet.
 *
 * On sign-in it reconciles once:
 *
 *   - holding an unsynced edit  → push it; a local change is the freshest thing.
 *   - the server is newer        → take the server's copy.
 *   - the server has nothing yet → seed it with this device's.
 *   - already agreed             → do nothing.
 *
 * After that it watches the store and pushes, after a short pause so a slider
 * dragged across its range is one request. The loop guard is equality: applying
 * the server's blob leaves the store serializing to exactly the string just
 * agreed, so the watch that fires next sees no difference and sends nothing.
 */
import { useEffect, useRef } from 'react';
import { settingsStore } from '../lib/settings/store';
import { applySyncBlob, toSyncBlob } from '../lib/settings/settingsSync';
import { useSession } from './SessionProvider';

/** Long enough to swallow a drag or a burst of toggles, short enough to rarely lose one to a closed tab. */
const PUSH_AFTER_MS = 1_200;

function keys(accountId: string) {
  return {
    at: `cipher/settings-sync/${accountId}/at`,
    dirty: `cipher/settings-sync/${accountId}/dirty`,
  };
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // A device that cannot persist these still syncs within a session; it just
    // reconciles from scratch next launch, which is safe, only chattier.
  }
}

export function SettingsSync() {
  const { account, auth } = useSession();
  const accountId = account?.id ?? null;

  // The serialization last agreed with the server. Refs, because none of this
  // is drawn and a render for it would be a render for nobody.
  const lastSyncedSerialized = useRef<string | null>(null);
  const reconciledFor = useRef<string | null>(null);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!accountId) {
      reconciledFor.current = null;
      lastSyncedSerialized.current = null;
      return;
    }
    if (reconciledFor.current === accountId) return;

    let live = true;
    const k = keys(accountId);

    async function reconcile(): Promise<void> {
      const server = await auth.settings();
      if (!live) return;

      const current = toSyncBlob(settingsStore.current);
      const at = read(k.at);
      const dirty = read(k.dirty) === '1';

      if (dirty) {
        // This device is holding an edit. It is the freshest intent, so it wins.
        const { updatedAt } = await auth.putSettings(current);
        if (!live) return;
        write(k.at, updatedAt);
        write(k.dirty, null);
        lastSyncedSerialized.current = current;
      } else if (server.blob !== null && server.updatedAt !== at) {
        // The server has moved on since this device last agreed. Take it.
        applySyncBlob(settingsStore, server.blob);
        write(k.at, server.updatedAt);
        // The canonical serialization of what the store now holds, which an
        // older-version blob upgrades into, so the watch below stays quiet.
        lastSyncedSerialized.current = toSyncBlob(settingsStore.current);
      } else if (server.blob === null) {
        // Nothing on the account yet. Seed it.
        const { updatedAt } = await auth.putSettings(current);
        if (!live) return;
        write(k.at, updatedAt);
        lastSyncedSerialized.current = current;
      } else {
        // Already agreed.
        lastSyncedSerialized.current = current;
      }

      if (live) reconciledFor.current = accountId;
    }

    void reconcile().catch(() => {
      // A failed reconcile leaves the markers where they are: the device keeps
      // its settings, nothing is marked agreed, and the next mount tries again.
    });

    return () => {
      live = false;
    };
  }, [accountId, auth]);

  // Device to server. One subscription for the life of the mount, reading the
  // reconcile state through the refs so it does not need re-subscribing.
  useEffect(() => {
    const unsubscribe = settingsStore.subscribe(() => {
      if (!accountId || reconciledFor.current !== accountId) return;

      const current = toSyncBlob(settingsStore.current);
      if (current === lastSyncedSerialized.current) return;

      // A real local change. Mark it held so a reload before the push still
      // knows to prefer this device.
      write(keys(accountId).dirty, '1');

      if (pushTimer.current) clearTimeout(pushTimer.current);
      pushTimer.current = setTimeout(() => {
        const blob = toSyncBlob(settingsStore.current);
        void auth
          .putSettings(blob)
          .then(({ updatedAt }) => {
            const k = keys(accountId);
            write(k.at, updatedAt);
            write(k.dirty, null);
            lastSyncedSerialized.current = blob;
          })
          .catch(() => {
            // Left dirty on purpose: the next change, or the next launch,
            // carries it.
          });
      }, PUSH_AFTER_MS);
    });

    return () => {
      unsubscribe();
      if (pushTimer.current) clearTimeout(pushTimer.current);
    };
  }, [accountId, auth]);

  return null;
}
