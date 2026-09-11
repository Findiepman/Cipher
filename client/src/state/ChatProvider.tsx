/**
 * Everything the chat UI needs, in one place.
 *
 * It owns the ChatController and the three server-backed lists the UI renders
 * (conversations, friends, pending requests), and it is where the identity from
 * SessionProvider meets the transport. Components below this read state and
 * call actions; none of them touch the API, the socket or the crypto module.
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
import type { CallSignalling } from '../lib/call/types';
import type {
  BlockedUserDto,
  ConversationDto,
  FriendDto,
  FriendRequestDto,
  SendFriendRequestResponse,
} from '../lib/api/types';
import { friendToUser } from '../lib/presentation';
import { Outbox, SecureOutboxStorage } from '../lib/transport/outbox';
import { SocketTransport } from '../lib/transport/socketTransport';
import { ConnectionCurtain } from '../components/ConnectionCurtain';
import type { ConnectionState } from '../lib/transport/types';
import { createSecureStore } from '../lib/storage/secureStore';
import { keyManager as defaultKeyManager, type KeyManager } from '../lib/session/keyManager';
import { KeyChangedError, KeyPinStore, type KeyChange } from '../lib/session/keyPins';
import type { Channel, Message, Presence, User } from '../types';
import { ChatController, type Recipient } from './chatController';
import { initialChatState, messagesForChannel, type ChatState } from './chatStore';
import { usePlatform } from './PlatformProvider';
import { useSession } from './SessionProvider';
import { useSettings } from './SettingsProvider';

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
  /** People you have blocked. Never anyone who has blocked you. */
  blocked: BlockedUserDto[];
  /** Everyone the UI might need to draw, friends and self alike. */
  usersById: Map<string, User>;
  self: User | null;

  activeChannelId: string | null;
  selectChannel: (channelId: string) => void;
  messagesFor: (channelId: string) => Message[];
  /**
   * Unread per channel. Seeded from the server on load and kept up by the
   * store after that, so the list draws its dots without asking again.
   */
  unread: Record<string, number>;
  /** Usernames currently typing in a channel. */
  typingIn: (channelId: string) => string[];

  send: (body: string) => Promise<void>;
  /** Tries an abandoned message again. Nothing else will: see the controller. */
  retrySend: (clientId: string) => Promise<void>;
  /**
   * The last message the other party has read in this channel, or undefined.
   *
   * Undefined is the normal case, not an error: it means they have not read
   * this far, or they have read receipts switched off, in which case the
   * server never tells us and no message will ever say "seen".
   */
  seenUpTo: (channelId: string) => string | undefined;
  notifyTyping: () => void;
  openDmWith: (userId: string) => Promise<void>;

  addFriend: (username: string) => Promise<SendFriendRequestResponse>;
  acceptRequest: (id: string) => Promise<void>;
  declineRequest: (id: string) => Promise<void>;
  /** Withdrawing a request you sent. Not the same call as declining one. */
  cancelRequest: (id: string) => Promise<void>;
  removeFriend: (userId: string) => Promise<void>;
  blockUser: (userId: string) => Promise<void>;
  unblockUser: (userId: string) => Promise<void>;
  /** Your own private label for someone. An empty string clears it. */
  setNickname: (userId: string, nickname: string) => Promise<void>;

  /**
   * People whose key is not the one this device pinned, by user id. While
   * somebody is in here nothing is sealed to them or opened from them, and
   * the conversation shows a notice with the one way out: acceptKey.
   */
  keyChanges: ReadonlyMap<string, KeyChange>;
  acceptKey: (userId: string) => Promise<void>;
  /**
   * Somebody's public key, once the pin store agrees it is theirs. Null when
   * this device holds no key for them; throws KeyChangedError when it holds
   * a different one. The call engine seals to what this returns.
   */
  resolvePeerKey: (userId: string) => Promise<Uint8Array | null>;

  /**
   * Call signalling, over the same socket messages use. Read by CallProvider
   * and nothing else: components get their call state from useCall().
   */
  callSignalling: CallSignalling;
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
  const [blocked, setBlocked] = useState<BlockedUserDto[]>([]);
  /// What the server last said each friend is. Absent means offline, which is
  /// also what the server would have said: it only announces people who are
  /// connected and showing as something.
  const [presences, setPresences] = useState<Map<string, Presence>>(new Map());
  const [typing, setTyping] = useState<{ channelId: string; userId: string; at: number }[]>([]);
  const [chatState, setChatState] = useState<ChatState>(initialChatState);
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
  /// What the server says everyone's key is. Nothing seals to an entry in
  /// here until the pin store has agreed with it, see trustedKey below.
  const keysByUser = useRef<Map<string, string>>(new Map());
  const selfIdRef = useRef<string | null>(null);
  selfIdRef.current = account?.id ?? null;

  /// Trust on first use for everyone else's key (lib/session/keyPins.ts).
  /// Created alongside the identity, since pins belong to an account.
  const pinsRef = useRef<KeyPinStore | null>(null);
  const [keyChanges, setKeyChanges] = useState<Map<string, KeyChange>>(new Map());

  const [controller] = useState(() => {
    const transport = new SocketTransport();

    /// The key to seal to or open with for somebody, once the pin store has
    /// agreed. Records a change for the UI before throwing it, so the notice
    /// goes up on the first message that hits it.
    async function trustedKey(userId: string): Promise<Uint8Array | null> {
      const encoded = keysByUser.current.get(userId);
      if (!encoded) return null;
      const pins = pinsRef.current;
      if (!pins) throw new Error('No identity to trust a key on behalf of.');
      try {
        return await fromBase64(await pins.trusted(userId, encoded));
      } catch (error) {
        if (error instanceof KeyChangedError) {
          const { change } = error;
          setKeyChanges((previous) => {
            const known = previous.get(change.userId);
            if (known && known.current === change.current) return previous;
            return new Map(previous).set(change.userId, change);
          });
        }
        throw error;
      }
    }

    return {
      transport,
      trustedKey,
      chat: new ChatController({
        transport,
        outbox: new Outbox(new SecureOutboxStorage(createSecureStore())),
        resolveRecipients: async (channelId) => {
          const conversation = conversationsRef.current.find((c) => c.id === channelId);
          if (!conversation) return [];

          const resolved: Recipient[] = [];
          for (const participant of conversation.participants) {
            // Our own copy is sealed to the key this device holds, never to
            // what the server says our key is. The controller adds it.
            if (participant.id === selfIdRef.current) continue;
            const publicKey = await trustedKey(participant.id);
            if (!publicKey) continue;
            resolved.push({ userId: participant.id, publicKey });
          }
          return resolved;
        },
        resolveAuthorKey: trustedKey,
      }),
    };
  });

  /// One reload for the whole friend graph. Blocking moves a row out of the
  /// friend list and into the blocked list in a single write, so refreshing
  /// half of it would leave the screen showing a person in two places or in
  /// neither.
  const reloadFriends = useCallback(async () => {
    const [{ friends: list }, requests, { blocked: blockedList }] = await Promise.all([
      friendsApi.list(),
      friendsApi.requests(),
      friendsApi.blocked(),
    ]);
    setFriends(list);
    setIncoming(requests.incoming);
    setOutgoing(requests.outgoing);
    setBlocked(blockedList);
  }, []);

  const reloadConversations = useCallback(
    async () => {
      const { conversations: list } = await conversationsApi.list();
      setConversations(list);
      // The server's counts are authoritative on a fresh load: this device may
      // have been closed while a conversation filled up, and it has no local
      // history of what it missed.
      controller.chat.seedUnread(
        Object.fromEntries(
          list
            .filter((conversation) => conversation.unread > 0)
            .map((conversation) => [conversation.id, conversation.unread]),
        ),
      );
      return list;
    },
    [controller],
  );

  /* --------------------------------------------------------------- start -- */

  useEffect(() => {
    if (!account) return;

    let live = true;
    const { chat, transport } = controller;

    const unsubscribeState = chat.subscribe((state) => {
      if (!live) return;
      setChatState(state);
      setQueued(chat.queuedCount);
    });

    const unsubscribeConnection = transport.on('state', (next) => {
      if (live) setConnection(next);
    });

    const unsubscribePresence = transport.on('presence', ({ userId, presence }) => {
      if (!live) return;
      setPresences((previous) => {
        const next = new Map(previous);
        if (presence === 'offline') next.delete(userId);
        else next.set(userId, presence);
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
        pinsRef.current = new KeyPinStore(createSecureStore(), account!.id);
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
      pinsRef.current = null;
      setKeyChanges(new Map());
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

    // Pin what is new and say what has changed as soon as the lists load,
    // so a changed key is a notice on the conversation and not a surprise on
    // the first message. Our own key is never pinned: it is whatever the
    // unlocked identity says it is.
    const pins = pinsRef.current;
    if (!pins) return;
    let live = true;
    void (async () => {
      const next = new Map<string, KeyChange>();
      for (const [userId, key] of map) {
        if (userId === selfIdRef.current) continue;
        const change = await pins.observe(userId, key);
        if (change) next.set(userId, change);
      }
      if (live) setKeyChanges(next);
    })();
    return () => {
      live = false;
    };
  }, [friends, conversations]);

  // A typing indicator that nobody refreshes has to expire on its own, or the
  // "… is typing" line stays up after the other person has given up.
  useEffect(() => {
    if (typing.length === 0) return;
    const timer = setTimeout(() => {
      setTyping((previous) => previous.filter((entry) => Date.now() - entry.at < TYPING_TTL_MS));
    }, TYPING_TTL_MS);
    return () => clearTimeout(timer);
  }, [typing]);

  /// Nicknames come down with the friend list, so they are already loaded by
  /// the time anybody is rendered. Kept as its own map because a conversation
  /// participant who is no longer a friend still has to be drawn under whatever
  /// you called them.
  const nicknames = useMemo(() => {
    const map = new Map<string, string>();
    for (const friend of friends) {
      if (friend.nickname) map.set(friend.id, friend.nickname);
    }
    return map;
  }, [friends]);

  const usersById = useMemo(() => {
    const map = new Map<string, User>();

    // Yourself first. You are not in your own friend list, and you are only in
    // a conversation once you have started one, so without this the account
    // avatar and your own message bubbles have nobody to render until then.
    // Drawn from the account's own profile, and as online: the presence you
    // chose is overlaid by App.tsx from settings, which moves before the
    // server has heard.
    if (account) {
      map.set(
        account.id,
        friendToUser(
          {
            id: account.id,
            username: account.username,
            publicKey: keys.current?.publicKey ?? null,
            nickname: null,
            friendsSince: account.createdAt,
            profile: account.profile,
          },
          'online',
        ),
      );
    }

    for (const friend of friends) {
      map.set(friend.id, friendToUser(friend, presences.get(friend.id) ?? 'offline'));
    }

    // Anyone in a conversation who is no longer a friend still has to render,
    // or their side of the history would show as an unknown author.
    for (const conversation of conversations) {
      for (const participant of conversation.participants) {
        if (map.has(participant.id)) continue;
        map.set(
          participant.id,
          friendToUser(
            {
              ...participant,
              nickname: nicknames.get(participant.id) ?? null,
              friendsSince: conversation.createdAt,
            },
            presences.get(participant.id) ?? 'offline',
          ),
        );
      }
    }

    return map;
  }, [account, keys, friends, conversations, nicknames, presences]);

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
          // What you call them, if you have renamed them. The list, the header
          // and the composer placeholder all read from here, so one lookup is
          // what makes a nickname show up everywhere at once.
          name: (other && nicknames.get(other.id)) ?? other?.username ?? 'unknown',
          recipientId: other?.id,
        };
      }),
    [conversations, account?.id, nicknames],
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

  /// Read means on screen *and* in front. A conversation sitting open behind
  /// another window has not been read, so its count survives until the tab
  /// comes back, which is also when the server hears about it.
  useEffect(() => {
    const { chat } = controller;

    const apply = () => {
      chat.focus(document.hasFocus() && !document.hidden ? activeChannelId : null);
    };

    apply();
    window.addEventListener('focus', apply);
    window.addEventListener('blur', apply);
    document.addEventListener('visibilitychange', apply);

    return () => {
      window.removeEventListener('focus', apply);
      window.removeEventListener('blur', apply);
      document.removeEventListener('visibilitychange', apply);
    };
  }, [activeChannelId, controller]);

  /* --------------------------------------------------- the platform side -- */

  const platform = usePlatform();
  const { settings } = useSettings();

  /// The unread total, on the icon and in the title. Cleared on the way out
  /// so a sign-out does not leave a count standing for nobody. Notifications
  /// themselves are components/DesktopNotifier.tsx, which watches the
  /// history this provider exposes.
  const unreadTotal = Object.values(chatState.unread).reduce((sum, count) => sum + count, 0);
  const unreadBadge = settings.notifications.unreadBadge;
  useEffect(() => {
    void platform.setBadge(unreadBadge ? unreadTotal : 0);
  }, [platform, unreadBadge, unreadTotal]);
  useEffect(
    () => () => {
      void platform.setBadge(0);
    },
    [platform],
  );

  const send = useCallback(
    async (body: string) => {
      if (!activeChannelId) return;
      await controller.chat.send(activeChannelId, body);
    },
    [activeChannelId, controller],
  );

  const seenUpTo = useCallback(
    (channelId: string) => {
      const perUser = chatState.peerReads[channelId];
      if (!perUser) return undefined;
      // The furthest anyone else has read. A DM has one other party, so this
      // is theirs; a group would show the most-read position, which is the
      // useful one for "has this been seen".
      const others = Object.entries(perUser).filter(([userId]) => userId !== account?.id);
      return others.at(-1)?.[1];
    },
    [chatState.peerReads, account?.id],
  );

  const retrySend = useCallback(
    async (clientId: string) => {
      await controller.chat.retry(clientId);
    },
    [controller],
  );

  /// Typing indicators off means this device never says so. There is nothing
  /// for the server to enforce: a signal that is not sent cannot be relayed,
  /// which is why this setting, alone among the privacy ones, stays local.
  const typingAllowed = settings.privacy.typingIndicators;
  const notifyTyping = useCallback(() => {
    if (!typingAllowed) return;
    if (activeChannelId) controller.transport.notifyTyping(activeChannelId);
  }, [activeChannelId, controller, typingAllowed]);

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

  const cancelRequest = useCallback(
    async (id: string) => {
      await friendsApi.cancel(id);
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

  const blockUser = useCallback(
    async (userId: string) => {
      await friendsApi.block(userId);
      // Blocking replaces the friendship row, so both lists move: they leave
      // your friends, and any request between you is gone.
      await Promise.all([reloadFriends(), reloadConversations()]);
    },
    [reloadConversations, reloadFriends],
  );

  const unblockUser = useCallback(
    async (userId: string) => {
      await friendsApi.unblock(userId);
      // Unblocking deletes the row outright rather than restoring what was
      // there before, so afterwards the two of you are strangers and either can
      // send a request. The screen says so.
      await reloadFriends();
    },
    [reloadFriends],
  );

  const setNickname = useCallback(
    async (userId: string, nickname: string) => {
      const trimmed = nickname.trim();
      if (trimmed) await friendsApi.setNickname(userId, trimmed);
      else await friendsApi.clearNickname(userId);
      await reloadFriends();
    },
    [reloadFriends],
  );

  /// The user has looked at a changed key and said it is fine. Whatever
  /// that person sent under it was refused and sits as a locked bubble; it
  /// is readable now, so every conversation they are in gets another go.
  const acceptKey = useCallback(
    async (userId: string) => {
      const pins = pinsRef.current;
      const current = keysByUser.current.get(userId);
      if (!pins || !current) return;
      await pins.accept(userId, current);
      setKeyChanges((previous) => {
        if (!previous.has(userId)) return previous;
        const next = new Map(previous);
        next.delete(userId);
        return next;
      });
      for (const conversation of conversationsRef.current) {
        if (conversation.participants.some((participant) => participant.id === userId)) {
          await controller.chat.reopen(conversation.id);
        }
      }
    },
    [controller],
  );

  const messagesFor = useCallback(
    (channelId: string) => messagesForChannel(chatState, channelId),
    [chatState],
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
      blocked,
      usersById,
      self,
      activeChannelId,
      selectChannel,
      messagesFor,
      unread: chatState.unread,
      typingIn,
      send,
      retrySend,
      seenUpTo,
      notifyTyping,
      openDmWith,
      addFriend,
      acceptRequest,
      declineRequest,
      cancelRequest,
      removeFriend,
      blockUser,
      unblockUser,
      setNickname,
      keyChanges,
      acceptKey,
      resolvePeerKey: controller.trustedKey,
      callSignalling: controller.transport.calls,
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
      blocked,
      usersById,
      self,
      activeChannelId,
      selectChannel,
      messagesFor,
      chatState.unread,
      typingIn,
      send,
      retrySend,
      seenUpTo,
      notifyTyping,
      openDmWith,
      addFriend,
      acceptRequest,
      declineRequest,
      cancelRequest,
      removeFriend,
      blockUser,
      unblockUser,
      setNickname,
      keyChanges,
      acceptKey,
      controller,
    ],
  );

  return (
    <ChatContext.Provider value={value}>
      {children}
      {/* Rendered here because this is the component that owns the socket. The
          curtain is a view of `connection` and nothing else, and every screen
          under it would otherwise have to know about a state that has nothing
          to do with what it draws. */}
      <ConnectionCurtain connection={connection} />
    </ChatContext.Provider>
  );
}

export function useChat(): ChatContextValue {
  const context = useContext(ChatContext);
  if (!context) throw new Error('useChat must be used inside a <ChatProvider>');
  return context;
}
