import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, readCookie } from './client';
import { ApiError, SecretLeakError } from './errors';

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: string | undefined;
}

/** A fetch stand-in that records calls and replays queued responses. */
// Handlers may be async: the single-flight test needs one that stalls mid
// refresh so the concurrent 401s actually overlap.
function fakeFetch(handler: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    calls.push(call);
    return handler(call, calls.length - 1);
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('readCookie', () => {
  it('pulls one value out of a cookie string', () => {
    expect(readCookie('a=1; csrf_token=abc123; b=2', 'csrf_token')).toBe('abc123');
    expect(readCookie('a=1', 'csrf_token')).toBeNull();
    expect(readCookie('csrf_token=a%20b', 'csrf_token')).toBe('a b');
  });
});

describe('headers', () => {
  it('sends the CSRF token on mutations in cookie mode, but not on reads', async () => {
    const { impl, calls } = fakeFetch(() => json({ ok: true }));
    const client = new ApiClient({
      baseUrl: 'http://api.test',
      authMode: 'cookie',
      fetchImpl: impl,
      readCookies: () => 'csrf_token=tok-123',
    });

    await client.get('/account/me');
    await client.post('/auth/logout');

    expect(calls[0].headers.get('x-csrf-token')).toBeNull();
    expect(calls[1].headers.get('x-csrf-token')).toBe('tok-123');
  });

  it('uses a bearer token instead of cookies in bearer mode', async () => {
    const { impl, calls } = fakeFetch(() => json({ ok: true }));
    const client = new ApiClient({
      baseUrl: 'http://api.test',
      authMode: 'bearer',
      fetchImpl: impl,
      readCookies: () => 'csrf_token=tok-123',
    });
    client.setTokens({
      accessToken: 'access-1',
      accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
      refreshToken: 'refresh-1',
    });

    await client.post('/account/me');

    expect(calls[0].headers.get('authorization')).toBe('Bearer access-1');
    expect(calls[0].headers.get('x-csrf-token')).toBeNull();
  });

  it('builds query strings and encodes path segments', async () => {
    const { impl, calls } = fakeFetch(() => json({ items: [] }));
    const client = new ApiClient({ baseUrl: 'http://api.test', fetchImpl: impl });

    await client.get('/admin/users', { query: { q: 'a b', page: 2, status: undefined } });

    expect(calls[0].url).toBe('http://api.test/admin/users?q=a+b&page=2');
  });

  // The production build ships VITE_API_URL empty and is served by the host
  // that also proxies the API. That used to throw: `new URL('/auth/login')`
  // with no base is a TypeError, so the whole app would have failed on its
  // first request rather than anywhere findable.
  it('resolves paths against the page origin when the base is empty', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://chat.example.com' } });

    const { impl, calls } = fakeFetch(() => json({ ok: true }));
    const client = new ApiClient({ baseUrl: '', fetchImpl: impl });

    await client.get('/conversations', { query: { limit: 20 } });

    expect(calls[0].url).toBe('https://chat.example.com/conversations?limit=20');

    vi.unstubAllGlobals();
  });
});

describe('token refresh', () => {
  it('refreshes once and retries the original request', async () => {
    let refreshed = false;
    const { impl, calls } = fakeFetch((call) => {
      if (call.url.endsWith('/auth/refresh')) {
        refreshed = true;
        return json({ tokens: null });
      }
      return refreshed ? json({ id: 'u1' }) : json({ error: { code: 'unauthorized', message: 'no' } }, 401);
    });
    const client = new ApiClient({ baseUrl: 'http://api.test', fetchImpl: impl });

    await expect(client.get('/account/me')).resolves.toEqual({ id: 'u1' });
    expect(calls.map((c) => c.url)).toEqual([
      'http://api.test/account/me',
      'http://api.test/auth/refresh',
      'http://api.test/account/me',
    ]);
  });

  it('single-flights the refresh across concurrent 401s', async () => {
    // This is the one that matters: the backend rotates refresh tokens and
    // treats a replay as an attack by revoking the whole session family. Five
    // parallel refreshes would log the user out.
    let refreshed = false;
    const { impl, calls } = fakeFetch(async (call) => {
      if (call.url.endsWith('/auth/refresh')) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        refreshed = true;
        return json({ tokens: null });
      }
      return refreshed ? json({ ok: true }) : json({ error: { code: 'unauthorized', message: 'no' } }, 401);
    });
    const client = new ApiClient({ baseUrl: 'http://api.test', fetchImpl: impl });

    await Promise.all([
      client.get('/account/me'),
      client.get('/account/sessions'),
      client.get('/keys/user/u1'),
      client.get('/admin/users'),
      client.get('/account/me'),
    ]);

    const refreshCalls = calls.filter((call) => call.url.endsWith('/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
  });

  it('gives up after one retry and reports the session as expired', async () => {
    const onSessionExpired = vi.fn();
    const { impl, calls } = fakeFetch((call) =>
      call.url.endsWith('/auth/refresh')
        ? json({ error: { code: 'invalid_token', message: 'nope' } }, 401)
        : json({ error: { code: 'unauthorized', message: 'no' } }, 401),
    );
    const client = new ApiClient({ baseUrl: 'http://api.test', fetchImpl: impl, onSessionExpired });
    client.setTokens({
      accessToken: 'a',
      accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
      refreshToken: 'r',
    });

    await expect(client.get('/account/me')).rejects.toBeInstanceOf(ApiError);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(client.hasAccessToken).toBe(false);
    // One original call, one refresh — and no retry loop.
    expect(calls).toHaveLength(2);
  });

  it('does not try to refresh the refresh call itself', async () => {
    const { impl, calls } = fakeFetch(() => json({ error: { code: 'invalid_token', message: 'x' } }, 401));
    const client = new ApiClient({ baseUrl: 'http://api.test', fetchImpl: impl });

    await expect(client.post('/auth/refresh')).rejects.toBeInstanceOf(ApiError);
    expect(calls).toHaveLength(1);
  });
});

describe('errors', () => {
  let client: ApiClient;
  let calls: Call[];

  beforeEach(() => {
    const fake = fakeFetch(() => json({ error: { code: 'weak_password', message: 'Too weak' } }, 400));
    client = new ApiClient({ baseUrl: 'http://api.test', fetchImpl: fake.impl });
    calls = fake.calls;
  });

  it('surfaces the machine-readable code from our envelope', async () => {
    await expect(client.post('/auth/register', { email: 'a@b.c' })).rejects.toMatchObject({
      code: 'weak_password',
      message: 'Too weak',
      status: 400,
    });
    expect(calls).toHaveLength(1);
  });

  it('falls back to Fastify default error bodies', async () => {
    const { impl } = fakeFetch(() =>
      json({ statusCode: 403, error: 'Forbidden', message: 'admin only' }, 403),
    );
    const fallbackClient = new ApiClient({ baseUrl: 'http://api.test', fetchImpl: impl });
    await expect(fallbackClient.get('/admin/users')).rejects.toMatchObject({
      status: 403,
      message: 'admin only',
    });
  });

  it('turns a dead connection into a transient ApiError', async () => {
    const impl = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const offline = new ApiClient({ baseUrl: 'http://api.test', fetchImpl: impl });

    const error = await offline.get('/account/me').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).isTransient).toBe(true);
  });

  it('treats 429 and 5xx as transient, and 400 as not', () => {
    expect(new ApiError(429, 'rate_limited', 'slow down').isTransient).toBe(true);
    expect(new ApiError(503, 'server_error', 'down').isTransient).toBe(true);
    expect(new ApiError(400, 'validation_failed', 'bad').isTransient).toBe(false);
  });
});

describe('outgoing secret guard', () => {
  it('refuses to send a body containing a registered secret, and never calls fetch', async () => {
    const { impl, calls } = fakeFetch(() => json({ ok: true }));
    const client = new ApiClient({ baseUrl: 'http://api.test', fetchImpl: impl });
    const privateKey = 'c3VwZXItc2VjcmV0LXByaXZhdGUta2V5LWJ5dGVz';
    client.registerSecretGuard(() => [privateKey]);

    await expect(
      client.post('/keys/device', { label: 'laptop', wrappedPrivateKey: privateKey }),
    ).rejects.toBeInstanceOf(SecretLeakError);
    expect(calls).toHaveLength(0);
  });

  it('lets ordinary bodies through', async () => {
    const { impl, calls } = fakeFetch(() => json({ ok: true }));
    const client = new ApiClient({ baseUrl: 'http://api.test', fetchImpl: impl });
    client.registerSecretGuard(() => ['a-very-secret-value']);

    await client.post('/auth/login', { email: 'a@b.c', authHash: 'hash' });
    expect(calls).toHaveLength(1);
  });

  it('ignores short secrets, which would false-positive on everything', async () => {
    const { impl, calls } = fakeFetch(() => json({ ok: true }));
    const client = new ApiClient({ baseUrl: 'http://api.test', fetchImpl: impl });
    client.registerSecretGuard(() => ['abc']);

    await client.post('/auth/login', { email: 'abc@b.c' });
    expect(calls).toHaveLength(1);
  });

  it('stops guarding once unregistered', async () => {
    const { impl, calls } = fakeFetch(() => json({ ok: true }));
    const client = new ApiClient({ baseUrl: 'http://api.test', fetchImpl: impl });
    const unregister = client.registerSecretGuard(() => ['a-very-secret-value']);
    unregister();

    await client.post('/debug', { note: 'a-very-secret-value' });
    expect(calls).toHaveLength(1);
  });
});
