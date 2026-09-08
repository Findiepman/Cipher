/**
 * Looking a string up and filling in the gaps.
 *
 * The whole of it: find the key in the chosen catalogue, fall back to English
 * if it is not there, pick a plural form if the entry has more than one, and
 * substitute `{name}` placeholders. That is all an app this size needs, and it
 * is why there is no library here.
 *
 * Keys are typed against the English catalogue, so a key that does not exist
 * is a compile error rather than a string that renders as `vault.setuup.title`
 * in front of somebody. That check is the reason the sweep was survivable.
 */
import type { Locale } from './locales';

/** A plural entry. English and Dutch use both forms; the shape allows more. */
export interface Plural {
  zero?: string;
  one: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

export type Message = string | Plural;

/** What a substitution can be. Numbers are formatted in the locale. */
export type Vars = Record<string, string | number>;

/**
 * A string a module wants to say, without knowing the language.
 *
 * Modules under `lib/` produce user-facing prose (a passkey is too short, a
 * file is too big, this many combinations) but have no business holding a
 * `t`. They return one of these instead, and whichever component renders it
 * does the translating. It is the same split as everywhere else here: the
 * logic decides what to say, the view decides how to say it.
 */
export interface Phrase<K extends string = string> {
  key: K;
  vars?: Vars;
}

/**
 * A catalogue is keyed by the English one, so a translation cannot invent a
 * key and cannot be missed by `tsc` when the English changes shape.
 */
export type Catalogue<K extends string> = Partial<Record<K, Message>>;

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * `count` is the only var that selects a plural form, by convention and
 * because inventing a second one would mean deciding what two counts in one
 * sentence should do.
 */
export function translate<K extends string>(
  key: K,
  locale: Locale,
  catalogue: Catalogue<K>,
  fallback: Record<K, Message>,
  vars?: Vars,
): string {
  const entry = catalogue[key] ?? fallback[key];
  const template = typeof entry === 'string' ? entry : pick(entry, locale, vars);
  return fill(template, locale, vars);
}

function pick(entry: Plural, locale: Locale, vars?: Vars): string {
  const count = typeof vars?.count === 'number' ? vars.count : 0;
  // `select` returns a category the entry may not carry (Welsh has six), so
  // `other` is the backstop, which every entry is required to have.
  const category = pluralRules(locale).select(count) as keyof Plural;
  return entry[category] ?? entry.other;
}

function fill(template: string, locale: Locale, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(PLACEHOLDER, (whole, name: string) => {
    const value = vars[name];
    if (value === undefined) return whole;
    // A count reaching a sentence unformatted would print 1234 where Dutch
    // wants 1.234, which is the sort of detail that makes a translation feel
    // machine made.
    return typeof value === 'number' ? numberFormat(locale).format(value) : value;
  });
}

/**
 * `Intl` objects are expensive to build and are built per render otherwise,
 * so both are memoised. There are two locales, so the map cannot grow.
 */
const plurals = new Map<Locale, Intl.PluralRules>();
const numbers = new Map<Locale, Intl.NumberFormat>();

function pluralRules(locale: Locale): Intl.PluralRules {
  let rules = plurals.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    plurals.set(locale, rules);
  }
  return rules;
}

function numberFormat(locale: Locale): Intl.NumberFormat {
  let format = numbers.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale);
    numbers.set(locale, format);
  }
  return format;
}
