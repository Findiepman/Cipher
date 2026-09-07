import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { prisma } from '../db.js';

export type AuditAction =
  | 'user.registered'
  | 'user.register_blocked_duplicate'
  | 'user.email_verified'
  | 'user.verify_resent'
  | 'auth.login_succeeded'
  | 'auth.login_failed'
  | 'auth.login_locked_out'
  | 'auth.refreshed'
  | 'auth.refresh_reuse_detected'
  | 'auth.logged_out'
  | 'auth.logged_out_all'
  /// friend.request_sent and friend.request_failed are also the counters the
  /// per-account request budget reads - see modules/friends/service.ts.
  | 'friend.request_sent'
  | 'friend.request_failed'
  | 'friend.accepted'
  | 'friend.declined'
  | 'friend.removed'
  | 'friend.blocked'
  | 'friend.unblocked'
  | 'friend.nickname_set'
  | 'friend.nickname_cleared';

export interface AuditEntry {
  action: AuditAction;
  actorUserId?: string | null;
  targetUserId?: string | null;
  ip?: string | null;
  meta?: Prisma.InputJsonValue;
}

/// Audit writes must never break the request they describe - a failed insert
/// here is a logging problem, not a reason to fail a login.
export async function recordAudit(
  entry: AuditEntry,
  client: PrismaClient | Prisma.TransactionClient = prisma,
): Promise<void> {
  try {
    await client.auditLog.create({
      data: {
        action: entry.action,
        actorUserId: entry.actorUserId ?? null,
        targetUserId: entry.targetUserId ?? null,
        ip: entry.ip ?? null,
        meta: entry.meta,
      },
    });
  } catch (error) {
    console.error('[audit] failed to record entry', entry.action, error);
  }
}
