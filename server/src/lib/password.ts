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

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;

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

const COMMON_PASSWORDS = new Set([
  'password', 'passw0rd', 'password1', 'password123', 'passwordpassword',
  '123456789012', '1234567890123', 'qwertyuiop123', 'qwertyuiopasd',
  'letmeinplease', 'iloveyou1234', 'administrator', 'welcome12345',
  'changeme1234', 'trustno1trust', 'monkeymonkey', 'football1234',
  'baseball1234', 'dragondragon', 'sunshine1234', 'princess1234',
  'qazwsxedcrfv', 'zaq12wsxcde3', 'abcd1234abcd', 'aaaaaaaaaaaa',
]);

export interface PasswordProblem {
  code: string;
  message: string;
}

/// Deliberately lightweight: length is what actually matters, plus a few
/// checks for the passwords people pick when a form says "12 characters".
export function checkPasswordStrength(
  password: string,
  context: { email: string; username: string },
): PasswordProblem | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      code: 'password_too_short',
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    return {
      code: 'password_too_long',
      message: `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`,
    };
  }

  const lowered = password.toLowerCase();

  if (COMMON_PASSWORDS.has(lowered)) {
    return {
      code: 'password_too_common',
      message: 'That password is too common. Pick something less guessable.',
    };
  }

  const localPart = context.email.split('@')[0]?.toLowerCase() ?? '';
  const username = context.username.toLowerCase();

  if (
    (username.length >= 4 && lowered.includes(username)) ||
    (localPart.length >= 4 && lowered.includes(localPart))
  ) {
    return {
      code: 'password_contains_identity',
      message: 'Password must not contain your username or email address.',
    };
  }

  if (new Set(lowered).size < 5) {
    return {
      code: 'password_not_varied',
      message: 'Password must use a wider variety of characters.',
    };
  }

  return null;
}
