/**
 * The people you keep at the top of the conversation list.
 *
 * Pinning is stored as a list of user ids rather than conversation ids,
 * because it is something you do to a person: the same right-click menu is on
 * a conversation row, a friends row, a message author and the profile card,
 * and only one of those four knows a conversation id. Anything the server
 * holds is deliberately not involved, so the order of your own list is not
 * something the server gets to learn.
 *
 * Everything here is pure and works on plain arrays, which is what makes the
 * ordering rule below testable rather than something you have to notice in a
 * running app.
 */
import { MAX_PINNED, resolvePinned } from './types';

export function isPinned(pinned: readonly string[], userId: string): boolean {
  return pinned.includes(userId);
}

/** True when there is no room to pin anybody else. */
export function pinnedIsFull(pinned: readonly string[]): boolean {
  return resolvePinned(pinned).length >= MAX_PINNED;
}

/**
 * Adds or removes one person, newest pin last.
 *
 * A full list refuses the addition rather than dropping the oldest pin: the
 * point of a short list is that you chose what is on it, and silently evicting
 * somebody to make room is a choice made for you.
 */
export function togglePin(pinned: readonly string[], userId: string): string[] {
  const current = resolvePinned(pinned);
  if (current.includes(userId)) return current.filter((id) => id !== userId);
  if (current.length >= MAX_PINNED) return current;
  return [...current, userId];
}

/**
 * Splits a list of conversations into the pinned ones and the rest.
 *
 * The pinned ones come out in the order they were pinned, not in the order the
 * conversation list arrived in. That is the whole reason to pin somebody: the
 * ordinary list reshuffles every time anyone says anything, and a section that
 * did the same would not be a shortcut, it would be the same list twice. The
 * rest keep whatever order they came in with.
 */
export function splitPinned<T>(
  items: readonly T[],
  pinned: readonly string[],
  keyOf: (item: T) => string | undefined,
): { pinned: T[]; rest: T[] } {
  const order = resolvePinned(pinned);
  const byKey = new Map<string, T>();
  const rest: T[] = [];

  for (const item of items) {
    const key = keyOf(item);
    // First one wins: two conversations with the same person would otherwise
    // put the second in neither list.
    if (key && order.includes(key) && !byKey.has(key)) byKey.set(key, item);
    else rest.push(item);
  }

  return {
    pinned: order.flatMap((key) => {
      const item = byKey.get(key);
      // A pin can outlive the conversation it pointed at: you unfriended them,
      // or you pinned somebody you have not opened a DM with yet. That is a
      // row that does not exist, not an error.
      return item ? [item] : [];
    }),
    rest,
  };
}
