/**
 * Where a typed message becomes a sealed blob on the wire, and where a blob off
 * the wire becomes something the UI can render.
 *
 * This is the only place in the frontend that calls encryptMessage /
 * decryptMessage (client/AGENTS.md). Components receive already-decrypted
 * Message objects and never touch the crypto module.
 *
 * The send path is deliberately optimistic-then-queued:
 *   seal -> show immediately as "sending" -> enqueue -> flush
 * so a message typed with no connection is on screen and in the outbox, not
 * lost, and the same code path handles online and offline.
 */
import {
  decryptMessage,
  encryptMessage,
  parseCiphertext,
  serializeCiphertext,
} from '@cipher/crypto';
import { Outbox } from '../lib/transport/outbox';
import type {
  ConnectionState,
  IncomingMessage,
  OutgoingMessage,
  Transport,
} from '../lib/transport/types';
import type { Message } from '../types';
import { chatReducer, initialChatState, type ChatAction, type ChatState } from './chatStore';

export interface ChatIdentity {
  userId: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

export interface ChatControllerOptions {
  transport: Transport;
  outbox?: Outbox;
  /**
   * Resolves the public key to seal to for a channel. Phase 1 ignores the
   * result; phase 2 cannot send without it, which is why the seam exists now.
   */
  resolveRecipientKey?: (conversationId: string) => Promise<Uint8Array | null>;
}

export class ChatController {
  private state: ChatState = initialChatState;
  private identity: ChatIdentity | null = null;
  private readonly listeners = new Set<(state: ChatState) => void>();
  private readonly transport: Transport;
  private readonly outbox: Outbox;
  private readonly resolveRecipientKey: (conversationId: string) => Promise<Uint8Array | null>;
  private unsubscribers: (() => void)[] = [];
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: ChatControllerOptions) {
    this.transport = options.transport;
    this.outbox = options.outbox ?? new Outbox();
    this.resolveRecipientKey = options.resolveRecipientKey ?? (async () => null);
  }

  get snapshot(): ChatState {
    return this.state;
  }

  get connection(): ConnectionState {
    return this.transport.state;
  }

  get queuedCount(): number {
    return this.outbox.size;
  }

  subscribe(listener: (state: ChatState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The identity must be unlocked before anything can be sealed or opened. */
  setIdentity(identity: ChatIdentity | null): void {
    this.identity = identity;
  }

  seed(messages: Message[]): void {
    this.dispatch({ type: 'seed', messages });
  }

  async start(): Promise<void> {
    await this.outbox.load();
    this.unsubscribers.push(
      this.transport.on('message', (incoming) => {
        void this.ingest(incoming);
      }),
      this.transport.on('state', (state) => {
        // Anything queued while offline goes out the moment we are back, and
        // without waiting out a backoff that was caused by being offline.
        if (state === 'online') {
          void this.outbox.resetBackoff().then(() => this.flush());
        }
        this.emit();
      }),
    );
    await this.transport.connect();
    await this.flush();
  }

  stop(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.transport.disconnect();
  }

  /**
   * Seals, shows, queues, and tries to send. Returns once the message is
   * durably queued — not once it is delivered — so the UI never blocks on the
   * network.
   */
  async send(conversationId: string, body: string): Promise<void> {
    const identity = this.requireIdentity();
    const clientId = newClientId();
    const sentAt = new Date().toISOString();

    const recipientKey = (await this.resolveRecipientKey(conversationId)) ?? identity.publicKey;
    const ciphertext = serializeCiphertext(
      await encryptMessage(body, recipientKey, identity.privateKey),
    );

    this.dispatch({
      type: 'sending',
      message: {
        id: clientId,
        clientId,
        conversationId,
        authorId: identity.userId,
        sentAt,
        state: 'sending',
        // Held locally so the sender can read their own message. It is never
        // sent anywhere in this form.
        body,
        ciphertext,
      },
    });

    await this.outbox.enqueue({ clientId, conversationId, ciphertext, sentAt });
    await this.flush();
  }

  /** Drains the outbox. Safe to call on reconnect, on a timer, or on send. */
  async flush(): Promise<void> {
    const result = await this.outbox.flush((message: OutgoingMessage) =>
      this.transport.send(message),
    );

    for (const ack of result.sent) {
      this.dispatch({ type: 'sent', clientId: ack.clientId, id: ack.id, sentAt: ack.sentAt });
    }
    for (const failure of result.failed) {
      this.dispatch({
        type: 'sendFailed',
        clientId: failure.entry.clientId,
        error: failure.entry.lastError ?? 'Could not send',
      });
    }
    if (result.sent.length > 0 || result.failed.length > 0) this.emit();
    this.scheduleRetry();
  }

  /**
   * Keeps the queue moving on its own. Without this, a message that failed into
   * a backoff window would wait for the user to do something else before it was
   * tried again — which is exactly when they have stopped watching.
   */
  private scheduleRetry(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const dueAt = this.outbox.nextDueAt();
    if (dueAt === null) return;

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flush();
    }, Math.max(0, dueAt - Date.now()));
  }

  /** Pulls everything this client missed, then opens what it can. */
  async syncConversation(conversationId: string): Promise<void> {
    const cursor = this.state.cursors[conversationId];
    const backlog = await this.transport.backlog(conversationId, cursor);
    const messages = await Promise.all(backlog.map((incoming) => this.open(incoming)));
    this.dispatch({ type: 'backlog', conversationId, messages });
  }

  private async ingest(incoming: IncomingMessage): Promise<void> {
    this.dispatch({ type: 'received', message: await this.open(incoming) });
  }

  /**
   * Turns a sealed blob into a renderable message. A failure here is a normal,
   * expected outcome — a key we do not have, a rotated key, a device we have
   * never seen — so it produces a locked bubble, never a dropped message and
   * never a thrown error that would take the conversation down with it.
   */
  private async open(incoming: IncomingMessage): Promise<Message> {
    const base: Message = {
      id: incoming.id,
      clientId: incoming.clientId,
      conversationId: incoming.conversationId,
      authorId: incoming.authorId,
      sentAt: incoming.sentAt,
      state: 'encrypted',
      body: null,
      ciphertext: incoming.ciphertext,
    };

    if (!this.identity) return base;

    try {
      const ciphertext = parseCiphertext(incoming.ciphertext);
      const senderKey = (await this.resolveRecipientKey(incoming.conversationId)) ?? this.identity.publicKey;
      const body = await decryptMessage(ciphertext, senderKey, this.identity.privateKey);
      return { ...base, state: 'decrypted', body };
    } catch (error) {
      return {
        ...base,
        state: 'failed',
        error: error instanceof Error ? error.message : 'Could not decrypt this message',
      };
    }
  }

  private requireIdentity(): ChatIdentity {
    if (!this.identity) {
      throw new Error('Cannot send: this device is locked and has no identity key.');
    }
    return this.identity;
  }

  private dispatch(action: ChatAction): void {
    const next = chatReducer(this.state, action);
    if (next === this.state) return;
    this.state = next;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }
}

function newClientId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `c-${crypto.randomUUID()}`;
  }
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
