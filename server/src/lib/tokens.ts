import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const TOKEN_BYTES = 32;

/// Returns the raw token (goes in the email or the cookie, never stored) and
/// its hash (goes in the DB, never leaves the server).
export function createOpaqueToken(): { token: string; tokenHash: string } {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

/// Plain SHA-256 is the right tool here, unlike for passwords: these tokens
/// are 256 bits of uniform randomness, so there is no dictionary to attack and
/// nothing for a slow KDF to buy us.
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

export function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60_000);
}
