/**
 * Deleting your own account.
 *
 * A soft delete, on purpose. `User` cascades to `Message` and
 * `MessageEnvelope`, so a hard delete would reach into every conversation
 * this person was in and remove the other side's copy of what was said to
 * them. Unfriending deliberately leaves history readable (STATUS.md, decision
 * 8), and ending an account is not a request to rewrite somebody else's.
 *
 * What goes: the handle and the address are freed, the profile is removed,
 * the device is revoked so the key registry stops handing out the public key,
 * every friendship and pending request is deleted, every session is revoked
 * and every socket dropped. What stays: the row itself, marked DELETED, and
 * the sealed envelopes, which nobody can read anyway without a key this
 * server never had.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { notFound, unauthorized } from '../../lib/errors.js';
import { verifyPassword } from '../../lib/password.js';
import { parseBody } from '../../lib/validate.js';
import type { RealtimeHooks } from '../../realtime/hooks.js';
import { base64_32 } from '../auth/schemas.js';

export interface DeletionRoutesOptions {
  realtime?: Partial<RealtimeHooks>;
}

const deleteSchema = z.object({
  authHash: base64_32,
});

const reauthLimit = {
  config: {
    rateLimit: { max: 10, timeWindow: '15 minutes' },
  },
};

export const deletionRoutes: FastifyPluginAsync<DeletionRoutesOptions> = async (
  fastify,
  opts,
) => {
  fastify.delete(
    '/',
    { ...reauthLimit, preHandler: fastify.requireAuth },
    async (request, reply) => {
      const { authHash } = parseBody(deleteSchema, request.body);
      const userId = request.currentUser!.id;

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw notFound('user_not_found', 'Account no longer exists.');

      // Re-authentication, as for a password change: an unlocked tab left
      // open must not be enough to end the account.
      if (!(await verifyPassword(user.authVerifier, authHash))) {
        throw unauthorized('invalid_credentials', 'That is not your password.');
      }

      const sessions = await prisma.session.findMany({
        where: { userId },
        select: { id: true },
      });
      const now = new Date();

      // The replacement handle is longer than a username may be, so nobody
      // can register it, and the address is under a reserved domain for the
      // same reason. Both unique columns are freed for whoever wants them.
      const tombstone = user.id.replace(/-/g, '');

      await prisma.$transaction([
        prisma.user.update({
          where: { id: userId },
          data: {
            status: 'DELETED',
            deletedAt: now,
            username: `deleted-${tombstone}`,
            email: `deleted-${tombstone}@deleted.invalid`,
            emailVerifiedAt: null,
            recoveryCodeHash: null,
          },
        }),
        prisma.profile.deleteMany({ where: { userId } }),
        prisma.device.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: now },
        }),
        prisma.friendship.deleteMany({
          where: { OR: [{ userAId: userId }, { userBId: userId }] },
        }),
        prisma.contactNickname.deleteMany({
          where: { OR: [{ ownerId: userId }, { subjectId: userId }] },
        }),
        prisma.emailToken.deleteMany({ where: { userId } }),
        prisma.session.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: now },
        }),
      ]);

      opts.realtime?.disconnectSessions?.(sessions.map((session) => session.id));

      await recordAudit({
        action: 'account.deleted',
        actorUserId: userId,
        targetUserId: userId,
        ip: request.ip,
      });

      return reply.send({ ok: true });
    },
  );
};
