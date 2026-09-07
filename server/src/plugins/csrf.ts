/**
 * CSRF: the double submit cookie check.
 *
 * The threat this closes is ambient authority. A browser attaches the session
 * cookies to a request whether the page that made it belongs to us or not, so
 * a form on someone else's site can spend a signed-in user's credentials
 * without ever reading a response. `SameSite=Lax` and the CORS allowlist both
 * push back on that, but neither is a check we perform: one is the browser's
 * promise and the other only governs what script may read.
 *
 * So every state-changing request has to carry proof that whoever built it
 * could read this origin's cookies. This plugin issues a random token in a
 * script-readable cookie (see setCsrfCookie for why that one is not httpOnly),
 * and requires the same value back in the `x-csrf-token` header, which is
 * something only same-origin script can set.
 *
 * Two decisions worth reading before changing anything here:
 *
 *  1. The token is (re-)sent on *every* response, not only where a route sets
 *     a session. Issuing it on login would leave anyone whose first call is a
 *     write with no token to send, and it would tie this plugin to a route
 *     file. Re-sending it on every response also slides its lifetime forward,
 *     so a session that stays alive for months cannot outlive the cookie that
 *     lets it write.
 *  2. A request that arrives with no cookies at all is not checked. There is
 *     nothing ambient to abuse: that request is either unauthenticated, or it
 *     is a bearer caller (the desktop shell, the smoke scripts, the test
 *     suite) that had to hold the token itself to send it. This is not a
 *     bypass, because a cross-site page cannot make the victim's browser drop
 *     its cookies. It can only fail to read them.
 *
 * Socket.io is not covered here and does not need to be. It attaches to the
 * raw HTTP server and intercepts /socket.io/* before Fastify routes anything,
 * so its handshake and its polling POSTs never reach this hook. It guards
 * itself in realtime/index.ts, where the handshake has to present an access
 * token that same-origin script had to supply.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { CSRF_COOKIE, setCsrfCookie } from '../lib/cookies.js';
import { forbidden } from '../lib/errors.js';

export const CSRF_HEADER = 'x-csrf-token';

/// GET, HEAD and OPTIONS change nothing, and OPTIONS is also the CORS
/// preflight, which the browser sends with no headers of ours on it at all.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The endpoints that are checked by their own contents rather than by a cookie.
 *
 * The rule for being on this list is narrow and it is not "this route is
 * public": it is that the request carries no ambient authority, so there is
 * nothing for a forged copy of it to spend. Every entry below authorizes
 * itself entirely out of its own body (an authHash, or a token from an email),
 * and every one of them is reachable as the very first thing a browser ever
 * says to this API, before any response could have handed it a token.
 *
 * Which is why /auth/refresh and /auth/logout are deliberately *not* here.
 * Both are authorized by the refresh cookie, which is exactly the ambient
 * authority this plugin exists to protect, and the client reaches both only
 * after `GET /account/me` on first paint has already left it holding a token.
 *
 * The health checks need no entry either: they are GET, so the safe-method
 * rule above already covers them.
 */
const EXEMPT = new Set([
  // A brand new visitor. The client is served by Caddy, not by this process,
  // so a first-time browser has never had a response from us to set a cookie.
  'POST /auth/register',
  // Same, and this is the call that creates the ambient authority in the
  // first place, so there is none yet to forge.
  'POST /auth/login',
  // Reached from a link in an email, often in a different browser than the
  // one that registered. Its authority is the token in the body.
  'POST /auth/verify-email',
  'POST /auth/resend-verification',
  // The password reset flow, same shape: opened from an email, authorized by
  // a token or a recovery code in the body. Listed ahead of the routes so the
  // flow does not have to think about this plugin when it lands.
  'POST /auth/forgot-password',
  'POST /auth/reset-password',
  'POST /auth/reset-password/context',
]);

function issueToken(): string {
  return randomBytes(32).toString('base64url');
}

/// Constant time, so a wrong header cannot be walked to a right one byte by
/// byte. The length check first is not a leak: timingSafeEqual throws on
/// mismatched lengths, and a token's length is fixed and public anyway.
function tokensMatch(cookie: string, header: string): boolean {
  const left = Buffer.from(cookie, 'utf8');
  const right = Buffer.from(header, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

const csrfPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', async (request, reply) => {
    // Read before issuing: the check below has to compare against the token
    // the request arrived with, never the one this response is about to hand
    // out. Setting it here rather than after the check means even a rejected
    // request leaves the caller able to retry successfully.
    const cookie = request.cookies[CSRF_COOKIE];
    setCsrfCookie(reply, cookie ?? issueToken());

    if (SAFE_METHODS.has(request.method)) return;
    if (!request.headers.cookie) return;

    const path = request.url.split('?')[0] ?? request.url;
    if (EXEMPT.has(`${request.method} ${path}`)) return;

    const header = request.headers[CSRF_HEADER];

    if (!cookie || typeof header !== 'string' || !tokensMatch(cookie, header)) {
      throw forbidden(
        'csrf_failed',
        'Missing or invalid CSRF token. Reload the page and try again.',
      );
    }
  });
};

export default fp(csrfPlugin, { name: 'csrf', dependencies: ['auth'] });
