import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { env, isProduction } from './env.js';
import { AppError } from './lib/errors.js';
import { createMailer, type Mailer } from './lib/mailer.js';
import authPlugin from './plugins/auth.js';
import csrfPlugin from './plugins/csrf.js';
import { authRoutes } from './modules/auth/routes.js';
import { accountRoutes } from './modules/account/routes.js';
import { conversationRoutes } from './modules/conversations/routes.js';
import { friendRoutes } from './modules/friends/routes.js';
import { healthRoutes } from './modules/health/routes.js';
import { keysRoutes } from './modules/keys/routes.js';
import { callsRoutes } from './modules/calls/routes.js';
import { createIceProvider, type IceProvider } from './modules/calls/ice.js';
import type { PostedMessage } from './modules/conversations/service.js';

export interface BuildOptions {
  /// Swapped for an in-memory implementation in tests.
  mailer?: Mailer;

  /// Rate limiting keys on client IP, so a whole test suite looks like one
  /// very busy attacker. Tests turn it off, apart from the one that exists to
  /// prove the limiter still works.
  rateLimits?: boolean;

  /// Pushes a stored message to whoever is connected. Wired to the socket layer
  /// in index.ts; absent here so the HTTP API can be built and tested with no
  /// socket at all.
  deliver?: (message: PostedMessage) => void;

  /// Mints STUN and TURN credentials for calls. Defaults to Cloudflare, or
  /// STUN only when no TURN key is configured; tests hand in a fake.
  ice?: IceProvider;
}

export async function buildApp(
  options: BuildOptions = {},
): Promise<FastifyInstance> {
  const mailer = options.mailer ?? createMailer();
  const rateLimits = options.rateLimits ?? true;

  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'test' ? 'silent' : 'info',
      // Passwords and tokens must never reach the log, not even at debug
      // level, and not even while chasing a bug.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          'req.body.password',
          'req.body.token',
          'req.body.refreshToken',
        ],
        remove: true,
      },
    },
    trustProxy: isProduction,
    bodyLimit: 64 * 1024,
  });

  await app.register(fastifyHelmet, {
    // This process serves JSON to a separate origin, so the browser-facing
    // CSP belongs to whatever serves the client, not here.
    contentSecurityPolicy: false,
  });

  await app.register(fastifyCors, {
    origin: [env.APP_URL],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  if (rateLimits) {
    await app.register(fastifyRateLimit, {
      global: true,
      max: 300,
      timeWindow: '15 minutes',
    });
  }

  await app.register(authPlugin);
  // After the auth plugin, which is what registers the cookie parser: the
  // CSRF hook reads request.cookies, and hooks run in registration order.
  await app.register(csrfPlugin);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }

    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: { code: 'validation_failed', message: 'Invalid request body.' },
      });
    }

    // Everything below is a Fastify-generated error (rate limit, malformed
    // JSON, payload too large). They carry their own status code.
    const fastifyError = error as FastifyError;

    if (fastifyError.statusCode === 429) {
      return reply.status(429).send({
        error: {
          code: 'rate_limited',
          message: 'Too many requests. Try again shortly.',
        },
      });
    }

    if (fastifyError.statusCode && fastifyError.statusCode < 500) {
      return reply.status(fastifyError.statusCode).send({
        error: {
          code: fastifyError.code ?? 'bad_request',
          message: fastifyError.message,
        },
      });
    }

    // Unexpected: log the detail, tell the caller nothing.
    request.log.error({ err: error }, 'unhandled error');

    return reply.status(500).send({
      error: { code: 'internal_error', message: 'Something went wrong.' },
    });
  });

  const KNOWN_METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const;

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0] ?? request.url;

    const allowed = KNOWN_METHODS.filter(
      (method) =>
        method !== request.method && app.hasRoute({ method, url: path }),
    );

    if (allowed.length > 0) {
      // The path exists, just not for this method - which is what a browser
      // hitting a POST-only endpoint looks like. A bare 404 here sends people
      // hunting for a route that is sitting right in front of them.
      return reply
        .status(405)
        .header('allow', allowed.join(', '))
        .send({
          error: {
            code: 'method_not_allowed',
            message: `${request.method} is not supported on ${path}. Use ${allowed.join(' or ')}.`,
          },
        });
    }

    return reply
      .status(404)
      .send({ error: { code: 'not_found', message: 'Route not found.' } });
  });

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/auth', mailer });
  await app.register(accountRoutes, { prefix: '/account' });
  await app.register(friendRoutes, { prefix: '/friends' });
  await app.register(keysRoutes, { prefix: '/keys' });
  await app.register(conversationRoutes, {
    prefix: '/conversations',
    deliver: options.deliver,
  });
  await app.register(callsRoutes, {
    prefix: '/calls',
    ice:
      options.ice ??
      createIceProvider({
        keyId: env.TURN_KEY_ID,
        apiToken: env.TURN_KEY_API_TOKEN,
        log: app.log,
      }),
  });

  return app;
}
