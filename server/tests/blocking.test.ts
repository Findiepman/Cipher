/**
 * Blocking, unblocking and taking a request back.
 *
 * Three properties are worth pinning down here, because each of them is easy to
 * get subtly wrong and none of them shows up as a crash:
 *
 *   1. A blocked list is one-directional. It answers "who have I blocked" and
 *      must never answer "who has blocked me", which is only useful to the
 *      person working around it.
 *   2. Unblocking returns the pair to strangers, so a request can be sent
 *      again. That is the whole "unblock and then re-add" path.
 *   3. Cancelling is the requester's move and answering is the other party's,
 *      and neither may take the other's. Letting the requester through the
 *      answer path would let someone accept a friendship one-sidedly.
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

async function blockedList(actor: Actor) {
  const response = await actor.request({ method: 'GET', url: '/friends/blocked' });
  expect(response.statusCode).toBe(200);
  return response.json().blocked;
}

async function sendRequest(from: Actor, to: Actor) {
  return from.request({
    method: 'POST',
    url: '/friends/requests',
    payload: { username: to.user.username },
  });
}

async function pendingIdFor(actor: Actor, direction: 'incoming' | 'outgoing') {
  const response = await actor.request({ method: 'GET', url: '/friends/requests' });
  return response.json()[direction][0]?.id as string | undefined;
}

describe('the blocked list', () => {
  it('shows who you blocked, and when', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    await befriend(alice, bob);

    await alice.request({ method: 'POST', url: `/friends/${bob.id}/block` });

    const list = await blockedList(alice);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: bob.id, username: bob.user.username });
    expect(Date.parse(list[0].blockedAt)).not.toBeNaN();
  });

  /// The important half. Bob must not be able to discover that Alice blocked
  /// him by reading his own list.
  it('never shows who blocked you', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    await befriend(alice, bob);

    await alice.request({ method: 'POST', url: `/friends/${bob.id}/block` });

    expect(await blockedList(bob)).toEqual([]);
  });

  it('takes a blocked person out of both friend lists', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    await befriend(alice, bob);

    await alice.request({ method: 'POST', url: `/friends/${bob.id}/block` });

    const aliceFriends = (await alice.request({ method: 'GET', url: '/friends' })).json().friends;
    const bobFriends = (await bob.request({ method: 'GET', url: '/friends' })).json().friends;
    expect(aliceFriends).toEqual([]);
    expect(bobFriends).toEqual([]);
  });

  it('requires authentication', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/friends/blocked' });
    expect(response.statusCode).toBe(401);
  });
});

describe('unblocking', () => {
  it('empties the list and lets the friendship be rebuilt', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    await befriend(alice, bob);

    await alice.request({ method: 'POST', url: `/friends/${bob.id}/block` });
    const unblocked = await alice.request({ method: 'DELETE', url: `/friends/${bob.id}/block` });

    expect(unblocked.statusCode).toBe(200);
    expect(await blockedList(alice)).toEqual([]);

    // The point of the whole flow: they are strangers again, so asking works.
    await befriend(alice, bob);
    const friends = (await alice.request({ method: 'GET', url: '/friends' })).json().friends;
    expect(friends.map((f: { id: string }) => f.id)).toEqual([bob.id]);
  });

  it('lets the person who was blocked ask first once it is lifted', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);

    await alice.request({ method: 'POST', url: `/friends/${bob.id}/block` });
    // While blocked, Bob is told what he would be told about a stranger.
    expect((await sendRequest(bob, alice)).statusCode).toBe(404);

    await alice.request({ method: 'DELETE', url: `/friends/${bob.id}/block` });

    expect((await sendRequest(bob, alice)).statusCode).toBe(200);
  });

  it('refuses to let the blocked party lift it themselves', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);

    await alice.request({ method: 'POST', url: `/friends/${bob.id}/block` });
    const response = await bob.request({ method: 'DELETE', url: `/friends/${alice.id}/block` });

    expect(response.statusCode).toBe(404);
    expect(await blockedList(alice)).toHaveLength(1);
  });
});

describe('cancelling a request you sent', () => {
  it('removes it from both sides', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    await sendRequest(alice, bob);

    const id = await pendingIdFor(alice, 'outgoing');
    const cancelled = await alice.request({
      method: 'POST',
      url: `/friends/requests/${id}/cancel`,
    });

    expect(cancelled.statusCode).toBe(200);
    expect(await pendingIdFor(alice, 'outgoing')).toBeUndefined();
    expect(await pendingIdFor(bob, 'incoming')).toBeUndefined();
  });

  it('leaves both free to ask again', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    await sendRequest(alice, bob);

    const id = await pendingIdFor(alice, 'outgoing');
    await alice.request({ method: 'POST', url: `/friends/requests/${id}/cancel` });

    expect((await sendRequest(alice, bob)).statusCode).toBe(200);
  });

  /// The mirror of the rule in respondToRequest. Neither party may take the
  /// other's move: cancelling is the asker's, answering is the asked's.
  it('refuses to let the recipient cancel instead of declining', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    await sendRequest(alice, bob);

    const id = await pendingIdFor(bob, 'incoming');
    const response = await bob.request({ method: 'POST', url: `/friends/requests/${id}/cancel` });

    expect(response.statusCode).toBe(404);
    expect(await pendingIdFor(bob, 'incoming')).toBe(id);
  });

  it('still refuses to let the sender accept their own request', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    await sendRequest(alice, bob);

    const id = await pendingIdFor(alice, 'outgoing');
    const response = await alice.request({
      method: 'POST',
      url: `/friends/requests/${id}/accept`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('not_your_request');
  });

  it('reports an unknown request as gone', async () => {
    const alice = await createActor(ctx);

    const response = await alice.request({
      method: 'POST',
      url: '/friends/requests/00000000-0000-0000-0000-000000000000/cancel',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('request_not_found');
  });
});
