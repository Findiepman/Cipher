export type Presence = 'online' | 'idle' | 'dnd' | 'offline';

export interface User {
  id: string;
  /**
   * What to draw. The nickname when there is one, the username otherwise, so
   * no component has to decide which of the two it is looking at.
   */
  name: string;
  /** The handle they actually registered. Never rewritten by a nickname. */
  username: string;
  /** Set only when you have renamed this person. Yours alone; they never see it. */
  nickname?: string;
  /** Fallback avatar tint; real avatars replace this later. */
  color: string;
  presence: Presence;
  /** Short status line under the name. */
  activity?: string;
  bot?: boolean;
}

/** A server in the sidebar. Grouping only: it holds no key material. */
export interface Server {
  id: string;
  name: string;
  /** Two-letter fallback shown before an icon is uploaded. */
  monogram: string;
  /** Fallback tint for the monogram. */
  color: string;
  unread?: boolean;
  mentions?: number;
}

/**
 * A channel, or a DM rendered as one.
 *
 * `kind: 'dm'` is the only one encryption covers today: it maps straight onto
 * `crypto_box`, whereas group channels need a key model that has not been
 * chosen yet (see packages/crypto/AGENTS.md). DMs hang off the pseudo-server
 * `@me` so the sidebar can treat both the same way without the message
 * pipeline pretending a group channel is a solved problem.
 */
export interface Channel {
  id: string;
  /** Owning server, or `'@me'` for a direct message. */
  serverId: string;
  kind: 'text' | 'voice' | 'dm';
  name: string;
  /** Sidebar grouping header. Absent for DMs. */
  category?: string;
  topic?: string;
  /** The other participant. Set only when `kind` is `'dm'`. */
  recipientId?: string;
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
  channelId: string;
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
