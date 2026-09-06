import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import {
  createTestApp,
  login,
  newUser,
  registerAndVerify,
  resetDatabase,
  base64Bytes,
  tokenFromEmail,
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

  it('stores the key material without being able to read it', async () => {
    const user = newUser('keymaterial');

    await app.inject({ method: 'POST', url: '/auth/register', payload: user });

    const device = await prisma.device.findFirstOrThrow({
      where: { user: { email: user.email } },
    });
    expect(device.publicKey).toBe(user.device.publicKey);
    expect(device.wrappedPrivateKey).toBe(user.device.wrappedPrivateKey);
    expect(device.wrappedPrivateKeyRecovery).toBe(
      user.device.wrappedPrivateKeyRecovery,
    );

    const stored = await prisma.user.findUniqueOrThrow({
      where: { email: user.email },
    });
    expect(stored.recoveryCodeHash).toBe(user.recoveryCodeHash);
  });

  it('will not create an account without a device to decrypt with', async () => {
    // An account with no key material could sign in and then read nothing,
    // which is a worse state to be in than not existing. The two are created
    // in one transaction; this is the guard on the way in.
    const { device: _device, ...withoutDevice } = newUser('nodevice');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: withoutDevice,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('validation_failed');
    expect(await prisma.user.count()).toBe(0);
  });

  it('rejects a malformed authHash', async () => {
    // Not a user error - a real client always sends base64 of 32 bytes. This
    // is the only judgement left to make about the value, since password
    // strength is now unknowable here (see lib/password.ts).
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { ...newUser('badhash'), authHash: 'not-base64' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('validation_failed');
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
      payload: { email: user.email, authHash: user.authHash },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.user.email).toBe(user.email);
    expect(body.user.emailVerifiedAt).not.toBeNull();
    expect(body.tokens.accessToken).toBeTruthy();

    // The stored verifier must never reach the client.
    expect(response.body).not.toContain('authVerifier');
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

  it('will not sign in by username', async () => {
    // Not an oversight. The auth salt is derived from the email address, so a
    // client given only a handle cannot compute an authHash at all - and
    // accepting one would mean this endpoint telling an anonymous caller which
    // email sits behind a username.
    const user = newUser('byname');
    await registerAndVerify(ctx, user);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.username, authHash: user.authHash },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('validation_failed');
  });

  it('returns the caller’s own wrapped key so it can be unlocked at once', async () => {
    const user = newUser('withdevice');
    await registerAndVerify(ctx, user);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.email, authHash: user.authHash },
    });

    const { device } = response.json();
    expect(device.publicKey).toBe(user.device.publicKey);
    expect(device.wrappedPrivateKey).toBe(user.device.wrappedPrivateKey);
    expect(device.wrappedPrivateKeyRecovery).toBe(
      user.device.wrappedPrivateKeyRecovery,
    );
  });

  it('rejects a wrong password', async () => {
    const user = newUser('wrongpw');
    await registerAndVerify(ctx, user);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.email, authHash: base64Bytes() },
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
      payload: { email: user.email, authHash: base64Bytes() },
    });

    const noSuchUser = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'ghost@example.test', authHash: base64Bytes() },
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
      payload: { email: user.email, authHash: user.authHash },
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
      payload: { email: user.email, authHash: user.authHash },
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
        payload: { email: user.email, authHash: base64Bytes() },
      });
    }

    const locked = await prisma.user.findUnique({
      where: { email: user.email },
    });
    expect(locked?.lockedUntil).not.toBeNull();

    const withCorrectPassword = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.email, authHash: user.authHash },
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
      payload: { email: user.email, authHash: base64Bytes() },
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

    const second = response.json().tokens;
    expect(second.refreshToken).not.toBe(first.refreshToken);
    // The client refreshes ahead of this, so it has to be the access token's
    // expiry rather than the session's.
    expect(Date.parse(second.accessTokenExpiresAt)).toBeGreaterThan(Date.now());

    const me = await app.inject({
      method: 'GET',
      url: '/account/me',
      headers: { authorization: `Bearer ${second.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe(user.email);
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
    const second = rotated.json().tokens;

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
    // The authHash the client sends is not what is stored: it is hashed again,
    // so a database dump is not a pile of working credentials.
    expect(stored.authVerifier).not.toContain(user.authHash);
    expect(stored.authVerifier.startsWith('$argon2id$')).toBe(true);

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
          payload: { email: 'someone@example.test', authHash: base64Bytes() },
        });
        statuses.push(response.statusCode);
      }

      expect(statuses).toContain(429);

      const blocked = await limited.app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'someone@example.test', authHash: base64Bytes() },
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
