import { z } from 'zod';
import { screenUsername, usernameRejectionMessage } from '../../lib/usernameFilter.js';

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

/// The format rule plus the word filter.
///
/// Kept separate from `usernameSchema` on purpose: that one is also what a
/// friend lookup parses, and a lookup has to be able to name a handle that
/// already exists. Only the act of claiming a new one is screened.
export const newUsernameSchema = usernameSchema.superRefine((value, ctx) => {
  const rejection = screenUsername(value);
  if (rejection) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: usernameRejectionMessage(rejection) });
  }
});

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address.')
  .max(254);

/// Standard base64 of 32 bytes. Used for every digest and public key crossing
/// this boundary - the authHash, the recovery code hash, an X25519 public key.
/// Exact-length on purpose: these are fixed-size outputs, so anything else is a
/// malformed client, not a user mistake.
export const base64_32 = z
  .string()
  .length(44)
  .regex(/^[A-Za-z0-9+/]{43}=$/, 'Expected base64 of a 32-byte value.');

/// A wrapped private key, as serialized by packages/crypto. Opaque here: the
/// server stores and returns it without ever being able to open it, so it is
/// checked for size and nothing else.
export const wrappedKeySchema = z.string().min(1).max(4096);

/// Anything delivered by email: a verification link, a reset link. The raw
/// value is 32 random bytes in base64url, so the bound is generous rather than
/// exact, and the real check is the lookup against the stored hash.
const emailedTokenSchema = z.string().min(1).max(512);

/// What a device registers. No password, no private key, no recovery code -
/// see the note on `authVerifier` in prisma/schema.prisma.
export const deviceRegistrationSchema = z.object({
  label: z.string().trim().min(1).max(64),
  publicKey: base64_32,
  wrappedPrivateKey: wrappedKeySchema,
  wrappedPrivateKeyRecovery: wrappedKeySchema,
});

/// Note what is absent: `password`. The client derives `authHash` from it
/// locally and sends only that, so password strength can no longer be judged
/// here - the server cannot see the thing it would be judging. That rule now
/// lives in client/src/lib/session/passwordPolicy.ts, and it is genuinely
/// client-side-only enforcement: a hostile client can register a weak password
/// and there is no way for this process to know. That is the cost of the server
/// never holding a password, and it is the trade this project has chosen.
export const registerSchema = z.object({
  email: emailSchema,
  username: newUsernameSchema,
  authHash: base64_32,
  recoveryCodeHash: base64_32,
  device: deviceRegistrationSchema,
});

/// Email only, not "email or username": the auth salt is derived from the email
/// address, so the client cannot compute an authHash without knowing which
/// address the account uses. Letting people sign in by username would mean
/// telling an anonymous caller the email behind a handle.
export const loginSchema = z.object({
  email: emailSchema,
  authHash: base64_32,
  deviceLabel: z.string().trim().max(64).optional(),
});

export const verifyEmailSchema = z.object({
  token: emailedTokenSchema,
});

export const resendVerificationSchema = z.object({
  email: emailSchema,
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetContextSchema = z.object({
  token: emailedTokenSchema,
});

/// What both reset paths have in common. Note that the recovery blob and its
/// hash are required in both: the code the user just typed is spent by using
/// it, so the client mints a fresh one either way and an account is never left
/// without a way back in.
const resetCommonShape = {
  token: emailedTokenSchema,
  authHash: base64_32,
  wrappedPrivateKey: wrappedKeySchema,
  wrappedPrivateKeyRecovery: wrappedKeySchema,
  recoveryCodeHash: base64_32,
};

/// The two reset paths, told apart by `identityReset` rather than by which
/// optional fields happen to be present.
///
/// A public key belongs only to the branch that generated a new keypair. On
/// the recovery-code branch the old keypair survived, so there is no field to
/// put one in and a client sending one has it dropped. That is deliberate:
/// accepting a new public key while keeping the old wrapped blobs would swap
/// the key everyone else encrypts to for one this account cannot open, which
/// is a silent way to make an account permanently unreadable.
export const resetPasswordSchema = z.discriminatedUnion('identityReset', [
  z.object({ identityReset: z.literal(false), ...resetCommonShape }),
  z.object({ identityReset: z.literal(true), publicKey: base64_32, ...resetCommonShape }),
]);

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type DeviceRegistrationInput = z.infer<typeof deviceRegistrationSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
