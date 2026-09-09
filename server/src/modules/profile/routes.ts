/**
 * Somebody else's profile card.
 *
 * One route, gated on friendship like the key registry. The light fields a
 * list needs (name, colour, avatar) ride along on the friend list and on
 * conversation participants; this is the full card, banner included, fetched
 * when one is opened and cached by the client on `updatedAt`.
 */
import type { FastifyPluginAsync } from 'fastify';
import { parseBody } from '../../lib/validate.js';
import { userIdSchema } from '../friends/schemas.js';
import { getFullProfile } from './service.js';

export const usersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.requireAuth);

  fastify.get('/:userId/profile', async (request) => {
    const { userId } = parseBody(userIdSchema, request.params);
    return getFullProfile(request.currentUser!.id, userId);
  });
};
