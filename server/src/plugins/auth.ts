import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { env } from '../env.js';
import { unauthorized } from '../lib/errors.js';
import { ACCESS_COOKIE } from '../lib/cookies.js';
import { loadLiveSession } from '../lib/session-guard.js';

export interface AccessTokenPayload {
  sub: string;
  role: 'USER' | 'ADMIN';
  sid: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessTokenPayload;
    user: AccessTokenPayload;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    /// preHandler that rejects the request unless it carries a valid,
    /// unexpired access token for an active account.
    requireAuth: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
    signAccessToken: (payload: AccessTokenPayload) => string;
  }

  interface FastifyRequest {
    currentUser?: {
      id: string;
      role: 'USER' | 'ADMIN';
      sessionId: string;
    };
  }
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(fastifyCookie);

  await fastify.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    // Accept the token from the cookie (web) or the Authorization header
    // (desktop shell), without the routes needing to care which.
    cookie: { cookieName: ACCESS_COOKIE, signed: false },
    sign: { expiresIn: `${env.ACCESS_TOKEN_TTL_MINUTES}m` },
  });

  fastify.decorate('signAccessToken', function (payload: AccessTokenPayload) {
    return fastify.jwt.sign(payload);
  });

  fastify.decorate(
    'requireAuth',
    async function (request: FastifyRequest, _reply: FastifyReply) {
      try {
        await request.jwtVerify();
      } catch {
        throw unauthorized('unauthenticated', 'Authentication required.');
      }

      const { sub, sid } = request.user;

      // A valid signature isn't enough: the session behind it may have been
      // revoked (logout-all, admin force-logout, reuse detection) since the
      // access token was minted. Shared with the socket handshake so the two
      // cannot drift - see lib/session-guard.ts.
      const session = await loadLiveSession(sub, sid);

      if (!session) {
        throw unauthorized('session_revoked', 'Session is no longer valid.');
      }

      request.currentUser = session;
    },
  );
};

export default fp(authPlugin, { name: 'auth' });
