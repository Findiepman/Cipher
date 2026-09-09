/**
 * The HTTP client every API call goes through.
 *
 * It owns four things that are easy to get subtly wrong and expensive to fix
 * once they are scattered across feature code:
 *
 *   1. Access-token refresh, single-flighted. Ten components hitting a 401 at
 *      once produce one refresh, not ten. Ten of them would trip the
 *      backend's refresh-token reuse detection, which revokes the whole session
 *      family (backend-plan.md, "Auth mechanics"). Getting this wrong logs the
 *      user out rather than degrading quietly.
 *   2. Cookie vs. bearer transport. The web build authenticates with httpOnly
 *      cookies plus a CSRF header; the desktop app is served from its own
 *      origin, so the WebView would never attach the API's cookies, and it
 *      uses `Authorization: Bearer` instead. One switch, set from env. In
 *      bearer mode the refresh token is also written to a store so the
 *      session survives a restart, see lib/storage/refreshTokenStore.ts.
 *   3. Uniform errors: see ApiError.
 *   4. The outgoing-secret guard. Registered secrets (the private key, the
 *      password, the recovery code) are checked against every request body
 *      before it is sent. client/AGENTS.md asks for a test proving the private
 *      key is never transmitted; this makes it structurally true, and the test
 *      then verifies the guard rather than a single code path.
 */
import { ApiError, SecretLeakError } from './errors';
import type { RefreshResponse, TokenPair } from './types';
import { config, type AuthMode } from '../config';
import { SecureRefreshTokenStore, type RefreshTokenStore } from '../storage/refreshTokenStore';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Set on the retry after a refresh, so a second 401 cannot loop. */
  skipRefresh?: boolean;
}

export interface ApiClientOptions {
  baseUrl?: string;
  authMode?: AuthMode;
  fetchImpl?: typeof fetch;
  /** Overridable so tests can supply a cookie string without a DOM. */
  readCookies?: () => string;
  /** Called when a refresh fails and the session is genuinely over. */
  onSessionExpired?: () => void;
  /**
   * Where the refresh token is kept between launches, in bearer mode. Left
   * out, the client picks the IndexedDB-backed store where there is an
   * IndexedDB and keeps the token in memory only elsewhere (tests, Node).
   * Pass null to keep it in memory on purpose.
   */
  tokenStore?: RefreshTokenStore | null;
}

/** Anything registered here is refused if it appears in a request body. */
export type SecretGuard = () => readonly string[];

const DEFAULT_TIMEOUT_MS = 15_000;
/** Refresh this far ahead of expiry rather than waiting for a 401. */
const REFRESH_SKEW_MS = 30_000;
const CSRF_COOKIE = 'csrf_token';
const CSRF_HEADER = 'x-csrf-token';

/**
 * Base for resolving same-origin request paths.
 *
 * Only reached when `baseUrl` is empty, which happens in the browser. Node
 * contexts (tests, scripts) always construct the client with an explicit
 * baseUrl, so the fallback just has to be a syntactically valid origin.
 */
function pageOrigin(): string {
  return typeof window === 'undefined'
    ? 'http://localhost'
    : window.location.origin;
}

function defaultTokenStore(authMode: AuthMode): RefreshTokenStore | null {
  if (authMode !== 'bearer' || typeof indexedDB === 'undefined') return null;
  return new SecureRefreshTokenStore();
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly authMode: AuthMode;
  private readonly fetchImpl: typeof fetch;
  private readonly readCookies: () => string;
  private readonly tokenStore: RefreshTokenStore | null;

  private onSessionExpired: (() => void) | undefined;
  private accessToken: string | null = null;
  private accessTokenExpiresAt: number | null = null;
  private refreshToken: string | null = null;
  private refreshInFlight: Promise<boolean> | null = null;
  /** The last write to the token store, so a restore never races it. */
  private storeWrite: Promise<void> = Promise.resolve();
  private readonly secretGuards = new Set<SecretGuard>();

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? config.apiUrl).replace(/\/+$/, '');
    this.authMode = options.authMode ?? config.authMode;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.readCookies =
      options.readCookies ?? (() => (typeof document === 'undefined' ? '' : document.cookie));
    this.onSessionExpired = options.onSessionExpired;
    this.tokenStore =
      options.tokenStore === undefined ? defaultTokenStore(this.authMode) : options.tokenStore;
  }

  setSessionExpiredHandler(handler: () => void): void {
    this.onSessionExpired = handler;
  }

  /**
   * Access tokens are held in memory only, never localStorage, which any
   * injected script can read. A page reload costs one refresh call, which is
   * the correct trade.
   *
   * The refresh token is different: in bearer mode it is the whole session,
   * and a session that dies with the process is a sign-in per launch. It goes
   * to the token store, whose file says exactly what that means.
   */
  setTokens(tokens: TokenPair | undefined): void {
    if (!tokens) return;
    this.accessToken = tokens.accessToken;
    this.accessTokenExpiresAt = Date.parse(tokens.accessTokenExpiresAt);
    this.refreshToken = tokens.refreshToken;
    this.persist((store) => store.save(tokens.refreshToken));
  }

  clearTokens(): void {
    this.accessToken = null;
    this.accessTokenExpiresAt = null;
    this.refreshToken = null;
    this.persist((store) => store.clear());
  }

  /**
   * Picks up the refresh token a previous launch left in the store, so the
   * first request can refresh instead of failing. A no-op in cookie mode and
   * wherever there is no store. Call it once, before the first request.
   */
  async restoreSession(): Promise<void> {
    if (!this.tokenStore || this.refreshToken) return;
    await this.storeWrite;
    try {
      const stored = await this.tokenStore.load();
      if (stored && !this.refreshToken) this.refreshToken = stored;
    } catch {
      // A store that cannot be read is a signed-out launch, not an error.
    }
  }

  get hasAccessToken(): boolean {
    return this.accessToken !== null;
  }

  /**
   * A token fit to present right now, refreshing first if the current one is
   * about to expire or if only a refresh token is held. For the socket
   * handshake, which reconnects on its own long after the token it was
   * created with has expired. Null in cookie mode, and when there is no
   * session to speak of.
   */
  async getAccessToken(): Promise<string | null> {
    if (this.authMode !== 'bearer') return null;
    const stale =
      this.accessTokenExpiresAt !== null &&
      this.accessTokenExpiresAt - Date.now() <= REFRESH_SKEW_MS;
    if ((this.accessToken === null || stale) && this.refreshToken) {
      await this.ensureRefreshed();
    }
    return this.accessToken;
  }

  /** Returns an unregister function. */
  registerSecretGuard(guard: SecretGuard): () => void {
    this.secretGuards.add(guard);
    return () => {
      this.secretGuards.delete(guard);
    };
  }

  get<T>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  post<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }

  patch<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PATCH', body });
  }

  put<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PUT', body });
  }

  delete<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE', body });
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? 'GET';
    const serializedBody = this.serializeBody(path, options.body);

    if (this.shouldRefreshProactively(path, options)) {
      await this.ensureRefreshed();
    }

    const response = await this.send(path, method, serializedBody, options);

    if (response.status === 401 && !options.skipRefresh && !isRefreshCall(path)) {
      const refreshed = await this.ensureRefreshed();
      if (refreshed) {
        const retry = await this.send(path, method, serializedBody, {
          ...options,
          skipRefresh: true,
        });
        return this.parse<T>(retry);
      }
      this.clearTokens();
      this.onSessionExpired?.();
    }

    return this.parse<T>(response);
  }

  /* ------------------------------------------------------------ internals -- */

  private async send(
    path: string,
    method: HttpMethod,
    body: string | undefined,
    options: RequestOptions,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const abortFromCaller = () => controller.abort();
    options.signal?.addEventListener('abort', abortFromCaller);

    try {
      return await this.fetchImpl(this.url(path, options.query), {
        method,
        body,
        headers: this.headers(method, body !== undefined),
        // Cookie mode needs the httpOnly refresh cookie to ride along; bearer
        // mode deliberately does not send cookies at all.
        credentials: this.authMode === 'cookie' ? 'include' : 'omit',
        signal: controller.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw ApiError.timeout('The request was cancelled');
      if (isAbortError(error)) throw ApiError.timeout();
      throw ApiError.network();
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  private async parse<T>(response: Response): Promise<T> {
    if (response.status === 204 || response.headers.get('content-length') === '0') {
      if (!response.ok) throw ApiError.fromBody(response.status, null);
      return undefined as T;
    }

    const text = await response.text().catch(() => '');
    let body: unknown = null;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { message: text };
      }
    }

    if (!response.ok) throw ApiError.fromBody(response.status, body);
    return body as T;
  }

  private url(path: string, query: RequestOptions['query']): string {
    const relative = path.startsWith('/') ? path : `/${path}`;
    // `baseUrl` is empty in the same-origin production build, and `new URL()`
    // cannot parse a bare path without a base. Supplying one unconditionally
    // costs nothing when baseUrl is absolute (an absolute first argument
    // makes the base irrelevant) and is the whole fix when it is not.
    const url = new URL(`${this.baseUrl}${relative}`, pageOrigin());
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private headers(method: HttpMethod, hasBody: boolean): Headers {
    const headers = new Headers({ accept: 'application/json' });
    if (hasBody) headers.set('content-type', 'application/json');

    if (this.authMode === 'bearer' && this.accessToken) {
      headers.set('authorization', `Bearer ${this.accessToken}`);
    }

    // CSRF only matters where the browser attaches credentials on its own.
    if (this.authMode === 'cookie' && method !== 'GET') {
      const token = readCookie(this.readCookies(), CSRF_COOKIE);
      if (token) headers.set(CSRF_HEADER, token);
    }

    return headers;
  }

  private serializeBody(path: string, body: unknown): string | undefined {
    if (body === undefined) return undefined;
    const serialized = JSON.stringify(body);
    this.assertNoSecrets(path, serialized);
    return serialized;
  }

  private assertNoSecrets(path: string, serialized: string): void {
    for (const guard of this.secretGuards) {
      for (const secret of guard()) {
        // Short strings would false-positive constantly; the values this
        // protects (base64 keys, passwords, recovery codes) are all longer.
        if (secret.length >= 8 && serialized.includes(secret)) {
          throw new SecretLeakError(path);
        }
      }
    }
  }

  private shouldRefreshProactively(path: string, options: RequestOptions): boolean {
    if (this.authMode !== 'bearer' || options.skipRefresh || isRefreshCall(path)) return false;
    if (!this.accessToken || this.accessTokenExpiresAt === null) return false;
    return this.accessTokenExpiresAt - Date.now() <= REFRESH_SKEW_MS;
  }

  /**
   * Single-flight refresh. Concurrent callers await the same promise, so the
   * backend sees exactly one use of the refresh token, which is what keeps
   * rotation-with-reuse-detection from mistaking us for a replay attack.
   */
  private ensureRefreshed(): Promise<boolean> {
    if (this.refreshInFlight) return this.refreshInFlight;

    this.refreshInFlight = this.doRefresh().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async doRefresh(): Promise<boolean> {
    try {
      const body =
        this.authMode === 'bearer' && this.refreshToken
          ? JSON.stringify({ refreshToken: this.refreshToken })
          : undefined;
      const response = await this.send('/auth/refresh', 'POST', body, { skipRefresh: true });
      if (!response.ok) return false;
      const parsed = await this.parse<RefreshResponse>(response);
      this.setTokens(parsed?.tokens);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Writes are serialized and never awaited by callers: a token change must
   * not block on storage, and a failed write leaves the next launch signed
   * out, which is the safe direction to fail in.
   */
  private persist(action: (store: RefreshTokenStore) => Promise<void>): void {
    const store = this.tokenStore;
    if (!store) return;
    this.storeWrite = this.storeWrite.then(() => action(store)).catch(() => {});
  }

  /** Waits for pending token writes. For tests. */
  flushTokenStore(): Promise<void> {
    return this.storeWrite;
  }
}

function isRefreshCall(path: string): boolean {
  return path.startsWith('/auth/refresh');
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function readCookie(cookieString: string, name: string): string | null {
  for (const part of cookieString.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/** The client the app uses. Tests construct their own with a fake fetch. */
export const api = new ApiClient();
