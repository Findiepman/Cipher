/**
 * Turning what the server knows about a person into what the UI draws.
 *
 * The server stores a username and a public key. It does not store an avatar
 * colour, and it should not: that is a rendering detail, and inventing a place
 * to keep one would be a column of no consequence on a table that matters.
 * So the colour is derived from the user id — stable for a given person on
 * every device, with no round trip and nothing to migrate.
 */
import { fromBase64, keyFingerprint } from '@cipher/crypto';
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

/**
 * The security number, short form — the first two blocks, which is what fits
 * beside a name. The full one belongs in a verification screen where two
 * people read it to each other; a truncated fingerprint is a label, not a
 * check, and the UI should not imply otherwise.
 */
export async function shortFingerprint(publicKey: string | null): Promise<string> {
  if (!publicKey) return '····';
  try {
    const full = await keyFingerprint(await fromBase64(publicKey));
    return full.split(' ').slice(0, 2).join(' ');
  } catch {
    // A key we cannot parse is not a crash; it is a person whose key we cannot
    // show, and the row still has to render.
    return '····';
  }
}

export interface PresentableUser {
  id: string;
  username: string;
  publicKey: string | null;
}

/**
 * `verified` is deliberately absent rather than false-by-default: nobody's key
 * has been compared out of band yet, and the UI says "unverified" instead of
 * implying a check that has not happened.
 */
export function toUser(
  person: PresentableUser,
  fingerprint: string,
  presence: Presence,
): User {
  return {
    id: person.id,
    name: person.username,
    color: colorFor(person.id),
    fingerprint,
    presence,
  };
}

export function friendToUser(
  friend: FriendDto,
  fingerprint: string,
  online: boolean,
): User {
  return toUser(friend, fingerprint, online ? 'online' : 'offline');
}
