/**
 * Unread state and marking a conversation read.
 *
 * The thing worth guarding here is that unread is counted from `seq` and not
 * from `sentAt`. Several sends land in the same millisecond, so a timestamp
 * cannot break the tie, and a count built on one would be quietly wrong exactly
 * when a conversation is busiest. One case below flattens every sentAt to the
 * same instant and still expects the right answer.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { prisma } from '../src/db.js';
import {
  befriend,
  createActor,
  createLiveApp,
  resetDatabase,
  type Actor,
  type LiveContext,
} from './helpers.js';

let ctx: LiveContext;
const sockets: Socket[] = [];

beforeEach(async () => {
  await resetDatabase();
  ctx = await createLiveApp();
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.disconnect();
  await ctx.close();
});

// Once, at the end. Disconnecting per test kills the pool the next one needs.
afterAll(async () => {
  await prisma.$disconnect();
});

/// Phase 1 seals to base64 and says so. Built by hand because it is the wire
/// format both sides agree on, so a change to it should break this file too.
function sealed(body: string): string {
  return JSON.stringify({
    v: 1,
    alg: 'none',
    nonce: null,
    body: Buffer.from(body, 'utf8').toString('base64'),
  });
}

function envelopesFor(body: string, ...recipients: Actor[]) {
  return recipients.map((actor) => ({
    recipientUserId: actor.id,
    ciphertext: sealed(`${body} [for ${actor.user.username}]`),
  }));
}

interface Pair {
  alice: Actor;
  bob: Actor;
  conversationId: string;
}

async function pair(): Promise<Pair> {
  const alice = await createActor(ctx);
  const bob = await createActor(ctx);
  await befriend(alice, bob);

  const opened = await alice.request({
    method: 'POST',
    url: '/conversations/dm',
    payload: { userId: bob.id },
  });

  return { alice, bob, conversationId: opened.json().id };
}

/// Sends as `from` and returns the stored message id.
async function say(
  { alice, bob, conversationId }: Pair,
  from: Actor,
  body: string,
): Promise<string> {
  const response = await from.request({
    method: 'POST',
    url: `/conversations/${conversationId}/messages`,
    payload: {
      clientId: `c-${body.replace(/\W+/g, '-')}-${from.id.slice(0, 8)}`,
      envelopes: envelopesFor(body, alice, bob),
    },
  });

  if (response.statusCode !== 200) {
    throw new Error(`Send failed: ${response.body}`);
  }
  return response.json().id;
}

/// The caller's own view of one conversation, off the list endpoint.
async function listed(actor: Actor, conversationId: string) {
  const response = await actor.request({ method: 'GET', url: '/conversations' });
  expect(response.statusCode).toBe(200);

  const found = response
    .json()
    .conversations.find((conversation: { id: string }) => conversation.id === conversationId);
  if (!found) throw new Error('Conversation missing from the list');
  return found as { unread: number; lastReadMessageId: string | null };
}

function markRead(actor: Actor, conversationId: string, messageId: string) {
  return actor.request({
    method: 'POST',
    url: `/conversations/${conversationId}/read`,
    payload: { messageId },
  });
}

describe('unread on the conversation list', () => {
  it('starts at nothing read and nothing unread', async () => {
    const context = await pair();

    expect(await listed(context.alice, context.conversationId)).toMatchObject({
      unread: 0,
      lastReadMessageId: null,
    });
  });

  it('counts what the other person said and never what you said', async () => {
    const context = await pair();
    await say(context, context.bob, 'one');
    await say(context, context.bob, 'two');
    await say(context, context.alice, 'mine');

    // Alice is behind by bob's two. Bob is behind by alice's one.
    expect((await listed(context.alice, context.conversationId)).unread).toBe(2);
    expect((await listed(context.bob, context.conversationId)).unread).toBe(1);
  });

  it('is per viewer, so reading does not move anybody else', async () => {
    const context = await pair();
    const first = await say(context, context.bob, 'one');
    await say(context, context.bob, 'two');

    await markRead(context.alice, context.conversationId, first);

    expect((await listed(context.alice, context.conversationId)).unread).toBe(1);
    // Bob has read nothing and has one of alice's... none, in fact: everything
    // here is his own. What matters is that alice's read did not touch him.
    expect(await listed(context.bob, context.conversationId)).toMatchObject({
      unread: 0,
      lastReadMessageId: null,
    });
  });

  it('counts by seq, not by sentAt', async () => {
    const context = await pair();
    const first = await say(context, context.bob, 'one');
    const second = await say(context, context.bob, 'two');
    await say(context, context.bob, 'three');

    // Flatten every timestamp onto one instant, which is what a burst of sends
    // looks like in practice. A count built on sentAt has nothing left to
    // compare and gets this wrong; one built on seq does not notice.
    await prisma.message.updateMany({
      where: { conversationId: context.conversationId },
      data: { sentAt: new Date('2026-09-07T12:00:00.000Z') },
    });

    await markRead(context.alice, context.conversationId, second);

    expect((await listed(context.alice, context.conversationId)).unread).toBe(1);

    await markRead(context.alice, context.conversationId, first);
    // Still one: the position only ever moves forward.
    expect((await listed(context.alice, context.conversationId)).unread).toBe(1);
  });

  it('holds a separate position per conversation', async () => {
    const context = await pair();
    const carol = await createActor(ctx);
    await befriend(context.alice, carol);

    const opened = await context.alice.request({
      method: 'POST',
      url: '/conversations/dm',
      payload: { userId: carol.id },
    });
    const otherId = opened.json().id;

    await say(context, context.bob, 'from bob');
    await carol.request({
      method: 'POST',
      url: `/conversations/${otherId}/messages`,
      payload: {
        clientId: 'c-carol-1',
        envelopes: envelopesFor('from carol', context.alice, carol),
      },
    });

    expect((await listed(context.alice, context.conversationId)).unread).toBe(1);
    expect((await listed(context.alice, otherId)).unread).toBe(1);
  });
});

describe('POST /conversations/:id/read', () => {
  it('marks everything up to a message read and says what is left', async () => {
    const context = await pair();
    const first = await say(context, context.bob, 'one');
    const last = await say(context, context.bob, 'two');

    const partial = await markRead(context.alice, context.conversationId, first);
    expect(partial.statusCode).toBe(200);
    expect(partial.json()).toMatchObject({
      conversationId: context.conversationId,
      lastReadMessageId: first,
      unread: 1,
    });

    const all = await markRead(context.alice, context.conversationId, last);
    expect(all.json()).toMatchObject({ lastReadMessageId: last, unread: 0 });
  });

  it('refuses to walk the position backwards', async () => {
    const context = await pair();
    const first = await say(context, context.bob, 'one');
    const second = await say(context, context.bob, 'two');

    await markRead(context.alice, context.conversationId, second);
    const backwards = await markRead(context.alice, context.conversationId, first);

    // Two tabs racing, or a retry landing late, must not resurrect a message
    // somebody has already seen.
    expect(backwards.json()).toMatchObject({ lastReadMessageId: second, unread: 0 });
  });

  it('rejects a message id from another conversation', async () => {
    const context = await pair();
    const carol = await createActor(ctx);
    await befriend(context.alice, carol);

    const opened = await context.alice.request({
      method: 'POST',
      url: '/conversations/dm',
      payload: { userId: carol.id },
    });
    const elsewhere = await carol.request({
      method: 'POST',
      url: `/conversations/${opened.json().id}/messages`,
      payload: {
        clientId: 'c-carol-2',
        envelopes: envelopesFor('elsewhere', context.alice, carol),
      },
    });

    // seq is global, so an id borrowed from another conversation would mark an
    // arbitrary slice of this one read.
    const response = await markRead(
      context.alice,
      context.conversationId,
      elsewhere.json().id,
    );
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('message_not_found');
  });

  it('tells a non-participant nothing', async () => {
    const context = await pair();
    const message = await say(context, context.bob, 'private');
    const stranger = await createActor(ctx);

    const response = await markRead(stranger, context.conversationId, message);
    // The same answer as no-such-conversation, so this cannot be used to
    // confirm that a conversation id exists.
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('conversation_not_found');
  });

  it('rejects a body that is not a message id', async () => {
    const context = await pair();

    const response = await markRead(context.alice, context.conversationId, 'not-a-uuid');
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('validation_failed');
  });

  it('needs a session', async () => {
    const context = await pair();
    const message = await say(context, context.bob, 'one');

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/conversations/${context.conversationId}/read`,
      payload: { messageId: message },
    });
    expect(response.statusCode).toBe(401);
  });
});

/// Connects as an actor and resolves once the handshake succeeds.
function open(token: string): Promise<Socket> {
  const socket = connect(ctx.url, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
  });
  sockets.push(socket);

  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (error) => reject(error));
  });
}

/// The next occurrence of an event, with a deadline so a missing emit fails
/// loudly instead of hanging out the suite timeout.
function next<T>(socket: Socket, event: string, timeoutMs = 3_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`No "${event}" within ${timeoutMs}ms`)),
      timeoutMs,
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe('the read event over the socket', () => {
  it('reaches the other participant and the reader\'s own other tabs', async () => {
    const context = await pair();
    const message = await say(context, context.bob, 'one');

    const bobSocket = await open(context.bob.accessToken);
    const aliceOtherTab = await open(context.alice.accessToken);
    const aliceSocket = await open(context.alice.accessToken);

    const atBob = next<Record<string, unknown>>(bobSocket, 'read');
    const atOtherTab = next<Record<string, unknown>>(aliceOtherTab, 'read');

    aliceSocket.emit('read', {
      conversationId: context.conversationId,
      messageId: message,
    });

    const expected = {
      conversationId: context.conversationId,
      userId: context.alice.id,
      lastReadMessageId: message,
    };
    expect(await atBob).toEqual(expected);
    // The reader is included on purpose: reading in one tab is what clears the
    // dot in the other.
    expect(await atOtherTab).toEqual(expected);

    expect((await listed(context.alice, context.conversationId)).unread).toBe(0);
  });

  it('ignores a read for a conversation the caller is not in', async () => {
    const context = await pair();
    const message = await say(context, context.bob, 'one');
    const stranger = await createActor(ctx);

    const socket = await open(stranger.accessToken);
    socket.emit('read', {
      conversationId: context.conversationId,
      messageId: message,
    });

    // Nothing to await, so give the server a beat to have done the wrong thing.
    await next(socket, 'read', 250).catch(() => undefined);
    expect((await listed(context.alice, context.conversationId)).unread).toBe(1);
  });
});
