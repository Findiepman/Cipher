/**
 * Where a bearer-mode session lives between launches.
 *
 * The web build never uses this: its refresh token is an httpOnly cookie the
 * browser keeps and attaches on its own. The desktop build is cross-origin
 * by construction (the page is served from the app's own origin, the API is
 * the deployed site), so the WebView would never attach the API's cookies,
 * and the client holds the refresh token itself. Held only in memory, every
 * launch of the app would be a sign-in. That is not a desktop app, so it is
 * written here.
 *
 * What is written is the refresh token, in the clear, in the WebView's
 * IndexedDB. Be honest about what that is: the same thing a browser's cookie
 * jar is, a credential on disk in the app's own profile directory, readable
 * by any process running as the user. The OS keychain would be better and is
 * the planned improvement (desktop/AGENTS.md); it is not bolted on here
 * because it should replace the device key at the same time. Nothing else in
 * `SecureStore` is raw, and this file is the one documented exception.
 *
 * Reuse detection on the server makes a stolen copy loud rather than silent:
 * the first refresh by whichever side does not hold the newest token revokes
 * the whole session family, and the account is signed out everywhere.
 */
import { createSecureStore, type SecureStore } from './secureStore';

const STORAGE_KEY = 'session/refresh-token/v1';

export interface RefreshTokenStore {
  load(): Promise<string | null>;
  save(refreshToken: string): Promise<void>;
  clear(): Promise<void>;
}

export class SecureRefreshTokenStore implements RefreshTokenStore {
  constructor(private readonly store: SecureStore = createSecureStore()) {}

  load(): Promise<string | null> {
    return this.store.get(STORAGE_KEY);
  }

  save(refreshToken: string): Promise<void> {
    return this.store.set(STORAGE_KEY, refreshToken);
  }

  clear(): Promise<void> {
    return this.store.remove(STORAGE_KEY);
  }
}

/** In-memory, for tests. */
export class MemoryRefreshTokenStore implements RefreshTokenStore {
  token: string | null = null;

  async load(): Promise<string | null> {
    return this.token;
  }

  async save(refreshToken: string): Promise<void> {
    this.token = refreshToken;
  }

  async clear(): Promise<void> {
    this.token = null;
  }
}
