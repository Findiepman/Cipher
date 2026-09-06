import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import {
  createTestApp,
  login,
  newUser,
  registerAndVerify,
  resetDatabase,
  tokenFromEmail,
  validPassword,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
let app: FastifyInstance;

beforeAll(async () => {
  ctx = await createTestApp();
  app = ctx.app;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  ctx.mailer.clear();
});

describe('registration', () => {
  it('creates an unverified account and emails a verification link', async () => {
    const user = newUser('alice');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: user,
    });

    expect(response.statusCode).toBe(202);

    const created = await prisma.user.findUnique({
      where: { email: user.email },
    });
    expect(created).not.toBeNull();
    expect(created?.emailVerifiedAt).toBeNull();

    expect(ctx.mailer.lastTo(user.email)?.subject).toBe(
      'Verify your email address',
    );
    expect(tokenFromEmail(ctx.mailer, user.email)).toBeTruthy();
  });

  it('normalizes the email address to lowercase', async () => {
    const user = newUser('mixedcase');

    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { ...user, email: user.email.toUpperCase() },
    });

    const created = await prisma.user.findUnique({
      where: { email: user.email },
    });
    expect(created).not.toBeNull();
  });

  it('rejects a password that is too short', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { ...newUser('shortpw'), password: 'short' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('password_too_short');
  });

  it('rejects a password containing the username', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: 'contains@example.test',
        username: 'bartholomew',
        password: 'bartholomew-99',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('password_contains_identity');
  });

  it('rejects an invalid username', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { ...newUser('badname'), username: '..nope..' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('validation_failed');
  });

  it('does not reveal that an email is already registered', async () => {
    const user = newUser('duplicate');

    const first = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: user,
    });
    ctx.mailer.clear();

    const second = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { ...user, username: 'someoneelse' },
    });

    // Byte-for-byte identical, so the response cannot be used as an oracle.
    expect(second.statusCode).toBe(first.statusCode);
    expect(second.body).toBe(first.body);

    // No second account, and the warning goes to the address owner.
    expect(await prisma.user.count()).toBe(1);
    expect(ctx.mailer.lastTo(user.email)?.subject).toBe(
      'Someone tried to register with your email address',
    );
  });

  it('does not create a second account when the username is taken', async () => {
    const user = newUser('taken');

    await app.inject({ method: 'POST', url: '/auth/register', payload: user });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { ...user, email: 'different@example.test' },
    });

    expect(response.statusCode).toBe(202);
    expect(await prisma.user.count()).toBe(1);
  });
});

describe('email verification', () => {
  it('verifies an account and lets the token be used only once', async () => {
    const user = newUser('verify');

    await app.inject({ method: 'POST', url: '/auth/register', payload: user });
    const token = tokenFromEmail(ctx.mailer, user.email);

    const first = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { token },
    });
    expect(first.statusCode).toBe(200);

    const verified = await prisma.user.findUnique({
      where: { email: user.email },
    });
    expect(verified?.emailVerifiedAt).not.toBeNull();

    const replay = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { token },
    });
    expect(replay.statusCode).toBe(400);
    expect(replay.json().error.code).toBe('invalid_token');
  });

  it('rejects an unknown token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { token: 'not-a-real-token' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects an expired token', async () => {
    const user = newUser('expired');
    await app.inject({ method: 'POST', url: '/auth/register', payload: user });
    const token = tokenFromEmail(ctx.mailer, user.email);

    await prisma.emailToken.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { token },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_token');
  });

  it('invalidates an earlier link when a new one is requested', async () => {
    const user = newUser('resend');
    await app.inject({ method: 'POST', url: '/auth/register', payload: user });
    const firstToken = tokenFromEmail(ctx.mailer, user.email);

    await app.inject({
      method: 'POST',
      url: '/auth/resend-verification',
      payload: { email: user.email },
    });
    const secondToken = tokenFromEmail(ctx.mailer, user.email);

    expect(secondToken).not.toBe(firstToken);

    const stale = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { token: firstToken },
    });
    expect(stale.statusCode).toBe(400);

    const fresh = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { token: secondToken },
    });
    expect(fresh.statusCode).toBe(200);
  });

  it('does not reveal whether an address exists when resending', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/resend-verification',
      payload: { email: 'nobody@example.test' },
    });

    expect(response.statusCode).toBe(202);
    expect(ctx.mailer.sent).toHaveLength(0);
  });
});

describe('login', () => {
  it('signs in with email and sets both auth cookies', async () => {
    const user = newUser('login');
    await registerAndVerify(ctx, user);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { identifier: user.email, password: user.password },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.user.email).toBe(user.email);
    expect(body.user.emailVerified).toBe(true);
    expect(body.accessToken).toBeTruthy();

    // The password hash must never reach the client.
    expect(response.body).not.toContain('passwordHash');
    expect(response.body).not.toContain('$argon2');

    const cookieNames = response.cookies.map((c) => c.name);
    expect(cookieNames).toContain('access_token');
    expect(cookieNames).toContain('refresh_token');

    const refreshCookie = response.cookies.find(
      (c) => c.name === 'refresh_token',
    );
    expect(refreshCookie?.httpOnly).toBe(true);
    // Scoped so it is never sent with ordinary API calls.
    expect(refreshCookie?.path).toBe('/auth');
  });

  it('signs in with the username too', async () => {
    const user = newUser('byname');
    await registerAndVerify(ctx, user);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { identifier: user.username, password: user.password },
    });

    expect(response.statusCode).toBe(200);
  });

  it('rejects a wrong password', async () => {
    const user = newUser('wrongpw');
    await registerAndVerify(ctx, user);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { identifier: user.email, password: 'not-the-password-here' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('invalid_credentials');
  });

  it('gives an identical answer for an unknown account', async () => {
    const user = newUser('known');
    await registerAndVerify(ctx, user);

    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { identifier: user.email, password: 'not-the-password-here' },
    });

    const noSuchUser = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { identifier: 'ghost@example.test', password: 'anything-at-all' },
    });

    expect(noSuchUser.statusCode).toBe(wrongPassword.statusCode);
    expect(noSuchUser.body).toBe(wrongPassword.body);
  });

  it('refuses to sign in an unverified account', async () => {
    const user = newUser('unverified');
    await app.inject({ method: 'POST', url: '/auth/register', payload: user });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { identifier: user.email, password: user.password },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('email_not_verified');
  });

  it('refuses to sign in a disabled account', async () => {
    const user = newUser('disabled');
    await registerAndVerify(ctx, user);
    await prisma.user.update({
      where: { email: user.email },
      data: { status: 'DISABLED' },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { identifier: user.email, password: user.password },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('account_disabled');
  });

  it('locks the account after repeated failures, then still refuses the correct password', async () => {
    const user = newUser('lockout');
    await registerAndVerify(ctx, user);

    // MAX_FAILED_LOGINS is forced to 3 in tests/setup.ts.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { identifier: user.email, password: 'definitely-wrong-pw' },
      });
    }

    const locked = await prisma.user.findUnique({
      where: { email: user.email },
    });
    expect(locked?.lockedUntil).not.toBeNull();

    const withCorrectPassword = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { identifier: user.email, password: user.password },
    });

    expect(withCorrectPassword.statusCode).toBe(401);
    // Reported as ordinary bad credentials - a distinct "locked" code would
    // confirm to an attacker that the account exists.
    expect(withCorrectPassword.json().error.code).toBe('invalid_credentials');
  });

  it('clears the failure counter after a successful sign-in', async () => {
    const user = newUser('counter');
    await registerAndVerify(ctx, user);

    await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { identifier: user.email, password: 'definitely-wrong-pw' },
    });
    await login(ctx, user);

    const after = await prisma.user.findUnique({ where: { email: user.email } });
    expect(after?.failedLoginCount).toBe(0);
    expect(after?.lastLoginAt).not.toBeNull();
  });
});

describe('refresh', () => {
  it('rotates the refresh token and keeps the session usable', async () => {
    const user = newUser('rotate');
    await registerAndVerify(ctx, user);
    const first = await login(ctx, user);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: first.refreshToken },
    });

    expect(response.statusCode).toBe(200);

    const second = response.json();
    expect(second.refreshToken).not.toBe(first.refreshToken);

    const me = await app.inject({
      method: 'GET',
      url: '/account/me',
      headers: { authorization: `Bearer ${second.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe(user.email);
  });

  it('revokes the whole session family when a spent token is replayed', async () => {
    const user = newUser('replay');
    await registerAndVerify(ctx, user);
    const first = await login(ctx, user);

    const rotated = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: first.refreshToken },
    });
    const second = rotated.json();

    // Replaying the spent token is the signal that one of the two copies was
    // stolen. We cannot tell which, so both must die.
    const replay = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: first.refreshToken },
    });

    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe('refresh_token_reused');

    // The token the legitimate client holds is now dead too.
    const afterwards = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: second.refreshToken },
    });
    expect(afterwards.statusCode).toBe(401);

    // And its access token stops working, without waiting for expiry.
    const me = await app.inject({
      method: 'GET',
      url: '/account/me',
      headers: { authorization: `Bearer ${second.accessToken}` },
    });
    expect(me.statusCode).toBe(401);
  });

  it('rejects an unknown refresh token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: 'nonsense' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('invalid_refresh_token');
  });

  it('rejects an expired refresh token', async () => {
    const user = newUser('expiredrefresh');
    await registerAndVerify(ctx, user);
    const session = await login(ctx, user);

    await prisma.session.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: session.refreshToken },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('refresh_token_expired');
  });

  it('rejects a request with no token at all', async () => {
    const response = await app.inject({ method: 'POST', url: '/auth/refresh' });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('missing_refresh_token');
  });
});

describe('logout', () => {
  it('revokes the presented session and clears the cookies', async () => {
    const user = newUser('logout');
    await registerAndVerify(ctx, user);
    const session = await login(ctx, user);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      payload: { refreshToken: session.refreshToken },
    });

    expect(response.statusCode).toBe(200);

    const reuse = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: session.refreshToken },
    });
    expect(reuse.statusCode).toBe(401);

    const cleared = response.cookies.filter((c) => c.value === '');
    expect(cleared.map((c) => c.name).sort()).toEqual([
      'access_token',
      'refresh_token',
    ]);
  });

  it('succeeds even with no session', async () => {
    const response = await app.inject({ method: 'POST', url: '/auth/logout' });
    expect(response.statusCode).toBe(200);
  });

  it('logout-all kills every session for the user', async () => {
    const user = newUser('logoutall');
    await registerAndVerify(ctx, user);

    const deviceOne = await login(ctx, user);
    const deviceTwo = await login(ctx, user);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout-all',
      headers: { authorization: `Bearer ${deviceOne.accessToken}` },
    });

    expect(response.statusCode).toBe(200);

    for (const device of [deviceOne, deviceTwo]) {
      const refresh = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: device.refreshToken },
      });
      expect(refresh.statusCode).toBe(401);
    }
  });
});

describe('authenticated requests', () => {
  it('rejects a request with no credentials', async () => {
    const response = await app.inject({ method: 'GET', url: '/account/me' });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('unauthenticated');
  });

  it('rejects a forged token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/account/me',
      headers: { authorization: 'Bearer not.a.jwt' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('accepts the access token from a cookie as well as a header', async () => {
    const user = newUser('cookieauth');
    await registerAndVerify(ctx, user);
    const session = await login(ctx, user);

    const response = await app.inject({
      method: 'GET',
      url: '/account/me',
      cookies: { access_token: session.accessToken },
    });

    expect(response.statusCode).toBe(200);
  });

  it('stops accepting an access token once its session is revoked', async () => {
    const user = newUser('revoked');
    await registerAndVerify(ctx, user);
    const session = await login(ctx, user);

    await app.inject({
      method: 'POST',
      url: '/auth/logout',
      payload: { refreshToken: session.refreshToken },
    });

    // The JWT is still perfectly valid and unexpired; the session behind it
    // is not. Signature alone must not be enough.
    const response = await app.inject({
      method: 'GET',
      url: '/account/me',
      headers: { authorization: `Bearer ${session.accessToken}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('session_revoked');
  });
});

describe('storage guarantees', () => {
  it('never stores the password or the raw tokens', async () => {
    const user = newUser('storage');
    await registerAndVerify(ctx, user);
    const session = await login(ctx, user);

    const stored = await prisma.user.findUniqueOrThrow({
      where: { email: user.email },
    });
    expect(stored.passwordHash).not.toContain(validPassword);
    expect(stored.passwordHash.startsWith('$argon2id$')).toBe(true);

    // Sessions and email tokens are stored as hashes; the raw value should
    // appear nowhere in the database.
    const sessions = await prisma.session.findMany();
    for (const row of sessions) {
      expect(row.refreshTokenHash).not.toBe(session.refreshToken);
    }

    const byRawToken = await prisma.session.findUnique({
      where: { refreshTokenHash: session.refreshToken },
    });
    expect(byRawToken).toBeNull();
  });
});

describe('rate limiting', () => {
  it('blocks repeated login attempts from the same client', async () => {
    // The rest of the suite runs with the limiter off, so this builds its own
    // app with it on - otherwise the safeguard would go untested.
    const limited = await createTestApp({ rateLimits: true });

    try {
      const statuses: number[] = [];

      for (let attempt = 0; attempt < 12; attempt += 1) {
        const response = await limited.app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { identifier: 'someone@example.test', password: 'guessing-away' },
        });
        statuses.push(response.statusCode);
      }

      expect(statuses).toContain(429);

      const blocked = await limited.app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { identifier: 'someone@example.test', password: 'guessing-away' },
      });
      expect(blocked.json().error.code).toBe('rate_limited');
    } finally {
      await limited.app.close();
    }
  });
});

describe('discoverability', () => {
  it('serves an index at the root', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.json().service).toBe('messenger-api');
  });

  it('answers a wrong method with 405 and the allowed methods', async () => {
    // What a browser does when someone types a POST-only URL into the bar.
    const response = await app.inject({ method: 'GET', url: '/auth/login' });

    expect(response.statusCode).toBe(405);
    expect(response.json().error.code).toBe('method_not_allowed');
    expect(response.headers.allow).toBe('POST');
    expect(response.json().error.message).toContain('Use POST');
  });

  it('still answers a genuinely unknown path with 404', async () => {
    const response = await app.inject({ method: 'GET', url: '/auth/nonsense' });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('not_found');
  });
});
