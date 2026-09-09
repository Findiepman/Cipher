/**
 * Editing your own profile and the handful of settings the server holds.
 *
 * One endpoint for all of it, taking a partial: the client sends the fields
 * that changed, debounced, so most calls carry one. What is in the set and
 * why is the header of modules/profile/service.ts.
 */
import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../db.js';
import { notFound } from '../../lib/errors.js';
import { parseBody } from '../../lib/validate.js';
import type { RealtimeHooks } from '../../realtime/hooks.js';
import { toAccountDto } from '../auth/service.js';
import { updateProfileSchema } from '../profile/schemas.js';
import { updateProfile } from '../profile/service.js';

export interface ProfileRoutesOptions {
  realtime?: Partial<RealtimeHooks>;
}

/// A banner is up to 160 KB of bytes, a third more as base64, and the
/// application-wide limit is 64 KB. This one route gets a budget of its own;
/// nothing else on the API carries a picture.
const PICTURE_BODY_LIMIT = 384 * 1024;

export const profileRoutes: FastifyPluginAsync<ProfileRoutesOptions> = async (fastify, opts) => {
  fastify.patch(
    '/me',
    { bodyLimit: PICTURE_BODY_LIMIT, preHandler: fastify.requireAuth },
    async (request) => {
      const input = parseBody(updateProfileSchema, request.body);
      const userId = request.currentUser!.id;

      const result = await updateProfile(userId, input, request.ip);

      // The socket layer decides what friends should now see, which depends
      // on whether this person is connected at all. Told after the write, so
      // what it reads back is the new choice.
      if (result.presenceChanged) opts.realtime?.presenceChanged?.(userId);

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw notFound('user_not_found', 'Account no longer exists.');

      return toAccountDto(user, result.profile);
    },
  );
};
