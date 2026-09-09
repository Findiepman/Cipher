/**
 * The seam between the settings blob and the account's profile.
 *
 * Most settings never leave this device. A handful do, because another person
 * has to see the result (your name, picture, colour, banner, about text, the
 * presence you chose) or because the server has to act on them for you
 * (whether it tells people you read their message, and who may send you a
 * friend request). Those live in two places at once: in `settings`, which is
 * what the app draws you from, and on the server, which is what your friends
 * are handed. This file is how the two stay equal.
 *
 * Two pure functions carry the rules, so they can be tested without a network
 * or a React tree:
 *
 *   - `toLocal` turns the server's copy into a settings patch. Applied when
 *     the account loads, because the server's copy is what everyone else has
 *     been looking at and this device may be new or stale.
 *   - `toRequest` turns a local edit into the smallest PATCH that would make
 *     the server agree. It sends only what differs, so an unrelated edit
 *     never re-uploads a banner, and it sends nothing at all when nothing
 *     differs, which is what stops a seed from echoing straight back.
 *
 * Two words get translated at this boundary and nowhere else. The presence you
 * choose to appear as is 'offline' in the client's vocabulary and 'invisible'
 * in the server's, because on the wire the server also has to say 'offline'
 * about people who really are. And the accent you have not chosen is '' here
 * (the settings blob is all strings) and null there.
 */
import type {
  FriendRequestPolicy,
  OwnProfileDto,
  ServerPresence,
  UpdateProfileRequest,
} from '../api/types';
import type { Presence } from '../../types';
import type { PrivacySettings, ProfileSettings } from './types';

/** The settings this file keeps in step with the server. */
export interface SyncedSettings {
  profile: ProfileSettings;
  privacy: Pick<PrivacySettings, 'readReceipts' | 'friendRequestsFrom'>;
}

/** The patch `toLocal` produces: one section each, partial on purpose. */
export interface LocalPatch {
  profile: Partial<ProfileSettings>;
  privacy: Partial<PrivacySettings>;
}

export function presenceToLocal(presence: ServerPresence): Presence {
  return presence === 'invisible' ? 'offline' : presence;
}

export function presenceToServer(presence: Presence): ServerPresence {
  return presence === 'offline' ? 'invisible' : presence;
}

/** What the settings blob should hold, given what the server holds. */
export function toLocal(profile: OwnProfileDto): LocalPatch {
  return {
    profile: {
      displayName: profile.displayName,
      about: profile.about,
      accent: profile.accent ?? '',
      avatar: profile.avatar,
      banner: profile.banner,
      presence: presenceToLocal(profile.presence),
    },
    privacy: {
      readReceipts: profile.readReceipts,
      friendRequestsFrom: profile.friendRequestsFrom,
    },
  };
}

/**
 * The PATCH that would make the server hold what this device holds, or an
 * empty object when it already does.
 *
 * Every comparison is against `lastKnown`, the server's copy as last seen, and
 * never against "what did I send before": a request that failed leaves the
 * server where it was, and the next edit has to carry the earlier change
 * along with it rather than assume it landed.
 */
export function toRequest(local: SyncedSettings, lastKnown: OwnProfileDto): UpdateProfileRequest {
  const request: UpdateProfileRequest = {};
  const { profile, privacy } = local;

  const displayName = profile.displayName.trim();
  if (displayName !== lastKnown.displayName) request.displayName = displayName;

  if (profile.about !== lastKnown.about) request.about = profile.about;

  const accent = profile.accent || null;
  if (accent !== lastKnown.accent) request.accent = accent;

  if (profile.avatar !== lastKnown.avatar) request.avatar = profile.avatar;
  if (profile.banner !== lastKnown.banner) request.banner = profile.banner;

  const presence = presenceToServer(profile.presence);
  if (presence !== lastKnown.presence) request.presence = presence;

  if (privacy.readReceipts !== lastKnown.readReceipts) {
    request.readReceipts = privacy.readReceipts;
  }
  if (privacy.friendRequestsFrom !== lastKnown.friendRequestsFrom) {
    request.friendRequestsFrom = privacy.friendRequestsFrom as FriendRequestPolicy;
  }

  return request;
}

export function isEmptyRequest(request: UpdateProfileRequest): boolean {
  return Object.keys(request).length === 0;
}
