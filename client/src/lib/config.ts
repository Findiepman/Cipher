/**
 * Runtime configuration, read once from Vite's env.
 *
 * `backend: "http"` is the default: the client and server now speak the same
 * protocol, so talking to server/ is the normal case. Set VITE_BACKEND=mock
 * (see .env.example) to run the chat UI off local fixtures with no server.
 * useful for pure design work, but nothing signs in in that mode.
 */

export type AuthMode = 'cookie' | 'bearer';
export type BackendMode = 'mock' | 'http';

function readEnv(): ImportMetaEnv {
  // Guarded so this module can also be imported from a plain Node context
  // (scripts, tests) where import.meta.env is not populated by Vite.
  return (import.meta.env ?? {}) as ImportMetaEnv;
}

const env = readEnv();

export const config = {
  /**
   * Where the API lives. An **empty string means same-origin**, which is what
   * the production build uses: one host serves the static client and proxies
   * `/auth`, `/socket.io` and the rest to Fastify. That is not a cosmetic
   * choice: same-origin is what keeps the auth cookies first-party, removes
   * CORS entirely, and makes `SameSite=Lax` an actual defence, which matters
   * while CSRF tokens are still unbuilt (backend-plan.md step 6).
   *
   * Development is genuinely cross-origin (Vite on :5173, Fastify on :3000),
   * so leaving the variable unset keeps the localhost default.
   */
  apiUrl: (env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
  authMode: (env.VITE_AUTH_MODE ?? 'cookie') as AuthMode,
  backend: (env.VITE_BACKEND ?? 'http') as BackendMode,
} as const;

export const isMockBackend = config.backend === 'mock';

/**
 * True only in `vite dev`. Vite substitutes this at build time, so anything
 * guarded by it is dropped from the production bundle entirely.
 *
 * Written as the literal `import.meta.env.DEV` rather than read off the `env`
 * object above, because only the literal form is substituted at build time -
 * which is what lets the minifier drop the guarded branch entirely.
 *
 * Use it for developer affordances - notes about `.mail/`, fixture switches -
 * that would be confusing or wrong in front of a real user.
 */
export const isDevelopment = import.meta.env?.DEV === true;

/** True when the client and the API are served by the same host. */
export const isSameOrigin = config.apiUrl === '';
