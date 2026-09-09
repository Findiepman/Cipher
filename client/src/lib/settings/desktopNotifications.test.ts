/**
 * Every gate between an arriving message and the operating system.
 *
 * Worth testing one by one rather than in combination, because the failure
 * that matters here is not "no notification appeared". It is one appearing,
 * with somebody's decrypted words in it, on a lock screen, after the person
 * whose words they are had switched the thing off.
 */
import { describe, expect, it } from 'vitest';
import { type Arrival, type Attention, notifiable, previewOf } from './desktopNotifications';
import { DEFAULT_SETTINGS } from './types';
import type { Message, MessageState } from '../../types';

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    channelId: 'c1',
    authorId: 'them',
    sentAt: '2026-09-08T12:00:00.000Z',
    state: 'decrypted' as MessageState,
    body: 'the safe is behind the painting',
    ciphertext: 'AAAA',
    ...overrides,
  };
}

function arrival(overrides: Partial<Arrival> = {}): Arrival {
  return {
    channelId: 'c1',
    channelName: 'ren',
    message: message(),
    own: false,
    mentioned: false,
    ...overrides,
  };
}

/** Permission given, window in the background: the case that should notify. */
const away: Attention = { permission: 'granted', watching: false };

const on = { ...DEFAULT_SETTINGS.notifications, desktop: true };

describe('notifiable', () => {
  it('lets a message through when everything is set for one', () => {
    expect(notifiable([arrival()], on, away)).toHaveLength(1);
  });

  it('says nothing until the browser has actually granted permission', () => {
    for (const permission of ['default', 'denied', 'unsupported'] as const) {
      expect(notifiable([arrival()], on, { ...away, permission })).toEqual([]);
    }
  });

  it('says nothing when the toggle is off, permission or no permission', () => {
    expect(notifiable([arrival()], { ...on, desktop: false }, away)).toEqual([]);
  });

  it('says nothing while you are looking at the window', () => {
    expect(notifiable([arrival()], on, { ...away, watching: true })).toEqual([]);
  });

  it('says nothing while notifications are paused, and starts again after', () => {
    const paused = { ...on, mutedUntil: '2026-09-08T13:00:00.000Z' };
    const during = Date.parse('2026-09-08T12:30:00.000Z');
    const after = Date.parse('2026-09-08T13:30:00.000Z');

    expect(notifiable([arrival()], paused, away, during)).toEqual([]);
    expect(notifiable([arrival()], paused, away, after)).toHaveLength(1);
  });

  it('says nothing while you are on do not disturb, whatever else is set', () => {
    expect(notifiable([arrival()], on, { ...away, quiet: true })).toEqual([]);
    expect(notifiable([arrival()], on, { ...away, quiet: false })).toHaveLength(1);
  });

  it('never notifies you about your own message', () => {
    expect(notifiable([arrival({ own: true })], on, away)).toEqual([]);
  });

  it('keeps a burst across conversations, in the order it arrived', () => {
    const let_through = notifiable(
      [
        arrival({ channelId: 'c1', channelName: 'ren' }),
        arrival({ channelId: 'c2', channelName: 'nova', own: true }),
        arrival({ channelId: 'c3', channelName: 'kestrel' }),
      ],
      on,
      away,
    );
    expect(let_through.map((one) => one.channelName)).toEqual(['ren', 'kestrel']);
  });
});

describe('previewOf', () => {
  it('is null while the preview setting is off, which is the default', () => {
    expect(DEFAULT_SETTINGS.notifications.preview).toBe(false);
    expect(previewOf(arrival(), false)).toBeNull();
  });

  it('is the message when the setting is on', () => {
    expect(previewOf(arrival(), true)).toBe('the safe is behind the painting');
  });

  it('is null for a message this device could not read', () => {
    for (const state of ['sending', 'encrypted', 'failed'] as const) {
      expect(previewOf(arrival({ message: message({ state }) }), true)).toBeNull();
    }
  });

  it('is null for an empty body, rather than a notification with a blank line', () => {
    expect(previewOf(arrival({ message: message({ body: '   ' }) }), true)).toBeNull();
    expect(previewOf(arrival({ message: message({ body: null }) }), true)).toBeNull();
  });
});
