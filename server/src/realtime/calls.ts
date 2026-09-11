/**
 * Call signalling over the socket layer.
 *
 * The server relays session descriptions and ICE candidates between two
 * browsers and keeps track of who is ringing whom. It never sees the media:
 * that runs browser to browser over DTLS-SRTP. The descriptions it relays
 * arrive sealed in the same envelope a message body does, so `sdp` below is an
 * opaque string this process must not try to read. Since phase 2 that
 * envelope is a real box to the peer's key, so a hostile server cannot open
 * it, rewrite the DTLS fingerprint inside and sit in the middle, which was
 * the standard WebRTC threat model (voice-plan.md) until then. Calls and
 * messages were closed in the same commit, which is the point of the shared
 * seam.
 *
 * Events, client to server. Every one takes an optional ack answered with
 * `{ ok: true }` or `{ error: { code, message } }`, the same envelope
 * `message:send` uses, so a refused call is reported rather than dropped:
 *
 *   call:offer        { callId, conversationId, toUserId, sdp }
 *   call:answer       { callId, sdp }
 *   call:description  { callId, sdp }       renegotiation, connected only
 *   call:candidate    { callId, candidate }
 *   call:hangup       { callId }            caller cancelling, or either side
 *   call:reject       { callId }            the callee declining a ring
 *
 * Server to client, each to a user's room so every tab hears it:
 *
 *   call:offer        { callId, conversationId, fromUserId, sdp }   to callee
 *   call:answer       { callId, sdp }                               to caller
 *   call:claimed      { callId }             to the callee's own room, so the
 *                                            tabs that did not answer stop ringing
 *   call:description  { callId, sdp }                          to the other side
 *   call:candidate    { callId, candidate }                    to the other side
 *   call:ended        { callId, reason }                       to both sides
 *
 * A refused offer (busy, not friends, malformed) rides the ack and nothing is
 * broadcast, because no call was ever registered.
 */
import type { Server, Socket } from 'socket.io';
import { AppError } from '../lib/errors.js';
import { loadLiveSession } from '../lib/session-guard.js';
import { parseBody } from '../lib/validate.js';
import { requireParticipant } from '../modules/conversations/service.js';
import { requireFriendship } from '../modules/friends/service.js';
import { CallRegistry, type ActiveCall, type EndReason } from '../modules/calls/registry.js';
import {
  answerSchema,
  callRefSchema,
  candidateSchema,
  descriptionSchema,
  offerSchema,
} from '../modules/calls/schemas.js';

/// Thirty seconds of ringing, then `no_answer`. Long enough to cross a room,
/// short enough that a phone left on a desk does not ring all afternoon.
export const DEFAULT_RING_TIMEOUT_MS = 30_000;

export interface CallSignallingOptions {
  ringTimeoutMs?: number;
}

export interface CallSignalling {
  /// Registers the call handlers on a freshly authenticated socket.
  attach(socket: Socket, userId: string, sessionId: string): void;
  /// The socket went away. Any call it was a party to ends, and the other side
  /// is told, so a caller who closes the tab mid-ring does not leave a phone
  /// ringing.
  detach(socket: Socket): void;
  close(): void;
}

type Ack = ((result: unknown) => void) | undefined;

export function createCallSignalling(
  io: Server,
  options: CallSignallingOptions = {},
): CallSignalling {
  const registry = new CallRegistry({
    ringTimeoutMs: options.ringTimeoutMs ?? DEFAULT_RING_TIMEOUT_MS,
    onExpire: (call) => announceEnded(call, 'no_answer'),
  });

  function announceEnded(call: ActiveCall, reason: EndReason): void {
    const payload = { callId: call.id, reason };
    io.to(call.callerId).emit('call:ended', payload);
    io.to(call.calleeId).emit('call:ended', payload);
  }

  /// Runs a handler and turns its outcome into the ack envelope. A handler
  /// that throws an AppError has refused the frame on purpose; anything else
  /// is reported as a generic failure and never as its message.
  async function answer(ack: Ack, handler: () => Promise<void> | void): Promise<void> {
    try {
      await handler();
      ack?.({ ok: true });
    } catch (error) {
      ack?.({ error: toClientError(error) });
    }
  }

  return {
    attach(socket, userId, sessionId) {
      socket.on('call:offer', (payload: unknown, ack?: Ack) =>
        answer(ack, async () => {
          const offer = parseBody(offerSchema, payload);

          if (offer.toUserId === userId) {
            throw new AppError(400, 'cannot_call_self', 'You cannot call yourself.');
          }

          // The socket has outlived its access token by now more often than
          // not, and a revoked session must not be able to ring anyone.
          if (!(await loadLiveSession(userId, sessionId))) {
            throw new AppError(401, 'session_revoked', 'Sign in again.');
          }

          // The same gates a message goes through. The callee has to be in
          // the conversation, and the two of you have to still be friends:
          // unfriending stops calls the way it stops new messages.
          const participants = await requireParticipant(userId, offer.conversationId);
          if (!participants.includes(offer.toUserId)) {
            throw new AppError(404, 'conversation_not_found', 'No such conversation.');
          }
          await requireFriendship(userId, offer.toUserId);

          const call = registry.offer({
            callId: offer.callId,
            conversationId: offer.conversationId,
            callerId: userId,
            calleeId: offer.toUserId,
            socketId: socket.id,
          });

          io.to(call.calleeId).emit('call:offer', {
            callId: call.id,
            conversationId: call.conversationId,
            fromUserId: userId,
            sdp: offer.sdp,
          });
        }),
      );

      socket.on('call:answer', (payload: unknown, ack?: Ack) =>
        answer(ack, async () => {
          const { callId, sdp } = parseBody(answerSchema, payload);

          if (!(await loadLiveSession(userId, sessionId))) {
            throw new AppError(401, 'session_revoked', 'Sign in again.');
          }

          const call = registry.answer(callId, userId, socket.id);

          io.to(call.callerId).emit('call:answer', { callId, sdp });
          // The answering tab has already left the ringing state and ignores
          // this. Every other tab of the same account is still ringing, and
          // this is what stops them.
          io.to(call.calleeId).emit('call:claimed', { callId });
        }),
      );

      socket.on('call:description', (payload: unknown, ack?: Ack) =>
        answer(ack, () => {
          const { callId, sdp } = parseBody(descriptionSchema, payload);
          const call = registry.require(callId, userId);
          if (call.state !== 'connected') {
            throw new AppError(409, 'call_not_connected', 'That call has not been answered.');
          }
          io.to(CallRegistry.otherParty(call, userId)).emit('call:description', { callId, sdp });
        }),
      );

      socket.on('call:candidate', (payload: unknown, ack?: Ack) =>
        answer(ack, () => {
          const { callId, candidate } = parseBody(candidateSchema, payload);
          // Allowed while ringing: the caller's candidates trickle out before
          // anyone has picked up, and the callee buffers them until then.
          const call = registry.require(callId, userId);
          io.to(CallRegistry.otherParty(call, userId)).emit('call:candidate', {
            callId,
            candidate,
          });
        }),
      );

      socket.on('call:hangup', (payload: unknown, ack?: Ack) =>
        answer(ack, () => {
          const { callId } = parseBody(callRefSchema, payload);
          registry.require(callId, userId);
          const call = registry.end(callId);
          if (call) announceEnded(call, 'hangup');
        }),
      );

      socket.on('call:reject', (payload: unknown, ack?: Ack) =>
        answer(ack, () => {
          const { callId } = parseBody(callRefSchema, payload);
          const call = registry.require(callId, userId);
          if (call.calleeId !== userId || call.state !== 'ringing') {
            throw new AppError(409, 'call_not_ringing', 'Only a ringing call can be declined.');
          }
          const ended = registry.end(callId);
          if (ended) announceEnded(ended, 'rejected');
        }),
      );
    },

    detach(socket) {
      for (const call of registry.endForSocket(socket.id)) {
        announceEnded(call, 'disconnected');
      }
    },

    close() {
      registry.close();
    },
  };
}

/// Mirrors the HTTP error envelope, as message:send does.
function toClientError(error: unknown): { code: string; message: string } {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message };
  }
  return { code: 'internal_error', message: 'Something went wrong.' };
}
