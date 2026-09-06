import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import { chatReducer, initialChatState, messagesForChannel, sortMessages } from './chatStore';

function message(overrides: Partial<Message> & Pick<Message, 'id'>): Message {
  return {
    channelId: 'c-general',
    authorId: 'u-me',
    sentAt: '2026-09-06T10:00:00.000Z',
    state: 'decrypted',
    body: 'hello',
    ciphertext: 'sealed',
    ...overrides,
  };
}

describe('sortMessages', () => {
  it('orders by time, then by id for same-millisecond sends', () => {
    const ordered = sortMessages([
      message({ id: 'b', sentAt: '2026-09-06T10:00:01.000Z' }),
      message({ id: 'c', sentAt: '2026-09-06T10:00:00.000Z' }),
      message({ id: 'a', sentAt: '2026-09-06T10:00:00.000Z' }),
    ]);
    expect(ordered.map((m) => m.id)).toEqual(['a', 'c', 'b']);
  });
});

describe('optimistic send', () => {
  it('shows the message immediately, then swaps in the server id on ack', () => {
    let state = chatReducer(initialChatState, {
      type: 'sending',
      message: message({ id: 'c-1', clientId: 'c-1', state: 'sending' }),
    });
    expect(state.messages[0].state).toBe('sending');

    state = chatReducer(state, {
      type: 'sent',
      clientId: 'c-1',
      id: 'srv-9',
      sentAt: '2026-09-06T10:00:02.000Z',
    });

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ id: 'srv-9', state: 'decrypted', body: 'hello' });
  });

  it('marks a rejected message failed rather than removing it', () => {
    let state = chatReducer(initialChatState, {
      type: 'sending',
      message: message({ id: 'c-1', clientId: 'c-1', state: 'sending' }),
    });
    state = chatReducer(state, { type: 'sendFailed', clientId: 'c-1', error: 'rejected' });

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ state: 'failed', error: 'rejected', body: 'hello' });
  });
});

describe('merging server messages', () => {
  it('collapses the server echo of our own message into the optimistic one', () => {
    let state = chatReducer(initialChatState, {
      type: 'sending',
      message: message({ id: 'c-1', clientId: 'c-1', state: 'sending' }),
    });
    state = chatReducer(state, {
      type: 'received',
      message: message({ id: 'srv-9', clientId: 'c-1', state: 'encrypted', body: null }),
    });

    expect(state.messages).toHaveLength(1);
    // The server's id wins; our plaintext and readable state survive, because
    // only this device ever had the plaintext.
    expect(state.messages[0]).toMatchObject({ id: 'srv-9', state: 'decrypted', body: 'hello' });
  });

  it('does not duplicate a message that arrives twice', () => {
    let state = chatReducer(initialChatState, {
      type: 'received',
      message: message({ id: 'srv-1' }),
    });
    state = chatReducer(state, { type: 'received', message: message({ id: 'srv-1' }) });
    expect(state.messages).toHaveLength(1);
  });

  it('keeps a message it cannot decrypt, instead of dropping it', () => {
    const state = chatReducer(initialChatState, {
      type: 'received',
      message: message({ id: 'srv-2', state: 'failed', body: null, error: 'no key' }),
    });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].state).toBe('failed');
  });
});

describe('backlog cursors', () => {
  it('advances the cursor to the newest confirmed message per channel', () => {
    const state = chatReducer(initialChatState, {
      type: 'backlog',
      channelId: 'c-general',
      messages: [
        message({ id: 'srv-1', sentAt: '2026-09-06T10:00:00.000Z' }),
        message({ id: 'srv-2', sentAt: '2026-09-06T10:00:05.000Z' }),
        message({ id: 'srv-3', channelId: 'c-crypto', sentAt: '2026-09-06T10:00:03.000Z' }),
      ],
    });

    expect(state.cursors).toEqual({ 'c-general': 'srv-2', 'c-crypto': 'srv-3' });
  });

  it('never uses an unsent message as a cursor', () => {
    // A local id as the cursor would make the next backlog pull skip real
    // history, because the server has never heard of it.
    const state = chatReducer(initialChatState, {
      type: 'seed',
      messages: [
        message({ id: 'srv-1', sentAt: '2026-09-06T10:00:00.000Z' }),
        message({ id: 'c-2', clientId: 'c-2', state: 'sending', sentAt: '2026-09-06T10:00:09.000Z' }),
      ],
    });
    expect(state.cursors['c-general']).toBe('srv-1');
  });
});

describe('messagesForChannel', () => {
  it('filters to one channel, in order', () => {
    const state = chatReducer(initialChatState, {
      type: 'seed',
      messages: [
        message({ id: 'a', channelId: 'c-general', sentAt: '2026-09-06T10:00:00.000Z' }),
        message({ id: 'b', channelId: 'c-crypto', sentAt: '2026-09-06T10:00:01.000Z' }),
        message({ id: 'c', channelId: 'c-general', sentAt: '2026-09-06T10:00:02.000Z' }),
      ],
    });
    expect(messagesForChannel(state, 'c-general').map((m) => m.id)).toEqual(['a', 'c']);
  });
});
