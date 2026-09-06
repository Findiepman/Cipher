export type Presence = 'online' | 'idle' | 'dnd' | 'offline';

export interface User {
  id: string;
  name: string;
  /** Fallback avatar tint; real avatars replace this later. */
  color: string;
  /** Short form of the device key's fingerprint, shown beside the name. */
  fingerprint: string;
  presence: Presence;
  /**
   * Whether this account's key has been checked out of band. Unverified is a
   * real state, not an error — the UI says so rather than implying safety it
   * cannot promise.
   */
  verified?: boolean;
  /** Short status line under the name. */
  activity?: string;
  bot?: boolean;
}

/**
 * A 1:1 conversation. There are no servers, channels or groups: v1 is direct
 * messages only, which is the one shape `crypto_box` maps onto cleanly.
 */
export interface Conversation {
  id: string;
  /** The other participant. */
  participantId: string;
  unread?: number;
}

/**
 * Where a message sits in the crypto pipeline. The UI has to render all four
 * states because with real E2EE a client can legitimately hold a message it
 * cannot read (missing key, key rotated, sender's device unknown).
 */
export type MessageState = 'sending' | 'decrypted' | 'encrypted' | 'failed';

export interface Message {
  id: string;
  conversationId: string;
  authorId: string;
  sentAt: string;
  state: MessageState;
  /** Plaintext, only ever present after local decryption. */
  body: string | null;
  /** Base64 blob exactly as the server stores it. */
  ciphertext: string;
  edited?: boolean;
}
