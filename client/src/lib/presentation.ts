/**
 * Turning what the server knows about a person into what the UI draws.
 *
 * The server stores a username and a public key. It does not store an avatar
 * colour, and it should not: that is a rendering detail, and inventing a place
 * to keep one would be a column of no consequence on a table that matters.
 * So the colour is derived from the user id, which is stable for a given person
 * on every device, with no round trip and nothing to migrate.
 */
import type { FriendDto } from './api/types';
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
}

/**
 * `name` is resolved once, here. Every component downstream draws `name` and
 * never has to ask whether it is looking at a nickname or a handle; the two
 * places that genuinely need the real handle (the context menu and the friends
 * list) read `username` explicitly.
 */
export function toUser(person: PresentableUser, presence: Presence): User {
  const nickname = person.nickname?.trim() || undefined;
  return {
    id: person.id,
    name: nickname ?? person.username,
    username: person.username,
    nickname,
    color: colorFor(person.id),
    presence,
  };
}

export function friendToUser(friend: FriendDto, online: boolean): User {
  return toUser(friend, online ? 'online' : 'offline');
}
