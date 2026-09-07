import 'dotenv/config';

import { z } from 'zod';

const boolish = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.string().url(),

  DATABASE_URL: z.string().min(1),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: boolish.default('false'),

  /// 'console' prints emails to the log instead of sending them. Development
  /// only - it is rejected in production below.
  MAIL_TRANSPORT: z.enum(['smtp', 'console', 'file']).default('smtp'),
  /// Where 'file' transport drops messages. Relative to the server directory.
  MAIL_DIR: z.string().default('.mail'),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().min(1),

  MAX_FAILED_LOGINS: z.coerce.number().int().positive().default(8),
  LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),

  /// A Cloudflare Realtime TURN key. Both or neither: with them the server
  /// mints short-lived relay credentials for calls, without them calls are
  /// STUN only and two browsers that cannot reach each other directly will
  /// not connect. The key itself is never sent to a client.
  TURN_KEY_ID: z.string().min(1).optional(),
  TURN_KEY_API_TOKEN: z.string().min(1).optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  // Fail loudly at boot rather than half-starting with a missing secret.
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;

if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
  throw new Error('COOKIE_SECURE must be true in production');
}

if (env.NODE_ENV === 'production' && env.MAIL_TRANSPORT !== 'smtp') {
  // Otherwise every verification and reset email is silently dropped, and
  // nobody can sign up or recover an account.
  throw new Error('MAIL_TRANSPORT must be "smtp" in production');
}

if (Boolean(env.TURN_KEY_ID) !== Boolean(env.TURN_KEY_API_TOKEN)) {
  // Half a key is a misconfiguration that would otherwise look like "calls
  // work on my network and not on yours".
  throw new Error('TURN_KEY_ID and TURN_KEY_API_TOKEN must be set together');
}

export const isProduction = env.NODE_ENV === 'production';
