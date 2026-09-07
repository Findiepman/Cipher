import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../db.js';
import { notFound } from '../../lib/errors.js';
import { toAccountDto } from '../auth/service.js';
import { credentialsRoutes } from './credentials.js';

/// Only the pieces the sign-in flow needs. Profile edits, email changes,
/// session management and account deletion arrive with their own step.
export const accountRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(credentialsRoutes);

  fastify.get('/me', { preHandler: fastify.requireAuth }, async (request) => {
    const user = await prisma.user.findUnique({
      where: { id: request.currentUser!.id },
    });

    if (!user) {
      throw notFound('user_not_found', 'Account no longer exists.');
    }

    return toAccountDto(user);
  });
};
