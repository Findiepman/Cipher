/**
 * Who may call this API from a browser context.
 *
 * Two kinds of caller and they are not alike. The web app is served from
 * APP_URL and is same-origin with the API in production, so CORS never
 * enters into it there; the entry exists for development, where Vite and
 * Fastify sit on different ports. The desktop app is a page bundled into a
 * Tauri shell and served from the shell's own origin, which is fixed by
 * Tauri per operating system and is not a hostname anybody else can serve
 * from: `tauri://localhost` on macOS and Linux, `http://tauri.localhost` on
 * Windows (and `https://` if the shell is ever switched to that scheme).
 *
 * Letting those origins through is what lets the desktop app talk to the
 * deployed server at all. It grants them nothing else: a request from the
 * desktop carries no cookies (the client sends none across origins) and
 * authenticates with a bearer token it had to obtain by signing in, so the
 * CSRF plugin's reasoning about cookie-less callers applies unchanged.
 */
import { env } from '../env.js';

export const DESKTOP_ORIGINS = [
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
] as const;

export function allowedOrigins(): string[] {
  return [env.APP_URL, ...DESKTOP_ORIGINS];
}
