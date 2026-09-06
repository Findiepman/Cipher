/**
 * The real transport: Socket.io for live delivery, HTTP for the backlog.
 *
 * It implements the same `Transport` interface `MockTransport` does, so the
 * controller, the store and the UI do not know which one they got — which is
 * what let all of that be built and tested before this file existed.
 *
 * Two vocabularies meet here and this is the only place they touch. The server
 * says `conversationId`; the UI says `channelId`, because a DM is rendered as
 * one channel among others. Mapping in the adapter is the point of having one.
 *
 * Everything crossing this boundary is already sealed. Nothing here can read a
 * message, and there is deliberately no code path that would let it.
 */
import { io } from 'socket.io-client';
import { conversationsApi, type ApiClient } from '../api';
import { createConversationsApi } from '../api/endpoints';
import { config } from '../config';
import type {
  ConnectionState,
  IncomingMessage,
  MessageAck,
  OutgoingMessage,
  Transport,
  TransportEventName,
  TransportEvents,
} from './types';

/** How long to wait for the server to ack a send before treating it as lost. */
const ACK_TIMEOUT_MS = 10_000;

/**
 * How long connect() waits for a verdict before handing control back.
 *
 * It resolves either way — this only bounds how long the caller is made to
 * wait. ChatController.start() awaits connect() before pulling the backlog and
 * flushing the outbox, so a connect that never settles would take the whole
 * chat startup with it. The socket keeps trying to reconnect regardless.
 */
const CONNECT_TIMEOUT_MS = 5_000;

/**
 * The slice of socket.io-client this file actually uses.
 *
 * Narrow on purpose: it is the seam a test substitutes to drive acks, errors
 * and timeouts deterministically, without standing up a server to reproduce a
 * malformed reply.
 */
export interface SocketLike {
  readonly connected: boolean;
  on(event: string, handler: (...args: unknown[]) => void): unknown;
  once(event: string, handler: (...args: unknown[]) => void): unknown;
  emit(event: string, ...args: unknown[]): unknown;
  disconnect(): unknown;
}

export interface SocketTransportOptions {
  /** Defaults to the API origin: the socket and the API share a host. */
  url?: string;
  /**
   * Bearer mode (the desktop shell) hands the access token to the handshake.
   * In cookie mode this is absent and the browser sends the cookie itself.
   */
  getToken?: () => string | null;
  /** Injectable so tests can drive a fake API. */
  api?: ApiClient;
  /** Injectable so tests can drive a fake socket. */
  createSocket?: (url: string, token: string | null) => SocketLike;
  ackTimeoutMs?: number;
  connectTimeoutMs?: number;
}

interface ServerMessage {
  id: string;
  conversationId: string;
  authorId: string;
  clientId: string;
  sentAt: string;
  ciphertext: string;
}

interface SendAck {
  id?: string;
  clientId?: string;
  sentAt?: string;
  error?: { code: string; message: string };
}

/**
 * A send the server actively refused. `isTransient: false` is the signal the
 * outbox reads to stop retrying — a malformed or unauthorised message will be
 * just as malformed in thirty seconds, and retrying it forever would block
 * every message queued behind it.
 */
export class SendRejectedError extends Error {
  readonly isTransient = false;

  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'SendRejectedError';
  }
}

/** A send that failed for a reason that might not be true later. */
export class SendFailedError extends Error {
  readonly isTransient = true;

  constructor(message: string) {
    super(message);
    this.name = 'SendFailedError';
  }
}

export class SocketTransport implements Transport {
  private socket: SocketLike | null = null;
  private connectionState: ConnectionState = 'idle';
  private readonly handlers = new Map<string, Set<(payload: never) => void>>();
  private readonly url: string;
  private readonly getToken: () => string | null;
  private readonly conversations: ReturnType<typeof createConversationsApi>;
  private readonly createSocket: (url: string, token: string | null) => SocketLike;
  private readonly ackTimeoutMs: number;
  private readonly connectTimeoutMs: number;

  constructor(options: SocketTransportOptions = {}) {
    this.url = options.url ?? config.apiUrl;
    this.getToken = options.getToken ?? (() => null);
    this.conversations = options.api ? createConversationsApi(options.api) : conversationsApi;
    this.createSocket = options.createSocket ?? defaultSocketFactory;
    this.ackTimeoutMs = options.ackTimeoutMs ?? ACK_TIMEOUT_MS;
    this.connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
  }

  get state(): ConnectionState {
    return this.connectionState;
  }

  async connect(): Promise<void> {
    if (this.socket) return;

    this.setState('connecting');

    const socket = this.createSocket(this.url, this.getToken());
    this.socket = socket;

    socket.on('connect', () => this.setState('online'));
    socket.on('disconnect', () => this.setState('offline'));
    socket.on('connect_error', () => this.setState('offline'));

    socket.on('message:new', (...args) => {
      this.emit('message', toIncoming(args[0] as ServerMessage));
    });

    socket.on('typing', (...args) => {
      const payload = args[0] as { conversationId: string; userId: string };
      this.emit('typing', { channelId: payload.conversationId, userId: payload.userId });
    });

    socket.on('presence', (...args) => {
      this.emit('presence', args[0] as { userId: string; online: boolean });
    });

    // Resolves on the first outcome either way, and on a deadline if neither
    // arrives: a caller must not block on a connection that may legitimately
    // take minutes to come back. Everything downstream copes with being
    // offline, and the socket keeps retrying in the background.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, this.connectTimeoutMs);
      const settle = () => {
        clearTimeout(timer);
        resolve();
      };
      socket.once('connect', settle);
      socket.once('connect_error', settle);
    });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.setState('idle');
  }

  /**
   * Sends over the socket, falling back to HTTP when there is no live one.
   * Both land in the same server handler, keyed on the same `clientId`, so a
   * message that goes out both ways is stored once.
   */
  async send(message: OutgoingMessage): Promise<MessageAck> {
    const payload = {
      conversationId: message.channelId,
      clientId: message.clientId,
      envelopes: message.envelopes,
    };

    if (this.socket?.connected) return this.sendOverSocket(payload);

    // Unwrapped on purpose: ApiError already carries `isTransient`, which is
    // exactly what the outbox reads to decide between retrying and giving up.
    const stored = await this.conversations.send(message.channelId, {
      clientId: message.clientId,
      envelopes: message.envelopes,
    });
    return { clientId: stored.clientId, id: stored.id, sentAt: stored.sentAt };
  }

  async backlog(channelId: string, cursor?: string): Promise<IncomingMessage[]> {
    const { messages } = await this.conversations.messages(channelId, cursor);
    return messages.map(toIncoming);
  }

  on<E extends TransportEventName>(
    event: E,
    handler: (payload: TransportEvents[E]) => void,
  ): () => void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler as (payload: never) => void);
    this.handlers.set(event, set);
    return () => {
      set.delete(handler as (payload: never) => void);
    };
  }

  /** Tells the other side we are typing. Advisory: failure is not reported. */
  notifyTyping(channelId: string): void {
    this.socket?.emit('typing', { conversationId: channelId });
  }

  private sendOverSocket(payload: {
    conversationId: string;
    clientId: string;
    envelopes: OutgoingMessage['envelopes'];
  }): Promise<MessageAck> {
    return new Promise((resolve, reject) => {
      // A socket.io emit with no reply never settles on its own. Without this
      // timeout a message sent into a half-open connection would sit in the
      // outbox forever, neither sent nor retried.
      const timer = setTimeout(
        () => reject(new SendFailedError('The server did not acknowledge the message.')),
        this.ackTimeoutMs,
      );

      this.socket!.emit('message:send', payload, (...args: unknown[]) => {
        clearTimeout(timer);
        const ack = args[0] as SendAck | undefined;

        if (ack?.error) {
          return reject(new SendRejectedError(ack.error.code, ack.error.message));
        }
        if (!ack?.id || !ack.sentAt) {
          return reject(new SendFailedError('The server sent a malformed acknowledgement.'));
        }

        resolve({ clientId: payload.clientId, id: ack.id, sentAt: ack.sentAt });
      });
    });
  }

  private setState(state: ConnectionState): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    this.emit('state', state);
  }

  private emit<E extends TransportEventName>(event: E, payload: TransportEvents[E]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      (handler as (value: TransportEvents[E]) => void)(payload);
    }
  }
}

function defaultSocketFactory(url: string, token: string | null): SocketLike {
  return io(url, {
    // Cookie mode needs the browser to attach the httpOnly access cookie to
    // the handshake; bearer mode passes the token explicitly instead.
    withCredentials: config.authMode === 'cookie',
    auth: token ? { token } : {},
    // socket.io's own backoff. The outbox layers its own on top, for the queue.
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 10_000,
  }) as unknown as SocketLike;
}

/** The one place `conversationId` becomes `channelId`. */
function toIncoming(message: ServerMessage): IncomingMessage {
  return {
    id: message.id,
    clientId: message.clientId,
    channelId: message.conversationId,
    authorId: message.authorId,
    sentAt: message.sentAt,
    ciphertext: message.ciphertext,
  };
}
