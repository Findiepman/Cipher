import type { FastifyPluginAsync } from 'fastify';
import { parseBody } from '../../lib/validate.js';
import {
  friendshipIdSchema,
  sendFriendRequestSchema,
  userIdSchema,
} from './schemas.js';
import {
  blockUser,
  listFriends,
  listRequests,
  removeFriend,
  respondToRequest,
  sendRequest,
  unblockUser,
} from './service.js';

/// Every route here is authenticated. The per-account friend-request budget
/// lives in the service rather than in @fastify/rate-limit, because the limiter
/// runs before the auth preHandler and so cannot see who is asking - and a
/// per-IP cap is the wrong unit for this: it caps addresses, which are cheap,
/// instead of accounts, which are not.
export const friendRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.requireAuth);

  fastify.get('/', async (request) => {
    return { friends: await listFriends(request.currentUser!.id) };
  });

  fastify.get('/requests', async (request) => {
    return listRequests(request.currentUser!.id);
  });

  fastify.post('/requests', async (request, reply) => {
    const { username } = parseBody(sendFriendRequestSchema, request.body);

    const result = await sendRequest(request.currentUser!.id, username, request.ip);

    return reply.send(result);
  });

  fastify.post('/requests/:id/accept', async (request, reply) => {
    const { id } = parseBody(friendshipIdSchema, request.params);

    await respondToRequest(request.currentUser!.id, id, true, request.ip);

    return reply.send({ ok: true });
  });

  fastify.post('/requests/:id/decline', async (request, reply) => {
    const { id } = parseBody(friendshipIdSchema, request.params);

    await respondToRequest(request.currentUser!.id, id, false, request.ip);

    return reply.send({ ok: true });
  });

  fastify.delete('/:userId', async (request, reply) => {
    const { userId } = parseBody(userIdSchema, request.params);

    await removeFriend(request.currentUser!.id, userId, request.ip);

    return reply.send({ ok: true });
  });

  fastify.post('/:userId/block', async (request, reply) => {
    const { userId } = parseBody(userIdSchema, request.params);

    await blockUser(request.currentUser!.id, userId, request.ip);

    return reply.send({ ok: true });
  });

  fastify.delete('/:userId/block', async (request, reply) => {
    const { userId } = parseBody(userIdSchema, request.params);

    await unblockUser(request.currentUser!.id, userId, request.ip);

    return reply.send({ ok: true });
  });
};
