/**
 * The offline queue.
 *
 * client/AGENTS.md: "Messages sent while offline should queue locally and flush
 * on reconnect, not get silently dropped." This is that queue, and the rules it
 * enforces are the ones that are easy to get wrong:
 *
 *   - Order is preserved. A flush stops at the first message that could not be
 *     delivered rather than skipping past it, so messages cannot arrive out of
 *     the order they were typed.
 *   - Retries are only for failures that might succeed later. A rejected
 *     message (400, 403) is marked failed and taken out of the queue, because
 *     retrying it forever would block every message behind it.
 *   - Delivery is idempotent. Each entry carries a `clientId` the server echoes
 *     back, so a message sent twice across a flaky reconnect is one message.
 *
 * The queue holds sealed blobs, not plaintext.
 */
import type { MessageAck, OutgoingMessage } from './types';

export interface OutboxEntry extends OutgoingMessage {
  attempts: number;
  /** Epoch ms. The entry is not retried before this. */
  nextAttemptAt: number;
  lastError?: string;
}

export interface OutboxStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}

export interface FlushResult {
  sent: MessageAck[];
  /** Permanently rejected — surfaced to the user as a failed message. */
  failed: { entry: OutboxEntry; error: unknown }[];
  /** Still queued, waiting on connectivity or a backoff window. */
  pending: number;
}

/** Whether a failure is worth retrying. Overridable for non-ApiError senders. */
export type RetryPredicate = (error: unknown) => boolean;

const MAX_ATTEMPTS = 8;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 30_000;

/**
 * Exponential backoff, capped. Pure and exported so the schedule is a tested
 * property rather than a number buried in a retry loop.
 */
export function backoffMs(attempts: number): number {
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1));
}

/** In-memory storage, for tests and for contexts with no persistence. */
export class MemoryOutboxStorage implements OutboxStorage {
  private value: string | null = null;

  async read(): Promise<string | null> {
    return this.value;
  }

  async write(value: string): Promise<void> {
    this.value = value;
  }
}

const STORAGE_KEY = 'outbox/v1';

/**
 * The real one: the same store that holds the wrapped identity key.
 *
 * Persisting matters more than it looks. A queue that only lives in memory
 * makes "messages sent while offline queue locally and flush on reconnect"
 * (client/AGENTS.md) true only until the tab is closed — which is exactly when
 * someone with no signal puts their phone away.
 *
 * What is stored is sealed blobs, never plaintext.
 */
export class SecureOutboxStorage implements OutboxStorage {
  constructor(private readonly store: { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> }) {}

  read(): Promise<string | null> {
    return this.store.get(STORAGE_KEY);
  }

  write(value: string): Promise<void> {
    return this.store.set(STORAGE_KEY, value);
  }
}

export class Outbox {
  private entries: OutboxEntry[] = [];
  private flushing = false;

  constructor(
    private readonly storage: OutboxStorage = new MemoryOutboxStorage(),
    private readonly shouldRetry: RetryPredicate = defaultShouldRetry,
  ) {}

  get pending(): readonly OutboxEntry[] {
    return this.entries;
  }

  get size(): number {
    return this.entries.length;
  }

  async load(): Promise<void> {
    const raw = await this.storage.read();
    if (!raw) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      this.entries = Array.isArray(parsed) ? (parsed as OutboxEntry[]) : [];
    } catch {
      this.entries = [];
    }
  }

  async enqueue(message: OutgoingMessage): Promise<void> {
    // Idempotent on clientId: a double-tap on send, or a replayed action,
    // must not queue the same message twice.
    if (this.entries.some((entry) => entry.clientId === message.clientId)) return;
    this.entries.push({ ...message, attempts: 0, nextAttemptAt: 0 });
    await this.persist();
  }

  /**
   * When the next entry is eligible for another attempt, or null if the queue
   * is empty. The caller uses this to set a timer — without one, a queue that
   * failed into a backoff window would sit there until the user did something.
   */
  nextDueAt(): number | null {
    if (this.entries.length === 0) return null;
    return Math.min(...this.entries.map((entry) => entry.nextAttemptAt));
  }

  /**
   * Clears every backoff window. Called when the connection comes back: the
   * failures that caused the backoff were "there was no network", and that is
   * no longer true, so making the user wait out the old delay is pointless.
   */
  async resetBackoff(): Promise<void> {
    if (this.entries.length === 0) return;
    for (const entry of this.entries) entry.nextAttemptAt = 0;
    await this.persist();
  }

  async remove(clientId: string): Promise<void> {
    this.entries = this.entries.filter((entry) => entry.clientId !== clientId);
    await this.persist();
  }

  async clear(): Promise<void> {
    this.entries = [];
    await this.persist();
  }

  /**
   * Attempts delivery, oldest first, stopping at the first entry that is not
   * due or that fails transiently. Concurrent calls are collapsed — a reconnect
   * event and a timer firing together must not double-send.
   */
  async flush(
    send: (message: OutgoingMessage) => Promise<MessageAck>,
    now: number = Date.now(),
  ): Promise<FlushResult> {
    if (this.flushing) return { sent: [], failed: [], pending: this.entries.length };
    this.flushing = true;

    const sent: MessageAck[] = [];
    const failed: FlushResult['failed'] = [];

    try {
      while (this.entries.length > 0) {
        const entry = this.entries[0];
        if (entry.nextAttemptAt > now) break;

        try {
          const ack = await send(entry);
          sent.push(ack);
          this.entries.shift();
        } catch (error) {
          entry.attempts += 1;
          entry.lastError = error instanceof Error ? error.message : String(error);

          const retryable = this.shouldRetry(error) && entry.attempts < MAX_ATTEMPTS;
          if (!retryable) {
            failed.push({ entry, error });
            this.entries.shift();
            continue;
          }

          entry.nextAttemptAt = now + backoffMs(entry.attempts);
          // Stop rather than skip: everything behind this entry was typed
          // after it and must not overtake it.
          break;
        }
      }
      await this.persist();
      return { sent, failed, pending: this.entries.length };
    } finally {
      this.flushing = false;
    }
  }

  private async persist(): Promise<void> {
    await this.storage.write(JSON.stringify(this.entries));
  }
}

/**
 * Retry anything that looks like a connectivity problem; give up on anything
 * the server actively refused. Recognises ApiError's `isTransient` without
 * importing it, so the outbox stays independent of the HTTP layer.
 */
function defaultShouldRetry(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'isTransient' in error) {
    return Boolean((error as { isTransient: unknown }).isTransient);
  }
  return true;
}
