import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { prisma } from '../src/db.js';
import { createIceProvider, type IceProvider } from '../src/modules/calls/ice.js';
import {
  befriend,
  createActor,
  createLiveApp,
  resetDatabase,
  type Actor,
  type LiveContext,
} from './helpers.js';

/// Short enough to wait for in a test, long enough that nothing else in a case
/// gets caught by it.
const RING_TIMEOUT_MS = 400;

let ctx: LiveContext;
const sockets: Socket[] = [];

beforeEach(async () => {
  await resetDatabase();
  ctx = await createLiveApp({ realtime: { calls: { ringTimeoutMs: RING_TIMEOUT_MS } } });
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.disconnect();
  await ctx.close();
});

afterAll(async () => {
  await prisma.$disconnect();
});

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

/// Resolves true if the event arrives within the window, false otherwise. For
/// asserting that something did *not* happen.
async function arrives(socket: Socket, event: string, windowMs = 300): Promise<boolean> {
  try {
    await next(socket, event, windowMs);
    return true;
  } catch {
    return false;
  }
}

type Ack = { ok?: true; error?: { code: string; message: string } };

function emit(socket: Socket, event: string, payload: unknown): Promise<Ack> {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

/// What the client sends: a description sealed in the message envelope. The
/// server relays it without looking, so any string will do here, and these
/// are shaped like the real thing only so a test reads like one.
function sealed(description: { type: string; sdp: string }): string {
  return JSON.stringify({
    v: 1,
    alg: 'none',
    nonce: null,
    body: Buffer.from(JSON.stringify(description), 'utf8').toString('base64'),
  });
}

const offerSdp = sealed({ type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n' });
const answerSdp = sealed({ type: 'answer', sdp: 'v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\n' });

async function dmBetween(a: Actor, b: Actor): Promise<string> {
  const opened = await a.request({
    method: 'POST',
    url: '/conversations/dm',
    payload: { userId: b.id },
  });
  return opened.json().id;
}

/// Two friends with a DM open between them, both on a socket.
async function pair(): Promise<{
  alice: Actor;
  bob: Actor;
  conversationId: string;
  hers: Socket;
  his: Socket;
}> {
  const alice = await createActor(ctx);
  const bob = await createActor(ctx);
  await befriend(alice, bob);
  const conversationId = await dmBetween(alice, bob);
  const hers = await open(alice.accessToken);
  const his = await open(bob.accessToken);
  return { alice, bob, conversationId, hers, his };
}

/// Alice rings Bob and Bob's socket has received the offer.
async function ringing() {
  const setup = await pair();
  const callId = randomUUID();
  const incoming = next<{ callId: string }>(setup.his, 'call:offer');
  const ack = await emit(setup.hers, 'call:offer', {
    callId,
    conversationId: setup.conversationId,
    toUserId: setup.bob.id,
    sdp: offerSdp,
  });
  expect(ack).toEqual({ ok: true });
  await incoming;
  return { ...setup, callId };
}

/// Alice rings Bob and Bob has answered.
async function connected() {
  const setup = await ringing();
  const answered = next(setup.hers, 'call:answer');
  const ack = await emit(setup.his, 'call:answer', { callId: setup.callId, sdp: answerSdp });
  expect(ack).toEqual({ ok: true });
  await answered;
  return setup;
}

describe('placing a call', () => {
  it('rings every tab the callee has open, and acks the caller', async () => {
    const { alice, bob, conversationId, hers, his } = await pair();
    const hisOther = await open(bob.accessToken);
    const callId = randomUUID();

    const ringOne = next<Record<string, unknown>>(his, 'call:offer');
    const ringTwo = next<Record<string, unknown>>(hisOther, 'call:offer');

    const ack = await emit(hers, 'call:offer', {
      callId,
      conversationId,
      toUserId: bob.id,
      sdp: offerSdp,
    });

    expect(ack).toEqual({ ok: true });
    const expected = { callId, conversationId, fromUserId: alice.id, sdp: offerSdp };
    expect(await ringOne).toEqual(expected);
    expect(await ringTwo).toEqual(expected);
  });

  it('does not ring the caller own other tabs', async () => {
    const { bob, conversationId, hers, his } = await pair();
    const alice = await open(hersToken(hers));
    void alice;
    const callId = randomUUID();

    const rang = next(his, 'call:offer');
    await emit(hers, 'call:offer', { callId, conversationId, toUserId: bob.id, sdp: offerSdp });
    await rang;
    expect(await arrives(hers, 'call:offer')).toBe(false);
  });

  it('refuses a call to somebody you are no longer friends with', async () => {
    const { alice, bob, conversationId, hers, his } = await pair();
    await alice.request({ method: 'DELETE', url: `/friends/${bob.id}` });

    const ack = await emit(hers, 'call:offer', {
      callId: randomUUID(),
      conversationId,
      toUserId: bob.id,
      sdp: offerSdp,
    });

    expect(ack.error).toMatchObject({ code: 'not_friends' });
    expect(await arrives(his, 'call:offer')).toBe(false);
  });

  it('refuses a call into a conversation the caller is not in', async () => {
    const { bob, conversationId, his } = await pair();
    const outsider = await createActor(ctx);
    await befriend(outsider, bob);
    const theirs = await open(outsider.accessToken);

    const ack = await emit(theirs, 'call:offer', {
      callId: randomUUID(),
      conversationId,
      toUserId: bob.id,
      sdp: offerSdp,
    });

    expect(ack.error).toMatchObject({ code: 'conversation_not_found' });
    expect(await arrives(his, 'call:offer')).toBe(false);
  });

  it('refuses a callee who is not in the conversation, with the same answer', async () => {
    const { alice, conversationId, hers } = await pair();
    const carol = await createActor(ctx);
    await befriend(alice, carol);

    const ack = await emit(hers, 'call:offer', {
      callId: randomUUID(),
      conversationId,
      toUserId: carol.id,
      sdp: offerSdp,
    });

    expect(ack.error).toMatchObject({ code: 'conversation_not_found' });
  });

  it('refuses calling yourself', async () => {
    const { alice, conversationId, hers } = await pair();

    const ack = await emit(hers, 'call:offer', {
      callId: randomUUID(),
      conversationId,
      toUserId: alice.id,
      sdp: offerSdp,
    });

    expect(ack.error).toMatchObject({ code: 'cannot_call_self' });
  });

  it('rejects a malformed frame without taking the connection down', async () => {
    const { hers } = await pair();

    const ack = await emit(hers, 'call:offer', { callId: 'not-a-uuid', sdp: { type: 'answer' } });
    expect(ack.error).toMatchObject({ code: 'validation_failed' });

    // A description that is not a string is refused too: the server relays
    // a sealed envelope and nothing else.
    const unsealed = await emit(hers, 'call:offer', {
      callId: randomUUID(),
      conversationId: randomUUID(),
      toUserId: randomUUID(),
      sdp: { type: 'offer', sdp: 'v=0' },
    });
    expect(unsealed.error).toMatchObject({ code: 'validation_failed' });

    expect(ack.error).toMatchObject({ code: 'validation_failed' });
    expect(hers.connected).toBe(true);
  });

  it('stops a revoked session from ringing anyone', async () => {
    const { alice, bob, conversationId, hers, his } = await pair();
    await alice.request({ method: 'POST', url: '/auth/logout-all' });

    const ack = await emit(hers, 'call:offer', {
      callId: randomUUID(),
      conversationId,
      toUserId: bob.id,
      sdp: offerSdp,
    });

    expect(ack.error).toMatchObject({ code: 'session_revoked' });
    expect(await arrives(his, 'call:offer')).toBe(false);
  });
});

describe('one call per person', () => {
  it('answers busy to a second caller while the first is still ringing', async () => {
    const { bob, his } = await ringing();
    const carol = await createActor(ctx);
    await befriend(carol, bob);
    const carolBob = await dmBetween(carol, bob);
    const carols = await open(carol.accessToken);

    const ack = await emit(carols, 'call:offer', {
      callId: randomUUID(),
      conversationId: carolBob,
      toUserId: bob.id,
      sdp: offerSdp,
    });

    expect(ack.error).toMatchObject({ code: 'busy' });
    expect(await arrives(his, 'call:offer')).toBe(false);
  });

  it('answers busy while the first call is connected', async () => {
    const { bob } = await connected();
    const carol = await createActor(ctx);
    await befriend(carol, bob);
    const carolBob = await dmBetween(carol, bob);
    const carols = await open(carol.accessToken);

    const ack = await emit(carols, 'call:offer', {
      callId: randomUUID(),
      conversationId: carolBob,
      toUserId: bob.id,
      sdp: offerSdp,
    });

    expect(ack.error).toMatchObject({ code: 'busy' });
  });

  it('tells a caller who is already in a call so, from any of their tabs', async () => {
    const { alice, hers } = await ringing();
    const carol = await createActor(ctx);
    await befriend(alice, carol);
    const aliceCarol = await dmBetween(alice, carol);
    const hersOther = await open(alice.accessToken);
    void hers;

    const ack = await emit(hersOther, 'call:offer', {
      callId: randomUUID(),
      conversationId: aliceCarol,
      toUserId: carol.id,
      sdp: offerSdp,
    });

    expect(ack.error).toMatchObject({ code: 'in_call' });
  });

  it('resolves glare by letting exactly one ring survive', async () => {
    // Both press call. Whichever offer the server sees first is the call;
    // the other is refused, because its sender is by then already being rung.
    const { alice, bob, conversationId, hers, his } = await pair();

    const first = await emit(hers, 'call:offer', {
      callId: randomUUID(),
      conversationId,
      toUserId: bob.id,
      sdp: offerSdp,
    });
    const second = await emit(his, 'call:offer', {
      callId: randomUUID(),
      conversationId,
      toUserId: alice.id,
      sdp: offerSdp,
    });

    expect(first).toEqual({ ok: true });
    expect(second.error).toMatchObject({ code: 'in_call' });
  });

  it('refuses a call id that is already in use', async () => {
    const { bob, conversationId, hers, callId } = await ringing();

    const ack = await emit(hers, 'call:offer', {
      callId,
      conversationId,
      toUserId: bob.id,
      sdp: offerSdp,
    });

    // Checked before busy: an id clash is the more specific complaint, and a
    // client that reuses ids has a bug worth hearing about by name.
    expect(ack.error).toMatchObject({ code: 'call_exists' });
  });

  it('frees both sides once the call has ended', async () => {
    const { bob, conversationId, hers, his, callId } = await connected();

    const ended = next(his, 'call:ended');
    await emit(hers, 'call:hangup', { callId });
    await ended;

    const again = next(his, 'call:offer');
    const ack = await emit(hers, 'call:offer', {
      callId: randomUUID(),
      conversationId,
      toUserId: bob.id,
      sdp: offerSdp,
    });
    expect(ack).toEqual({ ok: true });
    await again;
  });
});

describe('answering', () => {
  it('hands the answer to the caller and tells the callee other tabs to stop ringing', async () => {
    const { bob, hers, his, callId } = await ringing();
    const hisOther = await open(bob.accessToken);

    const answered = next(hers, 'call:answer');
    const claimedHere = next(his, 'call:claimed');
    const claimedThere = next(hisOther, 'call:claimed');

    const ack = await emit(his, 'call:answer', { callId, sdp: answerSdp });

    expect(ack).toEqual({ ok: true });
    expect(await answered).toEqual({ callId, sdp: answerSdp });
    expect(await claimedHere).toEqual({ callId });
    expect(await claimedThere).toEqual({ callId });
  });

  it('refuses an answer from the caller', async () => {
    const { hers, callId } = await ringing();

    const ack = await emit(hers, 'call:answer', { callId, sdp: answerSdp });

    expect(ack.error).toMatchObject({ code: 'call_not_found' });
  });

  it('refuses an answer from a stranger, with the same answer', async () => {
    const { callId } = await ringing();
    const stranger = await createActor(ctx);
    const theirs = await open(stranger.accessToken);

    const ack = await emit(theirs, 'call:answer', { callId, sdp: answerSdp });

    expect(ack.error).toMatchObject({ code: 'call_not_found' });
  });

  it('refuses a second answer', async () => {
    const { bob, callId } = await connected();
    const hisOther = await open(bob.accessToken);

    const ack = await emit(hisOther, 'call:answer', { callId, sdp: answerSdp });

    expect(ack.error).toMatchObject({ code: 'call_not_ringing' });
  });

  it('refuses an answer for a call that has already ended', async () => {
    const { hers, his, callId } = await ringing();

    const ended = next(his, 'call:ended');
    await emit(hers, 'call:hangup', { callId });
    await ended;

    const ack = await emit(his, 'call:answer', { callId, sdp: answerSdp });
    expect(ack.error).toMatchObject({ code: 'call_not_found' });
  });
});

describe('relaying', () => {
  it('carries candidates to the other side, in both directions, while ringing and after', async () => {
    const { hers, his, callId } = await ringing();
    const candidate = { candidate: 'candidate:1 1 udp 1 127.0.0.1 1 typ host', sdpMid: '0', sdpMLineIndex: 0 };

    // The caller's candidates trickle out before anyone has picked up.
    const toBob = next(his, 'call:candidate');
    expect(await emit(hers, 'call:candidate', { callId, candidate })).toEqual({ ok: true });
    expect(await toBob).toEqual({ callId, candidate });

    const answered = next(hers, 'call:answer');
    await emit(his, 'call:answer', { callId, sdp: answerSdp });
    await answered;

    const toAlice = next(hers, 'call:candidate');
    await emit(his, 'call:candidate', { callId, candidate });
    expect(await toAlice).toEqual({ callId, candidate });
  });

  it('relays the end-of-candidates marker as it is', async () => {
    const { hers, his, callId } = await ringing();

    const toBob = next(his, 'call:candidate');
    await emit(hers, 'call:candidate', { callId, candidate: null });
    expect(await toBob).toEqual({ callId, candidate: null });
  });

  it('never relays a candidate to or from somebody outside the call', async () => {
    const { hers, his, callId } = await ringing();
    const stranger = await createActor(ctx);
    const theirs = await open(stranger.accessToken);

    const ack = await emit(theirs, 'call:candidate', {
      callId,
      candidate: { candidate: 'candidate:evil', sdpMid: '0', sdpMLineIndex: 0 },
    });

    expect(ack.error).toMatchObject({ code: 'call_not_found' });
    expect(await arrives(hers, 'call:candidate')).toBe(false);
    expect(await arrives(his, 'call:candidate')).toBe(false);
  });

  it('relays a renegotiation once connected, and not before', async () => {
    const { hers, his, callId } = await ringing();

    const early = await emit(hers, 'call:description', { callId, sdp: offerSdp });
    expect(early.error).toMatchObject({ code: 'call_not_connected' });

    const answered = next(hers, 'call:answer');
    await emit(his, 'call:answer', { callId, sdp: answerSdp });
    await answered;

    const toBob = next(his, 'call:description');
    expect(await emit(hers, 'call:description', { callId, sdp: offerSdp })).toEqual({ ok: true });
    expect(await toBob).toEqual({ callId, sdp: offerSdp });
  });
});

describe('ending a call', () => {
  it('lets the caller cancel a ring, and tells every tab on both sides', async () => {
    const { bob, hers, his, callId } = await ringing();
    const hisOther = await open(bob.accessToken);

    const herEnd = next(hers, 'call:ended');
    const hisEnd = next(his, 'call:ended');
    const otherEnd = next(hisOther, 'call:ended');

    expect(await emit(hers, 'call:hangup', { callId })).toEqual({ ok: true });

    const expected = { callId, reason: 'hangup' };
    expect(await herEnd).toEqual(expected);
    expect(await hisEnd).toEqual(expected);
    expect(await otherEnd).toEqual(expected);
  });

  it('lets either side hang up a connected call', async () => {
    const { hers, his, callId } = await connected();

    const herEnd = next(hers, 'call:ended');
    const hisEnd = next(his, 'call:ended');

    expect(await emit(his, 'call:hangup', { callId })).toEqual({ ok: true });

    expect(await herEnd).toEqual({ callId, reason: 'hangup' });
    expect(await hisEnd).toEqual({ callId, reason: 'hangup' });
  });

  it('lets the callee decline, and says so to both sides', async () => {
    const { bob, hers, his, callId } = await ringing();
    const hisOther = await open(bob.accessToken);

    const herEnd = next(hers, 'call:ended');
    const otherEnd = next(hisOther, 'call:ended');

    expect(await emit(his, 'call:reject', { callId })).toEqual({ ok: true });

    expect(await herEnd).toEqual({ callId, reason: 'rejected' });
    expect(await otherEnd).toEqual({ callId, reason: 'rejected' });
  });

  it('does not let the caller decline their own call', async () => {
    const { hers, callId } = await ringing();

    const ack = await emit(hers, 'call:reject', { callId });

    expect(ack.error).toMatchObject({ code: 'call_not_ringing' });
  });

  it('does not let a connected call be declined', async () => {
    const { his, callId } = await connected();

    const ack = await emit(his, 'call:reject', { callId });

    expect(ack.error).toMatchObject({ code: 'call_not_ringing' });
  });

  it('refuses a hangup from somebody outside the call', async () => {
    const { hers, callId } = await connected();
    const stranger = await createActor(ctx);
    const theirs = await open(stranger.accessToken);

    const ack = await emit(theirs, 'call:hangup', { callId });

    expect(ack.error).toMatchObject({ code: 'call_not_found' });
    expect(await arrives(hers, 'call:ended')).toBe(false);
  });

  it('gives up on a ring nobody answers', async () => {
    const { hers, his, callId } = await ringing();

    const herEnd = next<{ reason: string }>(hers, 'call:ended');
    const hisEnd = next<{ reason: string }>(his, 'call:ended');

    expect(await herEnd).toEqual({ callId, reason: 'no_answer' });
    expect(await hisEnd).toEqual({ callId, reason: 'no_answer' });
  });

  it('does not expire a call that was answered in time', async () => {
    const { his } = await connected();

    await new Promise((resolve) => setTimeout(resolve, RING_TIMEOUT_MS + 100));

    expect(await arrives(his, 'call:ended', 100)).toBe(false);
  });
});

describe('a socket going away', () => {
  it('ends a ring when the caller disconnects', async () => {
    const { hers, his } = await ringing();

    const hisEnd = next<{ reason: string }>(his, 'call:ended');
    hers.disconnect();

    expect((await hisEnd).reason).toBe('disconnected');
  });

  it('ends a connected call when the caller disconnects', async () => {
    const { hers, his } = await connected();

    const hisEnd = next<{ reason: string }>(his, 'call:ended');
    hers.disconnect();

    expect((await hisEnd).reason).toBe('disconnected');
  });

  it('ends a connected call when the callee disconnects', async () => {
    const { hers, his } = await connected();

    const herEnd = next<{ reason: string }>(hers, 'call:ended');
    his.disconnect();

    expect((await herEnd).reason).toBe('disconnected');
  });

  it('ignores one of the callee other tabs closing', async () => {
    const { bob, hers, his, callId } = await ringing();
    const hisOther = await open(bob.accessToken);

    // The tab that did not answer closes. It was never a party to the call.
    const answered = next(hers, 'call:answer');
    await emit(his, 'call:answer', { callId, sdp: answerSdp });
    await answered;
    hisOther.disconnect();

    expect(await arrives(hers, 'call:ended')).toBe(false);

    // Still there: hanging up works and says hangup, not disconnected.
    const herEnd = next<{ reason: string }>(hers, 'call:ended');
    await emit(his, 'call:hangup', { callId });
    expect((await herEnd).reason).toBe('hangup');
  });

  it('ignores a ringing callee tab closing, since nobody has picked up', async () => {
    const { bob, hers, his } = await ringing();
    const hisOther = await open(bob.accessToken);

    hisOther.disconnect();

    expect(await arrives(hers, 'call:ended', 200)).toBe(false);
    void his;
    void bob;
  });
});

describe('GET /calls/ice', () => {
  it('needs a session', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/calls/ice' });
    expect(response.statusCode).toBe(401);
  });

  it('hands back whatever the provider minted', async () => {
    await ctx.close();
    const minted = {
      iceServers: [
        { urls: ['stun:stun.cloudflare.com:3478'] },
        { urls: ['turns:turn.cloudflare.com:443?transport=tcp'], username: 'u', credential: 'c' },
      ],
      ttlSeconds: 3600,
      relay: true,
    };
    const ice: IceProvider = { iceServers: async () => minted };
    ctx = await createLiveApp({ ice });

    const alice = await createActor(ctx);
    const response = await alice.request({ method: 'GET', url: '/calls/ice' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(minted);
  });

  it('is STUN only when no TURN key is configured', async () => {
    const provider = createIceProvider({});
    const result = await provider.iceServers();

    expect(result.relay).toBe(false);
    expect(result.iceServers).toEqual([{ urls: ['stun:stun.cloudflare.com:3478'] }]);
  });
});

describe('the Cloudflare credential call', () => {
  it('posts the key to the right place and passes the answer through', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          iceServers: {
            urls: ['stun:stun.cloudflare.com:3478', 'turns:turn.cloudflare.com:443?transport=tcp'],
            username: 'user',
            credential: 'secret',
          },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    };

    const provider = createIceProvider({ keyId: 'key-1', apiToken: 'token-1', fetchImpl });
    const result = await provider.iceServers();

    expect(calls).toHaveLength(1);
    const request = calls[0]!;
    expect(request.url).toBe(
      'https://rtc.live.cloudflare.com/v1/turn/keys/key-1/credentials/generate-ice-servers',
    );
    expect(request.init.method).toBe('POST');
    expect((request.init.headers as Record<string, string>).authorization).toBe('Bearer token-1');
    expect(JSON.parse(String(request.init.body))).toEqual({ ttl: 3600 });

    // One object from Cloudflare becomes the one-element array the browser wants.
    expect(result.relay).toBe(true);
    expect(result.iceServers).toEqual([
      {
        urls: ['stun:stun.cloudflare.com:3478', 'turns:turn.cloudflare.com:443?transport=tcp'],
        username: 'user',
        credential: 'secret',
      },
    ]);
  });

  it('falls back to STUN when Cloudflare cannot be reached', async () => {
    const warnings: unknown[] = [];
    const fetchImpl: typeof fetch = async () => {
      throw new Error('ECONNREFUSED');
    };

    const provider = createIceProvider({
      keyId: 'key-1',
      apiToken: 'token-1',
      fetchImpl,
      log: { warn: (...args: unknown[]) => void warnings.push(args) } as never,
    });
    const result = await provider.iceServers();

    expect(result.relay).toBe(false);
    expect(result.iceServers).toEqual([{ urls: ['stun:stun.cloudflare.com:3478'] }]);
    expect(warnings).toHaveLength(1);
  });

  it('falls back to STUN on a non-2xx answer', async () => {
    const fetchImpl: typeof fetch = async () => new Response('nope', { status: 403 });

    const provider = createIceProvider({ keyId: 'key-1', apiToken: 'token-1', fetchImpl });
    const result = await provider.iceServers();

    expect(result.relay).toBe(false);
  });
});

/// The socket helper hands back only the socket; the token that opened it is
/// what a second tab of the same account needs. Read it back off the handshake.
function hersToken(socket: Socket): string {
  return (socket.auth as { token: string }).token;
}
