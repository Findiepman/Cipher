/**
 * The real transport: Socket.io for live delivery, HTTP for the backlog.
 *
 * It implements the same `Transport` interface `MockTransport` does, so the
 * controller, the store and the UI do not know which one they got, which is
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
import { api as defaultApi, conversationsApi, type ApiClient } from '../api';
import { createConversationsApi } from '../api/endpoints';
import {
  SignalRefusedError,
  type CallSignalEventName,
  type CallSignalEvents,
  type CallSignalling,
} from '../call/types';
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
 * It resolves either way: this only bounds how long the caller is made to
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
   * Bearer mode (the desktop app) hands the access token to the handshake.
   * Asked again on every connection attempt, not once: socket.io reconnects
   * on its own, and a token minted at the first connect is long dead by the
   * time a laptop wakes up. Defaults to the API client's own token, refreshed
   * if it is stale. In cookie mode it answers null and the browser sends the
   * cookie itself.
   */
  getToken?: () => Promise<string | null> | string | null;
  /** Injectable so tests can drive a fake API. */
  api?: ApiClient;
  /** Injectable so tests can drive a fake socket. */
  createSocket?: (url: string, getToken: () => Promise<string | null>) => SocketLike;
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
 * outbox reads to stop retrying. A malformed or unauthorised message will be
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
  /**
   * Call signalling, over the same socket. Not part of the Transport
   * interface: the mock transport has no calls to carry, and the engine that
   * uses this is handed it directly by the provider that owns the transport.
   */
  readonly calls: CallSignalling;

  private socket: SocketLike | null = null;
  private connectionState: ConnectionState = 'idle';
  private readonly handlers = new Map<string, Set<(payload: never) => void>>();
  private readonly callHandlers = new Map<string, Set<(payload: never) => void>>();
  private readonly url: string;
  private readonly getToken: () => Promise<string | null>;
  private readonly conversations: ReturnType<typeof createConversationsApi>;
  private readonly createSocket: (url: string, getToken: () => Promise<string | null>) => SocketLike;
  private readonly ackTimeoutMs: number;
  private readonly connectTimeoutMs: number;

  constructor(options: SocketTransportOptions = {}) {
    this.url = options.url ?? config.apiUrl;
    const client = options.api ?? defaultApi;
    const getToken = options.getToken ?? (() => client.getAccessToken());
    this.getToken = () => Promise.resolve(getToken());
    this.conversations = options.api ? createConversationsApi(options.api) : conversationsApi;
    this.createSocket = options.createSocket ?? defaultSocketFactory;
    this.ackTimeoutMs = options.ackTimeoutMs ?? ACK_TIMEOUT_MS;
    this.connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
    this.calls = this.createCallSignalling();
  }

  get state(): ConnectionState {
    return this.connectionState;
  }

  async connect(): Promise<void> {
    if (this.socket) return;

    this.setState('connecting');

    const socket = this.createSocket(this.url, this.getToken);
    this.socket = socket;

    socket.on('connect', () => this.setState('online'));
    socket.on('disconnect', () => {
      this.setState('offline');
      // The server ends any call this socket was in the moment it notices the
      // socket is gone. Telling the engine keeps both sides of the same mind.
      this.emitCall('offline', undefined);
    });
    socket.on('connect_error', () => this.setState('offline'));

    // Call signalling rides the same socket. Relayed to the engine as they
    // are: the server has already validated the shape and the membership.
    socket.on('call:offer', (...args) => {
      this.emitCall('offer', args[0] as CallSignalEvents['offer']);
    });
    socket.on('call:answer', (...args) => {
      this.emitCall('answer', args[0] as CallSignalEvents['answer']);
    });
    socket.on('call:description', (...args) => {
      this.emitCall('description', args[0] as CallSignalEvents['description']);
    });
    socket.on('call:candidate', (...args) => {
      this.emitCall('candidate', args[0] as CallSignalEvents['candidate']);
    });
    socket.on('call:claimed', (...args) => {
      this.emitCall('claimed', args[0] as CallSignalEvents['claimed']);
    });
    socket.on('call:ended', (...args) => {
      this.emitCall('ended', args[0] as CallSignalEvents['ended']);
    });

    socket.on('message:new', (...args) => {
      this.emit('message', toIncoming(args[0] as ServerMessage));
    });

    socket.on('typing', (...args) => {
      const payload = args[0] as { conversationId: string; userId: string };
      this.emit('typing', { channelId: payload.conversationId, userId: payload.userId });
    });

    socket.on('presence', (...args) => {
      this.emit('presence', args[0] as TransportEvents['presence']);
    });

    socket.on('read', (...args) => {
      const payload = args[0] as {
        conversationId: string;
        userId: string;
        lastReadMessageId: string;
      };
      this.emit('read', {
        channelId: payload.conversationId,
        userId: payload.userId,
        lastReadMessageId: payload.lastReadMessageId,
      });
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

  /**
   * Tells the server how far we have read: the socket when there is one, HTTP
   * when there is not. The same split as send(), for the same reason. Both
   * land in the same handler, the position only ever moves forward there, so
   * the two paths cannot disagree about where it ended up.
   *
   * The socket path is fire and forget. There is no ack to wait for: the
   * server answers by broadcasting `read` to every participant, this client
   * included, which is what moves the badge in the tab next door.
   */
  async markRead(channelId: string, messageId: string): Promise<void> {
    if (this.socket?.connected) {
      this.socket.emit('read', { conversationId: channelId, messageId });
      return;
    }

    await this.conversations.markRead(channelId, messageId);
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

  /* --------------------------------------------------------------- calls -- */

  private createCallSignalling(): CallSignalling {
    const withAck = (event: string, payload: unknown): Promise<void> =>
      new Promise((resolve, reject) => {
        const socket = this.socket;
        if (!socket?.connected) {
          return reject(new SignalRefusedError('offline', 'Not connected.'));
        }

        // As with a send: an emit with no reply never settles on its own, and
        // a ring that neither starts nor fails is a button that did nothing.
        const timer = setTimeout(
          () => reject(new Error('The server did not answer.')),
          this.ackTimeoutMs,
        );

        socket.emit(event, payload, (...args: unknown[]) => {
          clearTimeout(timer);
          const ack = args[0] as { ok?: true; error?: { code: string; message: string } } | undefined;
          if (ack?.error) return reject(new SignalRefusedError(ack.error.code, ack.error.message));
          resolve();
        });
      });

    // Fire and forget. The other side either gets it or the call fails on its
    // own, and there is nothing a caller would do with the failure anyway.
    const fire = (event: string, payload: unknown): void => {
      this.socket?.emit(event, payload);
    };

    return {
      offer: (payload) => withAck('call:offer', payload),
      answer: (payload) => withAck('call:answer', payload),
      description: (payload) => fire('call:description', payload),
      candidate: (payload) => fire('call:candidate', payload),
      hangup: (callId) => fire('call:hangup', { callId }),
      reject: (callId) => fire('call:reject', { callId }),
      on: (event, handler) => {
        const set = this.callHandlers.get(event) ?? new Set();
        set.add(handler as (payload: never) => void);
        this.callHandlers.set(event, set);
        return () => {
          set.delete(handler as (payload: never) => void);
        };
      },
    };
  }

  private emitCall<E extends CallSignalEventName>(event: E, payload: CallSignalEvents[E]): void {
    for (const handler of this.callHandlers.get(event) ?? []) {
      (handler as (value: CallSignalEvents[E]) => void)(payload);
    }
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

function defaultSocketFactory(url: string, getToken: () => Promise<string | null>): SocketLike {
  const options = {
    // Cookie mode needs the browser to attach the httpOnly access cookie to
    // the handshake; bearer mode passes the token explicitly instead.
    withCredentials: config.authMode === 'cookie',
    // A function rather than an object, so socket.io asks for the token on
    // every attempt and a reconnect after a long sleep presents a live one.
    auth: (callback: (data: object) => void) => {
      void Promise.resolve(getToken())
        .then((token) => callback(token ? { token } : {}))
        .catch(() => callback({}));
    },
    // socket.io's own backoff. The outbox layers its own on top, for the queue.
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 10_000,
  };

  // An empty url is the same-origin production build (see lib/config.ts).
  // socket.io's one-argument form connects to the page's own origin, which is
  // exactly right there, and is a different overload, not an empty string.
  return (url ? io(url, options) : io(options)) as unknown as SocketLike;
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
