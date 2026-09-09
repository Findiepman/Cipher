/**
 * Which arriving messages raise a toast in the corner, and how much they say.
 *
 * The in-app twin of `desktopNotifications.ts`, and written the same way, as a
 * pure function with tests, for a different reason. That one is a security
 * decision: it decides what leaves the app for an OS notification centre. This
 * one never leaves the window, so the stakes are lower, but the *rules* are
 * fussier, and rules that are fussy are exactly the ones that rot into a
 * condition nobody dares change.
 *
 * The gates, in order:
 *
 *   1. The toggle is on.
 *   2. You can actually see the app. This is the complement of the desktop
 *      notification's third gate, and the pair is the whole design: exactly
 *      one of the two fires for any given message, never both and never
 *      neither. A toast drawn behind another window is a toast nobody sees,
 *      and it would have expired by the time you came back.
 *   3. Not the conversation you are already reading. You can see the message
 *      arrive; a card repeating it over the top is noise.
 *   4. Notifications are not paused.
 *   5. It was not you who sent it.
 *
 * Note what is deliberately not a gate. A mention does not bypass the toggle,
 * because a toggle that something can talk its way past is not a toggle. And
 * being muted is checked with the same `isMuted` the sounds use, so pausing
 * notifications pauses all of it and not most of it.
 */
import type { Arrival } from './desktopNotifications';
import { isMuted, isPersonMuted } from './notificationSounds';
import type { NotificationSettings } from './types';

export interface ToastAttention {
  /**
   * True when the window is on screen and in front. The same test
   * `DesktopNotifier` and `ChatProvider` use, on purpose: whether you saw a
   * message should never get two different answers in one app.
   */
  watching: boolean;
  /** The conversation on screen right now, or null when none is open. */
  activeChannelId: string | null;
}

/**
 * The arrivals that should become a toast, oldest first.
 *
 * A list rather than one, because a reconnect can land messages in several
 * conversations at once and each is its own card. How many of them are drawn
 * is the component's business, not this function's.
 */
export function toastable(
  arrivals: readonly Arrival[],
  notifications: NotificationSettings,
  attention: ToastAttention,
  now = Date.now(),
): Arrival[] {
  if (!notifications.toast) return [];
  if (!attention.watching) return [];
  if (isMuted(notifications.mutedUntil, now)) return [];
  return arrivals.filter(
    (arrival) =>
      !arrival.own &&
      arrival.channelId !== attention.activeChannelId &&
      !isPersonMuted(notifications, arrival.message.authorId),
  );
}

/**
 * The second line, or null for a toast that only says somebody wrote.
 *
 * Three ways to get null, and only the first is the setting: a message this
 * device could not decrypt has no text to show, and one that arrived empty has
 * nothing worth a line. Both would otherwise draw a card with a blank row
 * under the name, which reads as a bug rather than as discretion.
 */
export function toastPreviewOf(arrival: Arrival, preview: boolean): string | null {
  if (!preview) return null;
  if (arrival.message.state !== 'decrypted') return null;
  const body = arrival.message.body?.trim();
  return body ? body : null;
}
