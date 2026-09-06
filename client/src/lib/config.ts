/**
 * Runtime configuration, read once from Vite's env.
 *
 * `backend: "http"` is the default: the client and server now speak the same
 * protocol, so talking to server/ is the normal case. Set VITE_BACKEND=mock
 * (see .env.example) to run the chat UI off local fixtures with no server —
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
  apiUrl: (env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
  authMode: (env.VITE_AUTH_MODE ?? 'cookie') as AuthMode,
  backend: (env.VITE_BACKEND ?? 'http') as BackendMode,
} as const;

export const isMockBackend = config.backend === 'mock';
