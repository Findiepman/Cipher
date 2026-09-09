/**
 * The synced settings blob.
 *
 * The server's whole job is to hold an opaque string and hand it back, so the
 * tests are about exactly that: it stores what it is given, returns null before
 * anything is stored, refuses a body that is not JSON or is too large, and
 * keeps one person's blob away from another's.
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

function get(actor: Actor) {
  return actor.request({ method: 'GET', url: '/account/settings' });
}
function put(actor: Actor, blob: string) {
  return actor.request({ method: 'PUT', url: '/account/settings', payload: { blob } });
}

describe('the settings blob', () => {
  it('is null until something is stored', async () => {
    const alice = await createActor(ctx);
    const got = await get(alice);
    expect(got.statusCode).toBe(200);
    expect(got.json()).toEqual({ blob: null, updatedAt: null });
  });

  it('stores what it is given and hands it back untouched', async () => {
    const alice = await createActor(ctx);
    const blob = JSON.stringify({ appearance: { theme: 'dark' }, language: { choice: 'nl' } });

    const saved = await put(alice, blob);
    expect(saved.statusCode).toBe(200);
    expect(typeof saved.json().updatedAt).toBe('string');

    const got = await get(alice);
    expect(got.json().blob).toBe(blob);
    expect(got.json().updatedAt).toBe(saved.json().updatedAt);
  });

  it('overwrites on a second put and moves updatedAt forward', async () => {
    const alice = await createActor(ctx);
    const first = await put(alice, JSON.stringify({ n: 1 }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await put(alice, JSON.stringify({ n: 2 }));

    expect((await get(alice)).json().blob).toBe(JSON.stringify({ n: 2 }));
    expect(second.json().updatedAt >= first.json().updatedAt).toBe(true);
  });

  it('refuses a body that is not JSON', async () => {
    const alice = await createActor(ctx);
    const bad = await put(alice, 'not json {');
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('invalid_settings');
  });

  it("keeps one person's settings out of another's", async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    await put(alice, JSON.stringify({ who: 'alice' }));

    expect((await get(bob)).json().blob).toBeNull();
    await put(bob, JSON.stringify({ who: 'bob' }));
    expect((await get(alice)).json().blob).toBe(JSON.stringify({ who: 'alice' }));
  });

  it('needs a session', async () => {
    const unauth = await ctx.app.inject({ method: 'GET', url: '/account/settings' });
    expect(unauth.statusCode).toBe(401);
  });
});
