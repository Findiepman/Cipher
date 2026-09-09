/**
 * The shapes a profile travels in, and the mapping from the database enums.
 *
 * Its own file, with no database access, so the friend list, the conversation
 * list and the account DTO can all import it without a cycle: service.ts
 * imports the friend graph for its gate, and the friend graph needs these to
 * describe a friend.
 */
import type {
  FriendRequestPolicy,
  Prisma,
  Profile,
  ProfilePresence,
} from '../../generated/prisma/client.js';

export type WirePresence = 'online' | 'idle' | 'dnd' | 'invisible';
export type WirePolicy = 'everyone' | 'friends_of_friends' | 'nobody';

/// What friends see. Rides along on the friend list and on conversation
/// participants so a list of twenty people renders without twenty requests.
export interface PublicProfileDto {
  /// Empty means "show the username".
  displayName: string;
  about: string;
  /// #rrggbb, or null for a colour every client derives from the user id.
  accent: string | null;
  /// A data URL, or null for the lettered tile.
  avatar: string | null;
  /// When it last changed. The banner is fetched separately and cached by this.
  updatedAt: string;
}

/// The whole card, banner included. One request, when a card is opened.
export interface FullProfileDto extends PublicProfileDto {
  id: string;
  username: string;
  banner: string | null;
}

/// Your own, on the account. The two settings are here and nowhere else:
/// what somebody chose to appear as is theirs to know, the effect is all
/// their friends get.
export interface OwnProfileDto extends PublicProfileDto {
  banner: string | null;
  presence: WirePresence;
  readReceipts: boolean;
  friendRequestsFrom: WirePolicy;
}

export const PRESENCE_TO_WIRE: Record<ProfilePresence, WirePresence> = {
  ONLINE: 'online',
  IDLE: 'idle',
  DND: 'dnd',
  INVISIBLE: 'invisible',
};

export const PRESENCE_FROM_WIRE: Record<WirePresence, ProfilePresence> = {
  online: 'ONLINE',
  idle: 'IDLE',
  dnd: 'DND',
  invisible: 'INVISIBLE',
};

export const POLICY_TO_WIRE: Record<FriendRequestPolicy, WirePolicy> = {
  EVERYONE: 'everyone',
  FRIENDS_OF_FRIENDS: 'friends_of_friends',
  NOBODY: 'nobody',
};

export const POLICY_FROM_WIRE: Record<WirePolicy, FriendRequestPolicy> = {
  everyone: 'EVERYONE',
  friends_of_friends: 'FRIENDS_OF_FRIENDS',
  nobody: 'NOBODY',
};

/// An account that has never edited its profile has no row. Every reader
/// treats "no row" as this, so the client never has to.
const EPOCH = new Date(0);

export const DEFAULT_PROFILE: Profile = {
  userId: '',
  displayName: '',
  about: '',
  accent: null,
  avatar: null,
  banner: null,
  presence: 'ONLINE',
  readReceipts: true,
  friendRequestsFrom: 'EVERYONE',
  createdAt: EPOCH,
  updatedAt: EPOCH,
};

/// The columns a friend may see. Used by every include that hands a profile
/// to somebody other than its owner, so the banner (large) and the two
/// settings (private) cannot leak by way of a bare `include: { profile: true }`.
export const publicProfileSelect = {
  displayName: true,
  about: true,
  accent: true,
  avatar: true,
  updatedAt: true,
} satisfies Prisma.ProfileSelect;

export type PublicProfileRow = Prisma.ProfileGetPayload<{ select: typeof publicProfileSelect }>;

export function toPublicProfile(row: PublicProfileRow | null | undefined): PublicProfileDto {
  const profile = row ?? DEFAULT_PROFILE;
  return {
    displayName: profile.displayName,
    about: profile.about,
    accent: profile.accent,
    avatar: profile.avatar,
    updatedAt: profile.updatedAt.toISOString(),
  };
}

export function toOwnProfile(row: Profile | null | undefined): OwnProfileDto {
  const profile = row ?? DEFAULT_PROFILE;
  return {
    ...toPublicProfile(profile),
    banner: profile.banner,
    presence: PRESENCE_TO_WIRE[profile.presence],
    readReceipts: profile.readReceipts,
    friendRequestsFrom: POLICY_TO_WIRE[profile.friendRequestsFrom],
  };
}
