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
  Envelope,
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

/** Someone who must be able to open a message: their id and their public key. */
export interface Recipient {
  userId: string;
  publicKey: Uint8Array;
}

export interface ChatControllerOptions {
  transport: Transport;
  outbox?: Outbox;
  /**
   * Everyone a message in this channel has to be sealed for — the sender
   * included, or they lose their own history on the next device. Phase 1
   * ignores the keys; phase 2 cannot seal without them, which is why the seam
   * exists now.
   *
   * Defaults to "just me", which is what the tests and the mock transport want.
   */
  resolveRecipients?: (channelId: string) => Promise<Recipient[]>;
  /**
   * The public key to open an incoming message against. Opening needs the
   * *author's* key, not the channel's — which is why this is keyed on author.
   */
  resolveAuthorKey?: (authorId: string) => Promise<Uint8Array | null>;
}

export class ChatController {
  private state: ChatState = initialChatState;
  private identity: ChatIdentity | null = null;
  private readonly listeners = new Set<(state: ChatState) => void>();
  private readonly transport: Transport;
  private readonly outbox: Outbox;
  private readonly resolveRecipients: ((channelId: string) => Promise<Recipient[]>) | null;
  private readonly resolveAuthorKey: (authorId: string) => Promise<Uint8Array | null>;
  private unsubscribers: (() => void)[] = [];
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: ChatControllerOptions) {
    this.transport = options.transport;
    this.outbox = options.outbox ?? new Outbox();
    this.resolveRecipients = options.resolveRecipients ?? null;
    this.resolveAuthorKey = options.resolveAuthorKey ?? (async () => null);
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
  async send(channelId: string, body: string): Promise<void> {
    const identity = this.requireIdentity();
    const clientId = newClientId();
    const sentAt = new Date().toISOString();

    const recipients = await this.recipientsFor(channelId, identity);
    // One sealed copy each. The sender's own copy is what makes their history
    // readable on a device that was not the one they typed it on.
    const envelopes: Envelope[] = await Promise.all(
      recipients.map(async (recipient) => ({
        recipientUserId: recipient.userId,
        ciphertext: serializeCiphertext(
          await encryptMessage(body, recipient.publicKey, identity.privateKey),
        ),
      })),
    );

    const own =
      envelopes.find((envelope) => envelope.recipientUserId === identity.userId) ?? envelopes[0];

    this.dispatch({
      type: 'sending',
      message: {
        id: clientId,
        clientId,
        channelId,
        authorId: identity.userId,
        sentAt,
        state: 'sending',
        // Held locally so the sender can read their own message. It is never
        // sent anywhere in this form.
        body,
        ciphertext: own.ciphertext,
      },
    });

    await this.outbox.enqueue({ clientId, channelId, envelopes, sentAt });
    await this.flush();
  }

  /**
   * Falls back to sealing only for ourselves. That is right for a channel whose
   * membership we cannot resolve: the message stays readable to its author and
   * nobody else, which beats either dropping it or sending it in the clear.
   */
  private async recipientsFor(channelId: string, identity: ChatIdentity): Promise<Recipient[]> {
    const self: Recipient = { userId: identity.userId, publicKey: identity.publicKey };
    if (!this.resolveRecipients) return [self];

    const resolved = await this.resolveRecipients(channelId);
    if (resolved.length === 0) return [self];
    return resolved.some((recipient) => recipient.userId === identity.userId)
      ? resolved
      : [...resolved, self];
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
  async syncChannel(channelId: string): Promise<void> {
    const cursor = this.state.cursors[channelId];
    const backlog = await this.transport.backlog(channelId, cursor);
    const messages = await Promise.all(backlog.map((incoming) => this.open(incoming)));
    this.dispatch({ type: 'backlog', channelId, messages });
  }

  private async ingest(incoming: IncomingMessage): Promise<void> {
    this.dispatch({ type: 'received', message: await this.open(incoming) });
  }

  /**
   * Turns a sealed blob into a renderable message. A failure here is a normal,
   * expected outcome — a key we do not have, a rotated key, a device we have
   * never seen — so it produces a locked bubble, never a dropped message and
   * never a thrown error that would take the channel down with it.
   */
  private async open(incoming: IncomingMessage): Promise<Message> {
    const base: Message = {
      id: incoming.id,
      clientId: incoming.clientId,
      channelId: incoming.channelId,
      authorId: incoming.authorId,
      sentAt: incoming.sentAt,
      state: 'encrypted',
      body: null,
      ciphertext: incoming.ciphertext,
    };

    if (!this.identity) return base;

    try {
      const ciphertext = parseCiphertext(incoming.ciphertext);
      // Our own echo is sealed with our own key; anyone else's needs theirs.
      const authorKey =
        incoming.authorId === this.identity.userId
          ? this.identity.publicKey
          : ((await this.resolveAuthorKey(incoming.authorId)) ?? this.identity.publicKey);
      const body = await decryptMessage(ciphertext, authorKey, this.identity.privateKey);
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
