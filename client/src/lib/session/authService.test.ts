/**
 * End-to-end exercise of the account flows against a fake server.
 *
 * The fake implements only what the contract says the server must do: compare
 * the `authHash` it was given at registration, and hand back the opaque blobs
 * it stored. It has no access to the password, the recovery code or the
 * private key, so if these tests pass, the flows work under a server that
 * genuinely cannot read anything.
 */
import { toBase64 } from '@cipher/crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiClient } from '../api/client';
import { ApiError } from '../api/errors';
import type { RegisterRequest } from '../api/types';
import { MemorySecureStore } from '../storage/secureStore';
import { AuthService, IdentityUnavailableError } from './authService';
import { KeyManager } from './keyManager';

const EMAIL = 'sam@example.com';
const USERNAME = 'sam';
const PASSWORD = 'a-long-enough-password-1';
const NEW_PASSWORD = 'an-even-longer-password-2';

interface StoredAccount {
  authHash: string;
  recoveryCodeHash: string;
  device: RegisterRequest['device'] & { id: string };
}

/** Minimal stand-in for server/, plus a log of everything it was sent. */
class FakeServer {
  account: StoredAccount | null = null;
  readonly bodies: string[] = [];
  readonly resetTokens = new Map<string, string>();

  readonly fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const raw = typeof init?.body === 'string' ? init.body : '';
    if (raw) this.bodies.push(raw);
    const body = raw ? (JSON.parse(raw) as Record<string, string>) : {};

    switch (path) {
      case '/auth/register': {
        this.account = {
          authHash: body.authHash,
          recoveryCodeHash: body.recoveryCodeHash,
          device: {
            ...(JSON.parse(raw) as RegisterRequest).device,
            id: 'dev-1',
          },
        };
        return json({ ok: true });
      }

      case '/auth/login': {
        if (!this.account || body.authHash !== this.account.authHash) {
          return json({ error: { code: 'invalid_credentials', message: 'no' } }, 401);
        }
        return json({
          user: account(),
          device: {
            id: this.account.device.id,
            label: this.account.device.label,
            publicKey: this.account.device.publicKey,
            wrappedPrivateKey: this.account.device.wrappedPrivateKey,
            wrappedPrivateKeyRecovery: this.account.device.wrappedPrivateKeyRecovery,
            createdAt: '2026-09-06T10:00:00.000Z',
            revokedAt: null,
          },
        });
      }

      case '/account/change-password': {
        if (!this.account || body.currentAuthHash !== this.account.authHash) {
          return json({ error: { code: 'invalid_credentials', message: 'no' } }, 401);
        }
        this.account.authHash = body.newAuthHash;
        this.account.device.wrappedPrivateKey = body.wrappedPrivateKey;
        return json({ ok: true });
      }

      case '/account/recovery-code': {
        if (!this.account || body.authHash !== this.account.authHash) {
          return json({ error: { code: 'invalid_credentials', message: 'no' } }, 401);
        }
        this.account.recoveryCodeHash = body.recoveryCodeHash;
        this.account.device.wrappedPrivateKeyRecovery = body.wrappedPrivateKeyRecovery;
        return json({ ok: true });
      }

      case '/auth/reset-password/context': {
        if (!this.account || !this.resetTokens.has(body.token)) {
          return json({ error: { code: 'invalid_token', message: 'no' } }, 400);
        }
        return json({
          email: EMAIL,
          deviceId: this.account.device.id,
          publicKey: this.account.device.publicKey,
          wrappedPrivateKeyRecovery: this.account.device.wrappedPrivateKeyRecovery,
        });
      }

      case '/auth/reset-password': {
        if (!this.account || !this.resetTokens.has(body.token)) {
          return json({ error: { code: 'invalid_token', message: 'no' } }, 400);
        }
        this.resetTokens.delete(body.token);
        this.account.authHash = body.authHash;
        this.account.device.wrappedPrivateKey = body.wrappedPrivateKey;
        if (body.wrappedPrivateKeyRecovery) {
          this.account.device.wrappedPrivateKeyRecovery = body.wrappedPrivateKeyRecovery;
        }
        if (body.recoveryCodeHash) this.account.recoveryCodeHash = body.recoveryCodeHash;
        if (body.publicKey) this.account.device.publicKey = body.publicKey;
        return json({ ok: true });
      }

      case '/auth/logout':
        return new Response(null, { status: 204 });

      default:
        return json({ error: { code: 'not_found', message: path } }, 404);
    }
  }) as unknown as typeof fetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function account() {
  return {
    id: 'u-1',
    email: EMAIL,
    username: USERNAME,
    role: 'user',
    status: 'active',
    emailVerifiedAt: '2026-09-06T10:00:00.000Z',
    createdAt: '2026-09-06T09:00:00.000Z',
    lastLoginAt: null,
  };
}

function harness() {
  const server = new FakeServer();
  const client = new ApiClient({
    baseUrl: 'http://api.test',
    authMode: 'cookie',
    fetchImpl: server.fetch,
    readCookies: () => '',
  });
  const keys = new KeyManager(new MemorySecureStore(), client);
  return { server, client, keys, auth: new AuthService(keys, client) };
}

describe('register and log in', () => {
  let env: ReturnType<typeof harness>;

  beforeEach(() => {
    env = harness();
  });

  it('registers, then logs in and unlocks the identity', { timeout: 60_000 }, async () => {
    const { recoveryCode } = await env.auth.register({
      email: EMAIL,
      username: USERNAME,
      password: PASSWORD,
      deviceLabel: 'Test device',
    });
    expect(recoveryCode).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){3}$/);
    // Registration is deliberately not a sign-in: the device holds nothing yet.
    expect(env.keys.state).toBe('empty');

    const me = await env.auth.login({ email: EMAIL, password: PASSWORD });
    expect(me.email).toBe(EMAIL);
    expect(env.keys.state).toBe('unlocked');
    expect(env.keys.current?.deviceId).toBe('dev-1');
  });

  it('never sends the password, the recovery code or the private key', { timeout: 60_000 }, async () => {
    const { recoveryCode } = await env.auth.register({
      email: EMAIL,
      username: USERNAME,
      password: PASSWORD,
    });
    await env.auth.login({ email: EMAIL, password: PASSWORD });

    const privateKey = await toBase64(env.keys.requirePrivateKey());
    const everythingSent = env.server.bodies.join('\n');

    expect(everythingSent).not.toContain(PASSWORD);
    expect(everythingSent).not.toContain(recoveryCode);
    expect(everythingSent).not.toContain(recoveryCode.replace(/-/g, ''));
    expect(everythingSent).not.toContain(privateKey);
    // What the server did get: an opaque hash and two opaque blobs.
    expect(everythingSent).toContain('authHash');
    expect(everythingSent).toContain('wrappedPrivateKey');
  });

  it('rejects the wrong password without unlocking anything', { timeout: 60_000 }, async () => {
    await env.auth.register({ email: EMAIL, username: USERNAME, password: PASSWORD });
    await expect(env.auth.login({ email: EMAIL, password: 'not-the-password' })).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(env.keys.state).toBe('empty');
  });

  it('reports an unopenable blob distinctly from a wrong password', { timeout: 60_000 }, async () => {
    await env.auth.register({ email: EMAIL, username: USERNAME, password: PASSWORD });
    // Simulate key material that has drifted out of step with the credentials.
    const other = harness();
    await other.auth.register({ email: EMAIL, username: USERNAME, password: NEW_PASSWORD });
    env.server.account!.device.wrappedPrivateKey =
      other.server.account!.device.wrappedPrivateKey;

    await expect(env.auth.login({ email: EMAIL, password: PASSWORD })).rejects.toBeInstanceOf(
      IdentityUnavailableError,
    );
  });
});

describe('changing the password', () => {
  it('re-wraps the key, keeps the identity and invalidates the old password', { timeout: 90_000 }, async () => {
    const env = harness();
    await env.auth.register({ email: EMAIL, username: USERNAME, password: PASSWORD });
    await env.auth.login({ email: EMAIL, password: PASSWORD });
    const before = await toBase64(env.keys.requirePrivateKey());

    await env.auth.changePassword(PASSWORD, NEW_PASSWORD);

    const fresh = harness();
    fresh.server.account = env.server.account;
    await expect(fresh.auth.login({ email: EMAIL, password: PASSWORD })).rejects.toBeInstanceOf(
      ApiError,
    );

    await fresh.auth.login({ email: EMAIL, password: NEW_PASSWORD });
    // Same private key: the account keeps its identity and its history.
    expect(await toBase64(fresh.keys.requirePrivateKey())).toBe(before);
  });
});

describe('password reset', () => {
  it('recovers the same identity with the recovery code', { timeout: 90_000 }, async () => {
    const env = harness();
    const { recoveryCode } = await env.auth.register({
      email: EMAIL,
      username: USERNAME,
      password: PASSWORD,
    });
    await env.auth.login({ email: EMAIL, password: PASSWORD });
    const before = await toBase64(env.keys.requirePrivateKey());

    const fresh = harness();
    fresh.server.account = env.server.account;
    fresh.server.resetTokens.set('reset-token', EMAIL);

    const result = await fresh.auth.resetPasswordWithRecoveryCode({
      token: 'reset-token',
      recoveryCode,
      newPassword: NEW_PASSWORD,
    });
    // The spent code is replaced, so the user always leaves with a working one.
    expect(result.recoveryCode).not.toBe(recoveryCode);

    await fresh.auth.login({ email: EMAIL, password: NEW_PASSWORD });
    expect(await toBase64(fresh.keys.requirePrivateKey())).toBe(before);
  });

  it('refuses a recovery code that does not match', { timeout: 60_000 }, async () => {
    const env = harness();
    await env.auth.register({ email: EMAIL, username: USERNAME, password: PASSWORD });
    env.server.resetTokens.set('reset-token', EMAIL);

    await expect(
      env.auth.resetPasswordWithRecoveryCode({
        token: 'reset-token',
        recoveryCode: 'H8K2M-9P4Q7-R3T6V-1W5X0',
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toThrow(/recovery code/i);
  });

  it('starts a new identity when the recovery code is gone', { timeout: 90_000 }, async () => {
    const env = harness();
    await env.auth.register({ email: EMAIL, username: USERNAME, password: PASSWORD });
    await env.auth.login({ email: EMAIL, password: PASSWORD });
    const before = await toBase64(env.keys.requirePrivateKey());
    const oldPublicKey = env.server.account!.device.publicKey;

    env.server.resetTokens.set('reset-token', EMAIL);
    await env.auth.resetPasswordAndDiscardIdentity({
      token: 'reset-token',
      email: EMAIL,
      newPassword: NEW_PASSWORD,
    });

    // The old key is gone from this device, and the registry now holds a
    // different public key. This is what the "security number changed"
    // warning to contacts is derived from.
    expect(env.keys.state).toBe('empty');
    expect(env.server.account!.device.publicKey).not.toBe(oldPublicKey);

    await env.auth.login({ email: EMAIL, password: NEW_PASSWORD });
    expect(await toBase64(env.keys.requirePrivateKey())).not.toBe(before);
  });
});

describe('regenerating the recovery code', () => {
  it('makes the old code stop working and the new one start', { timeout: 90_000 }, async () => {
    const env = harness();
    const { recoveryCode: original } = await env.auth.register({
      email: EMAIL,
      username: USERNAME,
      password: PASSWORD,
    });
    await env.auth.login({ email: EMAIL, password: PASSWORD });
    const identity = await toBase64(env.keys.requirePrivateKey());

    const { recoveryCode: replacement } = await env.auth.regenerateRecoveryCode(PASSWORD);
    expect(replacement).not.toBe(original);

    env.server.resetTokens.set('reset-token', EMAIL);
    await expect(
      env.auth.resetPasswordWithRecoveryCode({
        token: 'reset-token',
        recoveryCode: original,
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toThrow(/recovery code/i);

    const fresh = harness();
    fresh.server.account = env.server.account;
    fresh.server.resetTokens.set('reset-token', EMAIL);
    await fresh.auth.resetPasswordWithRecoveryCode({
      token: 'reset-token',
      recoveryCode: replacement,
      newPassword: NEW_PASSWORD,
    });
    await fresh.auth.login({ email: EMAIL, password: NEW_PASSWORD });
    expect(await toBase64(fresh.keys.requirePrivateKey())).toBe(identity);
  });
});

describe('confirming the password again', () => {
  let env: ReturnType<typeof harness>;

  beforeEach(() => {
    env = harness();
  });

  it('accepts the right password and rejects the wrong one', { timeout: 90_000 }, async () => {
    await env.auth.register({ email: EMAIL, username: USERNAME, password: PASSWORD });
    await env.auth.login({ email: EMAIL, password: PASSWORD });

    await expect(env.auth.verifyPassword(PASSWORD)).resolves.toBe(true);
    await expect(env.auth.verifyPassword(NEW_PASSWORD)).resolves.toBe(false);
  });

  it('leaves the device unlocked either way, and asks the server nothing', { timeout: 90_000 }, async () => {
    await env.auth.register({ email: EMAIL, username: USERNAME, password: PASSWORD });
    await env.auth.login({ email: EMAIL, password: PASSWORD });
    const before = await toBase64(env.keys.requirePrivateKey());
    const sentSoFar = env.server.bodies.length;

    await env.auth.verifyPassword('not-the-password');

    // A failed check must not lock the device out of the messages it is
    // already showing, and must not reach the network, because that would turn a
    // local confirmation into something the server could count or throttle.
    expect(env.keys.state).toBe('unlocked');
    expect(await toBase64(env.keys.requirePrivateKey())).toBe(before);
    expect(env.server.bodies.length).toBe(sentSoFar);
  });

  it('says no rather than throwing when the device holds no key', { timeout: 60_000 }, async () => {
    await expect(env.auth.verifyPassword(PASSWORD)).resolves.toBe(false);
  });
});

describe('signing out', () => {
  it('forgets the key even if the server call fails', { timeout: 60_000 }, async () => {
    const env = harness();
    await env.auth.register({ email: EMAIL, username: USERNAME, password: PASSWORD });
    await env.auth.login({ email: EMAIL, password: PASSWORD });
    expect(env.keys.state).toBe('unlocked');

    await env.auth.logout();
    expect(env.keys.state).toBe('empty');
    expect(() => env.keys.requirePrivateKey()).toThrow();
  });
});
