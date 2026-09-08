/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Fastify API, e.g. http://localhost:3000. */
  readonly VITE_API_URL?: string;
  /**
   * "cookie" for the web build (httpOnly refresh cookie + CSRF header),
   * "bearer" for the desktop app, whose page origin is not the API's, so the
   * browser would never attach the API's cookies to its requests.
   */
  readonly VITE_AUTH_MODE?: 'cookie' | 'bearer';
  /** "mock" runs the UI off local fixtures; "http" talks to the real server. */
  readonly VITE_BACKEND?: 'mock' | 'http';
  /**
   * "desktop" when this build is the one the Tauri shell bundles. It picks
   * the platform adapter (lib/platform) and nothing else: the UI is the same.
   */
  readonly VITE_PLATFORM?: 'web' | 'desktop';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
