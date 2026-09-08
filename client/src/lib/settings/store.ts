/**
 * Where preferences live between sessions.
 *
 * localStorage, not the encrypted store in lib/storage. None of this is
 * secret, and putting it behind the key would mean a locked device could not
 * render itself in the right theme. The private key's store stays for the
 * private key.
 *
 * Reads are total: a missing, malformed, half-written or older blob all resolve
 * to defaults-plus-whatever-was-valid rather than throwing. A settings file is
 * the last thing that should be able to stop the app from starting.
 */
import { DEFAULT_SETTINGS, SETTINGS_VERSION, type Settings } from './types';

export const STORAGE_KEY = 'cipher/settings/v1';

/** The slice of the Storage API this needs, so tests can pass a fake. */
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type Section = keyof Omit<Settings, 'version'>;
type Listener = (settings: Settings) => void;

/**
 * Browsers throw on localStorage rather than returning null when storage is
 * blocked (Safari private mode, an embedded webview with cookies off), so
 * every access is guarded and failure degrades to in-memory settings.
 */
function browserStorage(): SettingsStorage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const probe = `${STORAGE_KEY}/probe`;
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

export class SettingsStore {
  private settings: Settings;
  private readonly listeners = new Set<Listener>();

  constructor(private readonly storage: SettingsStorage | null = browserStorage()) {
    this.settings = this.read();
  }

  get current(): Settings {
    return this.settings;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Change some fields of one section. Sections are flat, so a shallow merge is
   * the whole story: there is no nested-patch case to get wrong.
   */
  patch<K extends Section>(section: K, values: Partial<Settings[K]>): Settings {
    return this.commit({
      ...this.settings,
      [section]: { ...this.settings[section], ...values },
    });
  }

  /**
   * Change fields across several sections at once.
   *
   * One commit, so one write and one render. Switching profiles needs it:
   * it moves the live profile and the shelf it came off together, and doing
   * that as two patches would publish a state where they disagree.
   */
  patchSections(values: { [K in Section]?: Partial<Settings[K]> }): Settings {
    const next: Settings = { ...this.settings };
    for (const key of Object.keys(values) as Section[]) {
      // Object.assign rather than `next[key] = ...`: indexing with a union of
      // section names widens the target to the intersection of every section,
      // which nothing satisfies.
      Object.assign(next, { [key]: { ...this.settings[key], ...values[key] } });
    }
    return this.commit(next);
  }

  /** Restores one section, or everything, to the defaults. */
  reset(section?: Section): Settings {
    return this.commit(
      section
        ? { ...this.settings, [section]: { ...DEFAULT_SETTINGS[section] } }
        : clone(DEFAULT_SETTINGS),
    );
  }

  private commit(next: Settings): Settings {
    this.settings = next;
    this.write(next);
    for (const listener of this.listeners) listener(next);
    return next;
  }

  private read(): Settings {
    const raw = this.safely(() => this.storage?.getItem(STORAGE_KEY) ?? null, null);
    if (!raw) return clone(DEFAULT_SETTINGS);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return clone(DEFAULT_SETTINGS);
    }
    return merge(parsed);
  }

  private write(settings: Settings): void {
    this.safely(() => {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(settings));
      return null;
    }, null);
  }

  private safely<T>(action: () => T, fallback: T): T {
    try {
      return action();
    } catch {
      return fallback;
    }
  }
}

/**
 * Defaults, overwritten by any stored value of the right type.
 *
 * Type-checking each field rather than trusting the blob matters more here than
 * it looks: this is the one input to the app that a user can hand-edit, and a
 * string where a number belongs would otherwise reach a `calc()` or a slider.
 */
function merge(stored: unknown): Settings {
  if (!isRecord(stored)) return clone(DEFAULT_SETTINGS);

  const next = clone(DEFAULT_SETTINGS);
  next.version = SETTINGS_VERSION;

  for (const key of Object.keys(next) as (keyof Settings)[]) {
    if (key === 'version') continue;
    const section: Record<string, unknown> = next[key];
    const incoming = stored[key];
    if (!isRecord(incoming)) continue;

    for (const field of Object.keys(section)) {
      const value = incoming[field];
      if (value === undefined) continue;
      // Every nullable field in the schema is `string | null` (no device
      // chosen, no avatar, not muted) so a null default accepts either.
      const nullable = section[field] === null;
      if (value === null) {
        if (nullable) section[field] = null;
        continue;
      }
      // typeof an array is 'object', so without this branch a hand-edited file
      // could drop a plain object where a list belongs. What is inside is
      // checked where it is read (resolveSavedProfiles), on the same principle
      // as an unrecognised palette: fall back there rather than reject here.
      if (Array.isArray(section[field])) {
        if (Array.isArray(value)) section[field] = value;
        continue;
      }
      if (nullable ? typeof value === 'string' : typeof value === typeof section[field]) {
        section[field] = value;
      }
    }
  }

  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Settings are plain JSON by construction, so this is a complete copy. */
function clone(settings: Settings): Settings {
  return JSON.parse(JSON.stringify(settings)) as Settings;
}

export const settingsStore = new SettingsStore();
