/**
 * The checks that keep two catalogues honest about each other.
 *
 * `tsc` already refuses a key that does not exist and refuses a translation
 * that invents one, so what is left is everything the type system cannot see:
 * a translation that is simply missing, one that dropped a `{placeholder}` and
 * would render a sentence with a hole in it, one that answers a plural with a
 * single form, and house style.
 *
 * The last test is the one worth keeping honest. It walks the source looking
 * for keys nobody uses, because an unused entry is copy that has drifted out
 * of the app without anyone noticing, and it is also the first thing to rot
 * when a screen is rewritten.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from './en';
import { nl } from './nl';
import { LOCALES } from './locales';
import { CATALOGUES } from './catalogues';
import type { Message } from './translate';

type Key = keyof typeof en;

const KEYS = Object.keys(en) as Key[];
const PLACEHOLDER = /\{(\w+)\}/g;

/** Every `{name}` in an entry, whichever of its plural forms they live in. */
function placeholders(message: Message): Set<string> {
  const text =
    typeof message === 'string' ? message : Object.values(message).filter(Boolean).join(' ');
  return new Set([...text.matchAll(PLACEHOLDER)].map((match) => match[1]));
}

function isPlural(message: Message): boolean {
  return typeof message !== 'string';
}

describe('the Dutch catalogue', () => {
  it('has an entry for every English one', () => {
    const missing = KEYS.filter((key) => nl[key] === undefined);
    // Named rather than counted: a failure here should say which strings would
    // come out in English, not just how many.
    expect(missing).toEqual([]);
  });

  it('keeps every placeholder, so no sentence renders with a hole in it', () => {
    const broken: string[] = [];
    for (const key of KEYS) {
      const translated = nl[key];
      if (translated === undefined) continue;
      const wanted = [...placeholders(en[key])].sort();
      const got = [...placeholders(translated)].sort();
      if (wanted.join(',') !== got.join(',')) {
        broken.push(`${key}: expected {${wanted.join('} {')}}, got {${got.join('} {')}}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('answers a plural with a plural', () => {
    const mismatched = KEYS.filter(
      (key) => nl[key] !== undefined && isPlural(en[key]) !== isPlural(nl[key]!),
    );
    expect(mismatched).toEqual([]);
  });
});

describe('house style', () => {
  it('uses no em dashes or en dashes, in any language', () => {
    const offenders: string[] = [];
    for (const locale of LOCALES) {
      const catalogue = CATALOGUES[locale];
      for (const key of KEYS) {
        const message = catalogue[key];
        if (message === undefined) continue;
        const text =
          typeof message === 'string' ? message : Object.values(message).join(' ');
        if (/[—–]/.test(text)) offenders.push(`${locale}: ${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the English catalogue', () => {
  it('has no entry the app never asks for', () => {
    const source = readSource(join(__dirname, '..', '..'));
    // A key is written as a literal everywhere it is used, whether that is a
    // `t()` call, a table of options or a JSX attribute, so a substring search
    // finds all of them without needing to parse TypeScript. Both quote styles
    // count: JSX attributes are double quoted and everything else is not.
    const unused = KEYS.filter(
      (key) => !source.includes(`'${key}'`) && !source.includes(`"${key}"`),
    );
    expect(unused).toEqual([]);
  });
});

/** Every source file under `src`, concatenated, minus the catalogues. */
function readSource(root: string): string {
  const chunks: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (/\.tsx?$/.test(entry) && !path.includes(join('lib', 'i18n'))) {
        chunks.push(readFileSync(path, 'utf8'));
      }
    }
  };
  walk(root);
  return chunks.join('\n');
}
