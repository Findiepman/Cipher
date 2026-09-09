/**
 * The sessions signed in to this account, and signing one of them out.
 *
 * A "session" here is a refresh-token family (auth/sessions.ts): rotation
 * writes a new row and revokes the old one, so at any moment a family has
 * exactly one live row, and that row is what this lists. Revoking is by
 * family for the same reason: killing one row leaves its rotated sibling
 * alive, and the session walks straight back in on the next refresh.
 *
 * This is the only per-session revocation that exists short of rotating
 * JWT_SECRET and signing everyone out, which is why it pushes the socket
 * closed instead of leaving that to the sweep.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { parseBody } from '../../lib/validate.js';
import type { RealtimeHooks } from '../../realtime/hooks.js';

export interface SessionRoutesOptions {
  realtime?: Partial<RealtimeHooks>;
}

/// Mirrors SessionDto in the client. No token hash, ever: the hash is the
/// credential's fingerprint, and a list of them is a list of things to try.
export interface SessionDto {
  id: string;
  deviceLabel: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  /// The family the caller is standing in, so the UI can label it and refuse
  /// to sign it out by accident.
  current: boolean;
}

const sessionIdSchema = z.object({ id: z.string().uuid() });

export const sessionRoutes: FastifyPluginAsync<SessionRoutesOptions> = async (fastify, opts) => {
  fastify.addHook('preHandler', fastify.requireAuth);

  fastify.get('/sessions', async (request) => {
    const { id: userId, sessionId } = request.currentUser!;
    const family = await familyOf(sessionId);

    const rows = await prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        familyId: true,
        deviceLabel: true,
        ip: true,
        userAgent: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
      },
    });

    const sessions: SessionDto[] = rows.map((row) => ({
      id: row.id,
      deviceLabel: row.deviceLabel,
      ip: row.ip,
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      current: row.familyId === family,
    }));

    return sessions;
  });

  fastify.delete('/sessions/:id', async (request, reply) => {
    const { id } = parseBody(sessionIdSchema, request.params);
    const { id: userId, sessionId } = request.currentUser!;

    const target = await prisma.session.findFirst({
      // Scoped to the caller: somebody else's session id is reported as
      // absent, not as forbidden, so the id space cannot be probed.
      where: { id, userId, revokedAt: null },
      select: { familyId: true },
    });
    if (!target) throw notFound('session_not_found', 'That session is already gone.');

    if (target.familyId === (await familyOf(sessionId))) {
      // Signing yourself out is /auth/logout, which also clears the cookies.
      // Doing it here would leave the browser holding credentials for a
      // session that no longer exists.
      throw badRequest('cannot_revoke_current', 'Use sign out for the session you are in.');
    }

    const dropped = await revokeFamilies([target.familyId]);
    opts.realtime?.disconnectSessions?.(dropped);

    await recordAudit({
      action: 'account.session_revoked',
      actorUserId: userId,
      targetUserId: userId,
      ip: request.ip,
      meta: { sessionId: id },
    });

    return reply.send({ ok: true });
  });

  /// Everything but the session making the request. /auth/logout-all is the
  /// blunter version that takes the caller with it.
  fastify.delete('/sessions', async (request, reply) => {
    const { id: userId, sessionId } = request.currentUser!;
    const family = await familyOf(sessionId);

    const others = await prisma.session.findMany({
      where: { userId, revokedAt: null, familyId: { not: family } },
      select: { familyId: true },
      distinct: ['familyId'],
    });

    const dropped = await revokeFamilies(others.map((row) => row.familyId));
    opts.realtime?.disconnectSessions?.(dropped);

    await recordAudit({
      action: 'account.sessions_revoked',
      actorUserId: userId,
      targetUserId: userId,
      ip: request.ip,
      meta: { revoked: others.length },
    });

    return reply.send({ ok: true, revoked: others.length });
  });
};

async function familyOf(sessionId: string): Promise<string> {
  const row = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { familyId: true },
  });
  // requireAuth just confirmed this session is live, so this cannot miss
  // short of a race with a revocation, in which case there is no family to
  // protect either way.
  return row?.familyId ?? '';
}

/// Revokes every row in the given families and returns every session id
/// they ever had, live or rotated: a socket may still be authenticated with
/// the id of a row that rotation has already retired.
async function revokeFamilies(familyIds: string[]): Promise<string[]> {
  if (familyIds.length === 0) return [];

  const rows = await prisma.session.findMany({
    where: { familyId: { in: familyIds } },
    select: { id: true },
  });

  await prisma.session.updateMany({
    where: { familyId: { in: familyIds }, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  return rows.map((row) => row.id);
}
