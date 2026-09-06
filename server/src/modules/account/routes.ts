import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../db.js';
import { notFound } from '../../lib/errors.js';
import { toPublicUser } from '../auth/service.js';

/// Only the pieces the sign-in flow needs. Profile edits, email changes,
/// session management and account deletion arrive with their own step.
export const accountRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/me', { preHandler: fastify.requireAuth }, async (request) => {
    const user = await prisma.user.findUnique({
      where: { id: request.currentUser!.id },
    });

    if (!user) {
      throw notFound('user_not_found', 'Account no longer exists.');
    }

    return { user: toPublicUser(user) };
  });
};
