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

/// Connects as an actor and resolves once the handshake succeeds - or rejects
/// with the server's reason, which is what the auth cases assert on.
function open(token: string | null): Promise<Socket> {
  const socket = connect(ctx.url, {
    auth: token ? { token } : {},
    transports: ['websocket'],
    reconnection: false,
  });
  sockets.push(socket);

  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (error) => reject(error));
  });
}

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

function send(socket: Socket, payload: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve) => socket.emit('message:send', payload, resolve));
}

async function friends(): Promise<{ alice: Actor; bob: Actor; conversationId: string }> {
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

describe('the handshake', () => {
  it('refuses a connection with no token', async () => {
    await expect(open(null)).rejects.toThrow(/unauthenticated/);
  });

  it('refuses a garbage token', async () => {
    await expect(open('not-a-jwt')).rejects.toThrow(/unauthenticated/);
  });

  it('refuses a token whose session has been revoked', async () => {
    const alice = await createActor(ctx);
    await alice.request({ method: 'POST', url: '/auth/logout-all' });

    // The JWT is still signed and unexpired. The session behind it is not, and
    // that is the thing that has to be checked.
    await expect(open(alice.accessToken)).rejects.toThrow(/session_revoked/);
  });

  it('accepts a live session', async () => {
    const alice = await createActor(ctx);
    const socket = await open(alice.accessToken);
    expect(socket.connected).toBe(true);
  });
});

describe('delivery', () => {
  it('pushes a message to the other participant as it is sent', async () => {
    const { alice, bob, conversationId } = await friends();
    const hers = await open(alice.accessToken);
    const his = await open(bob.accessToken);

    const arriving = next<{ ciphertext: string; authorId: string }>(his, 'message:new');

    const ack = await send(hers, {
      conversationId,
      clientId: 'c-live',
      envelopes: envelopesFor('over the wire', alice, bob),
    });

    expect(ack).toMatchObject({ clientId: 'c-live' });
    expect(ack.id).toEqual(expect.any(String));

    const received = await arriving;
    expect(received.authorId).toBe(alice.id);
    // His copy, not hers.
    expect(received.ciphertext).toContain(
      Buffer.from(`over the wire [for ${bob.user.username}]`, 'utf8').toString('base64'),
    );
  });

  it('echoes to the sender own other tabs', async () => {
    const { alice, bob, conversationId } = await friends();
    const tabOne = await open(alice.accessToken);
    const tabTwo = await open(alice.accessToken);

    const echo = next<{ clientId: string; ciphertext: string }>(tabTwo, 'message:new');

    await send(tabOne, {
      conversationId,
      clientId: 'c-echo',
      envelopes: envelopesFor('typed elsewhere', alice, bob),
    });

    const received = await echo;
    expect(received.clientId).toBe('c-echo');
    expect(received.ciphertext).toContain(
      Buffer.from(`typed elsewhere [for ${alice.user.username}]`, 'utf8').toString('base64'),
    );
  });

  it('delivers a message that was sent over HTTP', async () => {
    // The socket is the normal path; HTTP is the fallback when the websocket is
    // down. A message that took the fallback must still arrive in real time.
    const { alice, bob, conversationId } = await friends();
    const his = await open(bob.accessToken);

    const arriving = next<{ clientId: string }>(his, 'message:new');

    await alice.request({
      method: 'POST',
      url: `/conversations/${conversationId}/messages`,
      payload: { clientId: 'c-http', envelopes: envelopesFor('via http', alice, bob) },
    });

    expect((await arriving).clientId).toBe('c-http');
  });

  it('is idempotent across the socket and HTTP both carrying the same send', async () => {
    const { alice, bob, conversationId } = await friends();
    const hers = await open(alice.accessToken);

    const payload = {
      conversationId,
      clientId: 'c-both',
      envelopes: envelopesFor('once only', alice, bob),
    };

    const viaSocket = await send(hers, payload);
    const viaHttp = await alice.request({
      method: 'POST',
      url: `/conversations/${conversationId}/messages`,
      payload: { clientId: payload.clientId, envelopes: payload.envelopes },
    });

    expect(viaHttp.json().id).toBe(viaSocket.id);
    expect(
      (await bob.request({ method: 'GET', url: `/conversations/${conversationId}/messages` }))
        .json().messages,
    ).toHaveLength(1);
  });

  it('never sends anyone an envelope addressed to someone else', async () => {
    const { alice, bob, conversationId } = await friends();
    const hers = await open(alice.accessToken);
    const his = await open(bob.accessToken);

    const arriving = next<{ ciphertext: string }>(his, 'message:new');

    await send(hers, {
      conversationId,
      clientId: 'c-guard',
      envelopes: envelopesFor('secret', alice, bob),
    });

    const herCopy = Buffer.from(`secret [for ${alice.user.username}]`, 'utf8').toString('base64');
    expect(JSON.stringify(await arriving)).not.toContain(herCopy);
  });
});

describe('refusals', () => {
  it('reports a rejected send through the ack rather than dropping it', async () => {
    const { alice, bob, conversationId } = await friends();
    const hers = await open(alice.accessToken);

    const ack = await send(hers, {
      conversationId,
      clientId: 'c-bad',
      envelopes: envelopesFor('missing a recipient', alice),
    });

    expect(ack.error).toMatchObject({ code: 'envelope_mismatch' });
  });

  it('refuses a send into a conversation the caller is not in', async () => {
    const { conversationId } = await friends();
    const outsider = await createActor(ctx);
    const theirs = await open(outsider.accessToken);

    const ack = await send(theirs, {
      conversationId,
      clientId: 'c-outsider',
      envelopes: [{ recipientUserId: outsider.id, ciphertext: sealed('let me in') }],
    });

    expect(ack.error).toMatchObject({ code: 'conversation_not_found' });
  });

  it('rejects a malformed frame without taking the connection down', async () => {
    const alice = await createActor(ctx);
    const socket = await open(alice.accessToken);

    const ack = await send(socket, { conversationId: 42 });

    expect(ack.error).toMatchObject({ code: 'validation_failed' });
    expect(socket.connected).toBe(true);
  });

  it('stops a revoked session from sending, even though its socket is open', async () => {
    const { alice, bob, conversationId } = await friends();
    const hers = await open(alice.accessToken);

    // The socket outlives the access token, so revocation has to be caught on
    // the send rather than only at handshake.
    await alice.request({ method: 'POST', url: '/auth/logout-all' });

    const ack = await send(hers, {
      conversationId,
      clientId: 'c-revoked',
      envelopes: envelopesFor('after logout', alice, bob),
    });

    expect(ack.error).toMatchObject({ code: 'session_revoked' });
    expect(
      (await bob.request({ method: 'GET', url: `/conversations/${conversationId}/messages` }))
        .json().messages,
    ).toHaveLength(0);
  });
});

describe('presence and typing', () => {
  it('tells friends when someone comes online and goes offline', async () => {
    const { alice, bob } = await friends();
    const his = await open(bob.accessToken);

    const cameOnline = next<Presence>(his, 'presence');
    const hers = await open(alice.accessToken);
    expect(await cameOnline).toEqual({ userId: alice.id, presence: 'online' });

    const wentOffline = next<Presence>(his, 'presence');
    hers.disconnect();
    expect(await wentOffline).toEqual({ userId: alice.id, presence: 'offline' });
  });

  it('does not announce a second tab as a presence change', async () => {
    const { alice, bob } = await friends();
    const his = await open(bob.accessToken);

    const first = next<Presence>(his, 'presence');
    const tabOne = await open(alice.accessToken);
    expect((await first).presence).toBe('online');

    // Opening a second tab is not going online again, and closing it is not
    // going offline.
    const spurious: unknown[] = [];
    his.on('presence', (payload) => spurious.push(payload));

    const tabTwo = await open(alice.accessToken);
    tabTwo.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(spurious).toEqual([]);
    expect(tabOne.connected).toBe(true);
  });

  it('relays typing to the other participant only', async () => {
    const { alice, bob, conversationId } = await friends();
    const hers = await open(alice.accessToken);
    const his = await open(bob.accessToken);

    const typing = next<{ conversationId: string; userId: string }>(his, 'typing');
    hers.emit('typing', { conversationId });

    expect(await typing).toEqual({ conversationId, userId: alice.id });
  });

  it('tells a fresh socket which friends are already around', async () => {
    const { alice, bob } = await friends();
    await open(alice.accessToken);
    await alice.request({ method: 'PATCH', url: '/account/me', payload: { presence: 'dnd' } });

    // Bob arrives after Alice: no transition of hers is going to happen, so
    // the only way he learns she is there is the snapshot on connect.
    const his = connect(ctx.url, {
      auth: { token: bob.accessToken },
      transports: ['websocket'],
      reconnection: false,
    });
    sockets.push(his);
    const told = next<Presence>(his, 'presence');

    expect(await told).toEqual({ userId: alice.id, presence: 'dnd' });
  });

  it('broadcasts the presence someone chose, and hides invisible as offline', async () => {
    const { alice, bob } = await friends();
    const his = await open(bob.accessToken);

    const arrived = next<Presence>(his, 'presence');
    await open(alice.accessToken);
    expect((await arrived).presence).toBe('online');

    const idle = next<Presence>(his, 'presence');
    await alice.request({ method: 'PATCH', url: '/account/me', payload: { presence: 'idle' } });
    expect(await idle).toEqual({ userId: alice.id, presence: 'idle' });

    // She is still connected. Bob is told she left; what she chose stays hers.
    const hidden = next<Presence>(his, 'presence');
    await alice.request({
      method: 'PATCH',
      url: '/account/me',
      payload: { presence: 'invisible' },
    });
    expect(await hidden).toEqual({ userId: alice.id, presence: 'offline' });

    const me = await alice.request({ method: 'GET', url: '/account/me' });
    expect(me.json().profile.presence).toBe('invisible');
  });

  it('says nothing when somebody who is not connected changes their presence', async () => {
    const { alice, bob } = await friends();
    const his = await open(bob.accessToken);

    const spurious: unknown[] = [];
    his.on('presence', (payload) => spurious.push(payload));

    await alice.request({ method: 'PATCH', url: '/account/me', payload: { presence: 'dnd' } });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(spurious).toEqual([]);
  });
});

describe('read receipts', () => {
  async function readBy(reader: Actor, other: Actor, conversationId: string) {
    const hers = await open(reader.accessToken);
    const his = await open(other.accessToken);

    const sent = await send(hers, {
      conversationId,
      clientId: 'm1',
      envelopes: envelopesFor('hello', reader, other),
    });

    const ownEcho = next<{ userId: string }>(hers, 'read');
    const theirs: unknown[] = [];
    his.on('read', (payload) => theirs.push(payload));

    hers.emit('read', { conversationId, messageId: sent.id });
    expect((await ownEcho).userId).toBe(reader.id);
    await new Promise((resolve) => setTimeout(resolve, 300));

    return theirs;
  }

  it('tells the other participant where you read up to, by default', async () => {
    const { alice, bob, conversationId } = await friends();
    const theirs = await readBy(alice, bob, conversationId);
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toMatchObject({ conversationId, userId: alice.id });
  });

  it('keeps it to your own tabs once read receipts are off', async () => {
    const { alice, bob, conversationId } = await friends();
    await alice.request({
      method: 'PATCH',
      url: '/account/me',
      payload: { readReceipts: false },
    });

    const theirs = await readBy(alice, bob, conversationId);
    expect(theirs).toEqual([]);
  });
});

describe('revoking a session', () => {
  it('drops the socket of a session signed out from the account screen', async () => {
    const alice = await createActor(ctx);
    // A second sign-in, the "device I do not recognise".
    const other = await alice.request({
      method: 'POST',
      url: '/auth/login',
      payload: { email: alice.user.email, authHash: alice.user.authHash },
    });
    const otherToken = other.json().tokens.accessToken as string;
    const theirs = await open(otherToken);

    const sessions = await alice.request({ method: 'GET', url: '/account/sessions' });
    const stranger = sessions.json().find((s: { current: boolean }) => !s.current);

    const dropped = next<string>(theirs, 'disconnect');
    const revoked = await alice.request({
      method: 'DELETE',
      url: `/account/sessions/${stranger.id}`,
    });
    expect(revoked.statusCode).toBe(200);

    await dropped;
    expect(theirs.connected).toBe(false);
  });
});

interface Presence {
  userId: string;
  presence: 'online' | 'idle' | 'dnd' | 'offline';
}
