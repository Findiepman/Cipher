/**
 * Password reset, change password and recovery-code rotation.
 *
 * The thing worth holding onto while reading these: not one of them sends a
 * password, and the reset ones do not send a recovery code either. The server
 * is handed an authHash and a couple of opaque blobs, and every assertion below
 * is about whether it swapped the right ones together. Whether the recovery
 * code was correct is decided on the device, by whether blob_B opens, and is
 * covered in client/src/lib/session/authService.test.ts against a fake server
 * that behaves like this one.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import {
  base64Bytes,
  createTestApp,
  login,
  newUser,
  registerAndVerify,
  resetDatabase,
  tokenFromEmail,
  type RegisteredUser,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
let app: FastifyInstance;

beforeAll(async () => {
  ctx = await createTestApp();
  app = ctx.app;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  ctx.mailer.clear();
});

/// Asks for a reset link and returns the token out of the email, the way a
/// user gets it. Fails loudly if no mail was sent, since "no email" and "an
/// email with no link in it" are different bugs.
async function requestReset(user: RegisteredUser): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/forgot-password',
    payload: { email: user.email },
  });

  if (response.statusCode !== 202) {
    throw new Error(`Reset request failed: ${response.body}`);
  }

  return tokenFromEmail(ctx.mailer, user.email);
}

/// What a client sends after re-wrapping the key it opened with the recovery
/// code. Fresh blobs and a fresh code hash, the same public key: the keypair
/// survived, so nothing anyone else looks up changes.
function recoveryReset(token: string) {
  return {
    token,
    identityReset: false,
    authHash: base64Bytes(),
    wrappedPrivateKey: `wrapped-a-after-reset`,
    wrappedPrivateKeyRecovery: `wrapped-b-after-reset`,
    recoveryCodeHash: base64Bytes(),
  };
}

/// What a client sends when the recovery code is gone: a brand new keypair,
/// so a public key comes with it and the old history is left unreadable.
function identityReset(token: string) {
  return {
    token,
    identityReset: true,
    authHash: base64Bytes(),
    publicKey: base64Bytes(),
    wrappedPrivateKey: `wrapped-a-new-identity`,
    wrappedPrivateKeyRecovery: `wrapped-b-new-identity`,
    recoveryCodeHash: base64Bytes(),
  };
}

describe('forgot password', () => {
  it('emails a reset link to a verified account', async () => {
    const user = newUser('forgot');
    await registerAndVerify(ctx, user);
    ctx.mailer.clear();

    const response = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: user.email },
    });

    expect(response.statusCode).toBe(202);
    expect(ctx.mailer.lastTo(user.email)?.subject).toBe('Reset your password');
    expect(tokenFromEmail(ctx.mailer, user.email)).toBeTruthy();

    // The link is a credential, so only its hash is kept.
    const stored = await prisma.emailToken.findFirstOrThrow({
      where: { purpose: 'RESET' },
    });
    expect(stored.tokenHash).not.toBe(tokenFromEmail(ctx.mailer, user.email));
  });

  it('gives an unknown address the same answer as a real one', async () => {
    const user = newUser('known-address');
    await registerAndVerify(ctx, user);
    ctx.mailer.clear();

    const real = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: user.email },
    });

    const unknown = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'nobody@example.test' },
    });

    // Byte for byte, so the response cannot answer "does this person have an
    // account here", which is the question this whole design refuses.
    expect(unknown.statusCode).toBe(real.statusCode);
    expect(unknown.body).toBe(real.body);
    expect(ctx.mailer.lastTo('nobody@example.test')).toBeUndefined();
  });

  it('will not reset an account whose address was never verified', async () => {
    // Nobody has proved they can read that inbox, and this endpoint would be
    // the proof. Honouring it would let someone who registered with an address
    // that is not theirs keep hold of it.
    const user = newUser('unverified');
    await app.inject({ method: 'POST', url: '/auth/register', payload: user });
    ctx.mailer.clear();

    const response = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: user.email },
    });

    expect(response.statusCode).toBe(202);
    expect(ctx.mailer.sent).toHaveLength(0);
    expect(await prisma.emailToken.count({ where: { purpose: 'RESET' } })).toBe(0);
  });

  it('will not reset a disabled account', async () => {
    const user = newUser('disabledreset');
    await registerAndVerify(ctx, user);
    await prisma.user.update({
      where: { email: user.email },
      data: { status: 'DISABLED' },
    });
    ctx.mailer.clear();

    const response = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: user.email },
    });

    expect(response.statusCode).toBe(202);
    expect(ctx.mailer.sent).toHaveLength(0);
  });

  it('kills the previous link when a second one is asked for', async () => {
    const user = newUser('secondlink');
    await registerAndVerify(ctx, user);

    const first = await requestReset(user);
    const second = await requestReset(user);
    expect(second).not.toBe(first);

    const stale = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/context',
      payload: { token: first },
    });
    expect(stale.statusCode).toBe(400);
    expect(stale.json().error.code).toBe('invalid_token');

    const fresh = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/context',
      payload: { token: second },
    });
    expect(fresh.statusCode).toBe(200);
  });
});

describe('reset context', () => {
  it('hands over blob_B and nothing else the account holds', async () => {
    const user = newUser('context');
    await registerAndVerify(ctx, user);
    const token = await requestReset(user);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/context',
      payload: { token },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.email).toBe(user.email);
    expect(body.publicKey).toBe(user.device.publicKey);
    expect(body.wrappedPrivateKeyRecovery).toBe(
      user.device.wrappedPrivateKeyRecovery,
    );
    expect(body.deviceId).toBeTruthy();

    // blob_A is wrapped under the password, so handing it to whoever holds a
    // reset token would turn control of an inbox into an offline attack on the
    // password. Only blob_B leaves, and that one needs the recovery code.
    expect(response.body).not.toContain(user.device.wrappedPrivateKey);
    expect(response.body).not.toContain('authVerifier');
  });

  it('does not spend the token, so a mistyped code can be retried', async () => {
    const user = newUser('retry');
    await registerAndVerify(ctx, user);
    const token = await requestReset(user);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/reset-password/context',
        payload: { token },
      });
      expect(response.statusCode).toBe(200);
    }
  });

  it('rejects an unknown token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/context',
      payload: { token: 'not-a-real-token' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_token');
  });

  it('rejects a verification token presented as a reset token', async () => {
    // Both live in the same table. Purpose is checked, not just existence.
    const user = newUser('wrongpurpose');
    await app.inject({ method: 'POST', url: '/auth/register', payload: user });
    const verifyToken = tokenFromEmail(ctx.mailer, user.email);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/context',
      payload: { token: verifyToken },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_token');
  });

  it('rejects an expired token', async () => {
    const user = newUser('expiredcontext');
    await registerAndVerify(ctx, user);
    const token = await requestReset(user);

    await prisma.emailToken.updateMany({
      where: { purpose: 'RESET' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/context',
      payload: { token },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_token');
  });
});

describe('reset with the recovery code', () => {
  it('swaps the credentials and the blobs together, keeping the identity', async () => {
    const user = newUser('recovered');
    await registerAndVerify(ctx, user);
    const token = await requestReset(user);

    const payload = recoveryReset(token);
    const response = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });

    // The old password no longer opens the account, the new one does.
    const withOld = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.email, authHash: user.authHash },
    });
    expect(withOld.statusCode).toBe(401);

    const withNew = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.email, authHash: payload.authHash },
    });
    expect(withNew.statusCode).toBe(200);

    // And the key material came with it. The public key is untouched, which is
    // the whole point of this path: everyone else can still reach this account
    // and its history is still readable.
    const device = withNew.json().device;
    expect(device.publicKey).toBe(user.device.publicKey);
    expect(device.wrappedPrivateKey).toBe(payload.wrappedPrivateKey);
    expect(device.wrappedPrivateKeyRecovery).toBe(payload.wrappedPrivateKeyRecovery);

    const stored = await prisma.user.findUniqueOrThrow({
      where: { email: user.email },
    });
    expect(stored.recoveryCodeHash).toBe(payload.recoveryCodeHash);
    // Stored hashed, exactly like a login: the value the client sent is not
    // the value in the row.
    expect(stored.authVerifier).not.toContain(payload.authHash);
    expect(stored.authVerifier.startsWith('$argon2id$')).toBe(true);
  });

  it('spends the link, so replaying it does nothing', async () => {
    const user = newUser('replaylink');
    await registerAndVerify(ctx, user);
    const token = await requestReset(user);

    const first = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: recoveryReset(token),
    });
    expect(first.statusCode).toBe(200);

    const second = recoveryReset(token);
    const replay = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: second,
    });
    expect(replay.statusCode).toBe(400);
    expect(replay.json().error.code).toBe('invalid_token');

    // The replay must not have taken effect either: the authHash it carried
    // should not sign anyone in.
    const login2 = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.email, authHash: second.authHash },
    });
    expect(login2.statusCode).toBe(401);

    // The context endpoint is dead too, so the spent link cannot be used to
    // fetch blob_B over and over.
    const context = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/context',
      payload: { token },
    });
    expect(context.statusCode).toBe(400);
  });

  it('rejects an expired link and changes nothing', async () => {
    const user = newUser('expiredreset');
    await registerAndVerify(ctx, user);
    const token = await requestReset(user);

    await prisma.emailToken.updateMany({
      where: { purpose: 'RESET' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: recoveryReset(token),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_token');

    const withOld = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.email, authHash: user.authHash },
    });
    expect(withOld.statusCode).toBe(200);
  });

  it('signs out every session the old password had open', async () => {
    // Someone resetting a password is often doing it because a session exists
    // that should not. One that survived the reset would make it pointless.
    const user = newUser('killsessions');
    await registerAndVerify(ctx, user);
    const session = await login(ctx, user);

    const token = await requestReset(user);
    await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: recoveryReset(token),
    });

    const me = await app.inject({
      method: 'GET',
      url: '/account/me',
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(me.statusCode).toBe(401);
    expect(me.json().error.code).toBe('session_revoked');

    const refresh = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: session.refreshToken },
    });
    expect(refresh.statusCode).toBe(401);
  });

  it('lifts a lockout, because the inbox was proof enough', async () => {
    const user = newUser('lockedout');
    await registerAndVerify(ctx, user);

    // MAX_FAILED_LOGINS is forced to 3 in tests/setup.ts.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: user.email, authHash: base64Bytes() },
      });
    }
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { email: user.email } }))
        .lockedUntil,
    ).not.toBeNull();

    const token = await requestReset(user);
    const payload = recoveryReset(token);
    await app.inject({ method: 'POST', url: '/auth/reset-password', payload });

    const signedIn = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.email, authHash: payload.authHash },
    });
    expect(signedIn.statusCode).toBe(200);
  });

  it('ignores a public key sent on the path that kept its keypair', async () => {
    // Swapping the public key while keeping the surviving blobs would leave
    // everyone encrypting to a key this account cannot open, which is a quiet
    // way to destroy an account. The field only exists on the other branch.
    const user = newUser('nokeyswap');
    await registerAndVerify(ctx, user);
    const token = await requestReset(user);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { ...recoveryReset(token), publicKey: base64Bytes() },
    });

    expect(response.statusCode).toBe(200);

    const device = await prisma.device.findFirstOrThrow({
      where: { user: { email: user.email } },
    });
    expect(device.publicKey).toBe(user.device.publicKey);
  });

  it('refuses a reset with no key material to swap in', async () => {
    const user = newUser('missingblob');
    await registerAndVerify(ctx, user);
    const token = await requestReset(user);

    const { wrappedPrivateKey: _dropped, ...withoutBlob } = recoveryReset(token);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: withoutBlob,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('validation_failed');
  });
});

describe('reset without the recovery code', () => {
  it('takes a new keypair and leaves the old history unreadable', async () => {
    const user = newUser('newidentity');
    await registerAndVerify(ctx, user);
    const token = await requestReset(user);

    const payload = identityReset(token);
    const response = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload,
    });
    expect(response.statusCode).toBe(200);

    const signedIn = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.email, authHash: payload.authHash },
    });
    expect(signedIn.statusCode).toBe(200);

    const device = signedIn.json().device;
    // The registry now points at the new key, so contacts have a different
    // security number and every envelope sealed to the old one is dead.
    expect(device.publicKey).toBe(payload.publicKey);
    expect(device.publicKey).not.toBe(user.device.publicKey);
    expect(device.wrappedPrivateKey).toBe(payload.wrappedPrivateKey);
  });

  it('requires a public key when the identity was discarded', async () => {
    const user = newUser('nopublickey');
    await registerAndVerify(ctx, user);
    const token = await requestReset(user);

    const { publicKey: _dropped, ...withoutKey } = identityReset(token);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: withoutKey,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('validation_failed');
  });

  it('gives key material back to an account that has none', async () => {
    // Not reachable through the UI today, since registration creates the
    // device in the same transaction as the user. It is here because the
    // alternative is an account that can sign in and read nothing, forever.
    const user = newUser('nodeviceleft');
    await registerAndVerify(ctx, user);
    await prisma.device.updateMany({ data: { revokedAt: new Date() } });

    const token = await requestReset(user);

    const stuck = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: recoveryReset(token),
    });
    expect(stuck.statusCode).toBe(400);
    expect(stuck.json().error.code).toBe('identity_unavailable');

    const payload = identityReset(token);
    const response = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload,
    });
    expect(response.statusCode).toBe(200);

    const signedIn = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.email, authHash: payload.authHash },
    });
    expect(signedIn.json().device.publicKey).toBe(payload.publicKey);
  });
});

describe('change password', () => {
  it('re-wraps the key and retires the old password', async () => {
    const user = newUser('changepw');
    await registerAndVerify(ctx, user);
    const session = await login(ctx, user);

    const newAuthHash = base64Bytes();
    const response = await app.inject({
      method: 'POST',
      url: '/account/change-password',
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: {
        currentAuthHash: user.authHash,
        newAuthHash,
        wrappedPrivateKey: 'wrapped-a-after-change',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });

    const withOld = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.email, authHash: user.authHash },
    });
    expect(withOld.statusCode).toBe(401);

    const withNew = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.email, authHash: newAuthHash },
    });
    expect(withNew.statusCode).toBe(200);
    expect(withNew.json().device.wrappedPrivateKey).toBe('wrapped-a-after-change');
    // blob_B is untouched, so the recovery code written down at signup still
    // works.
    expect(withNew.json().device.wrappedPrivateKeyRecovery).toBe(
      user.device.wrappedPrivateKeyRecovery,
    );
  });

  it('refuses the wrong current password and changes nothing', async () => {
    const user = newUser('wrongcurrent');
    await registerAndVerify(ctx, user);
    const session = await login(ctx, user);

    const response = await app.inject({
      method: 'POST',
      url: '/account/change-password',
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: {
        currentAuthHash: base64Bytes(),
        newAuthHash: base64Bytes(),
        wrappedPrivateKey: 'should-not-be-stored',
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('invalid_credentials');

    const device = await prisma.device.findFirstOrThrow({
      where: { user: { email: user.email } },
    });
    expect(device.wrappedPrivateKey).toBe(user.device.wrappedPrivateKey);
  });

  it('keeps the caller signed in and signs every other device out', async () => {
    const user = newUser('othersessions');
    await registerAndVerify(ctx, user);
    const here = await login(ctx, user);
    const elsewhere = await login(ctx, user);

    await app.inject({
      method: 'POST',
      url: '/account/change-password',
      headers: { authorization: `Bearer ${here.accessToken}` },
      payload: {
        currentAuthHash: user.authHash,
        newAuthHash: base64Bytes(),
        wrappedPrivateKey: 'wrapped-a-two-sessions',
      },
    });

    const stillHere = await app.inject({
      method: 'GET',
      url: '/account/me',
      headers: { authorization: `Bearer ${here.accessToken}` },
    });
    expect(stillHere.statusCode).toBe(200);

    const gone = await app.inject({
      method: 'GET',
      url: '/account/me',
      headers: { authorization: `Bearer ${elsewhere.accessToken}` },
    });
    expect(gone.statusCode).toBe(401);
  });

  it('needs a session at all', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/account/change-password',
      payload: {
        currentAuthHash: base64Bytes(),
        newAuthHash: base64Bytes(),
        wrappedPrivateKey: 'nope',
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('unauthenticated');
  });
});

describe('rotating the recovery code', () => {
  it('stores the new hash and the blob it opens', async () => {
    const user = newUser('rotatecode');
    await registerAndVerify(ctx, user);
    const session = await login(ctx, user);

    const recoveryCodeHash = base64Bytes();
    const response = await app.inject({
      method: 'POST',
      url: '/account/recovery-code',
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: {
        authHash: user.authHash,
        recoveryCodeHash,
        wrappedPrivateKeyRecovery: 'wrapped-b-rotated',
      },
    });

    expect(response.statusCode).toBe(200);

    const stored = await prisma.user.findUniqueOrThrow({
      where: { email: user.email },
    });
    // One live code at a time: writing the new hash is what retires the old
    // code, and the old blob_B goes with it.
    expect(stored.recoveryCodeHash).toBe(recoveryCodeHash);

    const device = await prisma.device.findFirstOrThrow({
      where: { userId: stored.id },
    });
    expect(device.wrappedPrivateKeyRecovery).toBe('wrapped-b-rotated');
    // The password half is untouched, so nobody is signed out.
    expect(device.wrappedPrivateKey).toBe(user.device.wrappedPrivateKey);
  });

  it('refuses a wrong password and leaves the old code working', async () => {
    const user = newUser('rotatewrongpw');
    await registerAndVerify(ctx, user);
    const session = await login(ctx, user);

    const response = await app.inject({
      method: 'POST',
      url: '/account/recovery-code',
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: {
        authHash: base64Bytes(),
        recoveryCodeHash: base64Bytes(),
        wrappedPrivateKeyRecovery: 'should-not-be-stored',
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('invalid_credentials');

    const stored = await prisma.user.findUniqueOrThrow({
      where: { email: user.email },
    });
    expect(stored.recoveryCodeHash).toBe(user.recoveryCodeHash);
  });

  it('needs a session at all', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/account/recovery-code',
      payload: {
        authHash: base64Bytes(),
        recoveryCodeHash: base64Bytes(),
        wrappedPrivateKeyRecovery: 'nope',
      },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('what the server never sees', () => {
  it('has nothing on file that could check a recovery code', async () => {
    // Worth asserting rather than assuming. The reset endpoint takes no
    // recovery code and could not verify one if it did: what it stores is a
    // SHA-256 the client computed, and the code that produced it exists only
    // wherever the user wrote it down. The consequence is the design's central
    // trade, so it should fail loudly if someone ever adds a field here.
    const user = newUser('nocode');
    await registerAndVerify(ctx, user);
    const token = await requestReset(user);

    const payload = recoveryReset(token);
    await app.inject({ method: 'POST', url: '/auth/reset-password', payload });

    const stored = await prisma.user.findUniqueOrThrow({
      where: { email: user.email },
    });
    expect(stored.recoveryCodeHash).toBe(payload.recoveryCodeHash);
    expect(stored.recoveryCodeHash).toHaveLength(44);
  });

  it('never puts a password or a raw token in the reset email', async () => {
    const user = newUser('mailcontents');
    await registerAndVerify(ctx, user);
    ctx.mailer.clear();
    await requestReset(user);

    const mail = ctx.mailer.lastTo(user.email)!;
    expect(mail.text).not.toContain(user.authHash);
    expect(mail.text).not.toContain(user.device.wrappedPrivateKey);
    expect(mail.text).toContain('/reset-password?token=');
    // Text first, HTML derived from it: both parts carry the same link.
    expect(mail.html).toContain('/reset-password?token=');
  });
});
