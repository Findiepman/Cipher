/**
 * Which arriving messages the operating system gets told about, and how much
 * of them it is told.
 *
 * This is the one notification decision that is a security decision rather
 * than a taste one, which is why it is a pure function with tests rather than
 * a condition inside a component. A desktop notification is handed to the OS:
 * on Windows it goes to the Action Centre, on macOS it can be mirrored to a
 * phone and on either it can sit on a lock screen in a room full of people.
 * Every one of those is a copy of a decrypted message living somewhere this
 * app cannot reach, so every gate on the way has to hold, and "it looked right
 * when I tried it" is not how you find out that one of them does not.
 *
 * The gates, in the order they are checked:
 *
 *   1. The browser said yes. Not "we asked", not "the toggle is on": granted.
 *   2. The toggle is on. Turning it off has to be enough on its own, because
 *      it is the control the settings screen promises.
 *   3. You are not already looking. A notification for a window you are
 *      staring at is noise, and worse, it is a copy of a message handed to the
 *      OS for no reason at all.
 *   4. Notifications are not paused.
 *   5. You are not on do not disturb. Distinct from paused: a pause is a
 *      timer you set here, do not disturb is the presence you chose and are
 *      showing your friends, and either alone has to be enough.
 *   6. It was not you who sent it.
 *
 * `preview` is a seventh gate over the body only, and it defaults off. The name
 * of the person is not behind it: the setting says "show message text", the
 * screen explains it in those words, and a notification that cannot say who it
 * is from is one you have to open the app to act on, which defeats it.
 */
import type { Message } from '../../types';
import { isMuted } from './notificationSounds';
import type { NotificationSettings } from './types';

/** One conversation whose newest message changed. */
export interface Arrival {
  channelId: string;
  /** What the conversation is called. For a DM that is the person. */
  channelName: string;
  message: Message;
  /** True when this device sent it. */
  own: boolean;
  /** True when the body names you. Not a gate today, see below. */
  mentioned: boolean;
}

/** What the browser has been asked, plus 'unsupported' for one that cannot. */
export type NotifyPermission = 'default' | 'granted' | 'denied' | 'unsupported';

export interface Attention {
  permission: NotifyPermission;
  /**
   * True when the window is on screen and in front of everything else.
   *
   * Both halves matter and neither is enough: a visible tab behind another
   * window is not being read, and a focused window whose tab is hidden does
   * not exist. ChatProvider already decides "read" the same way, which is on
   * purpose: a message that clears its unread count and a message that raises
   * a notification should never disagree about whether you saw it.
   */
  watching: boolean;
  /**
   * True while your chosen presence is do not disturb. Optional so the
   * callers that predate presence keep meaning what they meant.
   */
  quiet?: boolean;
}

/**
 * The arrivals that should become a notification, in the order they came.
 *
 * Returns a list rather than one, because a burst across two conversations is
 * two notifications and not one lost. Coalescing within a conversation happens
 * a level up, through the notification's tag: a second message replaces the
 * first rather than stacking.
 */
export function notifiable(
  arrivals: readonly Arrival[],
  notifications: NotificationSettings,
  attention: Attention,
  now = Date.now(),
): Arrival[] {
  if (attention.permission !== 'granted') return [];
  if (!notifications.desktop) return [];
  if (attention.watching) return [];
  if (isMuted(notifications.mutedUntil, now)) return [];
  if (attention.quiet) return [];
  return arrivals.filter((arrival) => !arrival.own);
}

/**
 * The line under the title, or null for a notification that only says someone
 * wrote.
 *
 * Null in three cases, and the last two are not the setting: a message this
 * device has not decrypted has no text to show, and one that arrived empty has
 * nothing worth a second line. Both would otherwise render as a notification
 * with a blank body, which reads as a bug rather than as discretion.
 */
export function previewOf(arrival: Arrival, preview: boolean): string | null {
  if (!preview) return null;
  if (arrival.message.state !== 'decrypted') return null;
  const body = arrival.message.body?.trim();
  return body ? body : null;
}
