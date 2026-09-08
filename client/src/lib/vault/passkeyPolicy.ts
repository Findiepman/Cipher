/**
 * What counts as a passkey, and what to tell the user it is worth.
 *
 * A passkey is not the account password and the rules are deliberately looser:
 * its job is that an unlocked screen is not an open vault, not that it survives
 * an offline attack on a stolen disk. Two shapes are offered, because a PIN you
 * will actually use beats a passphrase you avoid the feature to skip.
 *
 * The honest part of this file is `combinations()`. A six digit passkey is a
 * million guesses and the UI says so in those words, because "strong" and
 * "weak" are not claims this can make: the same six digits are plenty against
 * someone at your desk and nothing at all against someone with your disk.
 * vault-plan.md, *The encryption story, stated honestly*.
 */

import type { Key } from '../i18n/en';
import type { Phrase } from '../i18n/translate';

export type PasskeyKind = 'digits' | 'mixed';

/**
 * The labels are catalogue keys rather than words. This module has no business
 * holding a `t`, and the screen rendering a rule is the thing that knows which
 * language it is in.
 */
export const PASSKEY_RULES = {
  digits: {
    label: 'vault.kind.digits',
    hint: 'vault.kind.digitsHint',
    min: 6,
    max: 12,
    alphabet: 10,
    pattern: /^[0-9]+$/,
  },
  mixed: {
    label: 'vault.kind.mixed',
    hint: 'vault.kind.mixedHint',
    min: 8,
    max: 64,
    alphabet: 36,
    pattern: /^[a-zA-Z0-9]+$/,
  },
} as const;

export interface PasskeyCheck {
  ok: boolean;
  /** Reasons, in the order worth showing them, for the screen to translate. */
  problems: Phrase<Key>[];
}

export function checkPasskey(passkey: string, kind: PasskeyKind): PasskeyCheck {
  const rules = PASSKEY_RULES[kind];
  const digits = kind === 'digits';
  const problems: Phrase<Key>[] = [];

  if (passkey.length < rules.min) {
    problems.push({
      key: digits ? 'vault.problem.minDigits' : 'vault.problem.minChars',
      vars: { min: rules.min },
    });
  }
  if (passkey.length > rules.max) {
    problems.push({
      key: digits ? 'vault.problem.maxDigits' : 'vault.problem.maxChars',
      vars: { max: rules.max },
    });
  }
  if (passkey.length > 0 && !rules.pattern.test(passkey)) {
    problems.push({
      key: digits ? 'vault.problem.digitsOnly' : 'vault.problem.alnumOnly',
    });
  }
  if (passkey.length > 0 && /^(.)\1+$/.test(passkey)) {
    problems.push({ key: 'vault.problem.repeated' });
  }
  if (isSequential(passkey)) {
    problems.push({ key: 'vault.problem.sequence' });
  }

  return { ok: problems.length === 0, problems };
}

/**
 * Roughly how many possibilities a passkey of this shape has, as something a
 * person can picture. Deliberately an upper bound on the honest reading: it
 * assumes the attacker knows the length and the alphabet, which for a PIN box
 * they do.
 */
export function combinations(length: number, kind: PasskeyKind): Phrase<Key> {
  if (length <= 0) return { key: 'vault.combos.none' };
  const total = Math.pow(PASSKEY_RULES[kind].alphabet, length);
  const round = (by: number) => ({ count: Math.round(total / by) });
  if (total < 1e6) return { key: 'vault.combos.thousand', vars: round(1e3) };
  if (total < 1e9) return { key: 'vault.combos.million', vars: round(1e6) };
  if (total < 1e12) return { key: 'vault.combos.billion', vars: round(1e9) };
  return { key: 'vault.combos.beyond' };
}

/** Which shape a passkey already is, used when changing one. */
export function kindOf(passkey: string): PasskeyKind {
  return PASSKEY_RULES.digits.pattern.test(passkey) ? 'digits' : 'mixed';
}

function isSequential(value: string): boolean {
  if (value.length < 4) return false;
  let ascending = true;
  let descending = true;
  for (let i = 1; i < value.length; i += 1) {
    const step = value.charCodeAt(i) - value.charCodeAt(i - 1);
    if (step !== 1) ascending = false;
    if (step !== -1) descending = false;
  }
  return ascending || descending;
}
