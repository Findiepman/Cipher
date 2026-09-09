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

  it('marks a rejected message unsent rather than removing it', () => {
    let state = chatReducer(initialChatState, {
      type: 'sending',
      message: message({ id: 'c-1', clientId: 'c-1', state: 'sending' }),
    });
    state = chatReducer(state, { type: 'sendFailed', clientId: 'c-1', error: 'rejected' });

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ state: 'unsent', error: 'rejected', body: 'hello' });
  });

  it('keeps the body, so an unsent message can still be read and retried', () => {
    // The failure this guards: `unsent` sharing a state with `failed` meant
    // the list drew a padlock over your own words and offered no way to send
    // them, which is the opposite of both facts.
    let state = chatReducer(initialChatState, {
      type: 'sending',
      message: message({ id: 'c-2', clientId: 'c-2', state: 'sending' }),
    });
    state = chatReducer(state, { type: 'sendFailed', clientId: 'c-2', error: 'offline' });
    expect(state.messages[0]?.body).toBe('hello');
    expect(state.messages[0]?.state).not.toBe('failed');
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

describe('unread', () => {
  /// Every case below needs to know who "us" is, because our own messages are
  /// never unread and that is the only thing the store uses the identity for.
  const mine = chatReducer(initialChatState, { type: 'identity', userId: 'u-me' });

  it('counts a message that lands in a channel nobody is looking at', () => {
    const state = chatReducer(mine, {
      type: 'received',
      message: message({ id: 'srv-1', authorId: 'u-nova' }),
    });
    expect(state.unread).toEqual({ 'c-general': 1 });
  });

  it('does not count a message in the channel on screen', () => {
    let state = chatReducer(mine, { type: 'focus', channelId: 'c-general' });
    state = chatReducer(state, {
      type: 'received',
      message: message({ id: 'srv-1', authorId: 'u-nova' }),
    });
    expect(state.unread).toEqual({});
  });

  it('counts again once the window goes to the background', () => {
    // A conversation left open behind another window has not been read, and a
    // messenger that says otherwise is losing messages for the user.
    let state = chatReducer(mine, { type: 'focus', channelId: 'c-general' });
    state = chatReducer(state, { type: 'focus', channelId: null });
    state = chatReducer(state, {
      type: 'received',
      message: message({ id: 'srv-1', authorId: 'u-nova' }),
    });
    expect(state.unread).toEqual({ 'c-general': 1 });
  });

  it('never counts our own messages, wherever they were typed', () => {
    // A send from a second device arrives as a message this one has never
    // held. It still must not leave a dot on our own conversation.
    const state = chatReducer(mine, {
      type: 'received',
      message: message({ id: 'srv-1', authorId: 'u-me' }),
    });
    expect(state.unread).toEqual({});
  });

  it('does not count the server echo of a message already on screen', () => {
    let state = chatReducer(mine, {
      type: 'sending',
      message: message({ id: 'c-1', clientId: 'c-1', state: 'sending' }),
    });
    state = chatReducer(state, {
      type: 'received',
      message: message({ id: 'srv-9', clientId: 'c-1', state: 'encrypted', body: null }),
    });
    expect(state.unread).toEqual({});
  });

  it('counts a backlog pulled for a channel that is not on screen', () => {
    const state = chatReducer(mine, {
      type: 'backlog',
      channelId: 'c-crypto',
      messages: [
        message({ id: 'srv-1', channelId: 'c-crypto', authorId: 'u-nova' }),
        message({ id: 'srv-2', channelId: 'c-crypto', authorId: 'u-nova' }),
      ],
    });
    expect(state.unread).toEqual({ 'c-crypto': 2 });
  });

  it('clears the focused channel and leaves the others alone', () => {
    let state = chatReducer(mine, {
      type: 'unread',
      counts: { 'c-general': 3, 'c-crypto': 2 },
    });
    state = chatReducer(state, { type: 'focus', channelId: 'c-general' });
    expect(state.unread).toEqual({ 'c-crypto': 2 });
  });

  it('takes the server counts, except for the channel on screen', () => {
    // The server counted before this client said it was reading, so honouring
    // its number here would put a dot on the conversation being looked at.
    let state = chatReducer(mine, { type: 'focus', channelId: 'c-general' });
    state = chatReducer(state, {
      type: 'unread',
      counts: { 'c-general': 4, 'c-crypto': 1 },
    });
    expect(state.unread).toEqual({ 'c-crypto': 1 });
  });

  it('replaces the local counts rather than adding to them', () => {
    // A reload is the truth: this device may have been closed while a
    // conversation filled up, and it has no history of what it missed.
    let state = chatReducer(mine, {
      type: 'received',
      message: message({ id: 'srv-1', authorId: 'u-nova' }),
    });
    state = chatReducer(state, { type: 'unread', counts: { 'c-general': 7 } });
    expect(state.unread).toEqual({ 'c-general': 7 });
  });
});

describe('a read that happened somewhere else', () => {
  const mine = chatReducer(initialChatState, { type: 'identity', userId: 'u-me' });

  /// Three waiting, with nobody looking at the conversation.
  function waiting() {
    return chatReducer(mine, {
      type: 'backlog',
      channelId: 'c-general',
      messages: [
        message({ id: 'srv-1', authorId: 'u-nova' }),
        message({ id: 'srv-2', authorId: 'u-nova' }),
        message({ id: 'srv-3', authorId: 'u-nova' }),
      ],
    });
  }

  it('lowers the count to whatever sits after the marker', () => {
    const state = chatReducer(waiting(), {
      type: 'readUpTo',
      channelId: 'c-general',
      messageId: 'srv-1',
    });
    expect(state.unread).toEqual({ 'c-general': 2 });
  });

  it('clears it when the marker is the newest thing we hold', () => {
    const state = chatReducer(waiting(), {
      type: 'readUpTo',
      channelId: 'c-general',
      messageId: 'srv-3',
    });
    expect(state.unread).toEqual({});
  });

  it('clears it for a marker we have never seen', () => {
    // The other device is ahead of this one, so nothing this one holds can
    // still be waiting.
    const state = chatReducer(waiting(), {
      type: 'readUpTo',
      channelId: 'c-general',
      messageId: 'srv-99',
    });
    expect(state.unread).toEqual({});
  });

  it('never raises a count', () => {
    // A device sitting behind this one must not put a badge back on a
    // conversation this one has already shown as read.
    let state = chatReducer(waiting(), { type: 'unread', counts: { 'c-general': 1 } });
    state = chatReducer(state, {
      type: 'readUpTo',
      channelId: 'c-general',
      messageId: 'srv-1',
    });
    expect(state.unread).toEqual({ 'c-general': 1 });
  });

  it('leaves a channel with nothing waiting alone', () => {
    const before = waiting();
    const after = chatReducer(before, {
      type: 'readUpTo',
      channelId: 'c-crypto',
      messageId: 'srv-1',
    });
    expect(after).toBe(before);
  });
});
