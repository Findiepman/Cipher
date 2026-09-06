/**
 * The friend graph.
 *
 * One row per pair, stored in canonical (sorted) order, so "A asked B" and "B
 * asked A" are the same row and cannot both be pending. Direction is recorded
 * in `requestedById`, which is the only thing "incoming" and "outgoing" mean.
 *
 * Friendship is the authorization gate for everything else in the messaging
 * layer: you cannot look up someone's public key or open a conversation with
 * them until they have agreed to it.
 */
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { badRequest, conflict, notFound, tooManyRequests } from '../../lib/errors.js';

/// Per account, per hour, counted from the audit log so it survives a restart
/// and so *failed* lookups count too - a scraper's requests all fail, which is
/// exactly the traffic worth capping.
const REQUESTS_PER_HOUR = 20;

export interface FriendDto {
  id: string;
  username: string;
  /// base64 X25519 public key, or null for an account with no active device.
  /// Included here because the client needs it for every conversation anyway;
  /// /keys/user/:userId exists for the one-off lookup.
  publicKey: string | null;
  friendsSince: string;
}

export interface FriendRequestDto {
  id: string;
  direction: 'incoming' | 'outgoing';
  user: { id: string; username: string };
  createdAt: string;
}

/// The pair, sorted. Every read and write goes through this so the unique index
/// on (userAId, userBId) can do its job.
export function canonicalPair(
  x: string,
  y: string,
): { userAId: string; userBId: string } {
  return x < y ? { userAId: x, userBId: y } : { userAId: y, userBId: x };
}

export async function areFriends(x: string, y: string): Promise<boolean> {
  if (x === y) return false;
  const friendship = await prisma.friendship.findUnique({
    where: { userAId_userBId: canonicalPair(x, y) },
    select: { status: true },
  });
  return friendship?.status === 'ACCEPTED';
}

/// Throws rather than returning false, so callers cannot forget to check.
export async function requireFriendship(x: string, y: string): Promise<void> {
  if (!(await areFriends(x, y))) {
    throw notFound('not_friends', 'You are not friends with this user.');
  }
}

export async function listFriends(userId: string): Promise<FriendDto[]> {
  const rows = await prisma.friendship.findMany({
    where: {
      status: 'ACCEPTED',
      OR: [{ userAId: userId }, { userBId: userId }],
    },
    include: {
      userA: { select: { id: true, username: true, devices: activeDevice } },
      userB: { select: { id: true, username: true, devices: activeDevice } },
    },
  });

  return rows
    .map((row) => {
      const other = row.userAId === userId ? row.userB : row.userA;
      return {
        id: other.id,
        username: other.username,
        publicKey: other.devices[0]?.publicKey ?? null,
        friendsSince: (row.respondedAt ?? row.createdAt).toISOString(),
      };
    })
    .sort((a, b) => a.username.localeCompare(b.username));
}

export async function listRequests(userId: string): Promise<{
  incoming: FriendRequestDto[];
  outgoing: FriendRequestDto[];
}> {
  const rows = await prisma.friendship.findMany({
    where: {
      status: 'PENDING',
      OR: [{ userAId: userId }, { userBId: userId }],
    },
    include: {
      userA: { select: { id: true, username: true } },
      userB: { select: { id: true, username: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const incoming: FriendRequestDto[] = [];
  const outgoing: FriendRequestDto[] = [];

  for (const row of rows) {
    const other = row.userAId === userId ? row.userB : row.userA;
    const dto: FriendRequestDto = {
      id: row.id,
      direction: row.requestedById === userId ? 'outgoing' : 'incoming',
      user: { id: other.id, username: other.username },
      createdAt: row.createdAt.toISOString(),
    };
    (dto.direction === 'incoming' ? incoming : outgoing).push(dto);
  }

  return { incoming, outgoing };
}

export type SendRequestOutcome = 'pending' | 'accepted' | 'already_friends';

export async function sendRequest(
  userId: string,
  username: string,
  ip: string | null,
): Promise<{ status: SendRequestOutcome; user: { id: string; username: string } }> {
  await enforceRequestBudget(userId);

  // Case-insensitive, because nobody remembers whether a handle was
  // capitalised. Usernames are not stored lowercased, so two accounts could in
  // principle differ only by case - see the note in STATUS.md.
  const target = await prisma.user.findFirst({
    where: { username: { equals: username, mode: 'insensitive' } },
    select: { id: true, username: true, status: true, emailVerifiedAt: true },
  });

  const unknown = notFound('user_not_found', `No user called "${username}".`);

  // An unverified or disabled account is reported as absent rather than as
  // existing-but-unavailable: the distinction is only useful to someone
  // probing, and useless to someone genuinely adding a friend.
  if (!target || target.status !== 'ACTIVE' || !target.emailVerifiedAt) {
    await recordAudit({
      action: 'friend.request_failed',
      actorUserId: userId,
      ip,
      meta: { reason: 'unknown_user' },
    });
    throw unknown;
  }

  if (target.id === userId) {
    throw badRequest('cannot_friend_self', 'You cannot add yourself.');
  }

  const pair = canonicalPair(userId, target.id);
  const existing = await prisma.friendship.findUnique({
    where: { userAId_userBId: pair },
  });

  if (existing?.status === 'ACCEPTED') {
    return { status: 'already_friends', user: publicUser(target) };
  }

  if (existing?.status === 'BLOCKED') {
    // If they blocked us, say what we would say about a stranger - confirming a
    // block is itself information. If we blocked them, say so, because the
    // caller can act on it.
    if (existing.blockedById === userId) {
      throw conflict('blocked', 'Unblock this user before adding them.');
    }
    await recordAudit({
      action: 'friend.request_failed',
      actorUserId: userId,
      ip,
      meta: { reason: 'blocked_by_target' },
    });
    throw unknown;
  }

  if (existing?.status === 'PENDING') {
    if (existing.requestedById === userId) {
      // Asking twice is not an error; it is the same request.
      return { status: 'pending', user: publicUser(target) };
    }

    // They had already asked us. Both parties have now said yes, so this is
    // consent, not a second request.
    await prisma.friendship.update({
      where: { id: existing.id },
      data: { status: 'ACCEPTED', respondedAt: new Date() },
    });
    await recordAudit({
      action: 'friend.accepted',
      actorUserId: userId,
      targetUserId: target.id,
      ip,
    });
    return { status: 'accepted', user: publicUser(target) };
  }

  await prisma.friendship.create({
    data: { ...pair, requestedById: userId, status: 'PENDING' },
  });

  await recordAudit({
    action: 'friend.request_sent',
    actorUserId: userId,
    targetUserId: target.id,
    ip,
  });

  return { status: 'pending', user: publicUser(target) };
}

export async function respondToRequest(
  userId: string,
  friendshipId: string,
  accept: boolean,
  ip: string | null,
): Promise<void> {
  const friendship = await prisma.friendship.findUnique({
    where: { id: friendshipId },
  });

  const unknown = notFound('request_not_found', 'That friend request no longer exists.');

  if (!friendship || friendship.status !== 'PENDING') throw unknown;
  if (friendship.userAId !== userId && friendship.userBId !== userId) throw unknown;

  // Accepting your own request would be a one-sided friendship.
  if (friendship.requestedById === userId) {
    throw badRequest('not_your_request', 'You sent this request; only they can answer it.');
  }

  const otherId = friendship.userAId === userId ? friendship.userBId : friendship.userAId;

  if (accept) {
    await prisma.friendship.update({
      where: { id: friendship.id },
      data: { status: 'ACCEPTED', respondedAt: new Date() },
    });
  } else {
    // Deleted rather than marked declined, so they are free to ask again later
    // and so a declined request leaves no record to be read back.
    await prisma.friendship.delete({ where: { id: friendship.id } });
  }

  await recordAudit({
    action: accept ? 'friend.accepted' : 'friend.declined',
    actorUserId: userId,
    targetUserId: otherId,
    ip,
  });
}

export async function removeFriend(
  userId: string,
  otherUserId: string,
  ip: string | null,
): Promise<void> {
  const pair = canonicalPair(userId, otherUserId);
  const friendship = await prisma.friendship.findUnique({
    where: { userAId_userBId: pair },
  });

  if (!friendship || friendship.status !== 'ACCEPTED') {
    throw notFound('not_friends', 'You are not friends with this user.');
  }

  // The conversation and its messages stay. Unfriending withdraws the ability
  // to send anything new; it is not a request to destroy what was said.
  await prisma.friendship.delete({ where: { id: friendship.id } });

  await recordAudit({
    action: 'friend.removed',
    actorUserId: userId,
    targetUserId: otherUserId,
    ip,
  });
}

export async function blockUser(
  userId: string,
  otherUserId: string,
  ip: string | null,
): Promise<void> {
  if (userId === otherUserId) {
    throw badRequest('cannot_block_self', 'You cannot block yourself.');
  }

  const target = await prisma.user.findUnique({
    where: { id: otherUserId },
    select: { id: true },
  });
  if (!target) throw notFound('user_not_found', 'No such user.');

  const pair = canonicalPair(userId, otherUserId);

  await prisma.friendship.upsert({
    where: { userAId_userBId: pair },
    create: {
      ...pair,
      requestedById: userId,
      blockedById: userId,
      status: 'BLOCKED',
      respondedAt: new Date(),
    },
    update: { status: 'BLOCKED', blockedById: userId, respondedAt: new Date() },
  });

  await recordAudit({
    action: 'friend.blocked',
    actorUserId: userId,
    targetUserId: otherUserId,
    ip,
  });
}

export async function unblockUser(
  userId: string,
  otherUserId: string,
  ip: string | null,
): Promise<void> {
  const pair = canonicalPair(userId, otherUserId);
  const friendship = await prisma.friendship.findUnique({
    where: { userAId_userBId: pair },
  });

  // Only whoever applied the block can lift it. Without this check the blocked
  // party could clear it themselves, which would make blocking meaningless.
  if (!friendship || friendship.status !== 'BLOCKED' || friendship.blockedById !== userId) {
    throw notFound('not_blocked', 'You have not blocked this user.');
  }

  await prisma.friendship.delete({ where: { id: friendship.id } });

  await recordAudit({
    action: 'friend.unblocked',
    actorUserId: userId,
    targetUserId: otherUserId,
    ip,
  });
}

async function enforceRequestBudget(userId: string): Promise<void> {
  const since = new Date(Date.now() - 60 * 60_000);

  const recent = await prisma.auditLog.count({
    where: {
      actorUserId: userId,
      action: { in: ['friend.request_sent', 'friend.request_failed'] },
      createdAt: { gt: since },
    },
  });

  if (recent >= REQUESTS_PER_HOUR) {
    throw tooManyRequests(
      'rate_limited',
      'Too many friend requests. Try again in an hour.',
    );
  }
}

function publicUser(user: { id: string; username: string }) {
  return { id: user.id, username: user.username };
}

/// The account's live device. One per account in v1, so `[0]` is "the" key.
const activeDevice = {
  where: { revokedAt: null },
  orderBy: { createdAt: 'asc' },
  take: 1,
  select: { publicKey: true },
} satisfies Prisma.User$devicesArgs;
