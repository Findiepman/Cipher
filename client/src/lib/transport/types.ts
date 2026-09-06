/**
 * The real-time transport, behind an interface.
 *
 * server/ will speak Socket.io (stack.md), but the messaging endpoints do not
 * exist yet — the backend is building accounts and auth first. So the app talks
 * to this interface, `MockTransport` implements it against local fixtures, and
 * a `SocketTransport` drops in later without the store or the UI changing.
 *
 * Everything crossing this boundary is already sealed. The transport moves
 * opaque blobs and never sees plaintext, which is what makes it swappable — and
 * what stops "just log the message to debug it" from being possible here.
 */

export type ConnectionState = 'idle' | 'connecting' | 'online' | 'offline';

/** A message on its way out. `clientId` is generated locally for dedupe. */
export interface OutgoingMessage {
  clientId: string;
  channelId: string;
  /** Serialized Ciphertext from packages/crypto. Opaque here. */
  ciphertext: string;
  sentAt: string;
}

/** A message arriving from the server, still sealed. */
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
   * this on reconnect — the server cannot tell us "what's new" for a channel it
   * cannot read, so the cursor is the client's own last-seen id.
   */
  backlog(channelId: string, cursor?: string): Promise<IncomingMessage[]>;
  on<E extends TransportEventName>(
    event: E,
    handler: (payload: TransportEvents[E]) => void,
  ): () => void;
}
