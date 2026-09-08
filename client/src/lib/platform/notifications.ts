/**
 * Whether an event deserves a notification, and what it may say.
 *
 * Kept as data in, data out so the rules can be tested without a window, a
 * socket or a platform. The rules are the ones the Notifications settings
 * screen promises:
 *
 *   - nothing while paused, and nothing unless desktop notifications are on
 *   - never for your own messages, whichever device typed them
 *   - never for the conversation you are looking at, with the window in front
 *   - the text of a message only when the preview setting says so, because a
 *     notification is a copy of decrypted text handed to the operating system
 */
import type { NotificationSettings } from '../settings/types';
import type { NotificationPermission } from './types';

/** How much of a message a preview may carry. Enough to read, not the essay. */
const PREVIEW_LIMIT = 140;

export function isMuted(until: string | null, now = Date.now()): boolean {
  if (!until) return false;
  // The sentinel for "indefinitely", so a paused state cannot silently expire.
  if (until === 'forever') return true;
  const at = Date.parse(until);
  return Number.isNaN(at) ? false : at > now;
}

export interface NotifyInput {
  settings: NotificationSettings;
  permission: NotificationPermission;
  authorId: string;
  selfId: string | null;
  /** The message landed in the conversation on screen, with the window in front. */
  focused: boolean;
  now?: number;
}

export function shouldNotify(input: NotifyInput): boolean {
  const { settings } = input;
  if (!settings.desktop || input.permission !== 'granted') return false;
  if (isMuted(settings.mutedUntil, input.now)) return false;
  if (input.selfId !== null && input.authorId === input.selfId) return false;
  return !input.focused;
}

/**
 * The title and body for a message notification.
 *
 * With the preview off, neither the sender nor the text is named: the
 * settings screen says "only that someone messaged you", and who is talking
 * to you is itself something a lock screen should not announce.
 */
export function describeIncoming(
  settings: Pick<NotificationSettings, 'preview'>,
  authorName: string,
  body: string | null,
): { title: string; body: string } {
  if (!settings.preview) {
    return { title: 'New message', body: 'Someone sent you a message.' };
  }
  const text = body === null ? 'Sent you a message you cannot open yet.' : body.trim();
  return {
    title: authorName,
    body: text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT - 1)}…` : text,
  };
}
