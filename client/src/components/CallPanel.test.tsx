import { describe, expect, it } from 'vitest';
import { en } from '../lib/i18n/en';
import { nl } from '../lib/i18n/nl';
import { LOCALES, type Locale } from '../lib/i18n/locales';
import { translate } from '../lib/i18n/translate';
import { endedLabel, formatElapsed } from './CallPanel';

/**
 * `endedLabel` returns a catalogue key now, so the assertions go through the
 * same lookup the panel does. That is what keeps them about the sentence
 * somebody reads rather than about an identifier.
 */
function say(
  call: Parameters<typeof endedLabel>[0],
  name: string,
  locale: Locale = 'en',
): string {
  const phrase = endedLabel(call, name);
  return translate(phrase.key, locale, locale === 'en' ? en : nl, en, phrase.vars);
}

describe('the elapsed time', () => {
  it('shows minutes and seconds, and hours only once there are any', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(59_000)).toBe('00:59');
    expect(formatElapsed(61_000)).toBe('01:01');
    expect(formatElapsed(3_600_000)).toBe('1:00:00');
    expect(formatElapsed(3_723_000)).toBe('1:02:03');
  });

  it('never goes negative when the clock skews', () => {
    expect(formatElapsed(-5_000)).toBe('00:00');
  });
});

describe('why a call ended', () => {
  const base = { endMessage: null, relay: null };

  it('names the other person where it is about them', () => {
    expect(say({ ...base, endReason: 'rejected' }, 'nova')).toBe('nova declined');
    expect(say({ ...base, endReason: 'busy' }, 'nova')).toBe('nova is in another call');
    expect(say({ ...base, endReason: 'missed' }, 'nova')).toBe('Missed call from nova');
    // The name has to survive translation, not just substitution.
    expect(say({ ...base, endReason: 'missed' }, 'nova', 'nl')).toBe(
      'Gemist gesprek van nova',
    );
  });

  it('explains a failed connection differently when there was no relay to fall back on', () => {
    expect(say({ ...base, endReason: 'failed', relay: true }, 'nova')).toBe(
      'The connection failed.',
    );
    expect(say({ ...base, endReason: 'failed', relay: false }, 'nova')).toMatch(/no relay/);
  });

  it('passes the server message through for a refusal', () => {
    // The server wrote that sentence, so it comes through untouched in every
    // language. Only the fallback, which is ours, is translated.
    expect(
      say({ ...base, endReason: 'refused', endMessage: 'You are not friends.' }, 'nova', 'nl'),
    ).toBe('You are not friends.');
    expect(say({ ...base, endReason: 'refused' }, 'nova')).toBe(
      'The call could not be placed.',
    );
  });

  it('makes no claim about encryption in any of them', () => {
    const reasons = [
      'hangup',
      'rejected',
      'no_answer',
      'missed',
      'disconnected',
      'busy',
      'in_call',
      'no_microphone',
      'unreadable',
      'failed',
      'refused',
    ] as const;
    // Checked in every language we ship, because a translation is exactly
    // where an unearned claim would creep back in. The call audio is end to
    // end, the signalling that set it up is not yet bound to your identity
    // key, and a badge would be true in the half nobody checks.
    const claims = /encrypt|secure|sealed|versleuteld|verzegeld|beveiligd|veilig/i;
    for (const locale of LOCALES) {
      for (const endReason of reasons) {
        expect(say({ ...base, endReason }, 'nova', locale)).not.toMatch(claims);
      }
    }
  });
});
