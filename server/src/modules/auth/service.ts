import type { Device, User } from '../../generated/prisma/client.js';
import { prisma } from '../../db.js';
import { env } from '../../env.js';
import { recordAudit, type AuditAction, type AuditEntry } from '../../lib/audit.js';
import { badRequest, unauthorized } from '../../lib/errors.js';
import {
  alreadyRegisteredEmail,
  passwordResetEmail,
  verificationEmail,
  type Mailer,
} from '../../lib/mailer.js';
import {
  burnPasswordTime,
  hashPassword,
  verifyPassword,
} from '../../lib/password.js';
import {
  createOpaqueToken,
  hashToken,
  minutesFromNow,
} from '../../lib/tokens.js';
import type { RequestContext } from './sessions.js';
import type { LoginInput, RegisterInput, ResetPasswordInput } from './schemas.js';

const VERIFY_TOKEN_TTL_MINUTES = 60 * 24;

/// Much shorter than a verification link. A verification link is a convenience
/// that sits in an inbox until someone gets around to it; a reset link is a
/// live credential for the account, so the window it is stealable in should be
/// about as long as it takes to read the email and type a password.
const RESET_TOKEN_TTL_MINUTES = 60;

/// Audit actions for the credential flows.
///
/// These belong in the `AuditAction` union in lib/audit.ts and are named here
/// instead because a parallel change owns that file right now. The union is
/// closed on purpose: a mistyped action string is otherwise invisible until
/// someone reads the log looking for something that was never written under
/// that name. Fold these four in and delete this the moment both changes land.
type CredentialAuditAction =
  | 'auth.reset_requested'
  | 'auth.reset_completed'
  | 'auth.password_changed'
  | 'auth.recovery_code_rotated';

export function recordCredentialAudit(
  entry: Omit<AuditEntry, 'action'> & { action: CredentialAuditAction },
): Promise<void> {
  return recordAudit({ ...entry, action: entry.action as AuditAction });
}

/// Mirrors AccountDto in client/src/lib/api/types.ts. Lowercased role and
/// status because the enum casing is a database detail, and `emailVerifiedAt`
/// rather than a boolean because the UI shows when, not just whether.
export interface AccountDto {
  id: string;
  email: string;
  username: string;
  role: 'user' | 'admin';
  status: 'active' | 'disabled' | 'deleted';
  emailVerifiedAt: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export function toAccountDto(user: User): AccountDto {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role.toLowerCase() as 'user' | 'admin',
    status: user.status.toLowerCase() as 'active' | 'disabled' | 'deleted',
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}

/// A device as its *owner* sees it, wrapped blobs included. Never hand this
/// shape to anyone else - the public registry returns publicKey only.
export interface DeviceDto {
  id: string;
  label: string;
  publicKey: string;
  wrappedPrivateKey: string;
  wrappedPrivateKeyRecovery: string;
  createdAt: string;
  revokedAt: string | null;
}

export function toDeviceDto(device: Device): DeviceDto {
  return {
    id: device.id,
    label: device.label,
    publicKey: device.publicKey,
    wrappedPrivateKey: device.wrappedPrivateKey,
    wrappedPrivateKeyRecovery: device.wrappedPrivateKeyRecovery,
    createdAt: device.createdAt.toISOString(),
    revokedAt: device.revokedAt?.toISOString() ?? null,
  };
}

async function issueVerificationToken(userId: string): Promise<string> {
  const { token, tokenHash } = createOpaqueToken();

  // One live verification token at a time, so an old link in an old inbox
  // stops working the moment a new one is requested.
  await prisma.$transaction([
    prisma.emailToken.deleteMany({ where: { userId, purpose: 'VERIFY' } }),
    prisma.emailToken.create({
      data: {
        userId,
        purpose: 'VERIFY',
        tokenHash,
        expiresAt: minutesFromNow(VERIFY_TOKEN_TTL_MINUTES),
      },
    }),
  ]);

  return token;
}

/// Always resolves the same way whether or not the address was taken.
/// Registration is the easiest endpoint to turn into a "does this person have
/// an account here" oracle, and for a private messenger that answer is exactly
/// what an attacker wants.
export async function register(
  input: RegisterInput,
  ctx: RequestContext,
  mailer: Mailer,
): Promise<void> {
  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ email: input.email }, { username: input.username }],
    },
    select: { id: true, email: true, username: true },
  });

  if (existing) {
    // Spend roughly the time a real signup would, then tell the address owner
    // (not the caller) what happened.
    await hashPassword(input.authHash);

    await recordAudit({
      action: 'user.register_blocked_duplicate',
      targetUserId: existing.id,
      ip: ctx.ip,
      meta: {
        emailTaken: existing.email === input.email,
        usernameTaken: existing.username === input.username,
      },
    });

    if (existing.email === input.email) {
      await mailer.send({ to: input.email, ...alreadyRegisteredEmail() });
    }

    return;
  }

  // The authHash is already an argon2id output from the client; hashing it
  // again is what stops a database dump from being a pile of working
  // credentials, since the stored value is not what login sends.
  const authVerifier = await hashPassword(input.authHash);

  let user: User;
  try {
    // One transaction: an account without its device would be able to sign in
    // and then have nothing to decrypt with, which is worse than not existing.
    user = await prisma.user.create({
      data: {
        email: input.email,
        username: input.username,
        authVerifier,
        recoveryCodeHash: input.recoveryCodeHash,
        devices: {
          create: {
            label: input.device.label,
            publicKey: input.device.publicKey,
            wrappedPrivateKey: input.device.wrappedPrivateKey,
            wrappedPrivateKeyRecovery: input.device.wrappedPrivateKeyRecovery,
          },
        },
      },
    });
  } catch (error) {
    // Lost a race against a concurrent signup for the same handle. The unique
    // index is the real guard; behave exactly as the duplicate branch does.
    if (isUniqueViolation(error)) return;
    throw error;
  }

  const token = await issueVerificationToken(user.id);

  await mailer.send({ to: user.email, ...verificationEmail(token) });

  await recordAudit({
    action: 'user.registered',
    targetUserId: user.id,
    ip: ctx.ip,
    meta: { username: user.username },
  });
}

export async function verifyEmail(
  rawToken: string,
  ctx: RequestContext,
): Promise<void> {
  const record = await prisma.emailToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
  });

  const invalid = badRequest(
    'invalid_token',
    'This verification link is invalid or has expired.',
  );

  if (
    !record ||
    record.purpose !== 'VERIFY' ||
    record.usedAt ||
    record.expiresAt.getTime() <= Date.now()
  ) {
    throw invalid;
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: new Date() },
    }),
    prisma.emailToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
  ]);

  await recordAudit({
    action: 'user.email_verified',
    targetUserId: record.userId,
    ip: ctx.ip,
  });
}

/// Same generic-response rule as register.
export async function resendVerification(
  email: string,
  ctx: RequestContext,
  mailer: Mailer,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || user.status !== 'ACTIVE' || user.emailVerifiedAt) return;

  const token = await issueVerificationToken(user.id);
  await mailer.send({ to: user.email, ...verificationEmail(token) });

  await recordAudit({
    action: 'user.verify_resent',
    targetUserId: user.id,
    ip: ctx.ip,
  });
}

export interface AuthenticatedLogin {
  user: User;
  /// The caller's own device, returned inline so the client can unwrap its
  /// private key without a second round trip. Null for an account registered
  /// before devices existed, or one whose device was revoked.
  device: Device | null;
}

export async function authenticate(
  input: LoginInput,
  ctx: RequestContext,
): Promise<AuthenticatedLogin> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  const invalidCredentials = unauthorized(
    'invalid_credentials',
    'Incorrect email or password.',
  );

  if (!user) {
    // No account: still pay the argon2 cost so the response time does not
    // separate "no such user" from "wrong password".
    await burnPasswordTime();
    await recordAudit({
      action: 'auth.login_failed',
      ip: ctx.ip,
      meta: { reason: 'unknown_identifier' },
    });
    throw invalidCredentials;
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    await recordAudit({
      action: 'auth.login_locked_out',
      targetUserId: user.id,
      ip: ctx.ip,
    });
    // Reported as ordinary bad credentials on purpose: confirming "this
    // account is locked" tells an attacker their guessing is landing on a
    // real account.
    throw invalidCredentials;
  }

  const authOk = await verifyPassword(user.authVerifier, input.authHash);

  if (!authOk) {
    await registerFailedLogin(user, ctx);
    throw invalidCredentials;
  }

  if (user.status !== 'ACTIVE') {
    await recordAudit({
      action: 'auth.login_failed',
      targetUserId: user.id,
      ip: ctx.ip,
      meta: { reason: `status_${user.status.toLowerCase()}` },
    });
    // The password was right, so the caller is the account owner and is
    // entitled to know why they cannot get in.
    throw unauthorized(
      'account_disabled',
      'This account has been disabled. Contact an administrator.',
    );
  }

  if (!user.emailVerifiedAt) {
    throw unauthorized(
      'email_not_verified',
      'Verify your email address before signing in.',
    );
  }

  const [updated, device] = await Promise.all([
    prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    }),
    prisma.device.findFirst({
      where: { userId: user.id, revokedAt: null },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  await recordAudit({
    action: 'auth.login_succeeded',
    actorUserId: user.id,
    targetUserId: user.id,
    ip: ctx.ip,
  });

  return { user: updated, device };
}

async function registerFailedLogin(
  user: User,
  ctx: RequestContext,
): Promise<void> {
  const failedLoginCount = user.failedLoginCount + 1;
  const shouldLock = failedLoginCount >= env.MAX_FAILED_LOGINS;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginCount: shouldLock ? 0 : failedLoginCount,
      lockedUntil: shouldLock ? minutesFromNow(env.LOCKOUT_MINUTES) : null,
    },
  });

  await recordAudit({
    action: shouldLock ? 'auth.login_locked_out' : 'auth.login_failed',
    targetUserId: user.id,
    ip: ctx.ip,
    meta: { reason: 'bad_password', failedLoginCount },
  });
}

/* ------------------------------------------------------ password reset --- */

/// The account's live key material. One device per account today (STATUS.md
/// decision 4), so "the device" is the oldest one still unrevoked, matching
/// what login hands back.
export function activeDeviceFor(userId: string): Promise<Device | null> {
  return prisma.device.findFirst({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: 'asc' },
  });
}

/// Raised when an account has no key material to re-wrap. Registration creates
/// the user and the device in one transaction, so reaching this means a device
/// was revoked or the row predates devices existing at all.
const identityUnavailable = () =>
  badRequest(
    'identity_unavailable',
    'This account has no key material on file, so there is nothing to unlock. Contact an administrator.',
  );

async function issueResetToken(userId: string): Promise<string> {
  const { token, tokenHash } = createOpaqueToken();

  // Same rule as verification: one live link at a time, so asking again kills
  // the previous email rather than leaving two working credentials in an inbox.
  await prisma.$transaction([
    prisma.emailToken.deleteMany({ where: { userId, purpose: 'RESET' } }),
    prisma.emailToken.create({
      data: {
        userId,
        purpose: 'RESET',
        tokenHash,
        expiresAt: minutesFromNow(RESET_TOKEN_TTL_MINUTES),
      },
    }),
  ]);

  return token;
}

/// Always resolves the same way, exactly like register and resendVerification.
///
/// An unverified account gets no link. Nobody has ever proved they can read
/// that inbox, and this endpoint would be the proof step, so honouring it
/// would turn "sign up with someone else's address" into a way to end up
/// holding a verified-looking account against an address that was never
/// confirmed. Such an account can still be reached: register again, or ask for
/// a new verification email.
export async function requestPasswordReset(
  email: string,
  ctx: RequestContext,
  mailer: Mailer,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || user.status !== 'ACTIVE' || !user.emailVerifiedAt) return;

  const token = await issueResetToken(user.id);
  await mailer.send({ to: user.email, ...passwordResetEmail(token) });

  await recordCredentialAudit({
    action: 'auth.reset_requested',
    targetUserId: user.id,
    ip: ctx.ip,
  });
}

/// Every rejection is the same 400. The reasons are worth keeping apart in
/// code and not worth telling an anonymous caller apart, since the difference
/// between "expired" and "never existed" is exactly what token guessing wants
/// to learn.
async function requireResetToken(rawToken: string) {
  const record = await prisma.emailToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: true },
  });

  const invalid = badRequest(
    'invalid_token',
    'This reset link is invalid or has expired.',
  );

  if (
    !record ||
    record.purpose !== 'RESET' ||
    record.usedAt ||
    record.expiresAt.getTime() <= Date.now() ||
    record.user.status !== 'ACTIVE'
  ) {
    throw invalid;
  }

  return record;
}

export interface ResetContextDto {
  email: string;
  deviceId: string;
  publicKey: string;
  wrappedPrivateKeyRecovery: string;
}

/// blob_B, handed out in exchange for a valid reset token.
///
/// This endpoint is not in backend-plan.md and the recovery-code path cannot
/// work without it: a reset happens signed out, usually on a machine that has
/// never held this account's key material, so there is no other way to reach
/// the blob the recovery code opens.
///
/// Handing it over leaks nothing the server could have withheld anyway. blob_B
/// is sealed under a 103-bit code this server has never seen and cannot
/// derive, so to whoever holds the token it is a wrapped key they still cannot
/// open, and to us it always was. What the token holder does gain is an
/// offline target, which is why the recovery code is a key rather than a PIN.
///
/// It deliberately does not spend the token. Only the reset itself does, so a
/// user who fetches this and then mistypes their code can try again.
export async function loadResetContext(rawToken: string): Promise<ResetContextDto> {
  const record = await requireResetToken(rawToken);
  const device = await activeDeviceFor(record.userId);

  if (!device) throw identityUnavailable();

  return {
    email: record.user.email,
    deviceId: device.id,
    publicKey: device.publicKey,
    wrappedPrivateKeyRecovery: device.wrappedPrivateKeyRecovery,
  };
}

/// Both reset paths land here, and neither of them is "the server sets a new
/// password": the server has never held one. What arrives is a new authHash
/// plus the blobs the client re-wrapped on its own device, and the server's
/// job is to swap them in together or not at all.
///
/// `identityReset` says which path ran. False means the recovery code opened
/// blob_B and the same keypair survived, so message history stays readable.
/// True means a fresh keypair was generated, and every message already sealed
/// to the old public key is permanently unreadable. That is the design working
/// rather than failing, and it is the client's job to have said so plainly
/// before getting here.
export async function resetPassword(
  input: ResetPasswordInput,
  ctx: RequestContext,
): Promise<void> {
  const record = await requireResetToken(input.token);
  const device = await activeDeviceFor(record.userId);

  // Narrowed out of the union before the transaction, where the discriminant
  // is no longer in scope.
  const newPublicKey = input.identityReset ? input.publicKey : null;

  if (!device && !newPublicKey) throw identityUnavailable();

  const authVerifier = await hashPassword(input.authHash);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // Spending the token is conditional on it still being unspent, so two
    // requests racing the same link cannot both apply. Doing it first means
    // the loser fails before touching any credential.
    const spent = await tx.emailToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: now },
    });

    if (spent.count === 0) {
      throw badRequest('invalid_token', 'This reset link is invalid or has expired.');
    }

    await tx.user.update({
      where: { id: record.userId },
      data: {
        authVerifier,
        recoveryCodeHash: input.recoveryCodeHash,
        // Whoever gets here proved control of the inbox, so a lockout from
        // someone else's guessing should not outlive the reset.
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });

    if (device) {
      await tx.device.update({
        where: { id: device.id },
        data: {
          wrappedPrivateKey: input.wrappedPrivateKey,
          wrappedPrivateKeyRecovery: input.wrappedPrivateKeyRecovery,
          ...(newPublicKey ? { publicKey: newPublicKey } : {}),
        },
      });
    } else if (newPublicKey) {
      // No device and a brand new keypair: the account had nothing to lose, so
      // give it key material rather than leaving it able to sign in and read
      // nothing. The guard above makes these two branches exhaustive; the
      // condition is repeated here because only it narrows the public key.
      await tx.device.create({
        data: {
          userId: record.userId,
          label: 'Recovered account',
          publicKey: newPublicKey,
          wrappedPrivateKey: input.wrappedPrivateKey,
          wrappedPrivateKeyRecovery: input.wrappedPrivateKeyRecovery,
        },
      });
    }

    // Everyone signed in with the old password is signed out, including
    // whoever prompted the reset by being somewhere they should not be. A
    // reset that leaves an intruder's session alive has changed a password and
    // nothing else.
    await tx.session.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: now },
    });
  });

  await recordCredentialAudit({
    action: 'auth.reset_completed',
    targetUserId: record.userId,
    ip: ctx.ip,
    meta: { identityReset: input.identityReset },
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}
