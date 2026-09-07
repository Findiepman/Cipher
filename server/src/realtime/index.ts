/**
 * The real-time layer: Socket.io bolted onto the Fastify HTTP server.
 *
 * It moves sealed blobs and headers. It does not read a message body, and there
 * is no code path here that could - `deliver()` takes envelopes that are
 * already sealed and picks one by recipient id.
 *
 * Three things are worth knowing before changing anything here:
 *
 *  1. Delivery is per-recipient. Everyone in a conversation gets the one
 *     envelope addressed to them, never the whole set.
 *  2. A room per user id, not per conversation. Joining is then free (it
 *     happens once, at connect) and a user's other tabs get the echo of their
 *     own send for nothing.
 *  3. A socket outlives its access token, so the session behind it is
 *     re-checked before every send and on a sweep. Without that, a logout
 *     would stop the HTTP API but leave the socket happily delivering.
 */
// The named export, not the default: the default is the plugin function, and
// only the named one carries `parse`.
import { fastifyCookie } from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import { Server, type Socket } from 'socket.io';
import { env } from '../env.js';
import { ACCESS_COOKIE } from '../lib/cookies.js';
import { loadLiveSession } from '../lib/session-guard.js';
import type { AccessTokenPayload } from '../plugins/auth.js';
import { listFriends } from '../modules/friends/service.js';
import {
  markRead,
  postMessage,
  requireParticipant,
  type PostedMessage,
} from '../modules/conversations/service.js';
import { AppError } from '../lib/errors.js';

/// How often to re-check that every connected socket's session is still live.
/// The window this leaves is the longest a revoked session can keep receiving.
const SESSION_SWEEP_MS = 60_000;

interface SocketData {
  userId: string;
  sessionId: string;
}

export interface Realtime {
  /// Pushes a stored message to whoever is connected. Wired into the HTTP
  /// routes too, so a message sent over HTTP still arrives in real time.
  deliver(message: PostedMessage): void;
  close(): Promise<void>;
}

export function attachRealtime(app: FastifyInstance): Realtime {
  const io = new Server(app.server, {
    cors: { origin: [env.APP_URL], credentials: true },
    // The client's own outbox handles retries and ordering, so a slow reconnect
    // costs nothing but a delay.
    connectionStateRecovery: {},
  });

  /// userId -> how many sockets that user has open. A count, not a boolean,
  /// because closing one of three tabs is not going offline.
  const connections = new Map<string, number>();

  /// Shutting down disconnects every socket at once, which would otherwise
  /// fire a presence query per user against a pool that is about to close -
  /// and "everyone went offline" is not news anyone is still connected to hear.
  let closing = false;

  io.use(async (socket, next) => {
    const token = tokenFrom(socket);
    if (!token) return next(new Error('unauthenticated'));

    let payload: AccessTokenPayload;
    try {
      payload = app.jwt.verify<AccessTokenPayload>(token);
    } catch {
      return next(new Error('unauthenticated'));
    }

    const session = await loadLiveSession(payload.sub, payload.sid);
    if (!session) return next(new Error('session_revoked'));

    (socket.data as SocketData).userId = session.id;
    (socket.data as SocketData).sessionId = session.sessionId;
    next();
  });

  io.on('connection', (socket) => {
    const { userId } = socket.data as SocketData;

    void socket.join(userId);
    void markOnline(userId, true);

    socket.on('message:send', async (payload: unknown, ack?: (result: unknown) => void) => {
      try {
        const { conversationId, clientId, envelopes } = readSendPayload(payload);

        // Re-checked per send: the socket has outlived its access token by now
        // more often than not, and a revoked session must not be able to write.
        const session = await loadLiveSession(userId, (socket.data as SocketData).sessionId);
        if (!session) {
          ack?.({ error: { code: 'session_revoked', message: 'Sign in again.' } });
          // Ack first, then tear down on the next tick. Disconnecting before
          // the ack has flushed writes it to a dead transport, and the sender
          // is left waiting on a reply that was never going to arrive.
          setTimeout(() => socket.disconnect(true), 0);
          return;
        }

        const posted = await postMessage(userId, conversationId, { clientId, envelopes });

        ack?.({ id: posted.id, clientId: posted.clientId, sentAt: posted.sentAt });
        deliver(posted);
      } catch (error) {
        ack?.({ error: toClientError(error) });
      }
    });

    socket.on('typing', async (payload: unknown) => {
      const conversationId = (payload as { conversationId?: unknown })?.conversationId;
      if (typeof conversationId !== 'string') return;

      try {
        const participants = await requireParticipant(userId, conversationId);
        for (const participant of participants) {
          if (participant === userId) continue;
          io.to(participant).emit('typing', { conversationId, userId });
        }
      } catch {
        // Typing is advisory. A rejected one is not worth reporting.
      }
    });

    /// The socket path for marking read. POST /conversations/:id/read is the
    /// same call over HTTP, both landing in markRead(), which is the split the
    /// send path already has: the socket is the normal route and HTTP is what
    /// still works with a dead websocket.
    socket.on('read', async (payload: unknown) => {
      const value = payload as { conversationId?: unknown; messageId?: unknown } | undefined;
      if (typeof value?.conversationId !== 'string' || typeof value.messageId !== 'string') {
        return;
      }

      try {
        const state = await markRead(userId, value.conversationId, value.messageId);
        const participants = await requireParticipant(userId, value.conversationId);

        // The reader is included, unlike typing. Their own other tabs are the
        // reason this event is worth having: reading on the phone should clear
        // the dot on the desktop. The other participant gets it so a sender can
        // tell their message landed.
        for (const participant of participants) {
          io.to(participant).emit('read', {
            conversationId: state.conversationId,
            userId,
            lastReadMessageId: state.lastReadMessageId,
          });
        }
      } catch {
        // A read marker is advisory. The HTTP route is where a client finds out
        // that something was actually wrong with the request.
      }
    });

    socket.on('disconnect', () => {
      void markOnline(userId, false);
    });
  });

  function deliver(message: PostedMessage): void {
    for (const envelope of message.envelopes) {
      // One envelope per recipient: nobody is ever sent a copy sealed for
      // somebody else.
      io.to(envelope.recipientUserId).emit('message:new', {
        id: message.id,
        conversationId: message.conversationId,
        authorId: message.authorId,
        clientId: message.clientId,
        sentAt: message.sentAt,
        ciphertext: envelope.ciphertext,
      });
    }
  }

  /// Presence goes to friends only. It is derived from live connections, which
  /// means it is per-process: correct on one box, wrong the day there are two.
  async function markOnline(userId: string, online: boolean): Promise<void> {
    const before = connections.get(userId) ?? 0;
    const after = online ? before + 1 : Math.max(0, before - 1);

    if (after === 0) connections.delete(userId);
    else connections.set(userId, after);

    // Only the transitions are worth announcing; opening a second tab is not a
    // presence change.
    if (closing || before > 0 === after > 0) return;

    try {
      const friends = await listFriends(userId);
      for (const friend of friends) {
        io.to(friend.id).emit('presence', { userId, online: after > 0 });
      }
    } catch {
      // A presence broadcast that fails must not take the connection with it.
    }
  }

  const sweep = setInterval(() => {
    void (async () => {
      for (const socket of await io.fetchSockets()) {
        const { userId, sessionId } = socket.data as SocketData;
        if (!(await loadLiveSession(userId, sessionId))) socket.disconnect(true);
      }
    })();
  }, SESSION_SWEEP_MS);
  // Node should be free to exit with this timer pending.
  sweep.unref?.();

  return {
    deliver,
    async close() {
      closing = true;
      clearInterval(sweep);
      await io.close();
    },
  };
}

/// The cookie (web) or the handshake auth field (desktop shell), matching the
/// two modes the HTTP API already accepts.
function tokenFrom(socket: Socket): string | null {
  const fromAuth = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
  if (typeof fromAuth === 'string' && fromAuth) return fromAuth;

  const header = socket.handshake.headers.cookie;
  if (!header) return null;

  return fastifyCookie.parse(header)[ACCESS_COOKIE] ?? null;
}

interface SendPayload {
  conversationId: string;
  clientId: string;
  envelopes: { recipientUserId: string; ciphertext: string }[];
}

/// Deliberately strict. Everything past this point trusts the shape, and a
/// socket frame is as untrusted as a request body.
function readSendPayload(payload: unknown): SendPayload {
  const value = payload as Partial<SendPayload> | undefined;

  if (
    !value ||
    typeof value.conversationId !== 'string' ||
    typeof value.clientId !== 'string' ||
    !Array.isArray(value.envelopes) ||
    value.envelopes.length === 0 ||
    !value.envelopes.every(
      (envelope) =>
        typeof envelope?.recipientUserId === 'string' && typeof envelope?.ciphertext === 'string',
    )
  ) {
    throw new AppError(400, 'validation_failed', 'Malformed message.');
  }

  return {
    conversationId: value.conversationId,
    clientId: value.clientId,
    envelopes: value.envelopes,
  };
}

/// Mirrors the HTTP error envelope, so the client branches on one `code` shape
/// whichever way the message travelled.
function toClientError(error: unknown): { code: string; message: string } {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message };
  }
  return { code: 'internal_error', message: 'Something went wrong.' };
}
