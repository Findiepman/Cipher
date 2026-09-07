/**
 * A transport that answers locally, so the whole client (optimistic send,
 * acks, the offline queue, reconnect backlog) can be built and tested before
 * server/ has a messaging layer at all.
 *
 * It is also the thing to reach for when reproducing a delivery bug: latency
 * and offline are properties you set, not conditions you wait for.
 */
import type {
  ConnectionState,
  IncomingMessage,
  MessageAck,
  OutgoingMessage,
  Transport,
  TransportEventName,
  TransportEvents,
} from './types';

export interface MockTransportOptions {
  /** Simulated round-trip time for a send. */
  latencyMs?: number;
  /** When true, sends reject the way a dropped connection would. */
  offline?: boolean;
  /** Seeded history, keyed by channel. */
  history?: IncomingMessage[];
  /**
   * Who this transport is answering as. Decides which envelope of a sent
   * message comes back in the backlog, the way the real server hands each
   * client only the copy addressed to them.
   */
  selfUserId?: string;
}

export class MockTransport implements Transport {
  private connectionState: ConnectionState = 'idle';
  private readonly handlers = new Map<string, Set<(payload: never) => void>>();
  private readonly delivered: IncomingMessage[];
  private readonly selfUserId: string;
  private sequence = 0;

  latencyMs: number;
  offline: boolean;

  constructor(options: MockTransportOptions = {}) {
    this.latencyMs = options.latencyMs ?? 120;
    this.offline = options.offline ?? false;
    this.delivered = [...(options.history ?? [])];
    this.selfUserId = options.selfUserId ?? 'self';
  }

  get state(): ConnectionState {
    return this.connectionState;
  }

  async connect(): Promise<void> {
    this.setState('connecting');
    await delay(this.latencyMs);
    this.setState(this.offline ? 'offline' : 'online');
  }

  disconnect(): void {
    this.setState('idle');
  }

  async send(message: OutgoingMessage): Promise<MessageAck> {
    await delay(this.latencyMs);
    if (this.offline) {
      this.setState('offline');
      throw new Error('offline');
    }
    this.sequence += 1;
    const ack: MessageAck = {
      clientId: message.clientId,
      id: `srv-${this.sequence}-${message.clientId}`,
      sentAt: new Date().toISOString(),
    };
    // Keep only the copy addressed to us, and fall back to the first envelope
    // so a caller that has not bothered with identities still gets something
    // readable back.
    const own =
      message.envelopes.find((envelope) => envelope.recipientUserId === this.selfUserId) ??
      message.envelopes[0];

    this.delivered.push({
      id: ack.id,
      clientId: message.clientId,
      channelId: message.channelId,
      authorId: this.selfUserId,
      sentAt: ack.sentAt,
      ciphertext: own.ciphertext,
    });
    return ack;
  }

  async backlog(channelId: string, cursor?: string): Promise<IncomingMessage[]> {
    await delay(this.latencyMs);
    const inChannel = this.delivered.filter((m) => m.channelId === channelId);
    if (!cursor) return inChannel;
    const index = inChannel.findIndex((m) => m.id === cursor);
    return index === -1 ? inChannel : inChannel.slice(index + 1);
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

  /** Test/dev hook: pretend someone else sent something. */
  receive(message: IncomingMessage): void {
    this.delivered.push(message);
    this.emit('message', message);
  }

  /** Test/dev hook: pull the plug, then put it back. */
  setOffline(offline: boolean): void {
    this.offline = offline;
    this.setState(offline ? 'offline' : 'online');
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

function delay(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}
