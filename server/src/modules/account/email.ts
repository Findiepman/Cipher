/**
 * Moving an account to a new email address.
 *
 * Three steps, because the address is also the salt. The client derives
 * `authHash` from the password and the email (packages/crypto), so the
 * verifier on file is bound to the address it was made under, and a change of
 * address is also a change of verifier. The wrapped key blobs are not
 * affected: they carry their own random salts, so no re-wrapping and the
 * recovery code keeps working.
 *
 *   1. change-email: prove the password, name the new address. A link goes
 *      to the NEW address and nothing changes yet.
 *   2. change-email/context: the link was opened; the client asks which
 *      address the token is for, so it can derive the new authHash under it.
 *      Not spent by this, so a mistyped password costs nothing.
 *   3. change-email/confirm: the token and the new authHash. Both columns
 *      move in one transaction or neither. Sessions are kept: the password
 *      did not change, only the name it is derived under.
 *
 * Step 1 answers the same way whether or not the address is taken, like
 * registration and for the same reason. The owner of a taken address gets the
 * "someone tried to register" mail instead.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { badRequest, conflict, notFound, unauthorized } from '../../lib/errors.js';
import { alreadyRegisteredEmail, emailChangeEmail, type Mailer } from '../../lib/mailer.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { createOpaqueToken, hashToken, minutesFromNow } from '../../lib/tokens.js';
import { parseBody } from '../../lib/validate.js';
import { base64_32, emailSchema } from '../auth/schemas.js';
import { toAccountDto } from '../auth/service.js';
import { profileOf } from '../profile/service.js';

export interface EmailRoutesOptions {
  mailer: Mailer;
}

/// As short as a reset link, for the same reason: it is a live credential
/// for a change to the account, not a convenience waiting in an inbox.
const CHANGE_TOKEN_TTL_MINUTES = 60;

const requestSchema = z.object({
  newEmail: emailSchema,
  authHash: base64_32,
});

const tokenSchema = z.object({
  token: z.string().min(1).max(512),
});

const confirmSchema = z.object({
  token: z.string().min(1).max(512),
  newAuthHash: base64_32,
});

/// Argon2id verification per call, so a budget of its own, as
/// credentials.ts has.
const reauthLimit = {
  config: {
    rateLimit: { max: 10, timeWindow: '15 minutes' },
  },
};

export const emailRoutes: FastifyPluginAsync<EmailRoutesOptions> = async (fastify, opts) => {
  fastify.addHook('preHandler', fastify.requireAuth);

  fastify.post('/change-email', reauthLimit, async (request, reply) => {
    const input = parseBody(requestSchema, request.body);
    const userId = request.currentUser!.id;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound('user_not_found', 'Account no longer exists.');

    if (!(await verifyPassword(user.authVerifier, input.authHash))) {
      throw unauthorized('invalid_credentials', 'That is not your password.');
    }

    if (input.newEmail === user.email) {
      throw badRequest('same_email', 'That is already the address on this account.');
    }

    const taken = await prisma.user.findUnique({
      where: { email: input.newEmail },
      select: { id: true },
    });

    if (taken) {
      // The person asking is not told. The owner of the address is, because
      // they are the one entitled to know somebody is trying to use it.
      await opts.mailer.send({ to: input.newEmail, ...alreadyRegisteredEmail() });
      return reply.send({ ok: true });
    }

    const { token, tokenHash } = createOpaqueToken();

    // One live link at a time: asking again retires the previous email.
    await prisma.$transaction([
      prisma.emailToken.deleteMany({ where: { userId, purpose: 'EMAIL_CHANGE' } }),
      prisma.emailToken.create({
        data: {
          userId,
          purpose: 'EMAIL_CHANGE',
          tokenHash,
          newEmail: input.newEmail,
          expiresAt: minutesFromNow(CHANGE_TOKEN_TTL_MINUTES),
        },
      }),
    ]);

    await opts.mailer.send({ to: input.newEmail, ...emailChangeEmail(token) });

    // The new address is not written to the audit log. Until the link is
    // opened it is a claim, not a fact about the account.
    await recordAudit({
      action: 'account.email_change_requested',
      actorUserId: userId,
      targetUserId: userId,
      ip: request.ip,
    });

    return reply.send({ ok: true });
  });

  fastify.post('/change-email/context', async (request) => {
    const { token } = parseBody(tokenSchema, request.body);
    const record = await requireChangeToken(token, request.currentUser!.id);
    return { newEmail: record.newEmail };
  });

  fastify.post('/change-email/confirm', reauthLimit, async (request) => {
    const input = parseBody(confirmSchema, request.body);
    const userId = request.currentUser!.id;

    const record = await requireChangeToken(input.token, userId);
    const newEmail = record.newEmail;

    const authVerifier = await hashPassword(input.newAuthHash);
    const now = new Date();

    try {
      await prisma.$transaction(async (tx) => {
        // Spent conditionally, so two confirms racing the same link cannot
        // both apply, and the loser fails before touching the account.
        const spent = await tx.emailToken.updateMany({
          where: { id: record.id, usedAt: null },
          data: { usedAt: now },
        });
        if (spent.count === 0) throw invalidToken();

        await tx.user.update({
          where: { id: userId },
          data: {
            email: newEmail,
            authVerifier,
            // Opening the link is the proof the inbox is theirs.
            emailVerifiedAt: now,
            failedLoginCount: 0,
            lockedUntil: null,
          },
        });
      });
    } catch (error) {
      // Somebody registered the address between the request and the click.
      // At this point the caller has proved they hold the inbox, so they may
      // be told plainly.
      if (isUniqueViolation(error)) {
        throw conflict('email_in_use', 'That address now belongs to another account.');
      }
      throw error;
    }

    await recordAudit({
      action: 'account.email_changed',
      actorUserId: userId,
      targetUserId: userId,
      ip: request.ip,
    });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return toAccountDto(user, await profileOf(userId));
  });
};

const invalidToken = () =>
  badRequest('invalid_token', 'This confirmation link is invalid or has expired.');

/// Every rejection is the same 400, as with reset links: the difference
/// between "expired", "somebody else's" and "never existed" is only useful to
/// someone guessing.
async function requireChangeToken(rawToken: string, userId: string) {
  const record = await prisma.emailToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
  });

  if (
    !record ||
    record.purpose !== 'EMAIL_CHANGE' ||
    record.userId !== userId ||
    !record.newEmail ||
    record.usedAt ||
    record.expiresAt.getTime() <= Date.now()
  ) {
    throw invalidToken();
  }

  return { id: record.id, newEmail: record.newEmail };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}
