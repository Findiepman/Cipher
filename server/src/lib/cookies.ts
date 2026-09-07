import type { FastifyReply } from 'fastify';
import { env } from '../env.js';

export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';
export const CSRF_COOKIE = 'csrf_token';

/// The refresh cookie is scoped to /auth so it is never attached to ordinary
/// API calls - only the endpoints that actually need it can see it.
const REFRESH_PATH = '/auth';

const base = {
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: 'lax' as const,
  ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
};

export function setAuthCookies(
  reply: FastifyReply,
  tokens: { accessToken: string; refreshToken: string; refreshExpiresAt: Date },
): void {
  reply.setCookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base,
    path: '/',
    maxAge: env.ACCESS_TOKEN_TTL_MINUTES * 60,
  });

  reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base,
    path: REFRESH_PATH,
    expires: tokens.refreshExpiresAt,
  });
}

/// The CSRF cookie, and the one place in this file where `httpOnly` is false.
///
/// That is not an oversight. The double submit check compares this cookie
/// against a header the page sets, and the page can only set that header if its
/// own script can read the value: a cookie the script cannot read is a cookie
/// the script cannot echo back. Exposing it costs nothing, because it is not a
/// credential. On its own it authorizes nothing. All it proves is that the
/// caller was able to read this origin's cookies, which is exactly the thing a
/// cross-site attacker cannot do.
///
/// Path is '/' rather than the refresh cookie's '/auth', because every
/// state-changing route has to see it. The two are separate cookies with
/// separate attributes, so this does not widen the refresh cookie's scope.
export function setCsrfCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(CSRF_COOKIE, token, {
    ...base,
    httpOnly: false,
    path: '/',
    // Outlives the longest session it could be asked to protect. The plugin
    // also re-sends it on every response, so the window slides with use.
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
  });
}

export function clearAuthCookies(reply: FastifyReply): void {
  reply.clearCookie(ACCESS_COOKIE, { ...base, path: '/' });
  reply.clearCookie(REFRESH_COOKIE, { ...base, path: REFRESH_PATH });
}
