/**
 * Turning what the server knows about a person into what the UI draws.
 *
 * The server stores a username, a public key and, since profiles moved off
 * the device, the things a person chose to show their friends: a display
 * name, a picture, an accent, a line about themselves. Those come down on
 * every friend and every conversation participant as `profile`, so the list
 * draws forty faces from one request.
 *
 * The one thing still derived here is the fallback colour. An accent is a
 * choice, and most people never make it, so a lettered tile is painted from
 * the user id: stable for a given person on every device, with no round trip
 * and nothing to store.
 */
import type { FriendDto, PublicProfileDto } from './api/types';
import type { Presence, User } from '../types';

/**
 * Picked to stay legible against the dark surface and to be distinguishable
 * from each other by someone who cannot tell red from green.
 */
const PALETTE = [
  '#f2734e',
  '#b8749e',
  '#6aa06f',
  '#d9b382',
  '#7f9fc4',
  '#a583c4',
  '#8d8078',
  '#c47f7f',
];

/** Stable across devices, because the id is. */
export function colorFor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

export interface PresentableUser {
  id: string;
  username: string;
  publicKey: string | null;
  nickname?: string | null;
  /** Absent only for a row built by hand, such as a pending request. */
  profile?: PublicProfileDto | null;
}

/**
 * `name` is resolved once, here. Every component downstream draws `name` and
 * never has to ask whether it is looking at a nickname, a display name or a
 * handle; the two places that genuinely need the real handle (the context
 * menu and the friends list) read `username` explicitly.
 *
 * The order is what you would expect of a private label: what *you* call
 * them beats what they call themselves, which beats the handle.
 */
export function toUser(person: PresentableUser, presence: Presence): User {
  const nickname = person.nickname?.trim() || undefined;
  const profile = person.profile ?? null;
  const displayName = profile?.displayName.trim() || undefined;
  const about = profile?.about.trim() || undefined;

  return {
    id: person.id,
    name: nickname ?? displayName ?? person.username,
    username: person.username,
    nickname,
    color: profile?.accent ?? colorFor(person.id),
    avatarUrl: profile?.avatar ?? undefined,
    presence,
    activity: about,
    profileUpdatedAt: profile?.updatedAt,
  };
}

export function friendToUser(friend: FriendDto, presence: Presence): User {
  return toUser(friend, presence);
}
