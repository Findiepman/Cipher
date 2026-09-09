import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../db.js';
import { notFound } from '../../lib/errors.js';
import type { Mailer } from '../../lib/mailer.js';
import type { RealtimeHooks } from '../../realtime/hooks.js';
import { toAccountDto } from '../auth/service.js';
import { profileOf } from '../profile/service.js';
import { credentialsRoutes } from './credentials.js';
import { deletionRoutes } from './deletion.js';
import { emailRoutes } from './email.js';
import { profileRoutes } from './profile.js';
import { sessionRoutes } from './sessions.js';

export interface AccountRoutesOptions {
  mailer: Mailer;
  /// Absent when there is no socket layer (tests of the HTTP API alone).
  realtime?: Partial<RealtimeHooks>;
}

/// The account, in five files: what the sign-in flow needs (here and
/// credentials.ts), the profile and the settings the server holds
/// (profile.ts), the sessions signed in (sessions.ts), moving to a new
/// address (email.ts) and ending the account (deletion.ts).
export const accountRoutes: FastifyPluginAsync<AccountRoutesOptions> = async (fastify, opts) => {
  await fastify.register(credentialsRoutes);
  await fastify.register(profileRoutes, { realtime: opts.realtime });
  await fastify.register(sessionRoutes, { realtime: opts.realtime });
  await fastify.register(emailRoutes, { mailer: opts.mailer });
  await fastify.register(deletionRoutes, { realtime: opts.realtime });

  fastify.get('/me', { preHandler: fastify.requireAuth }, async (request) => {
    const user = await prisma.user.findUnique({
      where: { id: request.currentUser!.id },
      include: { profile: true },
    });

    if (!user) {
      throw notFound('user_not_found', 'Account no longer exists.');
    }

    return toAccountDto(user, user.profile);
  });
};
