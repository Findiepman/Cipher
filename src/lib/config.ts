/**
 * Runtime configuration, read once from Vite's env.
 *
 * `backend: "mock"` is the default so the UI runs with no server at all — the
 * frontend and the backend are being built in parallel and neither should block
 * the other. Flip VITE_BACKEND=http (see .env.example) to talk to server/.
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
  backend: (env.VITE_BACKEND ?? 'mock') as BackendMode,
} as const;

export const isMockBackend = config.backend === 'mock';
