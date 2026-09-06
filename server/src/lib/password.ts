import { hash, verify } from '@node-rs/argon2';

// argon2id with OWASP's recommended baseline (19 MiB, 2 passes, 1 lane).
// Chosen over bcrypt: no 72-byte input truncation, and memory-hardness makes
// GPU cracking far more expensive.
// @node-rs/argon2 exports Algorithm as an ambient const enum, which cannot
// be imported under verbatimModuleSyntax. Argon2id is 2.
const ARGON2ID = 2;

const OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await verify(passwordHash, password, OPTIONS);
  } catch {
    // Malformed hash in the DB - treat as a failed login, never as a pass.
    return false;
  }
}

/// A hash of a password nobody has. Used to burn roughly the same amount of
/// time on a login for an address that doesn't exist, so response timing
/// doesn't leak whether an account is real.
let dummyHashPromise: Promise<string> | undefined;

export function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword('not-a-real-password-placeholder');
  return dummyHashPromise;
}

export async function burnPasswordTime(): Promise<void> {
  await verifyPassword(await dummyHash(), 'wrong');
}

/// Password *strength* is deliberately not checked here any more.
///
/// Registration receives an authHash, never a password, so this process has no
/// input to judge - a weak password and a strong one produce base64 blobs that
/// are indistinguishable. Enforcement moved to
/// client/src/lib/session/passwordPolicy.ts, which means it is advisory: a
/// hostile client can skip it and this server cannot tell.
///
/// That is a real weakening, and it is the price of the server never holding a
/// password. It is worth stating plainly rather than leaving a dead
/// checkPasswordStrength() here implying a guarantee that no longer exists.
