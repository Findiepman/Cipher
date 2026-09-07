export type Presence = 'online' | 'idle' | 'dnd' | 'offline';

export interface User {
  id: string;
  name: string;
  /** Fallback avatar tint, used when there is no `avatarUrl`. */
  color: string;
  /**
   * A picture, if this user has one. Today only the signed-in user can set one
   * and it lives on their device (see lib/settings); once the server grows an
   * avatar endpoint this becomes the URL it hands out.
   */
  avatarUrl?: string;
  /** Short form of the device key's fingerprint, shown beside the name. */
  fingerprint: string;
  presence: Presence;
  /**
   * Whether this account's key has been checked out of band. Unverified is a
   * real state rather than an error, and the UI says so instead of implying a
   * safety it cannot promise.
   */
  verified?: boolean;
  /** Short status line under the name. */
  activity?: string;
  bot?: boolean;
}

/**
 * A 1:1 conversation, and the only container this app has.
 *
 * There are no servers, channels or groups: a two-party thread is the one
 * shape `crypto_box` maps onto directly (seal to the recipient's public key,
 * open with your own), so nothing here has to pretend a group key model has
 * been chosen. See packages/crypto/AGENTS.md.
 */
export interface Conversation {
  id: string;
  /** The other participant. */
  participantId: string;
  /** Unread messages, badged on the row. */
  unread?: number;
}

/**
 * Where a message sits in the crypto pipeline. The UI has to render all four
 * states because with real E2EE a client can legitimately hold a message it
 * cannot read (missing key, key rotated, sender's device unknown).
 */
export type MessageState = 'sending' | 'decrypted' | 'encrypted' | 'failed';

export interface Message {
  /** The server's id once it has one; the clientId until then. */
  id: string;
  /**
   * Set on a message this device composed, and kept after the server assigns a
   * real id. It is how an optimistic bubble is recognised as the same message
   * when it comes back from the server, rather than rendered twice.
   */
  clientId?: string;
  conversationId: string;
  authorId: string;
  sentAt: string;
  state: MessageState;
  /** Plaintext, only ever present after local decryption. */
  body: string | null;
  /** Base64 blob exactly as the server stores it. */
  ciphertext: string;
  /** Why a 'failed' message failed, in words the UI can show. */
  error?: string;
  edited?: boolean;
}
