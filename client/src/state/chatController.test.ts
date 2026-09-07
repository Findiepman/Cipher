import { generateKeyPair } from '@cipher/crypto';
import { describe, expect, it, vi } from 'vitest';
import { MockTransport } from '../lib/transport/mockTransport';
import { Outbox } from '../lib/transport/outbox';
import { ChatController } from './chatController';
import { messagesForConversation } from './chatStore';

async function setup(options: { offline?: boolean } = {}) {
  const keyPair = await generateKeyPair();
  const transport = new MockTransport({ latencyMs: 0, offline: options.offline });
  const controller = new ChatController({ transport, outbox: new Outbox() });
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

    const messages = messagesForConversation(controller.snapshot, 'c-general');
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
    expect(payload.ciphertext).toContain('"alg":"none"');
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

    let messages = messagesForConversation(controller.snapshot, 'c-general');
    expect(messages[0]).toMatchObject({ state: 'sending', body: 'sent with no signal' });
    expect(controller.queuedCount).toBe(1);

    transport.setOffline(false);

    await vi.waitFor(() => {
      expect(controller.queuedCount).toBe(0);
    });
    messages = messagesForConversation(controller.snapshot, 'c-general');
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

    expect(messagesForConversation(controller.snapshot, 'c-general').map((m) => m.body)).toEqual([
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
      conversationId: 'c-general',
      authorId: 'u-nova',
      sentAt: new Date().toISOString(),
      ciphertext: sealed,
    });
    void other;

    await vi.waitFor(() => {
      expect(messagesForConversation(controller.snapshot, 'c-general')).toHaveLength(1);
    });
    expect(messagesForConversation(controller.snapshot, 'c-general')[0]).toMatchObject({
      state: 'decrypted',
      body: 'hey',
    });
  });

  it('renders a message it cannot open instead of dropping it', async () => {
    // The one behaviour an E2EE client must never have is a silently vanishing
    // message — a missing or rotated key has to be visible.
    const { controller, transport } = await setup();

    transport.receive({
      id: 'srv-101',
      conversationId: 'c-general',
      authorId: 'u-quill',
      sentAt: new Date().toISOString(),
      ciphertext: 'not even json',
    });

    await vi.waitFor(() => {
      expect(messagesForConversation(controller.snapshot, 'c-general')).toHaveLength(1);
    });
    const message = messagesForConversation(controller.snapshot, 'c-general')[0];
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
      conversationId: 'c-general',
      authorId: 'u-ren',
      sentAt: new Date(Date.now() + 1000).toISOString(),
      ciphertext: JSON.stringify({ v: 1, alg: 'none', nonce: null, body: btoa('theirs') }),
    });
    await vi.waitFor(() => {
      expect(messagesForConversation(controller.snapshot, 'c-general')).toHaveLength(2);
    });

    await controller.syncConversation('c-general');

    const messages = messagesForConversation(controller.snapshot, 'c-general');
    expect(messages).toHaveLength(2);
    expect(messages.map((m) => m.body)).toEqual(['mine', 'theirs']);
  });
});
