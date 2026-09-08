/**
 * Every catalogue, keyed by locale.
 *
 * Its own file so that `en.ts` stays a plain list of strings with no imports
 * of its neighbours, and so adding a language is one import and one entry.
 */
import { en, type Key } from './en';
import { nl } from './nl';
import type { Locale } from './locales';
import type { Catalogue } from './translate';

export const CATALOGUES: Record<Locale, Catalogue<Key>> = { en, nl };
