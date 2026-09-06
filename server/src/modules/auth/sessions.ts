import { randomUUID } from 'node:crypto';
import type { User } from '../../generated/prisma/client.js';
import { prisma } from '../../db.js';
import { env } from '../../env.js';
import { recordAudit } from '../../lib/audit.js';
import { unauthorized } from '../../lib/errors.js';
import { createOpaqueToken, daysFromNow, hashToken } from '../../lib/tokens.js';

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

export interface IssuedSession {
  sessionId: string;
  refreshToken: string;
  expiresAt: Date;
}

export async function issueSession(
  userId: string,
  ctx: RequestContext,
  familyId: string = randomUUID(),
): Promise<IssuedSession> {
  const { token, tokenHash } = createOpaqueToken();
  const expiresAt = daysFromNow(env.REFRESH_TOKEN_TTL_DAYS);

  const session = await prisma.session.create({
    data: {
      userId,
      familyId,
      refreshTokenHash: tokenHash,
      expiresAt,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    },
  });

  return { sessionId: session.id, refreshToken: token, expiresAt };
}

export interface RotationResult {
  user: User;
  session: IssuedSession;
}

/// Exchanges a refresh token for a fresh one. The old row is marked revoked
/// and pointed at its replacement, so presenting it a second time is provably
/// a replay rather than a race.
export async function rotateSession(
  rawToken: string,
  ctx: RequestContext,
): Promise<RotationResult> {
  const tokenHash = hashToken(rawToken);

  const existing = await prisma.session.findUnique({
    where: { refreshTokenHash: tokenHash },
    include: { user: true },
  });

  if (!existing) {
    throw unauthorized('invalid_refresh_token', 'Session is no longer valid.');
  }

  if (existing.revokedAt) {
    // A spent token came back. Either it was stolen and replayed, or the
    // legitimate holder's newer token was stolen - we can't tell which, so
    // the whole family dies and every device has to sign in again.
    await revokeFamily(existing.familyId);
    await recordAudit({
      action: 'auth.refresh_reuse_detected',
      targetUserId: existing.userId,
      ip: ctx.ip,
      meta: { familyId: existing.familyId, sessionId: existing.id },
    });
    throw unauthorized(
      'refresh_token_reused',
      'Session was revoked for security reasons. Please sign in again.',
    );
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    throw unauthorized('refresh_token_expired', 'Session has expired.');
  }

  if (existing.user.status !== 'ACTIVE') {
    await revokeFamily(existing.familyId);
    throw unauthorized('account_unavailable', 'This account is not active.');
  }

  const replacement = await issueSession(
    existing.userId,
    ctx,
    existing.familyId,
  );

  await prisma.session.update({
    where: { id: existing.id },
    data: {
      revokedAt: new Date(),
      replacedById: replacement.sessionId,
      lastUsedAt: new Date(),
    },
  });

  return { user: existing.user, session: replacement };
}

export async function revokeByToken(rawToken: string): Promise<void> {
  await prisma.session.updateMany({
    where: { refreshTokenHash: hashToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeFamily(familyId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllForUser(userId: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}
