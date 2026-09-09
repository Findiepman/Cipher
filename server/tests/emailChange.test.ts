/**
 * Moving an account to a new email address.
 *
 * The address is also the auth salt, so the property under test is that the
 * confirm step swaps the address and the verifier together: afterwards the
 * new address signs in with the hash derived under it, and the old address
 * signs in with nothing.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import {
  base64Bytes,
  createActor,
  createTestApp,
  newUser,
  registerAndVerify,
  tokenFromEmail,
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

function login(email: string, authHash: string) {
  return ctx.app.inject({ method: 'POST', url: '/auth/login', payload: { email, authHash } });
}

async function requestChange(actor: Actor, newEmail: string) {
  return actor.request({
    method: 'POST',
    url: '/account/change-email',
    payload: { newEmail, authHash: actor.user.authHash },
  });
}

describe('asking to change', () => {
  it('needs the password and sends the link to the new address only', async () => {
    const alice = await createActor(ctx);
    const newEmail = `alice-new-${Date.now()}@example.test`;

    const wrong = await alice.request({
      method: 'POST',
      url: '/account/change-email',
      payload: { newEmail, authHash: base64Bytes() },
    });
    expect(wrong.statusCode).toBe(401);

    ctx.mailer.clear();
    const asked = await requestChange(alice, newEmail);
    expect(asked.statusCode).toBe(200);

    expect(ctx.mailer.lastTo(newEmail)?.subject).toMatch(/new email/i);
    expect(ctx.mailer.lastTo(alice.user.email)).toBeUndefined();

    // Nothing has moved yet.
    const me = await alice.request({ method: 'GET', url: '/account/me' });
    expect(me.json().email).toBe(alice.user.email);
  });

  it('answers the same for a taken address, and tells its owner instead', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);

    ctx.mailer.clear();
    const asked = await requestChange(alice, bob.user.email);
    expect(asked.statusCode).toBe(200);
    expect(asked.json()).toEqual({ ok: true });

    const toBob = ctx.mailer.lastTo(bob.user.email);
    expect(toBob?.subject).toMatch(/tried to register/i);
    expect(toBob?.text).not.toMatch(/token=/);
  });

  it('refuses the address already on the account', async () => {
    const alice = await createActor(ctx);
    const same = await requestChange(alice, alice.user.email);
    expect(same.statusCode).toBe(400);
    expect(same.json().error.code).toBe('same_email');
  });
});

describe('confirming', () => {
  it('says which address the link is for, then moves the account there', async () => {
    const alice = await createActor(ctx);
    const newEmail = `alice-moved-${Date.now()}@example.test`;
    await requestChange(alice, newEmail);
    const token = tokenFromEmail(ctx.mailer, newEmail);

    const context = await alice.request({
      method: 'POST',
      url: '/account/change-email/context',
      payload: { token },
    });
    expect(context.statusCode).toBe(200);
    expect(context.json()).toEqual({ newEmail });

    const newAuthHash = base64Bytes();
    const confirmed = await alice.request({
      method: 'POST',
      url: '/account/change-email/confirm',
      payload: { token, newAuthHash },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().email).toBe(newEmail);
    expect(confirmed.json().emailVerifiedAt).not.toBeNull();

    // The new address with the new hash is the account. The old pair is not,
    // and neither is the old hash under the new address.
    expect((await login(newEmail, newAuthHash)).statusCode).toBe(200);
    expect((await login(alice.user.email, alice.user.authHash)).statusCode).toBe(401);
    expect((await login(newEmail, alice.user.authHash)).statusCode).toBe(401);

    // The session that confirmed is still signed in: the password did not change.
    expect((await alice.request({ method: 'GET', url: '/account/me' })).statusCode).toBe(200);

    // The link is spent.
    const again = await alice.request({
      method: 'POST',
      url: '/account/change-email/confirm',
      payload: { token, newAuthHash: base64Bytes() },
    });
    expect(again.statusCode).toBe(400);
  });

  it("rejects somebody else's link and a stale one", async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    const newEmail = `alice-moved-${Date.now()}@example.test`;
    await requestChange(alice, newEmail);
    const token = tokenFromEmail(ctx.mailer, newEmail);

    const notHis = await bob.request({
      method: 'POST',
      url: '/account/change-email/context',
      payload: { token },
    });
    expect(notHis.statusCode).toBe(400);

    // Asking again retires the first link.
    await requestChange(alice, newEmail);
    const stale = await alice.request({
      method: 'POST',
      url: '/account/change-email/context',
      payload: { token },
    });
    expect(stale.statusCode).toBe(400);
  });

  it('tells the confirmer plainly if the address was taken in the meantime', async () => {
    const alice = await createActor(ctx);
    const newEmail = `contested-${Date.now()}@example.test`;
    await requestChange(alice, newEmail);
    const token = tokenFromEmail(ctx.mailer, newEmail);

    // Somebody registers the address between the request and the click.
    const rival = { ...newUser(`rival-${Date.now().toString(36)}`), email: newEmail };
    await registerAndVerify(ctx, rival);

    const confirmed = await alice.request({
      method: 'POST',
      url: '/account/change-email/confirm',
      payload: { token, newAuthHash: base64Bytes() },
    });
    expect(confirmed.statusCode).toBe(409);
    expect(confirmed.json().error.code).toBe('email_in_use');

    // And nothing about the account moved.
    expect((await login(alice.user.email, alice.user.authHash)).statusCode).toBe(200);
  });
});
