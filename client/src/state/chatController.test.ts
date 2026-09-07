import { generateKeyPair } from '@cipher/crypto';
import { describe, expect, it, vi } from 'vitest';
import { MockTransport } from '../lib/transport/mockTransport';
import { Outbox } from '../lib/transport/outbox';
import { ChatController, type ChatControllerOptions } from './chatController';
import { messagesForChannel } from './chatStore';

async function setup(
  options: { offline?: boolean; recipients?: ChatControllerOptions['resolveRecipients'] } = {},
) {
  const keyPair = await generateKeyPair();
  const transport = new MockTransport({
    latencyMs: 0,
    offline: options.offline,
    selfUserId: 'u-me',
  });
  const controller = new ChatController({
    transport,
    outbox: new Outbox(),
    resolveRecipients: options.recipients,
  });
  controller.setIdentity({
    userId: 'u-me',
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
  });
  await controller.start();
  return { controller, transport };
}

describe('sending', () => {
  it('shows the message straight away, then confirms it', async () => {
    const { controller } = await setup();
    await controller.send('c-general', 'ok the rail is done');

    const messages = messagesForChannel(controller.snapshot, 'c-general');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ state: 'decrypted', body: 'ok the rail is done' });
    expect(messages[0].id).toMatch(/^srv-/);
    expect(controller.queuedCount).toBe(0);
  });

  it('never puts the plaintext on the wire', async () => {
    const { controller, transport } = await setup();
    const sent = vi.spyOn(transport, 'send');

    await controller.send('c-general', 'the corner radius is 90% of the theme');

    const payload = sent.mock.calls[0][0];
    expect(JSON.stringify(payload)).not.toContain('the corner radius is 90% of the theme');
    // Phase 1 seals to base64 and says so. The point of the assertion is that
    // the composer's string is not what travels; in phase 2 the same assertion
    // holds for real.
    expect(payload.envelopes[0].ciphertext).toContain('"alg":"none"');
  });

  it('seals a copy for every participant, the sender included', async () => {
    // The sender's own copy is the whole reason envelopes exist: crypto_box
    // seals to one recipient, so without it a sender on a new device could not
    // read anything they had ever written.
    const nova = await generateKeyPair();
    const { controller, transport } = await setup({
      recipients: async () => [{ userId: 'u-nova', publicKey: nova.publicKey }],
    });
    const sent = vi.spyOn(transport, 'send');

    await controller.send('d-nova', 'sealed twice');

    const recipients = sent.mock.calls[0][0].envelopes.map((e) => e.recipientUserId);
    expect(recipients).toEqual(['u-nova', 'u-me']);
  });

  it('does not seal a second copy when the resolver already includes us', async () => {
    const nova = await generateKeyPair();
    const { controller, transport } = await setup({
      recipients: async () => [
        { userId: 'u-nova', publicKey: nova.publicKey },
        { userId: 'u-me', publicKey: nova.publicKey },
      ],
    });
    const sent = vi.spyOn(transport, 'send');

    await controller.send('d-nova', 'sealed twice, not three times');

    expect(sent.mock.calls[0][0].envelopes).toHaveLength(2);
  });

  it('refuses to send while locked', async () => {
    const { controller } = await setup();
    controller.setIdentity(null);
    await expect(controller.send('c-general', 'hello')).rejects.toThrow(/locked/i);
  });
});

describe('offline behaviour', () => {
  it('queues rather than dropping, and flushes on reconnect', async () => {
    const { controller, transport } = await setup({ offline: true });

    await controller.send('c-general', 'sent with no signal');

    let messages = messagesForChannel(controller.snapshot, 'c-general');
    expect(messages[0]).toMatchObject({ state: 'sending', body: 'sent with no signal' });
    expect(controller.queuedCount).toBe(1);

    transport.setOffline(false);

    await vi.waitFor(() => {
      expect(controller.queuedCount).toBe(0);
    });
    messages = messagesForChannel(controller.snapshot, 'c-general');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ state: 'decrypted', body: 'sent with no signal' });
    expect(messages[0].id).toMatch(/^srv-/);
  });

  it('keeps the order messages were typed in', async () => {
    const { controller, transport } = await setup({ offline: true });
    await controller.send('c-general', 'first');
    await controller.send('c-general', 'second');
    await controller.send('c-general', 'third');

    transport.setOffline(false);
    await vi.waitFor(() => {
      expect(controller.queuedCount).toBe(0);
    });

    expect(messagesForChannel(controller.snapshot, 'c-general').map((m) => m.body)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });
});

describe('receiving', () => {
  it('opens an incoming message', async () => {
    const { controller, transport } = await setup();
    const other = await generateKeyPair();
    const sealed = JSON.stringify({ v: 1, alg: 'none', nonce: null, body: btoa('hey') });

    transport.receive({
      id: 'srv-100',
      channelId: 'c-general',
      authorId: 'u-nova',
      sentAt: new Date().toISOString(),
      ciphertext: sealed,
    });
    void other;

    await vi.waitFor(() => {
      expect(messagesForChannel(controller.snapshot, 'c-general')).toHaveLength(1);
    });
    expect(messagesForChannel(controller.snapshot, 'c-general')[0]).toMatchObject({
      state: 'decrypted',
      body: 'hey',
    });
  });

  it('renders a message it cannot open instead of dropping it', async () => {
    // The one behaviour an E2EE client must never have is a silently vanishing
    // message. A missing or rotated key has to be visible.
    const { controller, transport } = await setup();

    transport.receive({
      id: 'srv-101',
      channelId: 'c-general',
      authorId: 'u-quill',
      sentAt: new Date().toISOString(),
      ciphertext: 'not even json',
    });

    await vi.waitFor(() => {
      expect(messagesForChannel(controller.snapshot, 'c-general')).toHaveLength(1);
    });
    const message = messagesForChannel(controller.snapshot, 'c-general')[0];
    expect(message.state).toBe('failed');
    expect(message.body).toBeNull();
    expect(message.ciphertext).toBe('not even json');
  });
});

describe('reconnect backlog', () => {
  it('pulls what was missed without duplicating what is already on screen', async () => {
    const { controller, transport } = await setup();
    await controller.send('c-general', 'mine');

    transport.receive({
      id: 'srv-200',
      channelId: 'c-general',
      authorId: 'u-ren',
      sentAt: new Date(Date.now() + 1000).toISOString(),
      ciphertext: JSON.stringify({ v: 1, alg: 'none', nonce: null, body: btoa('theirs') }),
    });
    await vi.waitFor(() => {
      expect(messagesForChannel(controller.snapshot, 'c-general')).toHaveLength(2);
    });

    await controller.syncChannel('c-general');

    const messages = messagesForChannel(controller.snapshot, 'c-general');
    expect(messages).toHaveLength(2);
    expect(messages.map((m) => m.body)).toEqual(['mine', 'theirs']);
  });
});

describe('read state', () => {
  function sealed(body: string): string {
    return JSON.stringify({ v: 1, alg: 'none', nonce: null, body: btoa(body) });
  }

  /// Delivers a message from somebody else and waits for it to land.
  async function arrive(
    controller: ChatController,
    transport: MockTransport,
    id: string,
    body: string,
    channelId = 'c-general',
  ): Promise<void> {
    const before = messagesForChannel(controller.snapshot, channelId).length;
    transport.receive({
      id,
      channelId,
      authorId: 'u-ren',
      sentAt: new Date().toISOString(),
      ciphertext: sealed(body),
    });
    await vi.waitFor(() => {
      expect(messagesForChannel(controller.snapshot, channelId)).toHaveLength(before + 1);
    });
  }

  it('tells the transport how far we have read when a channel is focused', async () => {
    const { controller, transport } = await setup();
    await arrive(controller, transport, 'srv-300', 'anyone there');

    controller.focus('c-general');

    await vi.waitFor(() => {
      expect(transport.reads).toEqual([{ channelId: 'c-general', messageId: 'srv-300' }]);
    });
    expect(controller.snapshot.unread['c-general']).toBeUndefined();
  });

  it('does not report the same position twice', async () => {
    const { controller, transport } = await setup();
    await arrive(controller, transport, 'srv-301', 'one');

    controller.focus('c-general');
    await vi.waitFor(() => expect(transport.reads).toHaveLength(1));

    controller.focus(null);
    controller.focus('c-general');
    await vi.waitFor(() => expect(transport.reads).toHaveLength(1));
  });

  it('keeps up as messages arrive in the channel on screen', async () => {
    const { controller, transport } = await setup();

    controller.focus('c-general');
    await arrive(controller, transport, 'srv-302', 'one');
    await vi.waitFor(() => expect(transport.reads.at(-1)?.messageId).toBe('srv-302'));

    await arrive(controller, transport, 'srv-303', 'two');
    await vi.waitFor(() => expect(transport.reads.at(-1)?.messageId).toBe('srv-303'));
  });

  it('says nothing while the window is in the background', async () => {
    const { controller, transport } = await setup();

    controller.focus(null);
    await arrive(controller, transport, 'srv-304', 'while you were out');

    expect(transport.reads).toHaveLength(0);
    expect(controller.snapshot.unread['c-general']).toBe(1);
  });

  it('never reports an id the server has not seen', async () => {
    // An optimistic message is identified by a local id the server has never
    // heard of. Marking read against one would be rejected, and the position
    // it claimed would be a lie either way.
    const { controller, transport } = await setup({ offline: true });
    await controller.send('c-general', 'queued');

    controller.focus('c-general');
    await vi.waitFor(() => expect(controller.queuedCount).toBe(1));

    expect(transport.reads).toHaveLength(0);
  });

  it('tries again after a report that failed', async () => {
    const { controller, transport } = await setup();
    await arrive(controller, transport, 'srv-305', 'one');
    const markRead = vi
      .spyOn(transport, 'markRead')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);

    controller.focus('c-general');
    await vi.waitFor(() => expect(markRead).toHaveBeenCalledTimes(1));

    // Read state is not worth failing anything over, so a failure is forgotten
    // rather than retried on a timer: the next focus has another go.
    controller.focus(null);
    controller.focus('c-general');
    await vi.waitFor(() => expect(markRead).toHaveBeenCalledTimes(2));
  });

  it('reports on the backlog pulled when a conversation is opened', async () => {
    // At focus time a conversation opened for the first time has no confirmed
    // message id to point at, so this is where its marker actually gets set.
    const { controller, transport } = await setup();
    transport.receive({
      id: 'srv-306',
      channelId: 'c-crypto',
      authorId: 'u-ren',
      sentAt: new Date().toISOString(),
      ciphertext: sealed('opened later'),
    });

    controller.focus('c-crypto');
    await controller.syncChannel('c-crypto');

    await vi.waitFor(() => {
      expect(transport.reads).toContainEqual({ channelId: 'c-crypto', messageId: 'srv-306' });
    });
  });
});

describe('a read from somewhere else', () => {
  /// Two messages waiting, with nobody looking at the conversation: the state
  /// another device is about to clear.
  async function withTwoWaiting() {
    const { controller, transport } = await setup();
    controller.focus(null);

    for (const [id, body] of [
      ['srv-400', 'one'],
      ['srv-401', 'two'],
    ]) {
      transport.receive({
        id,
        channelId: 'c-general',
        authorId: 'u-ren',
        sentAt: new Date().toISOString(),
        ciphertext: JSON.stringify({ v: 1, alg: 'none', nonce: null, body: btoa(body) }),
      });
    }
    await vi.waitFor(() => expect(controller.snapshot.unread['c-general']).toBe(2));

    return { controller, transport };
  }

  it('clears this tab when the other one has read everything', async () => {
    const { controller, transport } = await withTwoWaiting();

    transport.receiveRead({
      channelId: 'c-general',
      userId: 'u-me',
      lastReadMessageId: 'srv-401',
    });

    expect(controller.snapshot.unread['c-general']).toBeUndefined();
  });

  it('leaves what the other tab has not got to yet', async () => {
    const { controller, transport } = await withTwoWaiting();

    transport.receiveRead({
      channelId: 'c-general',
      userId: 'u-me',
      lastReadMessageId: 'srv-400',
    });

    expect(controller.snapshot.unread['c-general']).toBe(1);
  });

  it('ignores somebody else reading', async () => {
    // Their read position is theirs. This client draws it nowhere, and it must
    // certainly not clear our own badge.
    const { controller, transport } = await withTwoWaiting();

    transport.receiveRead({
      channelId: 'c-general',
      userId: 'u-ren',
      lastReadMessageId: 'srv-401',
    });

    expect(controller.snapshot.unread['c-general']).toBe(2);
  });
});
