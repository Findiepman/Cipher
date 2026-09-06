import type { Device, User } from '../../generated/prisma/client.js';
import { prisma } from '../../db.js';
import { env } from '../../env.js';
import { recordAudit } from '../../lib/audit.js';
import { badRequest, unauthorized } from '../../lib/errors.js';
import {
  alreadyRegisteredEmail,
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
import type { LoginInput, RegisterInput } from './schemas.js';

const VERIFY_TOKEN_TTL_MINUTES = 60 * 24;

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

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}
