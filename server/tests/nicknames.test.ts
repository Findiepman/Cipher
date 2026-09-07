/**
 * Nicknames: one person's private label for another.
 *
 * The property worth testing is the direction. A nickname is not a rename, so
 * it must be visible to exactly one account and invisible to the person it is
 * about, including when they ask for their own friend list.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import {
  befriend,
  createActor,
  createTestApp,
  resetDatabase,
  type Actor,
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

async function friendsOf(actor: Actor) {
  return (await actor.request({ method: 'GET', url: '/friends' })).json().friends;
}

describe('setting a nickname', () => {
  it('shows it to the person who set it and to nobody else', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    await befriend(alice, bob);

    const saved = await alice.request({
      method: 'PATCH',
      url: `/friends/${bob.id}/nickname`,
      payload: { nickname: 'Teto' },
    });

    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ nickname: 'Teto' });

    expect((await friendsOf(alice))[0]).toMatchObject({
      id: bob.id,
      username: bob.user.username,
      nickname: 'Teto',
    });

    // Bob is never told what Alice calls him.
    expect((await friendsOf(bob))[0]).toMatchObject({ id: alice.id, nickname: null });
  });

  it('replaces an existing nickname rather than stacking a second one', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    await befriend(alice, bob);

    for (const nickname of ['First', 'Second']) {
      await alice.request({
        method: 'PATCH',
        url: `/friends/${bob.id}/nickname`,
        payload: { nickname },
      });
    }

    expect(await friendsOf(alice)).toHaveLength(1);
    expect((await friendsOf(alice))[0].nickname).toBe('Second');
  });

  it('trims the value and refuses one that is only whitespace', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    await befriend(alice, bob);

    const padded = await alice.request({
      method: 'PATCH',
      url: `/friends/${bob.id}/nickname`,
      payload: { nickname: '  Teto  ' },
    });
    expect(padded.json().nickname).toBe('Teto');

    const blank = await alice.request({
      method: 'PATCH',
      url: `/friends/${bob.id}/nickname`,
      payload: { nickname: '   ' },
    });
    expect(blank.statusCode).toBe(400);
  });

  it('refuses a nickname for someone who is not a friend', async () => {
    const alice = await createActor(ctx);
    const stranger = await createActor(ctx);

    const response = await alice.request({
      method: 'PATCH',
      url: `/friends/${stranger.id}/nickname`,
      payload: { nickname: 'Nope' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('not_friends');
  });

  it('refuses one for yourself', async () => {
    const alice = await createActor(ctx);

    const response = await alice.request({
      method: 'PATCH',
      url: `/friends/${alice.id}/nickname`,
      payload: { nickname: 'Me' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('cannot_nickname_self');
  });

  it('requires authentication', async () => {
    const alice = await createActor(ctx);

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/friends/${alice.id}/nickname`,
      payload: { nickname: 'Anon' },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('clearing a nickname', () => {
  it('puts the username back', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    await befriend(alice, bob);

    await alice.request({
      method: 'PATCH',
      url: `/friends/${bob.id}/nickname`,
      payload: { nickname: 'Teto' },
    });

    const cleared = await alice.request({
      method: 'DELETE',
      url: `/friends/${bob.id}/nickname`,
    });

    expect(cleared.statusCode).toBe(200);
    expect((await friendsOf(alice))[0].nickname).toBeNull();
  });

  /// Clearing what was never set is the outcome the caller asked for, so it is
  /// not an error.
  it('succeeds when there was no nickname', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    await befriend(alice, bob);

    const response = await alice.request({
      method: 'DELETE',
      url: `/friends/${bob.id}/nickname`,
    });

    expect(response.statusCode).toBe(200);
  });
});

describe('the friend list', () => {
  it('sorts by what the caller reads, not by the underlying username', async () => {
    const alice = await createActor(ctx, 'zzz-owner');
    const early = await createActor(ctx, 'aaa-early');
    const late = await createActor(ctx, 'bbb-late');
    await befriend(alice, early);
    await befriend(alice, late);

    // "aaa-early" sorts first by username. Renaming it to Zoe should move it
    // last, because that is the name on screen.
    await alice.request({
      method: 'PATCH',
      url: `/friends/${early.id}/nickname`,
      payload: { nickname: 'Zoe' },
    });

    expect((await friendsOf(alice)).map((f: { id: string }) => f.id)).toEqual([
      late.id,
      early.id,
    ]);
  });
});
