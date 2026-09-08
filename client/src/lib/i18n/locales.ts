/**
 * Which languages the app speaks.
 *
 * A locale is three things and they are kept together here: the tag the
 * browser's `Intl` needs, the name to show in the picker, and the direction it
 * is written in. The name is deliberately in the language itself, because
 * someone looking for Dutch is looking for "Nederlands" and not for "Dutch".
 *
 * `dir` is always 'ltr' today. It is carried anyway so the day a right to left
 * language is added the work is CSS rather than plumbing. See i18n-plan.md.
 */
export const LOCALES = ['en', 'nl'] as const;
export type Locale = (typeof LOCALES)[number];

/** 'system' follows the browser and is the default. */
export type LanguageChoice = Locale | 'system';

export interface LocaleInfo {
  /** What it calls itself. */
  name: string;
  /** English, for the sub-line, so a picker in the wrong language is escapable. */
  english: string;
  dir: 'ltr' | 'rtl';
}

export const LOCALE_INFO: Record<Locale, LocaleInfo> = {
  en: { name: 'English', english: 'English', dir: 'ltr' },
  nl: { name: 'Nederlands', english: 'Dutch', dir: 'ltr' },
};

export const DEFAULT_LOCALE: Locale = 'en';

/** Anything stored that is not a language we ship falls back, like the palette. */
export function resolveLanguage(value: string): LanguageChoice {
  if (value === 'system') return 'system';
  return (LOCALES as readonly string[]).includes(value) ? (value as Locale) : 'system';
}

/**
 * The best locale we have for what the browser asked for.
 *
 * Matched on the language subtag, so `nl-BE` and `nl-NL` both find Dutch. We
 * do not ship regional variants and the difference does not reach this UI.
 */
export function localeFromBrowser(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const base = tag.toLowerCase().split('-')[0];
    const hit = (LOCALES as readonly string[]).find((locale) => locale === base);
    if (hit) return hit as Locale;
  }
  return DEFAULT_LOCALE;
}

/** The choice, resolved against the browser when it is 'system'. */
export function resolveLocale(
  choice: LanguageChoice,
  languages: readonly string[],
): Locale {
  return choice === 'system' ? localeFromBrowser(languages) : choice;
}
