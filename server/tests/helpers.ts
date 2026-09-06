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
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AuditLog", "EmailToken", "Session", "User" RESTART IDENTITY CASCADE',
  );
}

export const validPassword = 'correct-horse-battery-staple';

export interface RegisteredUser {
  email: string;
  username: string;
  password: string;
}

export function newUser(suffix = Date.now().toString(36)): RegisteredUser {
  return {
    email: `user-${suffix}@example.test`,
    username: `user-${suffix}`,
    password: validPassword,
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
    payload: { identifier: user.email, password: user.password },
  });

  if (response.statusCode !== 200) {
    throw new Error(`Login failed: ${response.body}`);
  }

  const body = response.json();
  return { accessToken: body.accessToken, refreshToken: body.refreshToken };
}
