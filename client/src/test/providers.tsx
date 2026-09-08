/**
 * The providers a component test needs before it can render a word.
 *
 * Anything that translates needs `I18nProvider`, which needs `SettingsProvider`
 * above it for the language choice. Rather than every test file rebuilding that
 * stack, they wrap in this.
 *
 * The locale is pinned to English on purpose. A test that reads its language
 * off the machine it runs on is a test that passes here and fails on somebody
 * else's laptop, and the point of these tests is the screen, not the
 * catalogue. The catalogue has tests of its own.
 */
import type { ReactNode } from 'react';
import { I18nProvider } from '../state/I18nProvider';
import { SettingsProvider } from '../state/SettingsProvider';
import { SettingsStore, type SettingsStorage } from '../lib/settings/store';

/** In memory, so one test's preferences cannot leak into the next one's. */
function scratchStorage(): SettingsStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider store={new SettingsStore(scratchStorage())}>
      <I18nProvider locale="en">{children}</I18nProvider>
    </SettingsProvider>
  );
}
