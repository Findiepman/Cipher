/**
 * Preferences, and the small amount of work that makes them visible.
 *
 * The store is the source of truth; this is the React binding plus one effect
 * that writes the appearance choices onto <html> as data attributes and a CSS
 * variable. Doing it there rather than in a wrapper element means the theme is
 * also correct for anything painted outside the app root — the backdrop behind
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
import type { Settings } from '../lib/settings/types';

type Section = keyof Omit<Settings, 'version'>;

export interface SettingsContextValue {
  settings: Settings;
  update: <K extends Section>(section: K, values: Partial<Settings[K]>) => void;
  reset: (section?: Section) => void;
  /** `theme` after resolving 'system' against the OS. */
  resolvedTheme: 'dark' | 'light';
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

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const { density, fontScale, reduceMotion } = settings.appearance;

    root.dataset.theme = resolvedTheme;
    root.dataset.density = density;
    root.style.setProperty('--font-scale', String(fontScale));
    // An attribute rather than a class so the rule in global.css can be a
    // single selector, and so devtools shows the current state at a glance.
    if (reduceMotion) root.dataset.motion = 'reduced';
    else delete root.dataset.motion;
  }, [resolvedTheme, settings.appearance]);

  const update = useCallback<SettingsContextValue['update']>(
    (section, values) => {
      store.patch(section, values);
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
    () => ({ settings, update, reset, resolvedTheme }),
    [settings, update, reset, resolvedTheme],
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
