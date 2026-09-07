/**
 * A transport that answers locally, so the whole client — optimistic send,
 * acks, the offline queue, reconnect backlog — can be built and tested before
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
  /** Seeded history, keyed by conversation. */
  history?: IncomingMessage[];
}

export class MockTransport implements Transport {
  private connectionState: ConnectionState = 'idle';
  private readonly handlers = new Map<string, Set<(payload: never) => void>>();
  private readonly delivered: IncomingMessage[];
  private sequence = 0;

  latencyMs: number;
  offline: boolean;

  constructor(options: MockTransportOptions = {}) {
    this.latencyMs = options.latencyMs ?? 120;
    this.offline = options.offline ?? false;
    this.delivered = [...(options.history ?? [])];
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
    this.delivered.push({
      id: ack.id,
      clientId: message.clientId,
      conversationId: message.conversationId,
      authorId: 'self',
      sentAt: ack.sentAt,
      ciphertext: message.ciphertext,
    });
    return ack;
  }

  async backlog(conversationId: string, cursor?: string): Promise<IncomingMessage[]> {
    await delay(this.latencyMs);
    const inConversation = this.delivered.filter((m) => m.conversationId === conversationId);
    if (!cursor) return inConversation;
    const index = inConversation.findIndex((m) => m.id === cursor);
    return index === -1 ? inConversation : inConversation.slice(index + 1);
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
