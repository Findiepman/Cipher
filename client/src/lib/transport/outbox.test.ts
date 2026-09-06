import { describe, expect, it, vi } from 'vitest';
import { MemoryOutboxStorage, Outbox, backoffMs } from './outbox';
import type { MessageAck, OutgoingMessage } from './types';

function message(clientId: string, channelId = 'c-general'): OutgoingMessage {
  return { clientId, channelId, ciphertext: `sealed-${clientId}`, sentAt: '2026-09-06T10:00:00.000Z' };
}

function ack(message: OutgoingMessage): MessageAck {
  return { clientId: message.clientId, id: `srv-${message.clientId}`, sentAt: '2026-09-06T10:00:01.000Z' };
}

/** A rejection the outbox should retry (connectivity). */
const transient = Object.assign(new Error('offline'), { isTransient: true });
/** A rejection the outbox should give up on (the server said no). */
const permanent = Object.assign(new Error('rejected'), { isTransient: false });

describe('backoffMs', () => {
  it('doubles and then caps', () => {
    expect(backoffMs(1)).toBe(500);
    expect(backoffMs(2)).toBe(1000);
    expect(backoffMs(3)).toBe(2000);
    expect(backoffMs(20)).toBe(30_000);
  });
});

describe('enqueue', () => {
  it('is idempotent on clientId, so a double send is one message', async () => {
    const outbox = new Outbox();
    await outbox.enqueue(message('a'));
    await outbox.enqueue(message('a'));
    expect(outbox.size).toBe(1);
  });

  it('survives a reload', async () => {
    const storage = new MemoryOutboxStorage();
    const first = new Outbox(storage);
    await first.enqueue(message('a'));
    await first.enqueue(message('b'));

    const second = new Outbox(storage);
    await second.load();
    expect(second.pending.map((entry) => entry.clientId)).toEqual(['a', 'b']);
  });
});

describe('flush', () => {
  it('delivers in order and empties the queue', async () => {
    const outbox = new Outbox();
    await outbox.enqueue(message('a'));
    await outbox.enqueue(message('b'));
    await outbox.enqueue(message('c'));

    const sent: string[] = [];
    const result = await outbox.flush(async (m) => {
      sent.push(m.clientId);
      return ack(m);
    });

    expect(sent).toEqual(['a', 'b', 'c']);
    expect(result.sent).toHaveLength(3);
    expect(outbox.size).toBe(0);
  });

  it('stops at a transient failure instead of letting later messages overtake it', async () => {
    const outbox = new Outbox();
    await outbox.enqueue(message('a'));
    await outbox.enqueue(message('b'));

    const attempted: string[] = [];
    const result = await outbox.flush(async (m) => {
      attempted.push(m.clientId);
      throw transient;
    }, 1_000);

    expect(attempted).toEqual(['a']);
    expect(result.sent).toHaveLength(0);
    expect(result.pending).toBe(2);
    expect(outbox.pending[0].nextAttemptAt).toBe(1_000 + backoffMs(1));
  });

  it('honours the backoff window, then retries', async () => {
    const outbox = new Outbox();
    await outbox.enqueue(message('a'));

    let attempts = 0;
    const send = async (m: OutgoingMessage) => {
      attempts += 1;
      if (attempts === 1) throw transient;
      return ack(m);
    };

    await outbox.flush(send, 1_000);
    // Too early: the entry is not due, so nothing is attempted.
    await outbox.flush(send, 1_100);
    expect(attempts).toBe(1);

    const result = await outbox.flush(send, 1_000 + backoffMs(1));
    expect(attempts).toBe(2);
    expect(result.sent.map((a) => a.clientId)).toEqual(['a']);
    expect(outbox.size).toBe(0);
  });

  it('drops a permanently rejected message so it cannot block the queue', async () => {
    const outbox = new Outbox();
    await outbox.enqueue(message('bad'));
    await outbox.enqueue(message('good'));

    const result = await outbox.flush(async (m) => {
      if (m.clientId === 'bad') throw permanent;
      return ack(m);
    });

    expect(result.failed.map((f) => f.entry.clientId)).toEqual(['bad']);
    expect(result.sent.map((a) => a.clientId)).toEqual(['good']);
    expect(outbox.size).toBe(0);
  });

  it('gives up on a transient failure that never resolves, rather than retrying forever', async () => {
    const outbox = new Outbox();
    await outbox.enqueue(message('a'));

    let now = 0;
    let result = await outbox.flush(async () => {
      throw transient;
    }, now);

    // Walk forward through every backoff window.
    for (let i = 0; i < 10 && outbox.size > 0; i += 1) {
      now = outbox.pending[0].nextAttemptAt;
      result = await outbox.flush(async () => {
        throw transient;
      }, now);
    }

    expect(outbox.size).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].entry.attempts).toBe(8);
  });

  it('collapses concurrent flushes so nothing is sent twice', async () => {
    const outbox = new Outbox();
    await outbox.enqueue(message('a'));

    const send = vi.fn(async (m: OutgoingMessage) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return ack(m);
    });

    await Promise.all([outbox.flush(send), outbox.flush(send), outbox.flush(send)]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('keeps unsent messages across a reload', async () => {
    const storage = new MemoryOutboxStorage();
    const outbox = new Outbox(storage);
    await outbox.enqueue(message('a'));
    await outbox.flush(async () => {
      throw transient;
    }, 0);

    const afterReload = new Outbox(storage);
    await afterReload.load();
    expect(afterReload.size).toBe(1);
    expect(afterReload.pending[0].attempts).toBe(1);
  });
});
