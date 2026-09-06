import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../db.js';

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  /// A directory of what this service exposes. Exists so that opening the
  /// server in a browser answers "is it up, and what can I call?" instead of
  /// returning a bare 404. Lists methods because most endpoints are POST and
  /// are therefore invisible from an address bar.
  fastify.get('/', { config: { rateLimit: false } }, async () => ({
    service: 'messenger-api',
    status: 'ok',
    endpoints: [
      { method: 'GET', path: '/health' },
      { method: 'GET', path: '/health/ready' },
      { method: 'POST', path: '/auth/register' },
      { method: 'POST', path: '/auth/verify-email' },
      { method: 'POST', path: '/auth/resend-verification' },
      { method: 'POST', path: '/auth/login' },
      { method: 'POST', path: '/auth/refresh' },
      { method: 'POST', path: '/auth/logout' },
      { method: 'POST', path: '/auth/logout-all', auth: 'access token' },
      { method: 'GET', path: '/account/me', auth: 'access token' },
    ],
  }));

  fastify.get('/health', { config: { rateLimit: false } }, async () => ({
    status: 'ok',
  }));

  /// Separate from /health on purpose: this one touches the database, so it
  /// answers "can this process actually serve traffic" rather than "is the
  /// process alive".
  fastify.get('/health/ready', { config: { rateLimit: false } }, async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ready' };
    } catch {
      return reply
        .status(503)
        .send({ error: { code: 'not_ready', message: 'Database unavailable.' } });
    }
  });
};
