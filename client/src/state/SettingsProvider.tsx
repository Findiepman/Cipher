/**
 * Preferences, and the small amount of work that makes them visible.
 *
 * The store is the source of truth; this is the React binding plus one effect
 * that writes the appearance choices onto <html> as data attributes and a CSS
 * variable. Doing it there rather than in a wrapper element means the theme is
 * also correct for anything painted outside the app root, such as the backdrop behind
 * a dialog, the scrollbars, the page's own background during a reload.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { SettingsStore, settingsStore as defaultStore } from '../lib/settings/store';
import {
  resolveSavedProfiles,
  type ProfilesState,
} from '../lib/settings/savedProfiles';
import {
  WALLPAPER_BLUR_RANGE,
  WALLPAPER_DIM_RANGE,
  clampToRange,
  readableInk,
  resolveHex,
  resolvePalette,
  resolvePicture,
  type Palette,
  type SavedProfile,
  type Settings,
} from '../lib/settings/types';

type Section = keyof Omit<Settings, 'version'>;

export interface SettingsContextValue {
  settings: Settings;
  update: <K extends Section>(section: K, values: Partial<Settings[K]>) => void;
  reset: (section?: Section) => void;
  /** `theme` after resolving 'system' against the OS. */
  resolvedTheme: 'dark' | 'light';
  /** `palette` after discarding anything that is not a palette we ship. */
  resolvedPalette: Palette;
  /** The shelf, after dropping anything in storage that is not a profile. */
  savedProfiles: SavedProfile[];
  /**
   * Moves the live profile and the shelf together.
   *
   * The reducers in lib/settings/savedProfiles.ts work out what the pair
   * should become; this commits it in one write, so no render ever sees the
   * two disagreeing about which profile is loaded.
   */
  applyProfiles: (next: ProfilesState) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

const DARK_QUERY = '(prefers-color-scheme: dark)';

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return window.matchMedia(DARK_QUERY).matches;
}

export function SettingsProvider({
  children,
  store = defaultStore,
}: {
  children: ReactNode;
  /** Injectable for tests and Storybook. */
  store?: SettingsStore;
}) {
  const settings = useSyncExternalStore(
    useCallback((listener) => store.subscribe(listener), [store]),
    useCallback(() => store.current, [store]),
    useCallback(() => store.current, [store]),
  );

  // Tracked rather than read on demand, so "System" follows the OS live
  // instead of only at startup.
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia(DARK_QUERY);
    const handle = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    query.addEventListener('change', handle);
    return () => query.removeEventListener('change', handle);
  }, []);

  const resolvedTheme: 'dark' | 'light' =
    settings.appearance.theme === 'system'
      ? prefersDark
        ? 'dark'
        : 'light'
      : settings.appearance.theme;

  const resolvedPalette = resolvePalette(settings.appearance.palette);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const {
      density,
      fontScale,
      reduceMotion,
      customAccent,
      customTint,
      wallpaper,
      wallpaperDim,
      wallpaperBlur,
    } = settings.appearance;

    // Two attributes rather than one combined value: styles/theme.css picks the
    // colour block from the pair, so light or dark stays a separate choice from
    // which palette it is drawn in.
    root.dataset.theme = resolvedTheme;
    root.dataset.palette = resolvedPalette;
    root.dataset.density = density;
    root.style.setProperty('--font-scale', String(fontScale));

    // The custom palette's two colours, written whether or not it is the one in
    // use: the swatch offering it in Appearance is painted from them too, and a
    // preview of a palette you have not picked yet is the point of that row.
    // Everything else in that block is mixed out of these by theme.css.
    const accent = resolveHex(customAccent, '#f2734e');
    root.style.setProperty('--custom-accent', accent);
    root.style.setProperty('--custom-tint', resolveHex(customTint, '#6b4a3a'));
    root.style.setProperty('--custom-ink', readableInk(accent));

    // The one setting in this file that ends up inside a CSS url(), so it goes
    // through the resolver rather than out of the blob: see resolvePicture.
    const picture = resolvePicture(wallpaper);
    if (picture) {
      root.style.setProperty('--wallpaper', `url("${picture}")`);
      root.style.setProperty(
        '--wallpaper-dim',
        String(clampToRange(wallpaperDim, WALLPAPER_DIM_RANGE) / 100),
      );
      root.style.setProperty(
        '--wallpaper-blur',
        `${clampToRange(wallpaperBlur, WALLPAPER_BLUR_RANGE)}px`,
      );
      root.dataset.wallpaper = 'on';
    } else {
      root.style.removeProperty('--wallpaper');
      delete root.dataset.wallpaper;
    }

    // An attribute rather than a class so the rule in global.css can be a
    // single selector, and so devtools shows the current state at a glance.
    if (reduceMotion) root.dataset.motion = 'reduced';
    else delete root.dataset.motion;
  }, [resolvedTheme, resolvedPalette, settings.appearance]);

  const savedProfiles = useMemo(
    () => resolveSavedProfiles(settings.profiles.saved),
    [settings.profiles.saved],
  );

  /**
   * Editing the live profile also writes it into the saved profile it came
   * from, so switching away can never lose the change and there is no
   * unsaved-changes state for anyone to reason about. When nothing is loaded
   * from the shelf this is an ordinary patch.
   */
  const update = useCallback<SettingsContextValue['update']>(
    (section, values) => {
      const { active, saved } = store.current.profiles;
      if (section !== 'profile' || !active) {
        store.patch(section, values);
        return;
      }
      const profile = { ...store.current.profile, ...(values as Partial<Settings['profile']>) };
      store.patchSections({
        profile,
        profiles: {
          saved: saved.map((entry) =>
            entry.id === active ? { ...entry, profile } : entry,
          ),
        },
      });
    },
    [store],
  );

  const applyProfiles = useCallback<SettingsContextValue['applyProfiles']>(
    (next) => {
      store.patchSections({ profile: next.profile, profiles: next.profiles });
    },
    [store],
  );

  const reset = useCallback(
    (section?: Section) => {
      store.reset(section);
    },
    [store],
  );

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      update,
      reset,
      resolvedTheme,
      resolvedPalette,
      savedProfiles,
      applyProfiles,
    }),
    [
      settings,
      update,
      reset,
      resolvedTheme,
      resolvedPalette,
      savedProfiles,
      applyProfiles,
    ],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used inside a <SettingsProvider>');
  }
  return context;
}
