/**
 * The message list, as a pure reducer.
 *
 * Kept free of transport, crypto and React so the awkward cases can be tested
 * as data in, data out. The awkward cases are:
 *
 *   - An optimistic message and the server's echo of that same message must
 *     collapse into one bubble, whichever arrives first.
 *   - A backlog pull on reconnect overlaps with what is already on screen.
 *   - A message that cannot be decrypted still has to render. Dropping it
 *     silently is the one behaviour an E2EE client must never have. The user
 *     needs to see that something arrived and could not be opened.
 *   - A message that arrives for a conversation nobody is looking at has to
 *     leave a mark on the list, and one that arrives while it is on screen
 *     must not.
 *
 * The last of those is why `focusedChannelId` and `selfId` are state rather
 * than something the caller decides: keeping them here is what lets "is this
 * unread" be answered as data in, data out, instead of depending on where in
 * the app the message happened to be handed over.
 */
import type { Message } from '../types';

export interface ChatState {
  /** Flat and sorted; components filter by channel. */
  messages: Message[];
  /** Last server id seen per channel: the cursor for the next backlog pull. */
  cursors: Record<string, string>;
  /** How many messages have arrived in each channel that nobody has looked at. */
  unread: Record<string, number>;
  /**
   * How far the other party has read, per channel and per person.
   *
   * Kept apart from `unread`, which is about you. This is what lets a message
   * say it was seen, and it only ever arrives when the other side has read
   * receipts switched on: the server does not relay it otherwise.
   */
  peerReads: Record<string, Record<string, string>>;
  /**
   * The channel on screen, and only while the window has focus. Null when the
   * app is in the background: a conversation open behind another window has
   * not been read, and pretending otherwise is how a messenger loses a message.
   */
  focusedChannelId: string | null;
  /** Us. Our own messages are never unread, whichever device typed them. */
  selfId: string | null;
}

export type ChatAction =
  | { type: 'seed'; messages: Message[] }
  | { type: 'sending'; message: Message }
  | { type: 'sent'; clientId: string; id: string; sentAt: string }
  | { type: 'sendFailed'; clientId: string; error: string }
  | { type: 'received'; message: Message }
  | { type: 'backlog'; channelId: string; messages: Message[] }
  | { type: 'identity'; userId: string | null }
  /** What the server says is unread, which is the truth on a fresh load. */
  | { type: 'unread'; counts: Record<string, number> }
  | { type: 'focus'; channelId: string | null }
  /** We read up to here somewhere else: another tab, or the phone. */
  | { type: 'readUpTo'; channelId: string; messageId: string }
  /** Somebody else moved their read position. */
  | { type: 'peerRead'; channelId: string; userId: string; messageId: string };

export const initialChatState: ChatState = {
  messages: [],
  cursors: {},
  unread: {},
  peerReads: {},
  focusedChannelId: null,
  selfId: null,
};

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'seed':
      return { ...state, messages: sortMessages(action.messages), cursors: cursorsFrom(action.messages) };

    case 'identity':
      if (state.selfId === action.userId) return state;
      return { ...state, selfId: action.userId };

    case 'unread': {
      // The focused channel stays at zero. The server's count was computed
      // before this client said it was reading, so honouring it here would put
      // a dot on the conversation the user is looking at.
      const counts = { ...action.counts };
      if (state.focusedChannelId) delete counts[state.focusedChannelId];
      return { ...state, unread: counts };
    }

    case 'focus': {
      if (state.focusedChannelId === action.channelId) return state;
      const unread = clearUnread(state.unread, action.channelId);
      return { ...state, focusedChannelId: action.channelId, unread };
    }

    case 'readUpTo': {
      const current = state.unread[action.channelId] ?? 0;
      if (current === 0) return state;

      // A read from somewhere else can only ever lower a count, never raise
      // one. A tab sitting behind us would otherwise put a badge back on a
      // conversation this one has already shown as read.
      const remaining = Math.min(current, unreadAfter(state, action));
      if (remaining === current) return state;

      const unread = { ...state.unread };
      if (remaining === 0) delete unread[action.channelId];
      else unread[action.channelId] = remaining;
      return { ...state, unread };
    }

    case 'sending':
      return { ...state, messages: sortMessages([...state.messages, action.message]) };

    case 'sent': {
      const messages = state.messages.map((message) =>
        message.clientId === action.clientId
          ? { ...message, id: action.id, sentAt: action.sentAt, state: 'decrypted' as const, error: undefined }
          : message,
      );
      return { ...state, messages: sortMessages(messages) };
    }

    case 'sendFailed': {
      const messages = state.messages.map((message) =>
        message.clientId === action.clientId
          ? { ...message, state: 'unsent' as const, error: action.error }
          : message,
      );
      return { ...state, messages };
    }

    case 'peerRead': {
      const forChannel = { ...(state.peerReads[action.channelId] ?? {}) };
      forChannel[action.userId] = action.messageId;
      return {
        ...state,
        peerReads: { ...state.peerReads, [action.channelId]: forChannel },
      };
    }

    case 'received':
      return mergeInto(state, [action.message]);

    case 'backlog':
      return mergeInto(state, action.messages);

    default:
      return state;
  }
}

/**
 * Merges server messages into local state, collapsing anything we already hold.
 * Matching is by server id first, then by clientId. That second pass is what
 * turns an optimistic bubble into the confirmed one instead of a duplicate.
 */
function mergeInto(state: ChatState, incoming: Message[]): ChatState {
  const byId = new Map(state.messages.map((message) => [message.id, message]));
  const byClientId = new Map(
    state.messages.filter((m) => m.clientId).map((message) => [message.clientId as string, message]),
  );

  let changed = false;
  const next = [...state.messages];
  const unread = { ...state.unread };
  let counted = false;

  for (const message of incoming) {
    const existing =
      byId.get(message.id) ?? (message.clientId ? byClientId.get(message.clientId) : undefined);

    if (existing) {
      const index = next.indexOf(existing);
      // The server's copy wins on identity and ordering. The local copy wins on
      // `body` and on a decrypted state, because only this device ever had the
      // plaintext, so re-receiving our own message must not re-lock it.
      const alreadyReadable = existing.state === 'decrypted' || existing.body !== null;
      next[index] = {
        ...existing,
        ...message,
        body: message.body ?? existing.body,
        state: alreadyReadable ? 'decrypted' : message.state,
      };
      changed = true;
      continue;
    }

    next.push(message);
    changed = true;

    // Only messages this device has never held count. That is what stops the
    // server's echo of our own optimistic bubble from marking a conversation
    // unread: it merges into what is already there, above, and so never gets
    // this far.
    if (isUnread(state, message)) {
      unread[message.channelId] = (unread[message.channelId] ?? 0) + 1;
      counted = true;
    }
  }

  if (!changed) return state;
  return {
    ...state,
    messages: sortMessages(next),
    cursors: { ...state.cursors, ...cursorsFrom(incoming) },
    unread: counted ? unread : state.unread,
  };
}

/// A message is unread when somebody else wrote it and nobody is looking at
/// the conversation it landed in.
function isUnread(state: ChatState, message: Message): boolean {
  if (message.channelId === state.focusedChannelId) return false;
  return state.selfId === null || message.authorId !== state.selfId;
}

/// How much of what this device holds still sits after a read position that
/// was set somewhere else. `messages` is kept sorted, so the marker's index is
/// the position and everything past it is what is left.
function unreadAfter(
  state: ChatState,
  action: { channelId: string; messageId: string },
): number {
  const inChannel = state.messages.filter((message) => message.channelId === action.channelId);
  const index = inChannel.findIndex((message) => message.id === action.messageId);

  // A marker for a message this device has never seen means the other one is
  // ahead of us, so nothing we hold can still be waiting.
  if (index === -1) return 0;

  return inChannel
    .slice(index + 1)
    .filter((message) => state.selfId === null || message.authorId !== state.selfId).length;
}

function clearUnread(
  unread: Record<string, number>,
  channelId: string | null,
): Record<string, number> {
  if (!channelId || !(channelId in unread)) return unread;
  const next = { ...unread };
  delete next[channelId];
  return next;
}

/** Chronological, with the id as a stable tiebreak for same-millisecond sends. */
export function sortMessages(messages: Message[]): Message[] {
  return [...messages].sort((a, b) => {
    const byTime = a.sentAt.localeCompare(b.sentAt);
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
  });
}

function cursorsFrom(messages: Message[]): Record<string, string> {
  const cursors: Record<string, string> = {};
  for (const message of sortMessages(messages)) {
    // Optimistic messages have no server id yet, so they cannot be a cursor.
    // using one would make the next backlog pull skip real history.
    if (message.state === 'sending' || message.state === 'unsent') continue;
    cursors[message.channelId] = message.id;
  }
  return cursors;
}

/** Messages for one channel, in order. */
export function messagesForChannel(state: ChatState, channelId: string): Message[] {
  return state.messages.filter((message) => message.channelId === channelId);
}
