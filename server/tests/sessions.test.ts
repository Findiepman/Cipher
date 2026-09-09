/**
 * The sessions signed in to an account, and signing one of them out.
 *
 * The property that matters: revoking is by family. A refresh rotates the
 * row, so revoking the one row the list showed would leave its replacement
 * alive, and the "device I do not recognise" walks straight back in.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import {
  createActor,
  createTestApp,
  type Actor,
  type TestContext,
  resetDatabase,
} from './helpers.js';

let ctx: TestContext;

beforeEach(async () => {
  await resetDatabase();
  ctx = await createTestApp();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/// A second sign-in to the same account, as another device would.
async function anotherDevice(actor: Actor, label = 'Other laptop') {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: actor.user.email, authHash: actor.user.authHash, deviceLabel: label },
  });
  const { tokens } = response.json();
  return {
    accessToken: tokens.accessToken as string,
    refreshToken: tokens.refreshToken as string,
    request: (options: { method: 'GET' | 'POST' | 'DELETE'; url: string; payload?: unknown }) =>
      ctx.app.inject({
        ...options,
        payload: options.payload as never,
        headers: { authorization: `Bearer ${tokens.accessToken}` },
      }),
  };
}

describe('listing sessions', () => {
  it('shows every live session and marks the one asking', async () => {
    const alice = await createActor(ctx);
    await anotherDevice(alice);

    const listed = await alice.request({ method: 'GET', url: '/account/sessions' });
    expect(listed.statusCode).toBe(200);

    const sessions = listed.json();
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    expect(sessions.find((s: { current: boolean }) => !s.current).deviceLabel).toBe(
      'Other laptop',
    );

    // Never the credential's fingerprint.
    for (const session of sessions) {
      expect(session).not.toHaveProperty('refreshTokenHash');
    }
  });

  it('still calls a session current after its token has rotated', async () => {
    const alice = await createActor(ctx);

    const refreshed = await ctx.app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: alice.refreshToken },
    });
    const fresh = refreshed.json().tokens.accessToken as string;

    const listed = await ctx.app.inject({
      method: 'GET',
      url: '/account/sessions',
      headers: { authorization: `Bearer ${fresh}` },
    });
    expect(listed.json()).toHaveLength(1);
    expect(listed.json()[0].current).toBe(true);
  });
});

describe('revoking a session', () => {
  it('signs the other device out for good, refresh included', async () => {
    const alice = await createActor(ctx);
    const other = await anotherDevice(alice);

    const listed = await alice.request({ method: 'GET', url: '/account/sessions' });
    const stranger = listed.json().find((s: { current: boolean }) => !s.current);

    const revoked = await alice.request({
      method: 'DELETE',
      url: `/account/sessions/${stranger.id}`,
    });
    expect(revoked.statusCode).toBe(200);

    expect((await other.request({ method: 'GET', url: '/account/me' })).statusCode).toBe(401);

    const refresh = await ctx.app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: other.refreshToken },
    });
    expect(refresh.statusCode).toBe(401);

    // The one doing the revoking is untouched.
    expect((await alice.request({ method: 'GET', url: '/account/me' })).statusCode).toBe(200);
  });

  it('refuses to revoke the session making the request', async () => {
    const alice = await createActor(ctx);
    const listed = await alice.request({ method: 'GET', url: '/account/sessions' });
    const [mine] = listed.json();

    const refused = await alice.request({
      method: 'DELETE',
      url: `/account/sessions/${mine.id}`,
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.code).toBe('cannot_revoke_current');
  });

  it("reports somebody else's session as absent", async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    const his = (await bob.request({ method: 'GET', url: '/account/sessions' })).json()[0];

    const refused = await alice.request({ method: 'DELETE', url: `/account/sessions/${his.id}` });
    expect(refused.statusCode).toBe(404);
    expect((await bob.request({ method: 'GET', url: '/account/me' })).statusCode).toBe(200);
  });

  it('signs out everywhere else in one call', async () => {
    const alice = await createActor(ctx);
    const one = await anotherDevice(alice, 'One');
    const two = await anotherDevice(alice, 'Two');

    const revoked = await alice.request({ method: 'DELETE', url: '/account/sessions' });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json().revoked).toBe(2);

    expect((await one.request({ method: 'GET', url: '/account/me' })).statusCode).toBe(401);
    expect((await two.request({ method: 'GET', url: '/account/me' })).statusCode).toBe(401);
    expect((await alice.request({ method: 'GET', url: '/account/me' })).statusCode).toBe(200);

    const listed = await alice.request({ method: 'GET', url: '/account/sessions' });
    expect(listed.json()).toHaveLength(1);
  });
});
