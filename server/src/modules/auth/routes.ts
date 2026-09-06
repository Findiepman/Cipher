import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { prisma } from '../../db.js';
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from '../../lib/cookies.js';
import { recordAudit } from '../../lib/audit.js';
import { unauthorized } from '../../lib/errors.js';
import type { Mailer } from '../../lib/mailer.js';
import { parseBody } from '../../lib/validate.js';
import {
  loginSchema,
  registerSchema,
  resendVerificationSchema,
  verifyEmailSchema,
} from './schemas.js';
import {
  authenticate,
  register,
  resendVerification,
  toPublicUser,
  verifyEmail,
} from './service.js';
import {
  issueSession,
  revokeAllForUser,
  revokeByToken,
  rotateSession,
  type RequestContext,
} from './sessions.js';

function contextOf(request: FastifyRequest): RequestContext {
  return {
    ip: request.ip ?? null,
    userAgent: request.headers['user-agent'] ?? null,
  };
}

/// Endpoints that an attacker can hammer to guess passwords or enumerate
/// accounts get a tighter budget than the global default.
const strictLimit = {
  config: {
    rateLimit: { max: 10, timeWindow: '15 minutes' },
  },
};

export const authRoutes: FastifyPluginAsync<{ mailer: Mailer }> = async (
  fastify,
  opts,
) => {
  const { mailer } = opts;

  fastify.post('/register', strictLimit, async (request, reply) => {
    const input = parseBody(registerSchema, request.body);

    await register(input, contextOf(request), mailer);

    // Identical response whether or not the account was created - see the
    // note on register() in service.ts.
    return reply.status(202).send({
      message:
        'If that email address can be registered, a verification link is on its way.',
    });
  });

  fastify.post('/verify-email', strictLimit, async (request, reply) => {
    const { token } = parseBody(verifyEmailSchema, request.body);

    await verifyEmail(token, contextOf(request));

    return reply.send({ message: 'Email address verified. You can sign in now.' });
  });

  fastify.post('/resend-verification', strictLimit, async (request, reply) => {
    const { email } = parseBody(resendVerificationSchema, request.body);

    await resendVerification(email, contextOf(request), mailer);

    return reply.status(202).send({
      message: 'If that account needs verifying, a new link is on its way.',
    });
  });

  fastify.post('/login', strictLimit, async (request, reply) => {
    const input = parseBody(loginSchema, request.body);
    const ctx = contextOf(request);

    const user = await authenticate(input, ctx);
    const session = await issueSession(user.id, ctx);

    if (input.deviceLabel) {
      await prisma.session.update({
        where: { id: session.sessionId },
        data: { deviceLabel: input.deviceLabel },
      });
    }

    const accessToken = fastify.signAccessToken({
      sub: user.id,
      role: user.role,
      sid: session.sessionId,
    });

    setAuthCookies(reply, {
      accessToken,
      refreshToken: session.refreshToken,
      refreshExpiresAt: session.expiresAt,
    });

    // Tokens are returned in the body as well as set as cookies: the web
    // client can ignore them and rely on the cookies, the desktop shell reads
    // them and sends Bearer headers instead.
    return reply.send({
      user: toPublicUser(user),
      accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt.toISOString(),
    });
  });

  fastify.post('/refresh', async (request, reply) => {
    const presented = readRefreshToken(request);
    const ctx = contextOf(request);

    const { user, session } = await rotateSession(presented, ctx);

    const accessToken = fastify.signAccessToken({
      sub: user.id,
      role: user.role,
      sid: session.sessionId,
    });

    setAuthCookies(reply, {
      accessToken,
      refreshToken: session.refreshToken,
      refreshExpiresAt: session.expiresAt,
    });

    await recordAudit({
      action: 'auth.refreshed',
      actorUserId: user.id,
      targetUserId: user.id,
      ip: ctx.ip,
    });

    return reply.send({
      user: toPublicUser(user),
      accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt.toISOString(),
    });
  });

  fastify.post('/logout', async (request, reply) => {
    const presented = tryReadRefreshToken(request);

    if (presented) {
      await revokeByToken(presented);
    }

    clearAuthCookies(reply);

    // Unconditionally successful: a caller with no session is already in the
    // state they asked for, and reporting otherwise just leaks information.
    return reply.send({ message: 'Signed out.' });
  });

  fastify.post(
    '/logout-all',
    { preHandler: fastify.requireAuth },
    async (request, reply) => {
      const userId = request.currentUser!.id;

      const revoked = await revokeAllForUser(userId);
      clearAuthCookies(reply);

      await recordAudit({
        action: 'auth.logged_out_all',
        actorUserId: userId,
        targetUserId: userId,
        ip: request.ip,
        meta: { revoked },
      });

      return reply.send({ message: 'Signed out on all devices.', revoked });
    },
  );
};

function tryReadRefreshToken(request: FastifyRequest): string | null {
  const fromCookie = request.cookies[REFRESH_COOKIE];
  if (fromCookie) return fromCookie;

  const body = request.body as { refreshToken?: unknown } | undefined;
  if (body && typeof body.refreshToken === 'string' && body.refreshToken) {
    return body.refreshToken;
  }

  return null;
}

function readRefreshToken(request: FastifyRequest): string {
  const token = tryReadRefreshToken(request);

  if (!token) {
    throw unauthorized('missing_refresh_token', 'No session to refresh.');
  }

  return token;
}
