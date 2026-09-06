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

describe('sending a request', () => {
  it('creates a pending request the other side can see', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);

    const sent = await alice.request({
      method: 'POST',
      url: '/friends/requests',
      payload: { username: bob.user.username },
    });

    expect(sent.statusCode).toBe(200);
    expect(sent.json()).toMatchObject({ status: 'pending', user: { id: bob.id } });

    const theirs = await bob.request({ method: 'GET', url: '/friends/requests' });
    expect(theirs.json().incoming).toHaveLength(1);
    expect(theirs.json().incoming[0]).toMatchObject({
      direction: 'incoming',
      user: { username: alice.user.username },
    });

    const mine = await alice.request({ method: 'GET', url: '/friends/requests' });
    expect(mine.json().outgoing).toHaveLength(1);
    expect(mine.json().incoming).toHaveLength(0);
  });

  it('matches a username regardless of case', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);

    const sent = await alice.request({
      method: 'POST',
      url: '/friends/requests',
      payload: { username: bob.user.username.toUpperCase() },
    });

    expect(sent.statusCode).toBe(200);
  });

  it('is idempotent, so asking twice is one request', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);

    for (let i = 0; i < 3; i += 1) {
      const sent = await alice.request({
        method: 'POST',
        url: '/friends/requests',
        payload: { username: bob.user.username },
      });
      expect(sent.json().status).toBe('pending');
    }

    const theirs = await bob.request({ method: 'GET', url: '/friends/requests' });
    expect(theirs.json().incoming).toHaveLength(1);
  });

  it('auto-accepts when both sides asked, because that is consent', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);

    await alice.request({
      method: 'POST',
      url: '/friends/requests',
      payload: { username: bob.user.username },
    });

    const crossed = await bob.request({
      method: 'POST',
      url: '/friends/requests',
      payload: { username: alice.user.username },
    });

    expect(crossed.json().status).toBe('accepted');
    await expectFriends(alice, bob);
  });

  it('refuses a request to yourself', async () => {
    const alice = await createActor(ctx);

    const sent = await alice.request({
      method: 'POST',
      url: '/friends/requests',
      payload: { username: alice.user.username },
    });

    expect(sent.statusCode).toBe(400);
    expect(sent.json().error.code).toBe('cannot_friend_self');
  });

  it('reports an unknown username honestly', async () => {
    const alice = await createActor(ctx);

    const sent = await alice.request({
      method: 'POST',
      url: '/friends/requests',
      payload: { username: 'nobody-at-all' },
    });

    expect(sent.statusCode).toBe(404);
    expect(sent.json().error.code).toBe('user_not_found');
  });

  it('hides an account that has not verified its email', async () => {
    const alice = await createActor(ctx);
    const unverified = await createActor(ctx);
    await prisma.user.update({
      where: { id: unverified.id },
      data: { emailVerifiedAt: null },
    });

    const sent = await alice.request({
      method: 'POST',
      url: '/friends/requests',
      payload: { username: unverified.user.username },
    });

    expect(sent.statusCode).toBe(404);
  });

  it('says already_friends rather than opening a second request', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    await befriend(alice, bob);

    const sent = await alice.request({
      method: 'POST',
      url: '/friends/requests',
      payload: { username: bob.user.username },
    });

    expect(sent.json().status).toBe('already_friends');
  });

  it('caps requests per account, counting the failures', async () => {
    const alice = await createActor(ctx);

    // Every one of these misses, which is exactly what scraping looks like.
    for (let i = 0; i < 20; i += 1) {
      await alice.request({
        method: 'POST',
        url: '/friends/requests',
        payload: { username: `ghost-${i}` },
      });
    }

    const blocked = await alice.request({
      method: 'POST',
      url: '/friends/requests',
      payload: { username: 'ghost-21' },
    });

    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('rate_limited');
  });
});

describe('answering a request', () => {
  it('accepting makes both sides friends', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    await befriend(alice, bob);

    await expectFriends(alice, bob);
  });

  it('declining removes it and lets them ask again', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);

    await alice.request({
      method: 'POST',
      url: '/friends/requests',
      payload: { username: bob.user.username },
    });
    const [incoming] = (await bob.request({ method: 'GET', url: '/friends/requests' })).json()
      .incoming;

    const declined = await bob.request({
      method: 'POST',
      url: `/friends/requests/${incoming.id}/decline`,
    });
    expect(declined.statusCode).toBe(200);

    expect(
      (await bob.request({ method: 'GET', url: '/friends/requests' })).json().incoming,
    ).toHaveLength(0);

    const again = await alice.request({
      method: 'POST',
      url: '/friends/requests',
      payload: { username: bob.user.username },
    });
    expect(again.json().status).toBe('pending');
  });

  it('refuses to let the sender accept their own request', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);

    await alice.request({
      method: 'POST',
      url: '/friends/requests',
      payload: { username: bob.user.username },
    });
    const [outgoing] = (await alice.request({ method: 'GET', url: '/friends/requests' })).json()
      .outgoing;

    const sneaky = await alice.request({
      method: 'POST',
      url: `/friends/requests/${outgoing.id}/accept`,
    });

    expect(sneaky.statusCode).toBe(400);
    expect(sneaky.json().error.code).toBe('not_your_request');
  });

  it('will not let an unrelated account answer someone else request', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    const mallory = await createActor(ctx);

    await alice.request({
      method: 'POST',
      url: '/friends/requests',
      payload: { username: bob.user.username },
    });
    const [incoming] = (await bob.request({ method: 'GET', url: '/friends/requests' })).json()
      .incoming;

    const intercepted = await mallory.request({
      method: 'POST',
      url: `/friends/requests/${incoming.id}/accept`,
    });

    expect(intercepted.statusCode).toBe(404);
  });
});

describe('removing and blocking', () => {
  it('unfriending leaves neither side on the other list', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    await befriend(alice, bob);

    const removed = await alice.request({ method: 'DELETE', url: `/friends/${bob.id}` });
    expect(removed.statusCode).toBe(200);

    expect((await alice.request({ method: 'GET', url: '/friends' })).json().friends).toHaveLength(0);
    expect((await bob.request({ method: 'GET', url: '/friends' })).json().friends).toHaveLength(0);
  });

  it('a blocked user is told the blocker does not exist', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);

    await alice.request({ method: 'POST', url: `/friends/${bob.id}/block` });

    const sent = await bob.request({
      method: 'POST',
      url: '/friends/requests',
      payload: { username: alice.user.username },
    });

    // Not "you are blocked": confirming a block is itself information.
    expect(sent.statusCode).toBe(404);
    expect(sent.json().error.code).toBe('user_not_found');
  });

  it('tells the blocker to unblock first, and lets only them do it', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);

    await alice.request({ method: 'POST', url: `/friends/${bob.id}/block` });

    const retried = await alice.request({
      method: 'POST',
      url: '/friends/requests',
      payload: { username: bob.user.username },
    });
    expect(retried.statusCode).toBe(409);
    expect(retried.json().error.code).toBe('blocked');

    // The blocked party cannot lift it themselves.
    const selfServe = await bob.request({ method: 'DELETE', url: `/friends/${alice.id}/block` });
    expect(selfServe.statusCode).toBe(404);

    const lifted = await alice.request({ method: 'DELETE', url: `/friends/${bob.id}/block` });
    expect(lifted.statusCode).toBe(200);

    const afterUnblock = await bob.request({
      method: 'POST',
      url: '/friends/requests',
      payload: { username: alice.user.username },
    });
    expect(afterUnblock.json().status).toBe('pending');
  });
});

describe('the key registry', () => {
  it('gives a friend the public key and nothing else', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    await befriend(alice, bob);

    const response = await alice.request({ method: 'GET', url: `/keys/user/${bob.id}` });

    expect(response.statusCode).toBe(200);
    const [device] = response.json();
    expect(device.publicKey).toBe(bob.user.device.publicKey);

    // The assertion that matters: no wrapped blob, under any key name.
    expect(response.body).not.toContain(bob.user.device.wrappedPrivateKey);
    expect(response.body).not.toContain(bob.user.device.wrappedPrivateKeyRecovery);
    expect(Object.keys(device)).toEqual([
      'id',
      'userId',
      'label',
      'publicKey',
      'createdAt',
      'revokedAt',
    ]);
  });

  it('refuses a stranger, so the registry is not a user directory', async () => {
    const alice = await createActor(ctx);
    const stranger = await createActor(ctx);

    const response = await alice.request({ method: 'GET', url: `/keys/user/${stranger.id}` });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('not_friends');
  });

  it('always lets you read your own', async () => {
    const alice = await createActor(ctx);

    const response = await alice.request({ method: 'GET', url: `/keys/user/${alice.id}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()[0].publicKey).toBe(alice.user.device.publicKey);
  });

  it('requires authentication', async () => {
    const alice = await createActor(ctx);

    const response = await ctx.app.inject({ method: 'GET', url: `/keys/user/${alice.id}` });

    expect(response.statusCode).toBe(401);
  });
});

async function expectFriends(a: Actor, b: Actor): Promise<void> {
  const aList = (await a.request({ method: 'GET', url: '/friends' })).json().friends;
  const bList = (await b.request({ method: 'GET', url: '/friends' })).json().friends;

  expect(aList.map((f: { id: string }) => f.id)).toEqual([b.id]);
  expect(bList.map((f: { id: string }) => f.id)).toEqual([a.id]);
  // The friend list carries the key, so opening a conversation is one request.
  expect(aList[0].publicKey).toBe(b.user.device.publicKey);
}
