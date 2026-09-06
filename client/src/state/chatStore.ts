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
 *     silently is the one behaviour an E2EE client must never have — the user
 *     needs to see that something arrived and could not be opened.
 */
import type { Message } from '../types';

export interface ChatState {
  /** Flat and sorted; components filter by channel. */
  messages: Message[];
  /** Last server id seen per channel — the cursor for the next backlog pull. */
  cursors: Record<string, string>;
}

export type ChatAction =
  | { type: 'seed'; messages: Message[] }
  | { type: 'sending'; message: Message }
  | { type: 'sent'; clientId: string; id: string; sentAt: string }
  | { type: 'sendFailed'; clientId: string; error: string }
  | { type: 'received'; message: Message }
  | { type: 'backlog'; channelId: string; messages: Message[] };

export const initialChatState: ChatState = { messages: [], cursors: {} };

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'seed':
      return { ...state, messages: sortMessages(action.messages), cursors: cursorsFrom(action.messages) };

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
          ? { ...message, state: 'failed' as const, error: action.error }
          : message,
      );
      return { ...state, messages };
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
 * Matching is by server id first, then by clientId — that second pass is what
 * turns an optimistic bubble into the confirmed one instead of a duplicate.
 */
function mergeInto(state: ChatState, incoming: Message[]): ChatState {
  const byId = new Map(state.messages.map((message) => [message.id, message]));
  const byClientId = new Map(
    state.messages.filter((m) => m.clientId).map((message) => [message.clientId as string, message]),
  );

  let changed = false;
  const next = [...state.messages];

  for (const message of incoming) {
    const existing =
      byId.get(message.id) ?? (message.clientId ? byClientId.get(message.clientId) : undefined);

    if (existing) {
      const index = next.indexOf(existing);
      // The server's copy wins on identity and ordering. The local copy wins on
      // `body` and on a decrypted state, because only this device ever had the
      // plaintext — re-receiving our own message must not re-lock it.
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
  }

  if (!changed) return state;
  return { messages: sortMessages(next), cursors: { ...state.cursors, ...cursorsFrom(incoming) } };
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
    // Optimistic messages have no server id yet, so they cannot be a cursor —
    // using one would make the next backlog pull skip real history.
    if (message.state === 'sending' || message.state === 'failed') continue;
    cursors[message.channelId] = message.id;
  }
  return cursors;
}

/** Messages for one channel, in order. */
export function messagesForChannel(state: ChatState, channelId: string): Message[] {
  return state.messages.filter((message) => message.channelId === channelId);
}
