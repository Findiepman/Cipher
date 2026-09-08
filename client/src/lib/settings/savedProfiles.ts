/**
 * Named profiles you can keep and switch between.
 *
 * The model in one line: `settings.profile` is the profile you are wearing,
 * and `settings.profiles.saved` is the wardrobe. Everything in the app already
 * reads the live one, so none of that had to change; this file is only about
 * the shelf.
 *
 * Two things follow from that split and are worth stating, because they are
 * the whole design:
 *
 *   1. Editing the live profile mirrors straight into its slot. There is no
 *      save button and no unsaved-changes state, because a wardrobe where
 *      taking something off could lose the alterations is a bad wardrobe.
 *      SettingsProvider does the mirroring.
 *   2. Having nothing saved is a real state, not a first row. Until you save
 *      something, `saved` is empty and `active` is '', and the app behaves
 *      exactly as it did before this file existed.
 *
 * The functions here are pure and take both sections together, because every
 * operation moves both of them and doing that in two steps would publish a
 * moment where they disagree about which profile is loaded.
 */
import { DEFAULT_SETTINGS, type ProfileSettings, type ProfilesSettings, type SavedProfile } from './types';

/**
 * Enough to be useful, few enough that the row of them stays a row.
 *
 * Storage is not the reason: an avatar is re-encoded to a 128px WebP before it
 * is ever stored, so a full shelf is tens of kilobytes against a localStorage
 * budget measured in megabytes. The reason is that a picker with forty entries
 * is not a picker.
 */
export const MAX_PROFILES = 10;

export const MAX_PROFILE_NAME = 24;

/** Both sections at once. Every function below takes and returns this pair. */
export interface ProfilesState {
  profile: ProfileSettings;
  profiles: ProfilesSettings;
}

/**
 * Snapshots the live profile under a name and wears it.
 *
 * Saving does not change how you look, which is the point: the profile you
 * were already using is the one that gets kept, and it stays loaded.
 */
export function saveAs(state: ProfilesState, name: string): ProfilesState {
  if (state.profiles.saved.length >= MAX_PROFILES) return state;
  const entry: SavedProfile = {
    id: newId(),
    name: nameFor(name, state.profiles.saved),
    profile: { ...state.profile },
  };
  return {
    profile: state.profile,
    profiles: { active: entry.id, saved: [...state.profiles.saved, entry] },
  };
}

/**
 * Adds a profile that is not a copy of anything, and wears it.
 *
 * The live profile is written back to its own slot on the way out, which is
 * the same thing switching does. Starting from the defaults rather than from
 * what you are wearing is deliberate: duplicating is a separate button, and a
 * "new" that arrives already looking like the old one is a rename trap.
 */
export function addBlank(state: ProfilesState, name: string): ProfilesState {
  if (state.profiles.saved.length >= MAX_PROFILES) return state;
  const shelved = mirror(state);
  const entry: SavedProfile = {
    id: newId(),
    name: nameFor(name, shelved),
    profile: { ...DEFAULT_SETTINGS.profile },
  };
  return {
    profile: entry.profile,
    profiles: { active: entry.id, saved: [...shelved, entry] },
  };
}

/** Copies one profile under a new name and wears the copy. */
export function duplicate(state: ProfilesState, id: string, name: string): ProfilesState {
  if (state.profiles.saved.length >= MAX_PROFILES) return state;
  const shelved = mirror(state);
  const source = shelved.find((entry) => entry.id === id);
  if (!source) return state;
  const entry: SavedProfile = {
    id: newId(),
    name: nameFor(name, shelved),
    profile: { ...source.profile },
  };
  return {
    profile: entry.profile,
    profiles: { active: entry.id, saved: [...shelved, entry] },
  };
}

/**
 * Wears a different saved profile.
 *
 * The one being taken off is written back first. That is what makes the
 * mirroring in the provider a convenience rather than a requirement: even if
 * an edit somehow never reached the slot, it is captured here.
 */
export function switchTo(state: ProfilesState, id: string): ProfilesState {
  if (id === state.profiles.active) return state;
  const shelved = mirror(state);
  const target = shelved.find((entry) => entry.id === id);
  if (!target) return state;
  return {
    profile: { ...target.profile },
    profiles: { active: id, saved: shelved },
  };
}

export function rename(state: ProfilesState, id: string, name: string): ProfilesState {
  const trimmed = name.trim().slice(0, MAX_PROFILE_NAME);
  if (!trimmed) return state;
  return {
    profile: state.profile,
    profiles: {
      ...state.profiles,
      saved: state.profiles.saved.map((entry) =>
        entry.id === id ? { ...entry, name: trimmed } : entry,
      ),
    },
  };
}

/**
 * Forgets a saved profile.
 *
 * Deleting the one you are wearing does not undress you: the live profile
 * stays exactly as it is and simply stops belonging to a slot. Anything else
 * would mean a delete could change your name and picture out from under you.
 */
export function remove(state: ProfilesState, id: string): ProfilesState {
  const saved = state.profiles.saved.filter((entry) => entry.id !== id);
  if (saved.length === state.profiles.saved.length) return state;
  return {
    profile: state.profile,
    profiles: { active: state.profiles.active === id ? '' : state.profiles.active, saved },
  };
}

/** Writes the live profile back into whichever slot it came from. */
function mirror(state: ProfilesState): SavedProfile[] {
  const { active, saved } = state.profiles;
  if (!active) return saved;
  return saved.map((entry) =>
    entry.id === active ? { ...entry, profile: { ...state.profile } } : entry,
  );
}

/**
 * A name that is not already taken, because the picker shows names and two
 * identical chips are two chips you have to click to tell apart.
 */
function nameFor(wanted: string, taken: SavedProfile[]): string {
  const base = wanted.trim().slice(0, MAX_PROFILE_NAME) || 'Profile';
  const names = new Set(taken.map((entry) => entry.name));
  if (!names.has(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${base} ${n}`;
    if (!names.has(candidate)) return candidate;
  }
  return base;
}

/** The name a new profile gets offered, given what is already on the shelf. */
export function suggestName(saved: SavedProfile[]): string {
  return nameFor(`Profile ${saved.length + 1}`, saved);
}

function newId(): string {
  return crypto.randomUUID();
}

/**
 * Reads a stored list back, dropping anything that is not a profile.
 *
 * The settings store type-checks a blob field by field but cannot look inside
 * an array, so this is where a hand-edited file gets caught. Same rule as
 * `resolvePalette`: fall back quietly rather than refuse to start, because a
 * settings file is the last thing that should be able to stop the app.
 */
export function resolveSavedProfiles(value: unknown): SavedProfile[] {
  if (!Array.isArray(value)) return [];
  const out: SavedProfile[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) continue;
    if (typeof item.id !== 'string' || !item.id || seen.has(item.id)) continue;
    if (typeof item.name !== 'string' || !item.name.trim()) continue;
    seen.add(item.id);
    out.push({
      id: item.id,
      name: item.name.slice(0, MAX_PROFILE_NAME),
      profile: resolveProfile(item.profile),
    });
    if (out.length === MAX_PROFILES) break;
  }
  return out;
}

/**
 * Defaults, overwritten by any stored field of the right type.
 *
 * Every field of a profile is a string, except `avatar`, which is a string or
 * null. That makes this shorter than it looks: a string is taken, null is
 * taken only where null means something, and anything else is ignored.
 */
function resolveProfile(value: unknown): ProfileSettings {
  const profile: ProfileSettings = { ...DEFAULT_SETTINGS.profile };
  if (!isRecord(value)) return profile;

  for (const field of Object.keys(profile) as (keyof ProfileSettings)[]) {
    const incoming = value[field];
    if (field === 'avatar' && incoming === null) {
      profile.avatar = null;
      continue;
    }
    if (typeof incoming !== 'string') continue;
    // Presence is the one string that is really a union, and it reaches the
    // DOM as a class suffix, so an unknown one would paint nothing at all.
    if (field === 'presence' && !PRESENCES.includes(incoming)) continue;
    Object.assign(profile, { [field]: incoming });
  }
  return profile;
}

const PRESENCES: readonly string[] = ['online', 'idle', 'dnd', 'offline'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
