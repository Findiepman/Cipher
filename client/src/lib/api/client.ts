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
 *      cookies plus a CSRF header; the desktop shell has no usable cookie jar
 *      and uses `Authorization: Bearer`. One switch, set from env.
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

export class ApiClient {
  private readonly baseUrl: string;
  private readonly authMode: AuthMode;
  private readonly fetchImpl: typeof fetch;
  private readonly readCookies: () => string;

  private onSessionExpired: (() => void) | undefined;
  private accessToken: string | null = null;
  private accessTokenExpiresAt: number | null = null;
  private refreshToken: string | null = null;
  private refreshInFlight: Promise<boolean> | null = null;
  private readonly secretGuards = new Set<SecretGuard>();

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? config.apiUrl).replace(/\/+$/, '');
    this.authMode = options.authMode ?? config.authMode;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.readCookies =
      options.readCookies ?? (() => (typeof document === 'undefined' ? '' : document.cookie));
    this.onSessionExpired = options.onSessionExpired;
  }

  setSessionExpiredHandler(handler: () => void): void {
    this.onSessionExpired = handler;
  }

  /**
   * Access tokens are held in memory only, never localStorage, which any
   * injected script can read. A page reload costs one refresh call, which is
   * the correct trade.
   */
  setTokens(tokens: TokenPair | undefined): void {
    if (!tokens) return;
    this.accessToken = tokens.accessToken;
    this.accessTokenExpiresAt = Date.parse(tokens.accessTokenExpiresAt);
    this.refreshToken = tokens.refreshToken;
  }

  clearTokens(): void {
    this.accessToken = null;
    this.accessTokenExpiresAt = null;
    this.refreshToken = null;
  }

  get hasAccessToken(): boolean {
    return this.accessToken !== null;
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
