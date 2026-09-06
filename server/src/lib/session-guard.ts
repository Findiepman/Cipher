/**
 * "Is the session behind this token still alive?"
 *
 * A valid JWT signature is not enough. The session it names may have been
 * revoked since it was minted - by a logout, a logout-all, an admin
 * force-logout, or refresh-token reuse detection - and an access token stays
 * signed and unexpired through all of that.
 *
 * Both entry points share this: `requireAuth` calls it per HTTP request, and
 * the socket layer calls it at handshake, on every send, and on a sweep. They
 * must not drift, which is why the check lives here rather than in either one.
 */
import { prisma } from '../db.js';

export interface LiveSession {
  id: string;
  role: 'USER' | 'ADMIN';
  sessionId: string;
}

export async function loadLiveSession(
  userId: string,
  sessionId: string,
): Promise<LiveSession | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      revokedAt: true,
      userId: true,
      user: { select: { id: true, role: true, status: true } },
    },
  });

  if (
    !session ||
    session.revokedAt ||
    session.userId !== userId ||
    session.user.status !== 'ACTIVE'
  ) {
    return null;
  }

  return {
    id: session.user.id,
    role: session.user.role,
    sessionId,
  };
}
