/**
 * The real-time transport, behind an interface.
 *
 * server/ will speak Socket.io (stack.md), but the messaging endpoints do not
 * exist yet: the backend is building accounts and auth first. So the app talks
 * to this interface, `MockTransport` implements it against local fixtures, and
 * a `SocketTransport` drops in later without the store or the UI changing.
 *
 * Everything crossing this boundary is already sealed. The transport moves
 * opaque blobs and never sees plaintext, which is what makes it swappable, and
 * what stops "just log the message to debug it" from being possible here.
 */

export type ConnectionState = 'idle' | 'connecting' | 'online' | 'offline';

/**
 * One sealed copy of a message, addressed to one participant.
 *
 * There is a copy per participant *including the sender* because `crypto_box`
 * seals to exactly one recipient: a message sealed for the person you are
 * talking to cannot be opened by you. Without a copy addressed to yourself, a
 * sender signing in on a fresh device would find their own history unreadable.
 *
 * Phase 1 puts the same `alg: 'none'` blob in every envelope, so this costs a
 * row per participant today and saves a migration when phase 2 lands.
 */
export interface Envelope {
  recipientUserId: string;
  /** Serialized Ciphertext from packages/crypto. Opaque here. */
  ciphertext: string;
}

/** A message on its way out. `clientId` is generated locally for dedupe. */
export interface OutgoingMessage {
  clientId: string;
  channelId: string;
  /**
   * One per participant, sender included. The server checks the recipient set
   * matches the channel's participants and stores the blobs without reading
   * them.
   */
  envelopes: Envelope[];
  sentAt: string;
}

/**
 * A message arriving from the server, still sealed. One `ciphertext`, not a
 * list: the server hands each client only the envelope addressed to them, so a
 * recipient never receives a copy they could not open anyway.
 */
export interface IncomingMessage {
  id: string;
  /** Present when this is the server's echo of something we sent. */
  clientId?: string;
  channelId: string;
  authorId: string;
  sentAt: string;
  ciphertext: string;
}

export interface MessageAck {
  clientId: string;
  /** The server-assigned id, which replaces the optimistic one. */
  id: string;
  sentAt: string;
}

export interface TransportEvents {
  message: IncomingMessage;
  state: ConnectionState;
  typing: { channelId: string; userId: string };
  /**
   * Derived from live connections and sent to friends only. It says whether
   * someone has a client connected, which is all the server can know. It is
   * not a claim that they are reading anything.
   */
  presence: { userId: string; online: boolean };
  /**
   * Somebody moved their read position in a channel.
   *
   * Sent to every participant, the reader included, which is the case this
   * mostly exists for: reading a conversation on one device is what clears the
   * unread count on the other. The position is a message id, because the
   * server can order messages but cannot read them.
   */
  read: { channelId: string; userId: string; lastReadMessageId: string };
}

export type TransportEventName = keyof TransportEvents;

export interface Transport {
  readonly state: ConnectionState;
  connect(): Promise<void>;
  disconnect(): void;
  /** Rejects on failure; the outbox decides whether to retry. */
  send(message: OutgoingMessage): Promise<MessageAck>;
  /**
   * Everything in a channel after `cursor` (a message id). The client asks for
   * this on reconnect: the server cannot tell us "what's new" for a channel it
   * cannot read, so the cursor is the client's own last-seen id.
   */
  backlog(channelId: string, cursor?: string): Promise<IncomingMessage[]>;
  /**
   * How far this client has read in a channel. A message id, for the same
   * reason the cursor above is one.
   *
   * Rejects on failure, so a caller can try again later. Read state is not
   * worth blocking anything on, but silently losing it means an unread count
   * that never clears.
   */
  markRead(channelId: string, messageId: string): Promise<void>;
  on<E extends TransportEventName>(
    event: E,
    handler: (payload: TransportEvents[E]) => void,
  ): () => void;
}
