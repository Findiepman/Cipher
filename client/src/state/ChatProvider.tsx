/**
 * Everything the chat UI needs, in one place.
 *
 * It owns the ChatController and the three server-backed lists the UI renders
 * (conversations, friends, pending requests), and it is where the identity from
 * SessionProvider meets the transport. Components below this read state and
 * call actions; none of them touch the API, the socket, or the crypto module.
 *
 * The controller, store and outbox underneath were written and tested long
 * before there was a server. This is the wiring that finally points them at
 * one.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { fromBase64 } from '@cipher/crypto';
import { conversationsApi, friendsApi } from '../lib/api';
import type {
  ConversationDto,
  FriendDto,
  FriendRequestDto,
  SendFriendRequestResponse,
} from '../lib/api/types';
import { friendToUser, shortFingerprint } from '../lib/presentation';
import { Outbox, SecureOutboxStorage } from '../lib/transport/outbox';
import { SocketTransport } from '../lib/transport/socketTransport';
import type { ConnectionState } from '../lib/transport/types';
import { createSecureStore } from '../lib/storage/secureStore';
import { keyManager as defaultKeyManager, type KeyManager } from '../lib/session/keyManager';
import type { Channel, Message, User } from '../types';
import { ChatController, type Recipient } from './chatController';
import { messagesForChannel } from './chatStore';
import { useSession } from './SessionProvider';

/** How long a typing indicator survives without a fresh signal. */
const TYPING_TTL_MS = 5_000;

export interface ChatContextValue {
  /** False until the first load finishes; the UI shows a holding state. */
  ready: boolean;
  error: Error | null;
  connection: ConnectionState;
  queued: number;

  conversations: ConversationDto[];
  channels: Channel[];
  friends: FriendDto[];
  incoming: FriendRequestDto[];
  outgoing: FriendRequestDto[];
  /** Everyone the UI might need to draw, friends and self alike. */
  usersById: Map<string, User>;
  self: User | null;

  activeChannelId: string | null;
  selectChannel: (channelId: string) => void;
  messagesFor: (channelId: string) => Message[];
  /** Usernames currently typing in a channel. */
  typingIn: (channelId: string) => string[];

  send: (body: string) => Promise<void>;
  notifyTyping: () => void;
  openDmWith: (userId: string) => Promise<void>;

  addFriend: (username: string) => Promise<SendFriendRequestResponse>;
  acceptRequest: (id: string) => Promise<void>;
  declineRequest: (id: string) => Promise<void>;
  removeFriend: (userId: string) => Promise<void>;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export interface ChatProviderProps {
  children: ReactNode;
  keys?: KeyManager;
}

export function ChatProvider({ children, keys = defaultKeyManager }: ChatProviderProps) {
  const { account } = useSession();

  const [conversations, setConversations] = useState<ConversationDto[]>([]);
  const [friends, setFriends] = useState<FriendDto[]>([]);
  const [incoming, setIncoming] = useState<FriendRequestDto[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequestDto[]>([]);
  const [fingerprints, setFingerprints] = useState<Map<string, string>>(new Map());
  const [ownFingerprint, setOwnFingerprint] = useState('····');
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [typing, setTyping] = useState<{ channelId: string; userId: string; at: number }[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('idle');
  const [queued, setQueued] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Read by resolveRecipients/resolveAuthorKey, which the controller calls
  // outside of React's render cycle. A ref, not state, because a stale closure
  // there would seal a message to the wrong set of keys.
  const conversationsRef = useRef<ConversationDto[]>([]);
  conversationsRef.current = conversations;
  const keysByUser = useRef<Map<string, string>>(new Map());

  const [controller] = useState(() => {
    const transport = new SocketTransport();
    return {
      transport,
      chat: new ChatController({
        transport,
        outbox: new Outbox(new SecureOutboxStorage(createSecureStore())),
        resolveRecipients: async (channelId) => {
          const conversation = conversationsRef.current.find((c) => c.id === channelId);
          if (!conversation) return [];

          const resolved: Recipient[] = [];
          for (const participant of conversation.participants) {
            if (!participant.publicKey) continue;
            resolved.push({
              userId: participant.id,
              publicKey: await fromBase64(participant.publicKey),
            });
          }
          return resolved;
        },
        resolveAuthorKey: async (authorId) => {
          const encoded = keysByUser.current.get(authorId);
          return encoded ? fromBase64(encoded) : null;
        },
      }),
    };
  });

  const reloadFriends = useCallback(async () => {
    const [{ friends: list }, requests] = await Promise.all([
      friendsApi.list(),
      friendsApi.requests(),
    ]);
    setFriends(list);
    setIncoming(requests.incoming);
    setOutgoing(requests.outgoing);
  }, []);

  const reloadConversations = useCallback(async () => {
    const { conversations: list } = await conversationsApi.list();
    setConversations(list);
    return list;
  }, []);

  /* --------------------------------------------------------------- start -- */

  useEffect(() => {
    if (!account) return;

    let live = true;
    const { chat, transport } = controller;

    const unsubscribeState = chat.subscribe((state) => {
      if (!live) return;
      setMessages(state.messages);
      setQueued(chat.queuedCount);
    });

    const unsubscribeConnection = transport.on('state', (next) => {
      if (live) setConnection(next);
    });

    const unsubscribePresence = transport.on('presence', ({ userId, online: isOnline }) => {
      if (!live) return;
      setOnline((previous) => {
        const next = new Set(previous);
        if (isOnline) next.add(userId);
        else next.delete(userId);
        return next;
      });
    });

    const unsubscribeTyping = transport.on('typing', ({ channelId, userId }) => {
      if (!live) return;
      setTyping((previous) => [
        ...previous.filter((entry) => !(entry.channelId === channelId && entry.userId === userId)),
        { channelId, userId, at: Date.now() },
      ]);
    });

    async function start() {
      try {
        // The identity has to be in place before the controller opens anything:
        // a message that arrives before it would render as undecryptable and
        // stay that way, because nothing re-opens an already-merged message.
        chat.setIdentity({
          userId: account!.id,
          privateKey: keys.requirePrivateKey(),
          publicKey: keys.requirePublicKey(),
        });

        await Promise.all([reloadFriends(), reloadConversations()]);
        await chat.start();
        if (live) setReady(true);
      } catch (caught) {
        if (live) setError(caught instanceof Error ? caught : new Error(String(caught)));
      }
    }

    void start();

    return () => {
      live = false;
      unsubscribeState();
      unsubscribeConnection();
      unsubscribePresence();
      unsubscribeTyping();
      chat.stop();
      chat.setIdentity(null);
    };
  }, [account, controller, keys, reloadConversations, reloadFriends]);

  /* -------------------------------------------------------- derived data -- */

  // Everyone's key, in one lookup the controller can read synchronously.
  useEffect(() => {
    const map = new Map<string, string>();
    for (const friend of friends) {
      if (friend.publicKey) map.set(friend.id, friend.publicKey);
    }
    for (const conversation of conversations) {
      for (const participant of conversation.participants) {
        if (participant.publicKey) map.set(participant.id, participant.publicKey);
      }
    }
    keysByUser.current = map;
  }, [friends, conversations]);

  // Fingerprints are derived from a key by hashing, so they are computed once
  // per key rather than on every render.
  useEffect(() => {
    let cancelled = false;

    async function compute() {
      const entries = await Promise.all(
        [...keysByUser.current.entries()].map(
          async ([userId, publicKey]) =>
            [userId, await shortFingerprint(publicKey)] as const,
        ),
      );
      if (!cancelled) setFingerprints(new Map(entries));
    }

    void compute();
    return () => {
      cancelled = true;
    };
  }, [friends, conversations]);

  useEffect(() => {
    let cancelled = false;
    void shortFingerprint(keys.current?.publicKey ?? null).then((value) => {
      if (!cancelled) setOwnFingerprint(value);
    });
    return () => {
      cancelled = true;
    };
  }, [keys, account]);

  // A typing indicator that nobody refreshes has to expire on its own, or the
  // "… is typing" line stays up after the other person has given up.
  useEffect(() => {
    if (typing.length === 0) return;
    const timer = setTimeout(() => {
      setTyping((previous) => previous.filter((entry) => Date.now() - entry.at < TYPING_TTL_MS));
    }, TYPING_TTL_MS);
    return () => clearTimeout(timer);
  }, [typing]);

  const usersById = useMemo(() => {
    const map = new Map<string, User>();

    // Yourself first. You are not in your own friend list, and you are only in
    // a conversation once you have started one - so without this the account
    // avatar and your own message bubbles have nobody to render until then.
    if (account) {
      map.set(
        account.id,
        friendToUser(
          {
            id: account.id,
            username: account.username,
            publicKey: keys.current?.publicKey ?? null,
            friendsSince: account.createdAt,
          },
          ownFingerprint,
          true,
        ),
      );
    }

    for (const friend of friends) {
      map.set(friend.id, friendToUser(friend, fingerprints.get(friend.id) ?? '····', online.has(friend.id)));
    }

    // Anyone in a conversation who is no longer a friend still has to render,
    // or their side of the history would show as an unknown author.
    for (const conversation of conversations) {
      for (const participant of conversation.participants) {
        if (map.has(participant.id)) continue;
        map.set(
          participant.id,
          friendToUser(
            { ...participant, friendsSince: conversation.createdAt },
            fingerprints.get(participant.id) ?? '····',
            online.has(participant.id),
          ),
        );
      }
    }

    return map;
  }, [account, keys, ownFingerprint, friends, conversations, fingerprints, online]);

  const self = account ? (usersById.get(account.id) ?? null) : null;

  /** A DM rendered as a channel, which is the shape the list already speaks. */
  const channels = useMemo<Channel[]>(
    () =>
      conversations.map((conversation) => {
        const other = conversation.participants.find(
          (participant) => participant.id !== account?.id,
        );
        return {
          id: conversation.id,
          serverId: '@me',
          kind: 'dm',
          name: other?.username ?? 'unknown',
          recipientId: other?.id,
        };
      }),
    [conversations, account?.id],
  );

  /* ------------------------------------------------------------- actions -- */

  const selectChannel = useCallback(
    (channelId: string) => {
      setActiveChannelId(channelId);
      // Pull anything missed while this conversation was not on screen.
      void controller.chat.syncChannel(channelId).catch(() => {
        // A backlog that fails is not fatal: live delivery still works, and
        // the next selection tries again.
      });
    },
    [controller],
  );

  // Land somewhere sensible rather than on an empty pane.
  useEffect(() => {
    if (activeChannelId || channels.length === 0) return;
    selectChannel(channels[0].id);
  }, [activeChannelId, channels, selectChannel]);

  const send = useCallback(
    async (body: string) => {
      if (!activeChannelId) return;
      await controller.chat.send(activeChannelId, body);
    },
    [activeChannelId, controller],
  );

  const notifyTyping = useCallback(() => {
    if (activeChannelId) controller.transport.notifyTyping(activeChannelId);
  }, [activeChannelId, controller]);

  const openDmWith = useCallback(
    async (userId: string) => {
      const conversation = await conversationsApi.openDm(userId);
      await reloadConversations();
      selectChannel(conversation.id);
    },
    [reloadConversations, selectChannel],
  );

  const addFriend = useCallback(
    async (username: string) => {
      const result = await friendsApi.sendRequest({ username });
      await reloadFriends();
      return result;
    },
    [reloadFriends],
  );

  const acceptRequest = useCallback(
    async (id: string) => {
      await friendsApi.accept(id);
      await Promise.all([reloadFriends(), reloadConversations()]);
    },
    [reloadConversations, reloadFriends],
  );

  const declineRequest = useCallback(
    async (id: string) => {
      await friendsApi.decline(id);
      await reloadFriends();
    },
    [reloadFriends],
  );

  const removeFriend = useCallback(
    async (userId: string) => {
      await friendsApi.remove(userId);
      await reloadFriends();
    },
    [reloadFriends],
  );

  const messagesFor = useCallback(
    (channelId: string) => messagesForChannel({ messages, cursors: {} }, channelId),
    [messages],
  );

  const typingIn = useCallback(
    (channelId: string) =>
      typing
        .filter(
          (entry) =>
            entry.channelId === channelId &&
            entry.userId !== account?.id &&
            Date.now() - entry.at < TYPING_TTL_MS,
        )
        .map((entry) => usersById.get(entry.userId)?.name ?? 'someone'),
    [typing, usersById, account?.id],
  );

  const value = useMemo<ChatContextValue>(
    () => ({
      ready,
      error,
      connection,
      queued,
      conversations,
      channels,
      friends,
      incoming,
      outgoing,
      usersById,
      self,
      activeChannelId,
      selectChannel,
      messagesFor,
      typingIn,
      send,
      notifyTyping,
      openDmWith,
      addFriend,
      acceptRequest,
      declineRequest,
      removeFriend,
    }),
    [
      ready,
      error,
      connection,
      queued,
      conversations,
      channels,
      friends,
      incoming,
      outgoing,
      usersById,
      self,
      activeChannelId,
      selectChannel,
      messagesFor,
      typingIn,
      send,
      notifyTyping,
      openDmWith,
      addFriend,
      acceptRequest,
      declineRequest,
      removeFriend,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const context = useContext(ChatContext);
  if (!context) throw new Error('useChat must be used inside a <ChatProvider>');
  return context;
}
