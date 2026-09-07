/**
 * The shapes a socket frame has to have before anything in calls/ trusts it.
 * A frame is as untrusted as a request body, so these are deliberately strict.
 *
 * A session description is opaque here. The client seals it in the same
 * envelope a message body travels in (voice-plan.md, "The encryption story"),
 * so the server relays a string it cannot usefully inspect, and must not try
 * to: the day phase 2 lands, that string is ciphertext, and anything here that
 * had learned to read an SDP would break. The server never needed to.
 */
import { z } from 'zod';

/// Generous for a sealed SDP, which is a few kilobytes, and small enough that a
/// hostile client cannot use the relay to push megabytes at someone.
const SEALED_MAX = 64 * 1024;

export const callIdSchema = z.string().uuid();

/// A serialised envelope from packages/crypto, holding a session description.
export const sealedDescriptionSchema = z.string().min(1).max(SEALED_MAX);

/// An RTCIceCandidateInit. `null` is the browser's end-of-candidates marker and
/// is relayed as it is. Candidates are not sealed: they are addresses, not
/// identity, and a relay could see them anyway.
export const iceCandidateSchema = z
  .object({
    candidate: z.string().max(2048).optional(),
    sdpMid: z.string().max(64).nullable().optional(),
    sdpMLineIndex: z.number().int().min(0).nullable().optional(),
    usernameFragment: z.string().max(256).nullable().optional(),
  })
  .nullable();

export const offerSchema = z.object({
  callId: callIdSchema,
  conversationId: z.string().uuid(),
  toUserId: z.string().uuid(),
  sdp: sealedDescriptionSchema,
});

export const answerSchema = z.object({
  callId: callIdSchema,
  sdp: sealedDescriptionSchema,
});

export const descriptionSchema = z.object({
  callId: callIdSchema,
  sdp: sealedDescriptionSchema,
});

export const candidateSchema = z.object({
  callId: callIdSchema,
  candidate: iceCandidateSchema,
});

export const callRefSchema = z.object({
  callId: callIdSchema,
});
