/**
 * Which sound plays for whom.
 *
 * One place decides, because the answer is needed in three: the call ringer,
 * the message chime and the settings screen that previews both. The rule is
 * the same for each. A person you have set explicitly wins, the general
 * setting is the fallback, and anything unrecognised falls back again to the
 * shipped default rather than to silence.
 *
 * The overrides exist for one reason worth stating: telling people apart
 * without looking. A flatmate on Knock and a partner on Bell is the difference
 * between glancing at a screen and knowing whether to get up.
 */
import {
  type MessageSound,
  type RingSound,
  asMessageSound,
  asRingSound,
} from '../media/sounds';
import type { NotificationSettings } from './types';

/** True while notifications are paused, so nothing should make a sound. */
export function isMuted(mutedUntil: string | null, now = Date.now()): boolean {
  if (!mutedUntil) return false;
  const until = Date.parse(mutedUntil);
  // An unparseable date is treated as "not muted": failing loud is recoverable,
  // failing silent looks like the app is broken.
  if (Number.isNaN(until)) return false;
  return until > now;
}

export function messageSoundFor(
  notifications: NotificationSettings,
  userId?: string | null,
): MessageSound {
  const override = userId ? notifications.perPerson[userId]?.message : undefined;
  return asMessageSound(override ?? notifications.messageSound);
}

export function ringSoundFor(
  notifications: NotificationSettings,
  userId?: string | null,
): RingSound {
  const override = userId ? notifications.perPerson[userId]?.call : undefined;
  return asRingSound(override ?? notifications.callSound);
}

/**
 * Sets or clears one person's choice.
 *
 * Clearing removes the key rather than storing an undefined, so
 * "back to the default" leaves no trace and the map only ever holds people you
 * actually decided something about.
 */
export function withPersonSound(
  perPerson: NotificationSettings['perPerson'],
  userId: string,
  field: 'message' | 'call',
  value: MessageSound | RingSound | null,
): NotificationSettings['perPerson'] {
  const next = { ...perPerson };
  const entry = { ...next[userId] };

  if (value === null) delete entry[field];
  else if (field === 'message') entry.message = value as MessageSound;
  else entry.call = value as RingSound;

  if (Object.keys(entry).length === 0) delete next[userId];
  else next[userId] = entry;

  return next;
}

/**
 * Whether this person is muted outright.
 *
 * Its own function so the three places that ask (the chime, the toast and the
 * OS notification) cannot drift into three different answers, which is exactly
 * how a muted person ends up silent in one place and not another.
 */
export function isPersonMuted(
  notifications: NotificationSettings,
  userId: string | undefined,
): boolean {
  if (!userId) return false;
  return notifications.mutedPeople.includes(userId);
}
