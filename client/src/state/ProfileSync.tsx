/**
 * Keeps the server's copy of your profile equal to this device's.
 *
 * Draws nothing. Mounted once, inside `authenticated`, where both the account
 * and the settings are in scope. Two effects, one per direction:
 *
 *   - When the account arrives, or arrives again after a refresh, its profile
 *     is written into settings. The server wins: its copy is what your friends
 *     have been looking at, and this device may be brand new. It goes through
 *     the settings provider's `update` rather than the store directly, so the
 *     saved profile slot that is loaded follows the change like any edit.
 *   - When a synced field changes locally, the difference is sent, after a
 *     short pause so a name typed letter by letter is one request rather than
 *     nine. The reply is the whole account, which becomes the new "last
 *     known", which is what makes the seed above a no-op rather than a loop:
 *     a seed produces settings equal to the server, and `toRequest` of two
 *     equal things is empty.
 *
 * A failed send is left alone. The local edit stays, the last known copy does
 * not move, and the next edit will carry the difference along. The settings
 * screen shows what you chose either way, which is the honest state: it is
 * what this device holds, and the server catches up when it can.
 */
import { useEffect, useRef } from 'react';
import type { OwnProfileDto } from '../lib/api/types';
import { isEmptyRequest, toLocal, toRequest } from '../lib/settings/profileSync';
import { useSession } from './SessionProvider';
import { useSettings } from './SettingsProvider';

/** Long enough to swallow typing, short enough that closing the tab rarely loses an edit. */
const SEND_AFTER_MS = 600;

export function ProfileSync() {
  const { account, auth, refresh } = useSession();
  const { settings, update } = useSettings();

  /* The server's copy as last seen, and which `updatedAt` was last written
     into settings. Refs rather than state: neither is drawn, and a state
     change here would only be a render for nobody. */
  const lastKnown = useRef<OwnProfileDto | null>(null);
  const seeded = useRef<string | null>(null);

  const profile = account?.profile ?? null;

  /* Server to device. Keyed on the profile's own timestamp: the account
     object is replaced on every refresh, but the profile only needs applying
     when it actually changed on the server. */
  useEffect(() => {
    if (!profile) return;
    lastKnown.current = profile;
    if (seeded.current === profile.updatedAt) return;
    seeded.current = profile.updatedAt;

    const patch = toLocal(profile);
    update('profile', patch.profile);
    update('privacy', patch.privacy);
  }, [profile, update]);

  /* Device to server. Depends on the two synced sections and nothing else in
     settings, so changing a palette never wakes this. */
  const synced = {
    profile: settings.profile,
    privacy: {
      readReceipts: settings.privacy.readReceipts,
      friendRequestsFrom: settings.privacy.friendRequestsFrom,
    },
  };
  const fingerprint = JSON.stringify(synced);

  useEffect(() => {
    if (!lastKnown.current || !account) return;
    const request = toRequest(synced, lastKnown.current);
    if (isEmptyRequest(request)) return;

    const timer = setTimeout(() => {
      void auth
        .updateProfile(request)
        .then((updated) => {
          lastKnown.current = updated.profile;
          // Marked as applied before the refresh lands, so the seed effect
          // does not write the reply back over an edit made in the meantime.
          seeded.current = updated.profile.updatedAt;
          return refresh();
        })
        .catch(() => {
          // Kept local. The next edit re-sends the whole difference.
        });
    }, SEND_AFTER_MS);

    return () => clearTimeout(timer);
    // `fingerprint` stands in for `synced`, which is a fresh object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint, account, auth, refresh]);

  return null;
}
