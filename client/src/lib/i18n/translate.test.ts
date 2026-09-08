/**
 * The lookup itself.
 *
 * Small enough to read in one sitting, which is the point of not taking a
 * dependency for it, and worth testing precisely because it is the one piece
 * every string in the app goes through.
 */
import { describe, expect, it } from 'vitest';
import { translate, type Catalogue, type Message } from './translate';
import { clockTime, shortDay } from './format';
import { localeFromBrowser, resolveLanguage, resolveLocale } from './locales';

type K = 'plain' | 'greeting' | 'notes' | 'big';

const source: Record<K, Message> = {
  plain: 'Locked',
  greeting: 'Hello {name}.',
  notes: { one: '{count} note', other: '{count} notes' },
  big: 'about {count} combinations',
};

const dutch: Catalogue<K> = {
  plain: 'Vergrendeld',
  greeting: 'Hallo {name}.',
  notes: { one: '{count} notitie', other: '{count} notities' },
};

const say = (key: K, locale: 'en' | 'nl', vars?: Record<string, string | number>) =>
  translate(key, locale, locale === 'en' ? source : dutch, source, vars);

describe('looking a string up', () => {
  it('prefers the chosen language', () => {
    expect(say('plain', 'nl')).toBe('Vergrendeld');
  });

  it('falls back to English rather than rendering nothing', () => {
    // `big` has no Dutch entry. A blank space where a sentence should be is
    // the one outcome worse than the wrong language.
    expect(say('big', 'nl', { count: 1000 })).toBe('about 1.000 combinations');
  });

  it('leaves a placeholder alone when nothing was passed for it', () => {
    expect(say('greeting', 'en')).toBe('Hello {name}.');
  });
});

describe('plurals', () => {
  it('picks the form the language asks for', () => {
    expect(say('notes', 'en', { count: 1 })).toBe('1 note');
    expect(say('notes', 'en', { count: 4 })).toBe('4 notes');
    expect(say('notes', 'nl', { count: 1 })).toBe('1 notitie');
    expect(say('notes', 'nl', { count: 0 })).toBe('0 notities');
  });
});

describe('numbers in a sentence', () => {
  it('formats them the way the language writes them', () => {
    // English groups with a comma, Dutch with a full stop. A raw 1234 in the
    // middle of a Dutch sentence is what makes a translation feel machine made.
    expect(say('big', 'en', { count: 1234 })).toBe('about 1,234 combinations');
    expect(say('notes', 'nl', { count: 1234 })).toBe('1.234 notities');
  });
});

describe('dates and times', () => {
  const at = new Date('2026-09-08T14:32:00');

  it('writes the day the way the language does', () => {
    expect(shortDay(at, 'en')).toMatch(/Sep/);
    expect(shortDay(at, 'nl')).toMatch(/sep/);
  });

  it('stays on a 24 hour clock in both, which is what the app already did', () => {
    expect(clockTime(at, 'en')).toBe('14:32');
    expect(clockTime(at, 'nl')).toBe('14:32');
  });

  it('says nothing at all about a date it cannot read', () => {
    expect(clockTime('not a date', 'en')).toBe('');
    expect(shortDay('not a date', 'en')).toBe('');
  });
});

describe('choosing a locale', () => {
  it('matches on the language, not the region', () => {
    expect(localeFromBrowser(['nl-BE', 'fr'])).toBe('nl');
    expect(localeFromBrowser(['en-GB'])).toBe('en');
  });

  it('falls back to English for a language we do not ship', () => {
    expect(localeFromBrowser(['fr-FR', 'de'])).toBe('en');
    expect(localeFromBrowser([])).toBe('en');
  });

  it('lets an explicit choice beat the browser', () => {
    expect(resolveLocale('nl', ['en-GB'])).toBe('nl');
    expect(resolveLocale('system', ['nl'])).toBe('nl');
  });

  it('reads a stored value it does not recognise as "follow the browser"', () => {
    // Same rule as the palette: a hand-edited settings file should not be able
    // to leave the app with no language at all.
    expect(resolveLanguage('klingon')).toBe('system');
    expect(resolveLanguage('nl')).toBe('nl');
  });
});
