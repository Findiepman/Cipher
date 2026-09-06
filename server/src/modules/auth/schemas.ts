import { z } from 'zod';
import { MAX_PASSWORD_LENGTH } from '../../lib/password.js';

/// Usernames are the handle other people see and search for. Deliberately
/// narrow: no leading/trailing separators, no consecutive separators, so
/// "a..b" and "a.b" can't be confused for each other.
export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters.')
  .max(32, 'Username must be at most 32 characters.')
  .regex(
    /^[a-zA-Z0-9](?:[a-zA-Z0-9]|[._-](?![._-]))*[a-zA-Z0-9]$/,
    'Username may use letters, numbers, and single . _ - between them.',
  );

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address.')
  .max(254);

/// Length bounds only - real strength rules live in checkPasswordStrength so
/// the message can explain *why* a password was rejected.
export const passwordSchema = z.string().min(1).max(MAX_PASSWORD_LENGTH);

export const registerSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  /// Accepts either, because making the user remember which one they signed
  /// up with is a pointless failure mode.
  identifier: z.string().trim().min(1).max(254),
  password: passwordSchema,
  deviceLabel: z.string().trim().max(64).optional(),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1).max(512),
});

export const resendVerificationSchema = z.object({
  email: emailSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
