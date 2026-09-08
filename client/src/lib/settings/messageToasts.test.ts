/**
 * Every gate between an arriving message and a card in the corner.
 *
 * Tested one gate at a time, like its sibling next door, but for a different
 * failure. Nothing here can leak a message out of the window, so what is being
 * defended is quieter: a toast for the conversation you are already reading, a
 * toast while notifications are paused, or a toast for your own message, each
 * of which turns a useful thing into one people switch off.
 *
 * The pairing with `notifiable` gets its own test at the bottom, because
 * "exactly one of the two fires" is the actual design and it is the kind of
 * property that survives every individual test and still breaks.
 */
import { describe, expect, it } from 'vitest';
import type { Arrival } from './desktopNotifications';
import { notifiable } from './desktopNotifications';
import { type ToastAttention, toastPreviewOf, toastable } from './messageToasts';
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

/** Looking at the app, reading some other conversation: the case that toasts. */
const here: ToastAttention = { watching: true, activeChannelId: 'somewhere-else' };

const on = DEFAULT_SETTINGS.notifications;

describe('toastable', () => {
  it('lets a message through when everything is set for one', () => {
    expect(toastable([arrival()], on, here)).toHaveLength(1);
  });

  it('is on by default, unlike the desktop notification', () => {
    expect(DEFAULT_SETTINGS.notifications.toast).toBe(true);
  });

  it('says nothing when the toggle is off', () => {
    expect(toastable([arrival()], { ...on, toast: false }, here)).toEqual([]);
  });

  it('says nothing when you cannot see the app', () => {
    expect(toastable([arrival()], on, { ...here, watching: false })).toEqual([]);
  });

  it('stays quiet for the conversation already on screen', () => {
    expect(toastable([arrival()], on, { ...here, activeChannelId: 'c1' })).toEqual([]);
  });

  it('still toasts for other conversations while one is open', () => {
    const arrivals = [arrival(), arrival({ channelId: 'c2' })];
    const out = toastable(arrivals, on, { ...here, activeChannelId: 'c1' });
    expect(out.map((a) => a.channelId)).toEqual(['c2']);
  });

  it('says nothing while notifications are paused', () => {
    const muted = { ...on, mutedUntil: '2026-09-08T13:00:00.000Z' };
    const during = Date.parse('2026-09-08T12:30:00.000Z');
    expect(toastable([arrival()], muted, here, during)).toEqual([]);
  });

  it('speaks again once the pause has run out', () => {
    const muted = { ...on, mutedUntil: '2026-09-08T13:00:00.000Z' };
    const after = Date.parse('2026-09-08T13:00:01.000Z');
    expect(toastable([arrival()], muted, here, after)).toHaveLength(1);
  });

  it('never toasts your own message back at you', () => {
    expect(toastable([arrival({ own: true })], on, here)).toEqual([]);
  });

  it('does not let a mention talk its way past the toggle', () => {
    const mention = arrival({ mentioned: true });
    expect(toastable([mention], { ...on, toast: false }, here)).toEqual([]);
  });

  it('keeps them in the order they arrived', () => {
    const arrivals = [arrival({ channelId: 'a' }), arrival({ channelId: 'b' })];
    expect(toastable(arrivals, on, here).map((a) => a.channelId)).toEqual(['a', 'b']);
  });
});

describe('toastPreviewOf', () => {
  it('shows the body when the setting allows it', () => {
    expect(toastPreviewOf(arrival(), true)).toBe('the safe is behind the painting');
  });

  it('withholds it when the setting does not', () => {
    expect(toastPreviewOf(arrival(), false)).toBeNull();
  });

  it('has nothing to show for a message this device could not open', () => {
    const sealed = arrival({ message: message({ state: 'failed' as MessageState }) });
    expect(toastPreviewOf(sealed, true)).toBeNull();
  });

  it('treats a blank body as nothing rather than as an empty line', () => {
    expect(toastPreviewOf(arrival({ message: message({ body: '   ' }) }), true)).toBeNull();
  });
});

describe('the pairing with the desktop notification', () => {
  /**
   * The design in one sentence: a message you can see the app for is a toast,
   * and one you cannot is an OS notification. Never both, which would be the
   * same message twice, and never neither, which would be silence.
   */
  it('fires exactly one of the two, whichever way you are looking', () => {
    const settings = { ...on, desktop: true };
    const granted = { permission: 'granted' as const };

    const watching =
      toastable([arrival()], settings, here).length +
      notifiable([arrival()], settings, { ...granted, watching: true }).length;

    const away =
      toastable([arrival()], settings, { ...here, watching: false }).length +
      notifiable([arrival()], settings, { ...granted, watching: false }).length;

    expect(watching).toBe(1);
    expect(away).toBe(1);
  });
});
