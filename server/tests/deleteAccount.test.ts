/**
 * Ending an account.
 *
 * A soft delete: the handle and the address are freed, the person vanishes
 * from every friend list, every session dies, and the sealed history of the
 * people they talked to is left exactly where it was.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import {
  base64Bytes,
  befriend,
  createActor,
  createTestApp,
  newUser,
  registerAndVerify,
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

function remove(actor: Actor, authHash = actor.user.authHash) {
  return actor.request({ method: 'DELETE', url: '/account', payload: { authHash } });
}

describe('deleting your account', () => {
  it('needs the password', async () => {
    const alice = await createActor(ctx);
    const refused = await remove(alice, base64Bytes());
    expect(refused.statusCode).toBe(401);
    expect((await alice.request({ method: 'GET', url: '/account/me' })).statusCode).toBe(200);
  });

  it('signs the account out, frees the handle and drops it from friend lists', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    await befriend(alice, bob);
    await alice.request({
      method: 'PATCH',
      url: '/account/me',
      payload: { displayName: 'Ali' },
    });

    const gone = await remove(alice);
    expect(gone.statusCode).toBe(200);

    expect((await alice.request({ method: 'GET', url: '/account/me' })).statusCode).toBe(401);
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: alice.user.email, authHash: alice.user.authHash },
    });
    expect(login.statusCode).toBe(401);

    const his = await bob.request({ method: 'GET', url: '/friends' });
    expect(his.json().friends).toEqual([]);

    // The old handle and address can be claimed again.
    const successor = {
      ...newUser(`again-${Date.now().toString(36)}`),
      username: alice.user.username,
      email: alice.user.email,
    };
    await registerAndVerify(ctx, successor);
    const stranger = await ctx.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: successor.email, authHash: successor.authHash },
    });
    expect(stranger.statusCode).toBe(200);
    // A new account, not the old one wearing its name.
    expect(stranger.json().user.id).not.toBe(alice.id);
    expect(stranger.json().user.profile.displayName).toBe('');
  });

  it("leaves the other side's history where it was", async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    await befriend(alice, bob);

    const opened = await alice.request({
      method: 'POST',
      url: '/conversations/dm',
      payload: { userId: bob.id },
    });
    const conversationId = opened.json().id as string;
    const sent = await alice.request({
      method: 'POST',
      url: `/conversations/${conversationId}/messages`,
      payload: {
        clientId: 'm1',
        envelopes: [
          { recipientUserId: alice.id, ciphertext: 'sealed-for-alice' },
          { recipientUserId: bob.id, ciphertext: 'sealed-for-bob' },
        ],
      },
    });
    expect(sent.statusCode).toBe(200);

    await remove(alice);

    const history = await bob.request({
      method: 'GET',
      url: `/conversations/${conversationId}/messages`,
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().messages).toHaveLength(1);
    expect(history.json().messages[0].ciphertext).toBe('sealed-for-bob');

    // Bob still sees the conversation, under a handle that says what happened.
    const listed = await bob.request({ method: 'GET', url: '/conversations' });
    const her = listed
      .json()
      .conversations[0].participants.find((p: { id: string }) => p.id === alice.id);
    expect(her.username).toMatch(/^deleted-/);
    expect(her.publicKey).toBeNull();
  });
});
