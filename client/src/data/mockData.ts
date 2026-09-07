import { fakeSeal } from '../lib/envelope';
import type { Channel, Message, Server, User } from '../types';

export const CURRENT_USER_ID = 'u-me';

export const users: User[] = [
  { id: 'u-me', name: 'shami', color: '#f2734e', fingerprint: '9f2c', presence: 'online' },
  {
    id: 'u-nova',
    name: 'nova',
    color: '#b8749e',
    fingerprint: '41ab',
    presence: 'online',
    activity: 'reading the libsodium docs',
  },
  { id: 'u-ren', name: 'ren', color: '#6aa06f', fingerprint: 'c07e', presence: 'idle' },
  {
    id: 'u-kestrel',
    name: 'kestrel',
    color: '#d9b382',
    fingerprint: '5d13',
    presence: 'dnd',
    activity: 'do not perceive me',
  },
  { id: 'u-quill', name: 'quill', color: '#7f9fc4', fingerprint: 'a8f0', presence: 'offline' },
  { id: 'u-atlas', name: 'atlas', color: '#a583c4', fingerprint: '3b6d', presence: 'offline' },
  {
    id: 'u-keybot',
    name: 'keybot',
    color: '#8d8078',
    fingerprint: '0000',
    presence: 'online',
    bot: true,
  },
];

export const servers: Server[] = [
  {
    id: 's-cipher',
    name: 'Cipher HQ',
    monogram: 'CH',
    keyId: '9f2c41ab',
    color: '#f2734e',
    mentions: 2,
  },
  {
    id: 's-lab',
    name: 'The Lab',
    monogram: 'TL',
    keyId: '7d10c3e2',
    color: '#6aa06f',
    unread: true,
  },
  { id: 's-void', name: 'void.exe', monogram: 'VD', keyId: '5b2fa910', color: '#b8749e' },
  { id: 's-study', name: 'Study Hall', monogram: 'SH', keyId: 'e41d7c88', color: '#d9b382' },
];

export const channels: Channel[] = [
  // Cipher HQ
  {
    id: 'c-general',
    serverId: 's-cipher',
    kind: 'text',
    name: 'general',
    category: 'Text Channels',
    topic: 'Anything goes, as long as it is encrypted.',
  },
  {
    id: 'c-crypto',
    serverId: 's-cipher',
    kind: 'text',
    name: 'crypto-talk',
    category: 'Text Channels',
    topic: 'X25519, XSalsa20-Poly1305, and other things we pretend to understand.',
    unread: true,
    mentions: 2,
  },
  {
    id: 'c-design',
    serverId: 's-cipher',
    kind: 'text',
    name: 'design',
    category: 'Text Channels',
    topic: 'Pixels, spacing, and arguing about border radius.',
  },
  {
    id: 'c-standup',
    serverId: 's-cipher',
    kind: 'voice',
    name: 'standup',
    category: 'Voice Channels',
  },
  {
    id: 'c-rubberduck',
    serverId: 's-cipher',
    kind: 'voice',
    name: 'rubber duck',
    category: 'Voice Channels',
  },
  // The Lab
  {
    id: 'c-lab-general',
    serverId: 's-lab',
    kind: 'text',
    name: 'general',
    category: 'Text Channels',
    topic: 'Second server, same vibes.',
  },
  // Direct messages live on the pseudo-server "@me".
  {
    id: 'd-nova',
    serverId: '@me',
    kind: 'dm',
    name: 'nova',
    recipientId: 'u-nova',
    unread: true,
  },
  { id: 'd-ren', serverId: '@me', kind: 'dm', name: 'ren', recipientId: 'u-ren' },
  {
    id: 'd-kestrel',
    serverId: '@me',
    kind: 'dm',
    name: 'kestrel',
    recipientId: 'u-kestrel',
  },
];

/** Members shown in the right-hand column, per server. */
export const serverMembers: Record<string, string[]> = {
  's-cipher': ['u-me', 'u-nova', 'u-ren', 'u-kestrel', 'u-quill', 'u-atlas', 'u-keybot'],
  's-lab': ['u-me', 'u-ren', 'u-quill'],
  's-void': ['u-me', 'u-kestrel'],
  's-study': ['u-me', 'u-nova', 'u-atlas'],
};

let seq = 0;
function msg(
  conversationId: string,
  authorId: string,
  minutesAgo: number,
  body: string,
): Message {
  return {
    id: `m-${++seq}`,
    conversationId,
    authorId,
    sentAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    state: 'decrypted',
    body,
    ciphertext: fakeSeal(body),
  };
}

export const messages: Message[] = [
  msg('c-general', 'u-nova', 260, 'ok the rail is done, the workspaces live in the top bar now'),
  msg('c-general', 'u-nova', 259, 'took embarrassingly long to get the bubble tails right'),
  msg('c-general', 'u-me', 255, 'it stopped reading as a clone the second the icon rail left'),
  msg('c-general', 'u-ren', 240, 'has anyone actually tested what happens when a key is missing'),
  msg('c-general', 'u-ren', 239, 'like does the message just vanish or do we show something'),
  msg(
    'c-general',
    'u-me',
    236,
    'we show a locked bubble. never silently drop a message, that is how people stop trusting an e2ee app',
  ),
  msg('c-general', 'u-kestrel', 120, 'strong agree. failure has to be visible'),
  msg('c-general', 'u-nova', 44, 'pushed the composer, enter sends, shift+enter newlines'),
  msg('c-general', 'u-me', 12, 'nice. next up is the member list grouping by presence'),

  msg(
    'c-crypto',
    'u-kestrel',
    180,
    'reminder that crypto_box is X25519 + XSalsa20-Poly1305 and we should not be inventing anything past that',
  ),
  msg('c-crypto', 'u-nova', 175, 'agreed. DMs first, groups later, no homegrown ratchet'),
  msg('c-crypto', 'u-me', 90, 'what do we do about multi-device though'),
  msg(
    'c-crypto',
    'u-kestrel',
    88,
    'v1: one device per account. it is the only version we can actually reason about',
  ),
  msg('c-crypto', 'u-ren', 30, '@shami can you sanity check the key registry schema before I migrate'),

  msg('c-design', 'u-nova', 300, 'the whole palette is in theme.css now, one file'),
  msg('c-design', 'u-me', 295, 'light mode too?'),
  msg('c-design', 'u-nova', 294, 'tokens are there, it just needs someone to look at it in daylight'),

  msg('c-lab-general', 'u-quill', 500, 'second server exists purely to prove the rail switches correctly'),

  msg('d-nova', 'u-nova', 60, 'yo did you see the ciphertext toggle idea'),
  msg('d-nova', 'u-me', 58, 'the one that shows what the server actually stores?'),
  msg('d-nova', 'u-nova', 57, 'yeah. it makes the e2ee thing legible instead of a claim in a readme'),
  msg('d-nova', 'u-nova', 4, 'it is in the chat header, the eye icon'),

  msg('d-ren', 'u-ren', 720, 'sending you the schema tomorrow'),
  msg('d-kestrel', 'u-kestrel', 1500, 'do not perceive me'),
];

// Two messages this client cannot read, so the locked and failed states are
// visible without having to break anything on purpose.
messages.push(
  {
    id: 'm-locked',
    conversationId: 'c-general',
    authorId: 'u-quill',
    sentAt: new Date(Date.now() - 200 * 60_000).toISOString(),
    state: 'encrypted',
    body: null,
    ciphertext: fakeSeal('sent from a device this account has never seen'),
  },
  {
    id: 'm-failed',
    conversationId: 'c-crypto',
    authorId: 'u-atlas',
    sentAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    state: 'failed',
    body: null,
    ciphertext: fakeSeal('authentication tag mismatch'),
  },
);

messages.sort((a, b) => a.sentAt.localeCompare(b.sentAt));

export const usersById = new Map(users.map((u) => [u.id, u]));
