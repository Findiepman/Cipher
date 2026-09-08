/**
 * The passkey rules, and the sentence the UI uses to be honest about them.
 *
 * These functions return catalogue keys now rather than sentences, because
 * they have no idea what language they are being read in. The tests still
 * assert on the English, through `translate`, because a key on its own proves
 * nothing about whether the number got into the sentence: `say()` below is
 * exactly what the screen does with what it is handed.
 */
import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { nl } from '../i18n/nl';
import { translate, type Phrase } from '../i18n/translate';
import { checkPasskey, combinations, kindOf } from './passkeyPolicy';

function say(phrase: Phrase<keyof typeof en>, locale: 'en' | 'nl' = 'en'): string {
  return translate(phrase.key, locale, locale === 'en' ? en : nl, en, phrase.vars);
}

describe('checkPasskey', () => {
  it('accepts a plain PIN of the minimum length', () => {
    expect(checkPasskey('318842', 'digits').ok).toBe(true);
  });

  it('rejects a PIN that is too short, and says by how much', () => {
    const check = checkPasskey('3188', 'digits');
    expect(check.ok).toBe(false);
    expect(say(check.problems[0])).toBe('Use at least 6 digits.');
  });

  it('holds each shape to its own alphabet', () => {
    expect(checkPasskey('3188a2', 'digits').problems.map((one) => say(one))).toContain(
      'Digits only, no letters.',
    );
    expect(checkPasskey('what-a-key', 'mixed').problems.map((one) => say(one))).toContain(
      'Letters and digits only.',
    );
  });

  it('turns away the two patterns everybody tries first', () => {
    expect(checkPasskey('111111', 'digits').ok).toBe(false);
    expect(checkPasskey('123456', 'digits').ok).toBe(false);
    expect(checkPasskey('87654321', 'mixed').ok).toBe(false);
  });

  it('wants more from letters and digits than from a PIN', () => {
    expect(checkPasskey('abc12345', 'mixed').ok).toBe(true);
    expect(checkPasskey('abc123', 'mixed').ok).toBe(false);
  });
});

describe('combinations', () => {
  it('describes a six digit PIN as the million it is', () => {
    expect(say(combinations(6, 'digits'))).toBe('about 1 million combinations');
  });

  it('describes a longer mixed key as out of reach', () => {
    expect(say(combinations(12, 'mixed'))).toBe(
      'more combinations than anyone will get through',
    );
  });

  it('says nothing at all about an empty box', () => {
    expect(say(combinations(0, 'digits'))).toBe('none yet');
  });
});

describe('kindOf', () => {
  it('reads a PIN as digits and anything else as mixed', () => {
    expect(kindOf('318842')).toBe('digits');
    expect(kindOf('abc12345')).toBe('mixed');
  });
});

describe('the same sentences in Dutch', () => {
  it('puts the number into the translated sentence, not beside it', () => {
    expect(say(checkPasskey('3188', 'digits').problems[0], 'nl')).toBe(
      'Gebruik minstens 6 cijfers.',
    );
  });

  it('says miljard, which is what the English billion means', () => {
    // The trap this test exists for: a Dutch biljoen is 10^12, a thousand
    // times what the English "billion" claims. See the note in nl.ts.
    expect(say(combinations(6, 'mixed'), 'nl')).toBe('ongeveer 2 miljard combinaties');
  });
});
