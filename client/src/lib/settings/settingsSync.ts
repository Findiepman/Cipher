/**
 * Turning the settings store into the blob that syncs, and back.
 *
 * Everything a person sets follows their account to every device, as one JSON
 * blob the server holds and never reads (server/AGENTS.md is about message
 * content, and this is not that). The friend-facing half of a profile is not in
 * here: it goes through the account profile instead (lib/settings/profileSync.ts),
 * so that going invisible does not have to ship a wallpaper. What is left is
 * everything else, and this file is the one place that knows which sections
 * that is.
 *
 * Two things are deliberately left out on top of `profile`: the two privacy
 * fields the server enforces (`readReceipts`, `friendRequestsFrom`) also ride
 * on the profile, so the blob carries only the other two privacy toggles.
 * Applying the blob patches those two fields and leaves the enforced pair as
 * the profile put them.
 */
import { mergeStoredSettings, type SettingsStore } from './store';
import type { Settings } from './types';

/**
 * The sections carried whole. Everything the store has except `profile` (the
 * account's job) and `privacy` (only two of its fields sync, handled apart).
 */
const WHOLE_SECTIONS = [
  'profiles',
  'sidebar',
  'language',
  'appearance',
  'voice',
  'notifications',
  'desktop',
] as const;

/**
 * The synced subset as a plain object, in a fixed key order so two devices
 * running the same code serialize an identical settings state to an identical
 * string. That equality is the whole of the loop guard: a device that has just
 * applied the server's blob produces this same string and so sends nothing back.
 */
function syncedSubset(settings: Settings): Record<string, unknown> {
  const subset: Record<string, unknown> = { version: settings.version };
  for (const section of WHOLE_SECTIONS) {
    subset[section] = settings[section];
  }
  // Only the two toggles that are ours. The enforced pair belongs to the
  // profile channel, and putting them here would let a stale blob fight it.
  subset.privacy = {
    typingIndicators: settings.privacy.typingIndicators,
    linkPreviews: settings.privacy.linkPreviews,
  };
  return subset;
}

/** The synced subset, serialized. What is stored on the account. */
export function toSyncBlob(settings: Settings): string {
  return JSON.stringify(syncedSubset(settings));
}

/**
 * Applies a blob received from the account onto the store.
 *
 * The blob is as untrusted as anything hand-edited on disk, so it goes through
 * the same field-by-field type check the store uses for its own localStorage
 * (`mergeStoredSettings`): a wrong-typed value falls back to the default rather
 * than reaching a slider or a `calc()`. Returns false for a blob that will not
 * parse, so the caller can leave `lastSynced` where it was and try again.
 *
 * It never writes `profile` or the two enforced privacy fields: those are the
 * profile channel's, and overwriting them here would undo what it just set.
 */
export function applySyncBlob(store: SettingsStore, blob: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(blob);
  } catch {
    return false;
  }

  const merged = mergeStoredSettings(parsed);

  store.patchSections({
    profiles: merged.profiles,
    sidebar: merged.sidebar,
    language: merged.language,
    appearance: merged.appearance,
    voice: merged.voice,
    notifications: merged.notifications,
    desktop: merged.desktop,
    privacy: {
      typingIndicators: merged.privacy.typingIndicators,
      linkPreviews: merged.privacy.linkPreviews,
    },
  });

  return true;
}
