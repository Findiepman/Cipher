/**
 * The language the app is drawn in.
 *
 * Sits between SettingsProvider (which holds the choice) and everything that
 * renders words. It resolves 'system' against the browser once, writes `lang`
 * and `dir` onto <html> the same way the theme attributes are written, and
 * hands down a `t` that is already bound to the chosen catalogue.
 *
 * `t` is stable for a given locale, so a component that only translates does
 * not re-render when an unrelated setting changes.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import { en, type Key } from '../lib/i18n/en';
import { CATALOGUES } from '../lib/i18n/catalogues';
import {
  LOCALE_INFO,
  resolveLanguage,
  resolveLocale,
  type Locale,
} from '../lib/i18n/locales';
import { phraseOf } from '../lib/i18n/errors';
import { translate, type Phrase, type Vars } from '../lib/i18n/translate';
import { useSettings } from './SettingsProvider';

/**
 * Takes a key, or a `Phrase` from somewhere that could not translate itself.
 * One function rather than two, because callers should not have to know which
 * kind of thing they were handed.
 */
export type Translate = (key: Key | Phrase<Key>, vars?: Vars) => string;

export interface I18nContextValue {
  /** The language actually in use, after resolving 'system'. */
  locale: Locale;
  t: Translate;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/** What the browser says it wants, in preference order. */
function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages ?? (navigator.language ? [navigator.language] : []);
}

export function I18nProvider({
  children,
  locale: forced,
}: {
  children: ReactNode;
  /** Pins the language. For tests, which should not depend on the browser. */
  locale?: Locale;
}) {
  const { settings } = useSettings();

  const locale =
    forced ?? resolveLocale(resolveLanguage(settings.language.choice), browserLanguages());

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.lang = locale;
    // Always 'ltr' today. Written anyway, so that adding a right to left
    // language is a CSS problem and not a plumbing one. See i18n-plan.md.
    root.dir = LOCALE_INFO[locale].dir;
  }, [locale]);

  const t = useCallback<Translate>(
    (key, vars) =>
      typeof key === 'string'
        ? translate(key, locale, CATALOGUES[locale], en, vars)
        : translate(key.key, locale, CATALOGUES[locale], en, vars ?? key.vars),
    [locale],
  );

  const value = useMemo<I18nContextValue>(() => ({ locale, t }), [locale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * A failure in words.
 *
 * A failure the app named itself carries a catalogue key and reads in your
 * language. One the server wrote arrives as a sentence, and comes through as
 * it was written: it knows what went wrong in more detail than we do, and
 * replacing it with a translated generic would trade accuracy for language.
 * Anything that is not an error at all gets the fallback.
 */
export function describeError(caught: unknown, t: Translate, fallback: Key = 'common.wrong'): string {
  const phrase = phraseOf(caught);
  if (phrase) return t(phrase);
  if (caught instanceof Error) return caught.message;
  return t(fallback);
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside an <I18nProvider>');
  return context;
}

/** The common case, so components read `const t = useT()`. */
export function useT(): Translate {
  return useI18n().t;
}
