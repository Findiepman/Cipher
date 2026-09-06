import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { InMemoryMailer } from '../src/lib/mailer.js';

export interface TestContext {
  app: FastifyInstance;
  mailer: InMemoryMailer;
}

export async function createTestApp(
  options: { rateLimits?: boolean } = {},
): Promise<TestContext> {
  const mailer = new InMemoryMailer();
  const app = await buildApp({ mailer, rateLimits: options.rateLimits ?? false });
  await app.ready();
  return { app, mailer };
}

export async function resetDatabase(): Promise<void> {
  // Truncate rather than delete so the tables come back in a known state, and
  // cascade so ordering between them stops mattering.
  //
  // Conversation is listed explicitly: it is the one table with no foreign key
  // to User, so truncating User would not cascade to it and rows would leak
  // between test cases.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AuditLog", "EmailToken", "Session", "Device", ' +
      '"MessageEnvelope", "Message", "ConversationParticipant", "Conversation", ' +
      '"Friendship", "User" RESTART IDENTITY CASCADE',
  );
}

/// Base64 of 32 random bytes - the shape of every digest and key crossing the
/// API boundary.
///
/// Note what these tests deliberately do NOT do: derive an authHash from a
/// password with real Argon2id. The server has no idea how the value was
/// produced and must not care, so treating it as an opaque token here keeps the
/// suite testing the server's actual contract (and keeps it fast). The
/// end-to-end derivation is exercised by scripts/smoke.ts and by the client's
/// own suite.
export function base64Bytes(): string {
  return randomBytes(32).toString('base64');
}

export interface RegisteredUser {
  email: string;
  username: string;
  /// Stands in for the password: the client-derived value login must reproduce.
  authHash: string;
  recoveryCodeHash: string;
  device: {
    label: string;
    publicKey: string;
    wrappedPrivateKey: string;
    wrappedPrivateKeyRecovery: string;
  };
}

export function newUser(suffix = Date.now().toString(36)): RegisteredUser {
  return {
    email: `user-${suffix}@example.test`,
    username: `user-${suffix}`,
    authHash: base64Bytes(),
    recoveryCodeHash: base64Bytes(),
    device: {
      label: 'Test Runner',
      publicKey: base64Bytes(),
      // Opaque to the server. Real ones are JSON from packages/crypto.
      wrappedPrivateKey: `wrapped-a-${suffix}`,
      wrappedPrivateKeyRecovery: `wrapped-b-${suffix}`,
    },
  };
}

/// Pulls the token out of the link in the most recent email to an address.
/// Tests read tokens this way rather than from the database, so they exercise
/// the same path a real user would.
export function tokenFromEmail(
  mailer: InMemoryMailer,
  address: string,
): string {
  const mail = mailer.lastTo(address);
  if (!mail) throw new Error(`No email was sent to ${address}`);

  const match = mail.text.match(/token=([A-Za-z0-9_-]+)/);
  if (!match?.[1]) {
    throw new Error(`No token found in email to ${address}:\n${mail.text}`);
  }

  return match[1];
}

/// Registers a user, verifies their email, and leaves them ready to sign in.
export async function registerAndVerify(
  ctx: TestContext,
  user: RegisteredUser,
): Promise<void> {
  const registered = await ctx.app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: user,
  });

  if (registered.statusCode !== 202) {
    throw new Error(`Registration failed: ${registered.body}`);
  }

  const verified = await ctx.app.inject({
    method: 'POST',
    url: '/auth/verify-email',
    payload: { token: tokenFromEmail(ctx.mailer, user.email) },
  });

  if (verified.statusCode !== 200) {
    throw new Error(`Verification failed: ${verified.body}`);
  }
}

export interface LoggedIn {
  accessToken: string;
  refreshToken: string;
}

export async function login(
  ctx: TestContext,
  user: RegisteredUser,
): Promise<LoggedIn> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: user.email, authHash: user.authHash },
  });

  if (response.statusCode !== 200) {
    throw new Error(`Login failed: ${response.body}`);
  }

  const { tokens } = response.json();
  return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
}

/// A registered, verified, signed-in account, with everything a test needs to
/// act as them. Bearer rather than cookies: it is the mode the desktop shell
/// uses, and it keeps `inject` calls to one header.
export interface Actor extends LoggedIn {
  id: string;
  user: RegisteredUser;
  /// Injects as this account.
  request(
    options: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string; payload?: unknown },
  ): ReturnType<FastifyInstance['inject']>;
}

let actorSequence = 0;

/// Registers, verifies and signs in one account in a single call. Most tests
/// here need two or three of these and care about none of the steps.
export async function createActor(
  ctx: TestContext,
  suffix = `a${(actorSequence += 1)}-${randomBytes(4).toString('hex')}`,
): Promise<Actor> {
  const user = newUser(suffix);
  await registerAndVerify(ctx, user);
  const tokens = await login(ctx, user);

  const record = await prisma.user.findUniqueOrThrow({
    where: { email: user.email },
    select: { id: true },
  });

  return {
    ...tokens,
    id: record.id,
    user,
    request: ({ method, url, payload }) =>
      ctx.app.inject({
        method,
        url,
        payload: payload as never,
        headers: { authorization: `Bearer ${tokens.accessToken}` },
      }),
  };
}

/// Makes `a` and `b` friends the way a user would: request, then accept.
export async function befriend(a: Actor, b: Actor): Promise<void> {
  const sent = await a.request({
    method: 'POST',
    url: '/friends/requests',
    payload: { username: b.user.username },
  });
  if (sent.statusCode !== 200) {
    throw new Error(`Friend request failed: ${sent.body}`);
  }

  const requests = await b.request({ method: 'GET', url: '/friends/requests' });
  const [incoming] = requests.json().incoming;
  if (!incoming) throw new Error('No incoming friend request to accept');

  const accepted = await b.request({
    method: 'POST',
    url: `/friends/requests/${incoming.id}/accept`,
  });
  if (accepted.statusCode !== 200) {
    throw new Error(`Accepting failed: ${accepted.body}`);
  }
}
