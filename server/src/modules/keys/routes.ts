/**
 * The public-key registry - `backend-plan.md` step 5, scoped to what DMs need.
 *
 * The one rule: this hands out public keys and nothing else. A response here
 * containing `wrappedPrivateKey` would be a password-cracking target served to
 * any authenticated caller, which is why `PublicDeviceDto` in the client's
 * types.ts deliberately cannot express one and why the select below is
 * explicit rather than a bare `include`.
 */
import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../db.js';
import { parseBody } from '../../lib/validate.js';
import { userIdSchema } from '../friends/schemas.js';
import { requireFriendship } from '../friends/service.js';

export const keysRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.requireAuth);

  fastify.get('/user/:userId', async (request) => {
    const { userId } = parseBody(userIdSchema, request.params);
    const callerId = request.currentUser!.id;

    // Your own keys are always readable; anyone else's needs their agreement.
    // Without this the registry is a directory of every account on the server.
    if (userId !== callerId) {
      await requireFriendship(callerId, userId);
    }

    const devices = await prisma.device.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        userId: true,
        label: true,
        publicKey: true,
        createdAt: true,
        revokedAt: true,
      },
    });

    return devices.map((device) => ({
      ...device,
      createdAt: device.createdAt.toISOString(),
      revokedAt: device.revokedAt?.toISOString() ?? null,
    }));
  });
};
