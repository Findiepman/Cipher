import { z } from 'zod';

/// A serialized Ciphertext from packages/crypto. Opaque here, permanently: the
/// only thing this server is allowed to know about it is how many bytes it is.
const ciphertextSchema = z.string().min(1).max(32 * 1024);

export const openDmSchema = z.object({
  userId: z.string().uuid(),
});

export const conversationIdSchema = z.object({
  id: z.string().uuid(),
});

/// One sealed copy per participant, the author included. The author's own copy
/// is not an optimisation - crypto_box seals to one recipient, so without it a
/// sender could not read their own history on a second device.
export const sendMessageSchema = z.object({
  /// The sender's own id, echoed back. Unique per conversation, which is what
  /// makes a send retried across a flaky reconnect one message and not two.
  clientId: z.string().trim().min(1).max(128),
  envelopes: z
    .array(
      z.object({
        recipientUserId: z.string().uuid(),
        ciphertext: ciphertextSchema,
      }),
    )
    .min(1)
    .max(64),
});

/// Marking read is expressed as a message id for the same reason a cursor is:
/// the server can order messages but cannot read them, so "up to here" is the
/// only thing the client can say and the only thing the server can act on.
export const markReadSchema = z.object({
  messageId: z.string().uuid(),
});

export const backlogQuerySchema = z.object({
  /// A message id. The client's own last-seen, because the server cannot tell
  /// anyone "what is new" in a conversation it cannot read.
  after: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type MarkReadInput = z.infer<typeof markReadSchema>;
export type BacklogQuery = z.infer<typeof backlogQuerySchema>;
