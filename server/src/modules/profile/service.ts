/**
 * What a person shows their friends, and the settings the server acts on for
 * them.
 *
 * The rule that decides what is in here: a setting stays on the device unless
 * another person has to see the result, or the server has to act on it. A
 * display name, a picture, an about line and a presence are the first kind;
 * read receipts and who may send a friend request are the second. Everything
 * else in the settings screen (theme, sounds, who is muted, the pinned list)
 * never reaches this process, and `client/src/lib/settings/types.ts` says so.
 *
 * All of it is stored in the clear. It is profile metadata, not message
 * content, and it exists to be shown to other people; the rule in
 * server/AGENTS.md is about bodies. What limits the exposure is who may read
 * it: friends, and nobody else. There is no listing and no search.
 *
 * Pictures are the base64 data URLs the client already renders from
 * localStorage, small by construction (the client downscales before it
 * uploads) and checked here for a real image header, a matching mime type and
 * a byte cap. A hostile client can skip the downscale, so the cap is the real
 * limit. Serving them inline rather than from a URL is deliberate: the desktop
 * app authenticates with a bearer header that an <img> tag cannot send.
 */
import type { Prisma, Profile } from '../../generated/prisma/client.js';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { badRequest, conflict, tooManyRequests } from '../../lib/errors.js';
import { requireFriendship } from '../friends/service.js';
import {
  DEFAULT_PROFILE,
  POLICY_FROM_WIRE,
  PRESENCE_FROM_WIRE,
  PRESENCE_TO_WIRE,
  toPublicProfile,
  type FullProfileDto,
  type WirePresence,
} from './dto.js';
import type { UpdateProfileInput } from './schemas.js';

export type {
  FullProfileDto,
  OwnProfileDto,
  PublicProfileDto,
  WirePolicy,
  WirePresence,
} from './dto.js';
export { publicProfileSelect, toOwnProfile, toPublicProfile } from './dto.js';

export function profileOf(userId: string): Promise<Profile | null> {
  return prisma.profile.findUnique({ where: { userId } });
}

/// The presence somebody chose, or the default for an account with no row.
/// Read by the socket layer on every transition, so it is one indexed lookup.
export async function chosenPresence(userId: string): Promise<WirePresence> {
  const row = await prisma.profile.findUnique({
    where: { userId },
    select: { presence: true },
  });
  return PRESENCE_TO_WIRE[row?.presence ?? 'ONLINE'];
}

/// The same for several people at once, for the snapshot a fresh socket gets.
/// Anyone without a row is simply absent, and absent means the default.
export async function chosenPresences(userIds: string[]): Promise<Map<string, WirePresence>> {
  if (userIds.length === 0) return new Map();
  const rows = await prisma.profile.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, presence: true },
  });
  return new Map(rows.map((row) => [row.userId, PRESENCE_TO_WIRE[row.presence]]));
}

export async function wantsReadReceipts(userId: string): Promise<boolean> {
  const row = await prisma.profile.findUnique({
    where: { userId },
    select: { readReceipts: true },
  });
  return row?.readReceipts ?? true;
}

/* ------------------------------------------------------------- reading --- */

/// The whole card. Your own is always readable; anyone else's needs their
/// agreement, the same gate as the key registry: without it every user id is
/// a picture and a paragraph for the asking.
export async function getFullProfile(
  callerId: string,
  userId: string,
): Promise<FullProfileDto> {
  if (userId !== callerId) {
    await requireFriendship(callerId, userId);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, profile: true },
  });
  // The gate just passed, so a missing user is a deleted account still
  // cascading. Reported the way the gate reports a stranger.
  if (!user) throw badRequest('not_friends', 'You are not friends with this user.');

  const profile = user.profile ?? DEFAULT_PROFILE;
  return {
    ...toPublicProfile(profile),
    id: user.id,
    username: user.username,
    banner: profile.banner,
  };
}

/* ------------------------------------------------------------- writing --- */

/// Raw bytes, after base64. The client sends a 128px avatar and a 640 by 200
/// banner, which land well under these; the caps exist for a client that does
/// not downscale.
export const AVATAR_MAX_BYTES = 64 * 1024;
export const BANNER_MAX_BYTES = 160 * 1024;

/// A handle that can be changed freely can be cycled to squat on, or to shake
/// off a reputation. Counted from the audit log so it survives a restart.
const USERNAME_CHANGES_PER_DAY = 3;

export interface ProfileUpdateResult {
  profile: Profile | null;
  /// True when the chosen presence changed, so the caller can tell the socket
  /// layer to broadcast the new one.
  presenceChanged: boolean;
  usernameChanged: boolean;
}

/**
 * Applies a partial update to the caller's own profile.
 *
 * Only the fields present in `input` move; the client sends the diff against
 * what it last saw, debounced, so most calls carry one field. Pictures are
 * validated here rather than in the schema because a schema error is a 400
 * with a field path, and "that image could not be used" is the message the
 * client already has for exactly this.
 */
export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
  ip: string | null,
): Promise<ProfileUpdateResult> {
  const update: Prisma.ProfileUpdateInput = {};
  let touched = false;

  if (input.displayName !== undefined) {
    update.displayName = input.displayName;
    touched = true;
  }
  if (input.about !== undefined) {
    update.about = input.about;
    touched = true;
  }
  if (input.accent !== undefined) {
    update.accent = input.accent;
    touched = true;
  }
  if (input.avatar !== undefined) {
    update.avatar = input.avatar === null ? null : checkPicture(input.avatar, AVATAR_MAX_BYTES);
    touched = true;
  }
  if (input.banner !== undefined) {
    update.banner = input.banner === null ? null : checkPicture(input.banner, BANNER_MAX_BYTES);
    touched = true;
  }
  if (input.presence !== undefined) {
    update.presence = PRESENCE_FROM_WIRE[input.presence];
    touched = true;
  }
  if (input.readReceipts !== undefined) {
    update.readReceipts = input.readReceipts;
    touched = true;
  }
  if (input.friendRequestsFrom !== undefined) {
    update.friendRequestsFrom = POLICY_FROM_WIRE[input.friendRequestsFrom];
    touched = true;
  }

  let usernameChanged = false;
  if (input.username !== undefined) {
    usernameChanged = await changeUsername(userId, input.username, ip);
  }

  if (!touched) {
    return { profile: await profileOf(userId), presenceChanged: false, usernameChanged };
  }

  const before = await prisma.profile.findUnique({
    where: { userId },
    select: { presence: true },
  });

  const profile = await prisma.profile.upsert({
    where: { userId },
    create: { ...(update as Prisma.ProfileUncheckedCreateInput), userId },
    update,
  });

  const presenceChanged =
    input.presence !== undefined && (before?.presence ?? 'ONLINE') !== profile.presence;

  return { profile, presenceChanged, usernameChanged };
}

/// Returns false when the new handle is the current one: not an error, and
/// not a change worth counting against the daily budget either.
async function changeUsername(
  userId: string,
  username: string,
  ip: string | null,
): Promise<boolean> {
  const current = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { username: true },
  });
  if (current.username === username) return false;

  const since = new Date(Date.now() - 24 * 60 * 60_000);
  const recent = await prisma.auditLog.count({
    where: { actorUserId: userId, action: 'account.username_changed', createdAt: { gt: since } },
  });
  if (recent >= USERNAME_CHANGES_PER_DAY) {
    throw tooManyRequests(
      'rate_limited',
      'You have changed your username enough for one day. Try again tomorrow.',
    );
  }

  // Case-insensitive, because friend lookup is (friends/service.ts). Two
  // handles that differ only by case would be findable as one and reachable
  // as the other, so a rename is refused if it lands on an existing handle in
  // any case. Changing the case of your own handle is allowed: the row
  // matched below is your own.
  const taken = await prisma.user.findFirst({
    where: { username: { equals: username, mode: 'insensitive' }, id: { not: userId } },
    select: { id: true },
  });
  if (taken) throw conflict('username_in_use', 'That username is taken.');

  try {
    await prisma.user.update({ where: { id: userId }, data: { username } });
  } catch (error) {
    // Lost a race against a signup for the same handle. The unique index is
    // the real guard; report it the same way.
    if (isUniqueViolation(error)) throw conflict('username_in_use', 'That username is taken.');
    throw error;
  }

  await recordAudit({
    action: 'account.username_changed',
    actorUserId: userId,
    targetUserId: userId,
    ip,
    meta: { from: current.username, to: username },
  });

  return true;
}

/* ------------------------------------------------------------ pictures --- */

const DATA_URL = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

/// The string itself, once it has passed. Returned rather than the decoded
/// bytes because the string is what gets stored and what the client renders.
///
/// Three checks, each of which the client's own encoder already satisfies:
/// the shape of a data URL with one of three types, a byte cap, and the
/// file header of the type it claims. The third is what stops "image/png" from
/// carrying something that is not a PNG. SVG is not on the list on purpose:
/// it is a document with scripts in it, not a picture.
export function checkPicture(dataUrl: string, maxBytes: number): string {
  const rejected = badRequest('bad_picture', 'That image could not be used.');

  const match = DATA_URL.exec(dataUrl);
  if (!match) throw rejected;

  const type = match[1];
  const encoded = match[2];
  if (!type || !encoded) throw rejected;

  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length === 0 || bytes.length > maxBytes) throw rejected;
  if (!headerMatches(type, bytes)) throw rejected;

  return dataUrl;
}

function headerMatches(type: string, bytes: Buffer): boolean {
  switch (type) {
    case 'jpeg':
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case 'png':
      return (
        bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a
      );
    case 'webp':
      return (
        bytes.length >= 12 &&
        bytes.toString('latin1', 0, 4) === 'RIFF' &&
        bytes.toString('latin1', 8, 12) === 'WEBP'
      );
    default:
      return false;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}
