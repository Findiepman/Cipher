import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { InMemoryMailer } from '../src/lib/mailer.js';
import { attachRealtime, type Realtime, type RealtimeOptions } from '../src/realtime/index.js';
import type { IceProvider } from '../src/modules/calls/ice.js';
import { screenUsername } from '../src/lib/usernameFilter.js';

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

export interface LiveContext extends TestContext {
  /// http://127.0.0.1:<port>. Sockets need a real listener; `inject` cannot
  /// carry a websocket.
  url: string;
  realtime: Realtime;
  close(): Promise<void>;
}

/// Boots the app on an ephemeral port with the socket layer attached, wired the
/// same way src/index.ts wires it - including the late-bound `deliver`, so a
/// message sent over HTTP still arrives in real time here too.
export async function createLiveApp(
  options: { realtime?: RealtimeOptions; ice?: IceProvider } = {},
): Promise<LiveContext> {
  const mailer = new InMemoryMailer();

  let realtime: Realtime | null = null;
  const app = await buildApp({
    mailer,
    rateLimits: false,
    deliver: (message) => realtime?.deliver(message),
    presenceChanged: (userId) => realtime?.presenceChanged(userId),
    disconnectSessions: (sessionIds) => realtime?.disconnectSessions(sessionIds),
    ice: options.ice,
  });

  realtime = attachRealtime(app, options.realtime);

  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;

  return {
    app,
    mailer,
    realtime,
    url: `http://127.0.0.1:${port}`,
    async close() {
      await realtime?.close();
      await app.close();
    },
  };
}

export async function resetDatabase(): Promise<void> {
  // Truncate rather than delete so the tables come back in a known state, and
  // cascade so ordering between them stops mattering.
  //
  // Conversation is listed explicitly: it is the one table with no foreign key
  // to User, so truncating User would not cascade to it and rows would leak
  // between test cases.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AuditLog", "EmailToken", "Session", "Device", "Profile", "AccountSettings", ' +
      '"MessageEnvelope", "Message", "ConversationParticipant", "Conversation", ' +
      '"ContactNickname", "Friendship", "User" RESTART IDENTITY CASCADE',
  );
}

/// Registration screens usernames for slurs, and these are generated from
/// random hex. The filter normalizes digits to letters (4 to a, 6 and 9 to g,
/// 0 to o), so a random suffix can land on a real blocked term perfectly by
/// accident. Rare enough to never show up in review and common enough to fail a
/// CI run, so it is designed out here rather than left to chance.
function screenedHandle(candidate: string): string {
  let handle = candidate;
  while (screenUsername(handle) !== null) {
    handle = `user-x${randomBytes(6).toString('hex')}`;
  }
  return handle;
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
    username: screenedHandle(`user-${suffix}`),
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
  request(options: {
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    url: string;
    payload?: unknown;
  }): Promise<LightMyRequestResponse>;
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
