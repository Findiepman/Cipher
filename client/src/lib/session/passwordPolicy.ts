/**
 * Client-side password rules, mirroring the server's ("minimum 12 chars,
 * weak-password rejection" — backend-plan.md).
 *
 * The server is still the authority; this exists so the user gets told before
 * an argon2id derivation and a round trip, and so the signup form can show a
 * meter. Never treat a pass here as permission to skip the server's answer.
 */

export const MIN_PASSWORD_LENGTH = 12;

/** Passwords long enough to pass the length check but not worth accepting. */
const COMMON_PASSWORDS = [
  'password',
  'passw0rd',
  'letmein',
  'qwerty',
  'iloveyou',
  'admin',
  'welcome',
  'monkey',
  'dragon',
  'football',
  'baseball',
  'sunshine',
  'princess',
  'trustno1',
  'changeme',
  'correcthorsebatterystaple',
];

export interface PasswordCheck {
  ok: boolean;
  /** Human-readable reasons, in the order worth showing them. */
  problems: string[];
  /** 0–4, for a strength meter. Not a security claim. */
  score: number;
}

export function checkPassword(password: string, context: { email?: string; username?: string } = {}): PasswordCheck {
  const problems: string[] = [];
  const normalized = password.normalize('NFKC');
  const lower = normalized.toLowerCase();

  if (normalized.length < MIN_PASSWORD_LENGTH) {
    problems.push(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (COMMON_PASSWORDS.some((common) => lower.includes(common))) {
    problems.push('That is based on a very common password.');
  }
  if (/^(.)\1+$/.test(normalized)) {
    problems.push('That is a single repeated character.');
  }
  if (isSequential(lower)) {
    problems.push('That is a keyboard or alphabet sequence.');
  }
  for (const [field, value] of Object.entries(context)) {
    const stem = field === 'email' ? (value ?? '').split('@')[0] : value;
    if (stem && stem.length >= 3 && lower.includes(stem.toLowerCase())) {
      problems.push(`Do not use your ${field} in your password.`);
    }
  }

  return { ok: problems.length === 0, problems, score: scorePassword(normalized) };
}

function isSequential(value: string): boolean {
  if (value.length < 6) return false;
  let ascending = true;
  let descending = true;
  for (let i = 1; i < value.length; i += 1) {
    const step = value.charCodeAt(i) - value.charCodeAt(i - 1);
    if (step !== 1) ascending = false;
    if (step !== -1) descending = false;
  }
  return ascending || descending;
}

/**
 * Length dominates, variety is a tiebreak. A long passphrase of nothing but
 * lowercase words is stronger than a short one with a symbol bolted on, and a
 * meter that says otherwise pushes people toward worse passwords.
 */
function scorePassword(password: string): number {
  if (password.length < MIN_PASSWORD_LENGTH) return 0;
  if (password.length >= 24) return 4;

  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) =>
    re.test(password),
  ).length;
  const lengthPoints = password.length >= 20 ? 3 : password.length >= 16 ? 2 : 1;
  return Math.min(4, lengthPoints + (classes >= 3 ? 1 : 0));
}
