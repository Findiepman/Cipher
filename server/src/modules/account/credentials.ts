/**
 * Changing a password, and rotating the recovery code, for someone who is
 * already signed in.
 *
 * Neither of these is a credentials-only operation, which is the thing to
 * understand before editing them. A password here is also a wrapping key, so
 * changing one means the client re-wraps its private key locally and uploads
 * the new blob alongside the new verifier. The server swaps both in one
 * transaction or neither: an account whose verifier moved on without its blob
 * can sign in and then decrypt nothing, which is worse than a failed request.
 *
 * The password itself never arrives, here as everywhere else. What arrives is
 * an authHash the client derived, and the only question this file can answer
 * about it is whether it matches the one on file.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { badRequest, notFound, unauthorized } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { parseBody } from '../../lib/validate.js';
import { base64_32, wrappedKeySchema } from '../auth/schemas.js';
import { activeDeviceFor, recordCredentialAudit } from '../auth/service.js';

/// blob_A is re-wrapped under the new password. blob_B is untouched, so the
/// recovery code the user wrote down at signup keeps working.
const changePasswordSchema = z.object({
  currentAuthHash: base64_32,
  newAuthHash: base64_32,
  wrappedPrivateKey: wrappedKeySchema,
});

/// The mirror image: blob_B is re-wrapped under a new code and blob_A is
/// untouched, so the password keeps working.
const regenerateRecoveryCodeSchema = z.object({
  authHash: base64_32,
  recoveryCodeHash: base64_32,
  wrappedPrivateKeyRecovery: wrappedKeySchema,
});

/// Both endpoints verify an argon2id hash, which is deliberately expensive, so
/// they get a budget of their own rather than sitting under the 300-per-window
/// global one. Tighter than /auth/* because the caller is authenticated: a
/// person changing their own password does not need ten attempts.
const reauthLimit = {
  config: {
    rateLimit: { max: 10, timeWindow: '15 minutes' },
  },
};

export const credentialsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/change-password',
    { ...reauthLimit, preHandler: fastify.requireAuth },
    async (request, reply) => {
      const input = parseBody(changePasswordSchema, request.body);
      const { id: userId, sessionId } = request.currentUser!;

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw notFound('user_not_found', 'Account no longer exists.');

      // Re-authentication, not authorization. The access token already proves
      // who is calling; this proves they know the password they are replacing,
      // so a borrowed unlocked tab cannot lock the owner out of their own
      // account.
      if (!(await verifyPassword(user.authVerifier, input.currentAuthHash))) {
        throw unauthorized(
          'invalid_credentials',
          'That is not your current password.',
        );
      }

      const device = await activeDeviceFor(userId);
      if (!device) {
        throw badRequest(
          'identity_unavailable',
          'This account has no key material on file, so there is nothing to re-wrap.',
        );
      }

      const authVerifier = await hashPassword(input.newAuthHash);
      const now = new Date();

      await prisma.$transaction([
        prisma.user.update({
          where: { id: userId },
          data: { authVerifier, failedLoginCount: 0, lockedUntil: null },
        }),
        prisma.device.update({
          where: { id: device.id },
          data: { wrappedPrivateKey: input.wrappedPrivateKey },
        }),
        // Every other session dies. Somebody changing their password is
        // often doing it because of a session they want gone, and the one
        // making the request is kept so they are not signed out of the tab
        // they are standing in.
        prisma.session.updateMany({
          where: { userId, revokedAt: null, id: { not: sessionId } },
          data: { revokedAt: now },
        }),
      ]);

      await recordCredentialAudit({
        action: 'auth.password_changed',
        actorUserId: userId,
        targetUserId: userId,
        ip: request.ip,
      });

      return reply.send({ ok: true });
    },
  );

  fastify.post(
    '/recovery-code',
    { ...reauthLimit, preHandler: fastify.requireAuth },
    async (request, reply) => {
      const input = parseBody(regenerateRecoveryCodeSchema, request.body);
      const userId = request.currentUser!.id;

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw notFound('user_not_found', 'Account no longer exists.');

      if (!(await verifyPassword(user.authVerifier, input.authHash))) {
        throw unauthorized('invalid_credentials', 'That password is not correct.');
      }

      const device = await activeDeviceFor(userId);
      if (!device) {
        throw badRequest(
          'identity_unavailable',
          'This account has no key material on file, so there is nothing to re-wrap.',
        );
      }

      // One live code at a time (STATUS.md, Deviations): writing the new hash
      // is what retires the old code. Sessions are left alone, because nothing
      // about the session credentials changed.
      await prisma.$transaction([
        prisma.user.update({
          where: { id: userId },
          data: { recoveryCodeHash: input.recoveryCodeHash },
        }),
        prisma.device.update({
          where: { id: device.id },
          data: { wrappedPrivateKeyRecovery: input.wrappedPrivateKeyRecovery },
        }),
      ]);

      await recordCredentialAudit({
        action: 'auth.recovery_code_rotated',
        actorUserId: userId,
        targetUserId: userId,
        ip: request.ip,
      });

      return reply.send({ ok: true });
    },
  );
};
