import { describe, expect, it } from 'vitest';
import { endedLabel, formatElapsed } from './CallPanel';

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
    expect(endedLabel({ ...base, endReason: 'rejected' }, 'nova')).toBe('nova declined');
    expect(endedLabel({ ...base, endReason: 'busy' }, 'nova')).toBe('nova is in another call');
    expect(endedLabel({ ...base, endReason: 'missed' }, 'nova')).toBe('Missed call from nova');
  });

  it('explains a failed connection differently when there was no relay to fall back on', () => {
    expect(endedLabel({ ...base, endReason: 'failed', relay: true }, 'nova')).toBe(
      'The connection failed.',
    );
    expect(endedLabel({ ...base, endReason: 'failed', relay: false }, 'nova')).toMatch(
      /no relay/,
    );
  });

  it('passes the server message through for a refusal', () => {
    expect(
      endedLabel({ ...base, endReason: 'refused', endMessage: 'You are not friends.' }, 'nova'),
    ).toBe('You are not friends.');
    expect(endedLabel({ ...base, endReason: 'refused' }, 'nova')).toBe(
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
    for (const endReason of reasons) {
      expect(endedLabel({ ...base, endReason }, 'nova')).not.toMatch(/encrypt|secure|sealed/i);
    }
  });
});
