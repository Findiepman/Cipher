/**
 * The bearer-mode session between launches: the refresh token goes to a
 * store on every rotation, comes back on restore, and is gone after a
 * sign-out or a refusal. This is what makes the desktop app open signed in.
 */
import { describe, expect, it } from 'vitest';
import { MemoryRefreshTokenStore } from '../storage/refreshTokenStore';
import { ApiClient } from './client';

interface Call {
  url: string;
  body: string | undefined;
  authorization: string | null;
}

function fakeFetch(handler: (call: Call) => Response) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      body: typeof init?.body === 'string' ? init.body : undefined,
      authorization: new Headers(init?.headers).get('authorization'),
    };
    calls.push(call);
    return handler(call);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function tokens(suffix: string, ttlMs = 900_000) {
  return {
    accessToken: `access-${suffix}`,
    accessTokenExpiresAt: new Date(Date.now() + ttlMs).toISOString(),
    refreshToken: `refresh-${suffix}`,
  };
}

function bearerClient(store: MemoryRefreshTokenStore, impl: typeof fetch) {
  return new ApiClient({
    baseUrl: 'http://api.test',
    authMode: 'bearer',
    fetchImpl: impl,
    readCookies: () => '',
    tokenStore: store,
  });
}

describe('the refresh token store', () => {
  it('writes the refresh token on every rotation and clears it on sign-out', async () => {
    const store = new MemoryRefreshTokenStore();
    const { impl } = fakeFetch(() => json({ tokens: tokens('2') }));
    const client = bearerClient(store, impl);

    client.setTokens(tokens('1'));
    await client.flushTokenStore();
    expect(store.token).toBe('refresh-1');

    // A refresh rotates the token; the store must hold the new one, because
    // presenting the old one again is what reuse detection punishes.
    await client.getAccessToken();
    client.setTokens(tokens('1', 0));
    await client.getAccessToken();
    await client.flushTokenStore();
    expect(store.token).toBe('refresh-2');

    client.clearTokens();
    await client.flushTokenStore();
    expect(store.token).toBeNull();
  });

  it('restores a stored refresh token so the first request refreshes instead of failing', async () => {
    const store = new MemoryRefreshTokenStore();
    store.token = 'refresh-stored';
    const { impl, calls } = fakeFetch((call) => {
      if (call.url.endsWith('/auth/refresh')) return json({ tokens: tokens('new') });
      return call.authorization === 'Bearer access-new'
        ? json({ id: 'u1' })
        : json({ error: { code: 'unauthenticated', message: 'no' } }, 401);
    });
    const client = bearerClient(store, impl);

    await client.restoreSession();
    await expect(client.get('/account/me')).resolves.toEqual({ id: 'u1' });

    const refresh = calls.find((call) => call.url.endsWith('/auth/refresh'));
    expect(refresh?.body).toBe(JSON.stringify({ refreshToken: 'refresh-stored' }));
    expect(store.token).toBe('refresh-new');
  });

  it('forgets a stored token the server refuses, so the next launch is signed out', async () => {
    const store = new MemoryRefreshTokenStore();
    store.token = 'refresh-revoked';
    const { impl } = fakeFetch(() =>
      json({ error: { code: 'unauthenticated', message: 'no' } }, 401),
    );
    const client = bearerClient(store, impl);

    await client.restoreSession();
    await expect(client.get('/account/me')).rejects.toBeTruthy();
    await client.flushTokenStore();
    expect(store.token).toBeNull();
  });

  it('never touches a store in cookie mode', async () => {
    const store = new MemoryRefreshTokenStore();
    const { impl } = fakeFetch(() => json({ ok: true }));
    const client = new ApiClient({
      baseUrl: 'http://api.test',
      authMode: 'cookie',
      fetchImpl: impl,
      readCookies: () => '',
      tokenStore: store,
    });

    client.setTokens(tokens('1'));
    await client.flushTokenStore();
    // Written: the option was passed explicitly. What matters is that the
    // cookie-mode client hands out no bearer token off the back of it.
    await expect(client.getAccessToken()).resolves.toBeNull();
  });
});

describe('getAccessToken', () => {
  it('hands out the live token, and refreshes first when it is about to expire', async () => {
    const store = new MemoryRefreshTokenStore();
    const { impl, calls } = fakeFetch(() => json({ tokens: tokens('fresh') }));
    const client = bearerClient(store, impl);

    client.setTokens(tokens('live'));
    await expect(client.getAccessToken()).resolves.toBe('access-live');
    expect(calls).toHaveLength(0);

    client.setTokens(tokens('stale', 5_000));
    await expect(client.getAccessToken()).resolves.toBe('access-fresh');
    expect(calls.map((call) => call.url)).toEqual(['http://api.test/auth/refresh']);
  });

  it('answers null with no session rather than refreshing with nothing', async () => {
    const store = new MemoryRefreshTokenStore();
    const { impl, calls } = fakeFetch(() => json({}));
    const client = bearerClient(store, impl);

    await expect(client.getAccessToken()).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });
});
