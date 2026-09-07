import { useEffect, useMemo, useState } from 'react';
import { ChatHeader } from './components/ChatHeader';
import { Composer } from './components/Composer';
import { ConversationList, type Preview } from './components/ConversationList';
import { MessageList } from './components/MessageList';
import { TopBar } from './components/TopBar';
import {
  CURRENT_USER_ID,
  channels as allChannels,
  messages as seedMessages,
  serverMembers,
  servers,
  usersById,
} from './data/mockData';
import { fakeSeal } from './lib/envelope';
import { withProfile } from './lib/settings/profile';
import { SettingsScreen } from './screens/settings/SettingsScreen';
import { useSettings } from './state/SettingsProvider';
import type { Channel, Message } from './types';
import './styles/global.css';
import './styles/app.css';

/** Demo-only: who appears to be typing in a given channel. */
const TYPING: Record<string, string[]> = {
  'c-general': ['nova'],
  'd-nova': ['nova'],
};

export default function App() {
  const [activeServerId, setActiveServerId] = useState('s-cipher');
  // Remembering the last conversation per workspace is what makes switching
  // from the top bar feel like coming back rather than starting over.
  const [lastChannel, setLastChannel] = useState<Record<string, string>>({
    's-cipher': 'c-general',
    '@me': 'd-nova',
  });
  const [messages, setMessages] = useState<Message[]>(seedMessages);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { settings, update } = useSettings();
  const showCiphertext = settings.appearance.showCiphertext;

  // Your own row, avatar and bubbles all read from one User, so the profile
  // settings are folded in once here rather than special-cased per component.
  const baseUser = usersById.get(CURRENT_USER_ID)!;
  const currentUser = useMemo(
    () => withProfile(baseUser, settings.profile),
    [baseUser, settings.profile],
  );

  // The shortcut everyone tries first.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const serverChannels = useMemo(
    () => allChannels.filter((channel) => channel.serverId === activeServerId),
    [activeServerId],
  );

  const activeChannelId = lastChannel[activeServerId] ?? serverChannels[0]?.id;
  const activeChannel =
    serverChannels.find((channel) => channel.id === activeChannelId) ?? serverChannels[0];

  const channelMessages = useMemo(
    () => messages.filter((message) => message.conversationId === activeChannel?.id),
    [messages, activeChannel?.id],
  );

  // Every row in the list carries the last thing said in it.
  const previews = useMemo(() => {
    const latest = new Map<string, Preview>();
    for (const message of messages) {
      const channel = allChannels.find((c) => c.id === message.conversationId);
      if (!channel) continue;

      const author = usersById.get(message.authorId);
      const body =
        message.state === 'decrypted' || message.state === 'sending'
          ? (message.body ?? '')
          : 'sealed message';
      const text =
        channel.kind === 'dm' ? body : `${author?.name ?? 'unknown'}: ${body}`;

      latest.set(channel.id, { text, at: message.sentAt });
    }
    return latest;
  }, [messages]);

  const sections = useMemo(() => groupChannels(serverChannels), [serverChannels]);

  const members = useMemo(
    () =>
      (serverMembers[activeServerId] ?? [])
        .map((id) => usersById.get(id))
        .filter((user): user is NonNullable<typeof user> => Boolean(user)),
    [activeServerId],
  );

  const dmUnread = allChannels.filter(
    (channel) => channel.serverId === '@me' && channel.unread,
  ).length;

  function handleSend(body: string) {
    if (!activeChannel) return;

    const id = `m-local-${Date.now()}`;
    const message: Message = {
      id,
      conversationId: activeChannel.id,
      authorId: CURRENT_USER_ID,
      sentAt: new Date().toISOString(),
      state: 'sending',
      body,
      // The real client seals here, before the message touches the network.
      ciphertext: fakeSeal(body),
    };

    setMessages((prev) => [...prev, message]);

    // Stands in for the server ack that will arrive over the socket.
    setTimeout(() => {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, state: 'decrypted' } : m)),
      );
    }, 400);
  }

  if (!activeChannel) return null;

  const recipient = activeChannel.recipientId
    ? usersById.get(activeChannel.recipientId)
    : undefined;

  return (
    <div className="app">
      <TopBar
        servers={servers}
        activeServerId={activeServerId}
        onSelect={setActiveServerId}
        currentUser={currentUser}
        dmUnread={dmUnread}
      />

      <div className="app__body">
        <div className="panel panel--list">
          <ConversationList
            sections={sections}
            activeChannelId={activeChannel.id}
            onSelect={(conversationId) =>
              setLastChannel((prev) => ({ ...prev, [activeServerId]: conversationId }))
            }
            usersById={usersById}
            previews={previews}
            currentUser={currentUser}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </div>

        <main className="panel panel--chat">
          <ChatHeader
            channel={activeChannel}
            recipient={recipient}
            members={members}
            showCiphertext={showCiphertext}
            onToggleCiphertext={() =>
              update('appearance', { showCiphertext: !showCiphertext })
            }
          />

          <MessageList
            channel={activeChannel}
            messages={channelMessages}
            usersById={usersById}
            currentUserId={CURRENT_USER_ID}
            currentUserName={currentUser.name}
            showCiphertext={showCiphertext}
          />

          <Composer
            placeholder={`message ${activeChannel.name}`}
            onSend={handleSend}
            typing={settings.privacy.typingIndicators ? TYPING[activeChannel.id] : undefined}
          />
        </main>
      </div>

      {settingsOpen && (
        <SettingsScreen user={currentUser} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}

/**
 * Channels and DMs share one list, split only by a small label. "Text
 * Channels" reads as noise next to the names themselves, so it becomes
 * "channels".
 */
function groupChannels(channels: Channel[]): { label: string; channels: Channel[] }[] {
  const order: string[] = [];
  const groups = new Map<string, Channel[]>();

  for (const channel of channels) {
    const label =
      channel.kind === 'dm'
        ? 'direct'
        : (channel.category ?? 'channels').replace(/\s*channels$/i, '').toLowerCase();

    if (!groups.has(label)) {
      groups.set(label, []);
      order.push(label);
    }
    groups.get(label)!.push(channel);
  }

  return order.map((label) => ({ label, channels: groups.get(label)! }));
}
