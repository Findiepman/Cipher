/**
 * The synced settings blob: everything a person has set that is not part of
 * the friend-facing profile, stored so it follows them to every device.
 *
 * The server never looks inside it. It takes a JSON string, checks it is a
 * string of a sane size and parses as JSON so a corrupt body is refused rather
 * than stored, and hands it back untouched. What is in it, and how the client
 * merges it, is entirely the client's business (see the settings store).
 *
 * Two devices editing at once is settled by `updatedAt` and nothing cleverer:
 * a device sends the whole blob, the newest write is the one that survives, and
 * a device applies the server's copy only when it is newer than the last one it
 * pushed. Personal settings are not worth a merge algorithm.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { badRequest } from '../../lib/errors.js';
import { parseBody } from '../../lib/validate.js';

/// Generous, because the blob can carry a wallpaper and up to ten saved
/// profiles, each with its own avatar and banner. All base64, so a maxed-out
/// blob is a few megabytes. Larger than this is a client that is not
/// downscaling, and is refused rather than stored.
const MAX_BLOB_BYTES = 6 * 1024 * 1024;
const BODY_LIMIT = 8 * 1024 * 1024;

const putSchema = z.object({
  blob: z.string().max(MAX_BLOB_BYTES, 'Your settings are too large to sync.'),
});

export interface SettingsDto {
  blob: string | null;
  updatedAt: string | null;
}

export const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/settings', { preHandler: fastify.requireAuth }, async (request): Promise<SettingsDto> => {
    const row = await prisma.accountSettings.findUnique({
      where: { userId: request.currentUser!.id },
    });
    return {
      blob: row?.blob ?? null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  });

  fastify.put(
    '/settings',
    { bodyLimit: BODY_LIMIT, preHandler: fastify.requireAuth },
    async (request): Promise<{ updatedAt: string }> => {
      const { blob } = parseBody(putSchema, request.body);
      const userId = request.currentUser!.id;

      // Parsed and thrown away: the point is only to refuse a body that is not
      // JSON, so a device never syncs down something it cannot read back.
      try {
        JSON.parse(blob);
      } catch {
        throw badRequest('invalid_settings', 'Settings must be valid JSON.');
      }

      const row = await prisma.accountSettings.upsert({
        where: { userId },
        create: { userId, blob },
        update: { blob },
      });

      return { updatedAt: row.updatedAt.toISOString() };
    },
  );
};
