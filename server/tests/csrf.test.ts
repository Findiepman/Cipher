import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { LightMyRequestResponse } from 'fastify';
import { prisma } from '../src/db.js';
import {
  createActor,
  createTestApp,
  newUser,
  resetDatabase,
  tokenFromEmail,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;

beforeEach(async () => {
  await resetDatabase();
  ctx = await createTestApp();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/// Reads a cookie off a response the way a browser would, so these tests never
/// assert against a Set-Cookie string they parsed by hand.
function cookieOn(response: LightMyRequestResponse, name: string) {
  return response.cookies.find((cookie) => cookie.name === name);
}

async function csrfTokenFor(): Promise<string> {
  const response = await ctx.app.inject({ method: 'GET', url: '/health' });
  const cookie = cookieOn(response, 'csrf_token');
  if (!cookie) throw new Error('No csrf_token cookie was issued');
  return cookie.value;
}

/// Injects the way a browser does: credentials ride along in the cookie header
/// on their own, which is the whole reason the token has to be echoed back.
/// The helpers' `Actor.request` uses bearer instead, so it deliberately cannot
/// exercise any of this.
function asBrowser(options: {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  payload?: unknown;
  accessToken?: string;
  csrfCookie?: string;
  csrfHeader?: string;
}) {
  const jar = [
    options.accessToken ? `access_token=${options.accessToken}` : null,
    options.csrfCookie ? `csrf_token=${options.csrfCookie}` : null,
  ].filter((entry): entry is string => entry !== null);

  return ctx.app.inject({
    method: options.method,
    url: options.url,
    payload: options.payload as never,
    headers: {
      cookie: jar.join('; '),
      ...(options.csrfHeader ? { 'x-csrf-token': options.csrfHeader } : {}),
    },
  });
}

describe('issuing the token', () => {
  it('sets a csrf cookie on any response, before anyone has signed in', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/health' });

    const cookie = cookieOn(response, 'csrf_token');
    expect(cookie?.value).toBeTruthy();
    expect(cookie?.path).toBe('/');
  });

  it('leaves the cookie readable by script, unlike the auth cookies', async () => {
    // The double submit check is only possible if the page can read this one.
    // If this ever flips to httpOnly, every write in the app starts failing.
    const response = await ctx.app.inject({ method: 'GET', url: '/health' });

    expect(cookieOn(response, 'csrf_token')?.httpOnly).toBeFalsy();
  });

  it('keeps the token the caller already has rather than rotating it', async () => {
    const token = await csrfTokenFor();

    const second = await asBrowser({ method: 'GET', url: '/health', csrfCookie: token });

    expect(cookieOn(second, 'csrf_token')?.value).toBe(token);
  });
});

describe('state-changing requests carrying cookies', () => {
  it('rejects a POST with no header at all', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    const token = await csrfTokenFor();

    const response = await asBrowser({
      method: 'POST',
      url: '/friends/requests',
      payload: { username: bob.user.username },
      accessToken: alice.accessToken,
      csrfCookie: token,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('csrf_failed');
  });

  it('rejects a POST whose header does not match the cookie', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    const token = await csrfTokenFor();

    const response = await asBrowser({
      method: 'POST',
      url: '/friends/requests',
      payload: { username: bob.user.username },
      accessToken: alice.accessToken,
      csrfCookie: token,
      csrfHeader: `${token}x`,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('csrf_failed');
  });

  it('rejects a POST that sends a header with no cookie behind it', async () => {
    // Otherwise a forged request could simply invent both halves.
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);

    const response = await asBrowser({
      method: 'POST',
      url: '/friends/requests',
      payload: { username: bob.user.username },
      accessToken: alice.accessToken,
      csrfHeader: await csrfTokenFor(),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('csrf_failed');
  });

  it('accepts a POST whose header matches the cookie', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    const token = await csrfTokenFor();

    const response = await asBrowser({
      method: 'POST',
      url: '/friends/requests',
      payload: { username: bob.user.username },
      accessToken: alice.accessToken,
      csrfCookie: token,
      csrfHeader: token,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'pending', user: { id: bob.id } });
  });

  it('accepts a DELETE the same way, so the rule is about the method not the verb used to test it', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    const token = await csrfTokenFor();

    const blocked = await asBrowser({
      method: 'DELETE',
      url: `/friends/${bob.id}`,
      accessToken: alice.accessToken,
      csrfCookie: token,
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('csrf_failed');

    const allowed = await asBrowser({
      method: 'DELETE',
      url: `/friends/${bob.id}`,
      accessToken: alice.accessToken,
      csrfCookie: token,
      csrfHeader: token,
    });
    expect(allowed.statusCode).not.toBe(403);
  });
});

describe('what the check leaves alone', () => {
  it('lets safe methods through with no header', async () => {
    const alice = await createActor(ctx);
    const token = await csrfTokenFor();

    const response = await asBrowser({
      method: 'GET',
      url: '/friends/requests',
      accessToken: alice.accessToken,
      csrfCookie: token,
    });

    expect(response.statusCode).toBe(200);
  });

  it('lets the health checks through', async () => {
    const health = await ctx.app.inject({ method: 'GET', url: '/health' });
    const ready = await asBrowser({
      method: 'GET',
      url: '/health/ready',
      csrfCookie: await csrfTokenFor(),
    });

    expect(health.statusCode).toBe(200);
    expect(ready.statusCode).toBe(200);
  });

  it('lets a browser register and sign in before it could hold a token', async () => {
    const user = newUser(`csrf-${Date.now().toString(36)}`);
    const token = await csrfTokenFor();

    const registered = await asBrowser({
      method: 'POST',
      url: '/auth/register',
      payload: user,
      csrfCookie: token,
    });
    expect(registered.statusCode).toBe(202);

    const verified = await asBrowser({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { token: tokenFromEmail(ctx.mailer, user.email) },
      csrfCookie: token,
    });
    expect(verified.statusCode).toBe(200);

    const loggedIn = await asBrowser({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.email, authHash: user.authHash },
      csrfCookie: token,
    });
    expect(loggedIn.statusCode).toBe(200);
  });

  it('leaves bearer callers with no cookies untouched', async () => {
    // This is what keeps the desktop shell, the smoke scripts and every other
    // server suite working: no cookies means no ambient authority to forge.
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);

    const response = await alice.request({
      method: 'POST',
      url: '/friends/requests',
      payload: { username: bob.user.username },
    });

    expect(response.statusCode).toBe(200);
  });
});
