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

/// A pair of friends with a DM already open - the starting point for almost
/// every case below.
async function pair(): Promise<{ alice: Actor; bob: Actor; conversationId: string }> {
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

/// Phase 1 seals to base64 and marks itself `alg: 'none'`. Building the
/// envelope by hand here is deliberate: it is the wire format both sides agree
/// on, so a change to it should break this test.
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

describe('opening a DM', () => {
  it('returns the same conversation both times, from either side', async () => {
    const { alice, bob, conversationId } = await pair();

    const again = await alice.request({
      method: 'POST',
      url: '/conversations/dm',
      payload: { userId: bob.id },
    });
    const fromBob = await bob.request({
      method: 'POST',
      url: '/conversations/dm',
      payload: { userId: alice.id },
    });

    expect(again.json().id).toBe(conversationId);
    expect(fromBob.json().id).toBe(conversationId);
  });

  it('carries both participants and their public keys', async () => {
    const { alice, bob, conversationId } = await pair();

    const listed = await alice.request({ method: 'GET', url: '/conversations' });
    const [conversation] = listed.json().conversations;

    expect(conversation.id).toBe(conversationId);
    expect(conversation.kind).toBe('dm');
    expect(
      conversation.participants.map((p: { id: string }) => p.id).sort(),
    ).toEqual([alice.id, bob.id].sort());
    const other = conversation.participants.find((p: { id: string }) => p.id === bob.id);
    expect(other.publicKey).toBe(bob.user.device.publicKey);
  });

  it('refuses a stranger', async () => {
    const alice = await createActor(ctx);
    const stranger = await createActor(ctx);

    const opened = await alice.request({
      method: 'POST',
      url: '/conversations/dm',
      payload: { userId: stranger.id },
    });

    expect(opened.statusCode).toBe(404);
    expect(opened.json().error.code).toBe('not_friends');
  });

  it('refuses a conversation with yourself', async () => {
    const alice = await createActor(ctx);

    const opened = await alice.request({
      method: 'POST',
      url: '/conversations/dm',
      payload: { userId: alice.id },
    });

    expect(opened.statusCode).toBe(400);
    expect(opened.json().error.code).toBe('cannot_dm_self');
  });
});

describe('sending', () => {
  it('stores one sealed copy per participant and hands each only their own', async () => {
    const { alice, bob, conversationId } = await pair();

    const sent = await alice.request({
      method: 'POST',
      url: `/conversations/${conversationId}/messages`,
      payload: { clientId: 'c-1', envelopes: envelopesFor('hello', alice, bob) },
    });
    expect(sent.statusCode).toBe(200);

    const hers = await alice.request({
      method: 'GET',
      url: `/conversations/${conversationId}/messages`,
    });
    const his = await bob.request({
      method: 'GET',
      url: `/conversations/${conversationId}/messages`,
    });

    // Same message, different envelope: each side gets the copy sealed to them
    // and never sees the other's.
    expect(hers.json().messages[0].id).toBe(his.json().messages[0].id);
    expect(hers.json().messages[0].ciphertext).toContain(
      Buffer.from(`hello [for ${alice.user.username}]`, 'utf8').toString('base64'),
    );
    expect(his.json().messages[0].ciphertext).toContain(
      Buffer.from(`hello [for ${bob.user.username}]`, 'utf8').toString('base64'),
    );
    expect(hers.body).not.toContain(his.json().messages[0].ciphertext);
  });

  it('is idempotent on clientId, so a retried send is one message', async () => {
    const { alice, bob, conversationId } = await pair();
    const payload = { clientId: 'c-retry', envelopes: envelopesFor('once', alice, bob) };

    const first = await alice.request({
      method: 'POST',
      url: `/conversations/${conversationId}/messages`,
      payload,
    });
    const second = await alice.request({
      method: 'POST',
      url: `/conversations/${conversationId}/messages`,
      payload,
    });

    expect(second.json().id).toBe(first.json().id);
    expect(
      (await bob.request({ method: 'GET', url: `/conversations/${conversationId}/messages` }))
        .json().messages,
    ).toHaveLength(1);
  });

  it('rejects a message that leaves a participant unable to read it', async () => {
    const { alice, conversationId } = await pair();

    const sent = await alice.request({
      method: 'POST',
      url: `/conversations/${conversationId}/messages`,
      payload: { clientId: 'c-2', envelopes: envelopesFor('only mine', alice) },
    });

    expect(sent.statusCode).toBe(400);
    expect(sent.json().error.code).toBe('envelope_mismatch');
  });

  it('rejects an envelope addressed outside the conversation', async () => {
    const { alice, bob, conversationId } = await pair();
    const outsider = await createActor(ctx);

    const sent = await alice.request({
      method: 'POST',
      url: `/conversations/${conversationId}/messages`,
      payload: {
        clientId: 'c-3',
        envelopes: envelopesFor('for a third party', alice, bob, outsider),
      },
    });

    expect(sent.statusCode).toBe(400);
    expect(sent.json().error.code).toBe('envelope_mismatch');
  });

  it('rejects two envelopes for the same participant', async () => {
    const { alice, bob, conversationId } = await pair();

    const sent = await alice.request({
      method: 'POST',
      url: `/conversations/${conversationId}/messages`,
      payload: {
        clientId: 'c-4',
        envelopes: envelopesFor('twice', alice, bob, bob),
      },
    });

    expect(sent.statusCode).toBe(400);
    expect(sent.json().error.code).toBe('duplicate_envelope');
  });

  it('stops after unfriending, but leaves the history readable', async () => {
    const { alice, bob, conversationId } = await pair();

    await alice.request({
      method: 'POST',
      url: `/conversations/${conversationId}/messages`,
      payload: { clientId: 'c-before', envelopes: envelopesFor('before', alice, bob) },
    });

    await bob.request({ method: 'DELETE', url: `/friends/${alice.id}` });

    const blocked = await alice.request({
      method: 'POST',
      url: `/conversations/${conversationId}/messages`,
      payload: { clientId: 'c-after', envelopes: envelopesFor('after', alice, bob) },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('not_friends');

    // Unfriending withdraws the ability to add to a conversation. It is not a
    // request to destroy what was already said.
    const history = await bob.request({
      method: 'GET',
      url: `/conversations/${conversationId}/messages`,
    });
    expect(history.json().messages).toHaveLength(1);
  });
});

describe('reading', () => {
  it('refuses a non-participant, without confirming the conversation exists', async () => {
    const { conversationId } = await pair();
    const outsider = await createActor(ctx);

    const read = await outsider.request({
      method: 'GET',
      url: `/conversations/${conversationId}/messages`,
    });
    const sent = await outsider.request({
      method: 'POST',
      url: `/conversations/${conversationId}/messages`,
      payload: { clientId: 'c-x', envelopes: [] },
    });

    expect(read.statusCode).toBe(404);
    expect(read.json().error.code).toBe('conversation_not_found');
    expect(sent.statusCode).toBe(400);
  });

  it('pages from a cursor, in order, without repeating', async () => {
    const { alice, bob, conversationId } = await pair();

    for (let i = 0; i < 5; i += 1) {
      await alice.request({
        method: 'POST',
        url: `/conversations/${conversationId}/messages`,
        payload: { clientId: `c-${i}`, envelopes: envelopesFor(`m${i}`, alice, bob) },
      });
    }

    const first = await bob.request({
      method: 'GET',
      url: `/conversations/${conversationId}/messages?limit=2`,
    });
    expect(first.json().messages.map((m: { clientId: string }) => m.clientId)).toEqual([
      'c-0',
      'c-1',
    ]);

    const next = await bob.request({
      method: 'GET',
      url: `/conversations/${conversationId}/messages?after=${first.json().cursor}`,
    });
    expect(next.json().messages.map((m: { clientId: string }) => m.clientId)).toEqual([
      'c-2',
      'c-3',
      'c-4',
    ]);

    const caughtUp = await bob.request({
      method: 'GET',
      url: `/conversations/${conversationId}/messages?after=${next.json().cursor}`,
    });
    expect(caughtUp.json().messages).toEqual([]);
  });

  it('orders same-millisecond sends by sequence, not by timestamp', async () => {
    const { alice, bob, conversationId } = await pair();

    // sentAt defaults to now(); several of these land in the same millisecond,
    // which is exactly the tie `seq` exists to break.
    for (let i = 0; i < 8; i += 1) {
      await alice.request({
        method: 'POST',
        url: `/conversations/${conversationId}/messages`,
        payload: { clientId: `s-${i}`, envelopes: envelopesFor(`s${i}`, alice, bob) },
      });
    }

    const read = await bob.request({
      method: 'GET',
      url: `/conversations/${conversationId}/messages`,
    });

    expect(read.json().messages.map((m: { clientId: string }) => m.clientId)).toEqual([
      's-0',
      's-1',
      's-2',
      's-3',
      's-4',
      's-5',
      's-6',
      's-7',
    ]);
  });

  it('sorts the conversation list by most recent activity', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    const carol = await createActor(ctx);
    await befriend(alice, bob);
    await befriend(alice, carol);

    const withBob = (
      await alice.request({
        method: 'POST',
        url: '/conversations/dm',
        payload: { userId: bob.id },
      })
    ).json().id;
    const withCarol = (
      await alice.request({
        method: 'POST',
        url: '/conversations/dm',
        payload: { userId: carol.id },
      })
    ).json().id;

    await alice.request({
      method: 'POST',
      url: `/conversations/${withBob}/messages`,
      payload: { clientId: 'to-bob', envelopes: envelopesFor('hi bob', alice, bob) },
    });

    const listed = await alice.request({ method: 'GET', url: '/conversations' });
    expect(listed.json().conversations.map((c: { id: string }) => c.id)).toEqual([
      withBob,
      withCarol,
    ]);
  });

  it('never returns a message body the caller was not sealed a copy of', async () => {
    // The guardrail server/AGENTS.md asks for: whatever else changes, a
    // response must not carry someone else's envelope.
    const { alice, bob, conversationId } = await pair();

    await alice.request({
      method: 'POST',
      url: `/conversations/${conversationId}/messages`,
      payload: { clientId: 'c-guard', envelopes: envelopesFor('secret', alice, bob) },
    });

    const hisCopy = Buffer.from(`secret [for ${bob.user.username}]`, 'utf8').toString('base64');
    const herView = await alice.request({
      method: 'GET',
      url: `/conversations/${conversationId}/messages`,
    });

    expect(herView.body).not.toContain(hisCopy);
  });
});
