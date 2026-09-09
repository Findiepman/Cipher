import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../api/client';
import { Outbox } from './outbox';
import { SocketTransport, type SocketLike } from './socketTransport';
import type { OutgoingMessage } from './types';

/**
 * A socket whose acks the test decides. The real protocol is covered end to
 * end by the server suite; what is worth pinning down here is the half a real
 * server makes hard to reproduce (a refusal, a malformed ack, a reply that
 * never comes) and the vocabulary mapping either side of it.
 */
class FakeSocket implements SocketLike {
  connected = false;
  readonly sent: unknown[] = [];
  private readonly listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  /** What to reply with, or null to never reply at all. */
  ack: unknown = { id: 'srv-1', clientId: 'c-1', sentAt: '2026-09-06T10:00:00.000Z' };

  on(event: string, handler: (...args: unknown[]) => void): unknown {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), handler]);
    return this;
  }

  once(event: string, handler: (...args: unknown[]) => void): unknown {
    return this.on(event, handler);
  }

  emit(event: string, ...args: unknown[]): unknown {
    this.sent.push({ event, payload: args[0] });
    const reply = args[1];
    if (typeof reply === 'function' && this.ack !== null) {
      (reply as (ack: unknown) => void)(this.ack);
    }
    return this;
  }

  disconnect(): unknown {
    this.connected = false;
    return this;
  }

  /** Drives an event as the server would. */
  fire(event: string, payload?: unknown): void {
    for (const handler of this.listeners.get(event) ?? []) handler(payload);
  }

  /** Completes the handshake the way socket.io does. */
  goOnline(): void {
    this.connected = true;
    this.fire('connect');
  }
}

function setup(options: { api?: ApiClient; ackTimeoutMs?: number } = {}) {
  const socket = new FakeSocket();
  const transport = new SocketTransport({
    url: 'http://localhost:3000',
    api: options.api,
    ackTimeoutMs: options.ackTimeoutMs,
    // Short, so the cases that deliberately never complete a handshake do not
    // spend the real deadline waiting for one.
    connectTimeoutMs: 20,
    createSocket: () => socket,
  });
  return { socket, transport };
}

/** An ApiClient whose fetch the test controls. */
function fakeApi(handler: (url: string, init: RequestInit) => Response): ApiClient {
  return new ApiClient({
    baseUrl: 'http://localhost:3000',
    authMode: 'bearer',
    fetchImpl: async (input, init) => handler(String(input), init ?? {}),
    readCookies: () => '',
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const outgoing: OutgoingMessage = {
  clientId: 'c-1',
  channelId: 'conv-1',
  envelopes: [{ recipientUserId: 'u-me', ciphertext: 'sealed-for-me' }],
  sentAt: '2026-09-06T10:00:00.000Z',
};

describe('connection state', () => {
  it('follows the socket, so the UI can say what is happening', async () => {
    const { socket, transport } = setup();
    const seen: string[] = [];
    transport.on('state', (state) => seen.push(state));

    const connecting = transport.connect();
    socket.goOnline();
    await connecting;

    expect(transport.state).toBe('online');

    socket.fire('disconnect');
    expect(transport.state).toBe('offline');

    expect(seen).toEqual(['connecting', 'online', 'offline']);
  });

  it('resolves connect() even when the handshake fails', async () => {
    // A caller must not block on a connection that may be minutes away.
    // Everything downstream already copes with being offline.
    const { socket, transport } = setup();

    const connecting = transport.connect();
    socket.fire('connect_error');

    await expect(connecting).resolves.toBeUndefined();
    expect(transport.state).toBe('offline');
  });

  it('resolves connect() on a deadline when the socket says nothing at all', async () => {
    // ChatController.start() awaits this before pulling the backlog and
    // flushing the outbox, so a connect that never settles would take the
    // whole chat startup with it.
    const { transport } = setup();

    await expect(transport.connect()).resolves.toBeUndefined();
    expect(transport.state).toBe('connecting');
  });
});

describe('sending', () => {
  it('sends over the socket and returns the server id', async () => {
    const { socket, transport } = setup();
    const connecting = transport.connect();
    socket.goOnline();
    await connecting;

    const ack = await transport.send(outgoing);

    expect(ack).toEqual({ clientId: 'c-1', id: 'srv-1', sentAt: '2026-09-06T10:00:00.000Z' });
    expect(socket.sent[0]).toEqual({
      event: 'message:send',
      // The server's word, not the UI's.
      payload: {
        conversationId: 'conv-1',
        clientId: 'c-1',
        envelopes: outgoing.envelopes,
      },
    });
  });

  it('marks a refusal as permanent so the outbox stops retrying it', async () => {
    const { socket, transport } = setup();
    const connecting = transport.connect();
    socket.goOnline();
    await connecting;
    socket.ack = { error: { code: 'envelope_mismatch', message: 'Nope.' } };

    // A malformed message will be just as malformed in thirty seconds, and
    // retrying it forever would block every message queued behind it.
    await expect(transport.send(outgoing)).rejects.toMatchObject({
      code: 'envelope_mismatch',
      isTransient: false,
    });
  });

  it('marks a missing ack as transient, and gives up rather than hanging', async () => {
    const { socket, transport } = setup({ ackTimeoutMs: 20 });
    const connecting = transport.connect();
    socket.goOnline();
    await connecting;
    // A half-open connection: the emit lands, nothing ever comes back.
    socket.ack = null;

    await expect(transport.send(outgoing)).rejects.toMatchObject({ isTransient: true });
  });

  it('treats a malformed ack as a failure rather than a delivered message', async () => {
    const { socket, transport } = setup();
    const connecting = transport.connect();
    socket.goOnline();
    await connecting;
    socket.ack = { clientId: 'c-1' };

    await expect(transport.send(outgoing)).rejects.toMatchObject({ isTransient: true });
  });

  it('falls back to HTTP when there is no live socket', async () => {
    const calls: string[] = [];
    const api = fakeApi((url) => {
      calls.push(url);
      return json({
        id: 'srv-http',
        conversationId: 'conv-1',
        authorId: 'u-me',
        clientId: 'c-1',
        sentAt: '2026-09-06T10:00:02.000Z',
        ciphertext: 'sealed-for-me',
      });
    });
    const { transport } = setup({ api });
    await transport.connect();

    const ack = await transport.send(outgoing);

    expect(ack.id).toBe('srv-http');
    expect(calls[0]).toBe('http://localhost:3000/conversations/conv-1/messages');
  });

  it('hands the outbox an error it will retry when HTTP is unreachable', async () => {
    const api = fakeApi(() => {
      throw new TypeError('Failed to fetch');
    });
    const { transport } = setup({ api });
    await transport.connect();

    const outbox = new Outbox();
    await outbox.enqueue(outgoing);
    const result = await outbox.flush((message) => transport.send(message));

    // Queued, not failed: there is no signal, and that may not be true later.
    expect(result.sent).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
    expect(result.pending).toBe(1);
  });
});

describe('receiving', () => {
  it('maps the server conversation onto the channel the UI knows', async () => {
    const { socket, transport } = setup();
    const received = vi.fn();
    transport.on('message', received);

    const connecting = transport.connect();
    socket.goOnline();
    await connecting;

    socket.fire('message:new', {
      id: 'srv-9',
      conversationId: 'conv-1',
      authorId: 'u-nova',
      clientId: 'c-9',
      sentAt: '2026-09-06T10:00:03.000Z',
      ciphertext: 'sealed',
    });

    expect(received).toHaveBeenCalledWith({
      id: 'srv-9',
      clientId: 'c-9',
      channelId: 'conv-1',
      authorId: 'u-nova',
      sentAt: '2026-09-06T10:00:03.000Z',
      ciphertext: 'sealed',
    });
  });

  it('pulls a backlog from a cursor and maps it the same way', async () => {
    const urls: string[] = [];
    const api = fakeApi((url) => {
      urls.push(url);
      return json({
        messages: [
          {
            id: 'srv-1',
            conversationId: 'conv-1',
            authorId: 'u-nova',
            clientId: 'c-a',
            sentAt: '2026-09-06T10:00:00.000Z',
            ciphertext: 'one',
          },
        ],
        cursor: 'srv-1',
      });
    });
    const { transport } = setup({ api });

    const backlog = await transport.backlog('conv-1', 'srv-0');

    expect(backlog[0]).toMatchObject({ channelId: 'conv-1', id: 'srv-1' });
    expect(urls[0]).toContain('after=srv-0');
  });

  it('relays typing and presence', async () => {
    const { socket, transport } = setup();
    const typing = vi.fn();
    const presence = vi.fn();
    transport.on('typing', typing);
    transport.on('presence', presence);

    const connecting = transport.connect();
    socket.goOnline();
    await connecting;

    socket.fire('typing', { conversationId: 'conv-1', userId: 'u-nova' });
    socket.fire('presence', { userId: 'u-nova', presence: 'dnd' });

    expect(typing).toHaveBeenCalledWith({ channelId: 'conv-1', userId: 'u-nova' });
    expect(presence).toHaveBeenCalledWith({ userId: 'u-nova', presence: 'dnd' });
  });
});

describe('read positions', () => {
  it('sends one over the socket, in the server\'s vocabulary', async () => {
    const { socket, transport } = setup();
    const connecting = transport.connect();
    socket.goOnline();
    await connecting;

    await transport.markRead('conv-1', 'srv-9');

    expect(socket.sent).toContainEqual({
      event: 'read',
      payload: { conversationId: 'conv-1', messageId: 'srv-9' },
    });
  });

  it('falls back to HTTP when there is no live socket', async () => {
    // The same split as send(), and for the same reason: both paths land in
    // the same handler, so a marker that travels either way ends up in one
    // place.
    const calls: string[] = [];
    const api = fakeApi((url) => {
      calls.push(url);
      return json({ conversationId: 'conv-1', lastReadMessageId: 'srv-9', unread: 0 });
    });
    const { transport } = setup({ api });
    await transport.connect();

    await transport.markRead('conv-1', 'srv-9');

    expect(calls[0]).toBe('http://localhost:3000/conversations/conv-1/read');
  });

  it('rejects a failed HTTP marker so the caller can try again', async () => {
    const api = fakeApi(() => {
      throw new TypeError('Failed to fetch');
    });
    const { transport } = setup({ api });
    await transport.connect();

    await expect(transport.markRead('conv-1', 'srv-9')).rejects.toBeTruthy();
  });

  it('relays an incoming one, mapping the conversation onto the channel', async () => {
    const { socket, transport } = setup();
    const read = vi.fn();
    transport.on('read', read);

    const connecting = transport.connect();
    socket.goOnline();
    await connecting;

    socket.fire('read', {
      conversationId: 'conv-1',
      userId: 'u-me',
      lastReadMessageId: 'srv-9',
    });

    expect(read).toHaveBeenCalledWith({
      channelId: 'conv-1',
      userId: 'u-me',
      lastReadMessageId: 'srv-9',
    });
  });
});

describe('the handshake token', () => {
  it('hands the socket a getter that asks the API client afresh each time', async () => {
    const api = fakeApi(() => json({}));
    api.setTokens({
      accessToken: 'access-1',
      accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
      refreshToken: 'refresh-1',
    });

    let getter: (() => Promise<string | null>) | null = null;
    const transport = new SocketTransport({
      url: 'http://localhost:3000',
      api,
      connectTimeoutMs: 20,
      createSocket: (_url, getToken) => {
        getter = getToken;
        return new FakeSocket();
      },
    });
    await transport.connect();

    // A function, not a value: socket.io calls it on every reconnect, and a
    // token captured at the first connect would be long expired by then.
    await expect(getter!()).resolves.toBe('access-1');
    api.setTokens({
      accessToken: 'access-2',
      accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
      refreshToken: 'refresh-2',
    });
    await expect(getter!()).resolves.toBe('access-2');
  });
});
