/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Fastify API, e.g. http://localhost:3000. */
  readonly VITE_API_URL?: string;
  /**
   * "cookie" for the web build (httpOnly refresh cookie + CSRF header),
   * "bearer" for the desktop shell, which has no cookie jar to rely on.
   */
  readonly VITE_AUTH_MODE?: 'cookie' | 'bearer';
  /** "mock" runs the UI off local fixtures; "http" talks to the real server. */
  readonly VITE_BACKEND?: 'mock' | 'http';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
