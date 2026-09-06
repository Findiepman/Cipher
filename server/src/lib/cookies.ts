import type { FastifyReply } from 'fastify';
import { env } from '../env.js';

export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';

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

export function clearAuthCookies(reply: FastifyReply): void {
  reply.clearCookie(ACCESS_COOKIE, { ...base, path: '/' });
  reply.clearCookie(REFRESH_COOKIE, { ...base, path: REFRESH_PATH });
}
