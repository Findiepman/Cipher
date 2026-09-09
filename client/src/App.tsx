/**
 * The chat window.
 *
 * Everything here comes from the server through ChatProvider. The fixtures this
 * file used to render (the nova/ren/kestrel conversations) now live only behind
 * VITE_BACKEND=mock, which is the escape hatch for working on the design with
 * no backend running. See MockApp.
 *
 * The profile panel is a third column rather than an overlay, and its state is
 * two pieces rather than one id. `hidden` is a preference: you closed it, so it
 * stays closed as you move between conversations. `pinnedUserId` is an
 * override: you asked for one particular person, so the panel stops following
 * the conversation until you change conversation. With a single id, closing the
 * panel and then switching DM would reopen it, and "view profile" on a message
 * author would be silently replaced the next time anything re-rendered.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChatHeader } from './components/ChatHeader';
import { Composer } from './components/Composer';
import { ConversationList, type Preview } from './components/ConversationList';
import { MessageList } from './components/MessageList';
import { PersonMenuProvider, usePersonMenu } from './components/PersonMenu';
import { TopBar, type View } from './components/TopBar';
import { UserProfile } from './components/UserProfile';
import { FriendsScreen } from './screens/FriendsScreen';
import { VaultScreen } from './screens/VaultScreen';
import { SettingsScreen } from './screens/settings/SettingsScreen';
import { CallPanel } from './components/CallPanel';
import { CallRinger } from './components/CallRinger';
import { DesktopNotifier } from './components/DesktopNotifier';
import { MessageChime } from './components/MessageChime';
import { MessageToasts } from './components/MessageToasts';
import { plainText } from './lib/chat/format';
import { splitPinned } from './lib/settings/pinned';
import { withProfile } from './lib/settings/profile';
import { resolveActivityBar } from './lib/settings/types';
import { describeError, useT } from './state/I18nProvider';
import { useCall } from './state/CallProvider';
import { useChat } from './state/ChatProvider';
import { useSettings } from './state/SettingsProvider';
import './styles/global.css';
import './styles/app.css';

export default function App() {
  const [view, setView] = useState<View>('direct');
  // Open beside the conversation on a wide window. On a narrow one the column
  // has nowhere to sit, so it starts closed and the header's Profile button
  // opens it as a sheet over the conversation (app.css).
  const [hidden, setHidden] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1100px)').matches,
  );
  const [pinnedUserId, setPinnedUserId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // The shortcut everyone tries first. Bound here rather than in the settings
  // screen so it can open as well as close.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault();
        setSettingsOpen((open) => !open);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The panel only exists beside a conversation, so asking for a profile from
  // the Friends screen has to move you there. Without this the menu item is
  // live, does something and shows nothing.
  const viewProfile = useCallback((userId: string) => {
    setPinnedUserId(userId);
    setHidden(false);
    setView('direct');
  }, []);

  return (
    <PersonMenuProvider onViewProfile={viewProfile}>
      {/* None of the three draws anything. They watch for an arriving message
          and an incoming call, and play whichever sound that person is set to
          or hand the message to the operating system. Mounted here rather than
          beside the call panel so opening settings does not unmount a ringtone
          mid-ring, and so a notification still arrives while you are reading a
          settings screen. */}
      <CallRinger />
      <MessageChime />
      <DesktopNotifier />
      <MessageToasts />

      <Shell
        view={view}
        onSelectView={setView}
        hidden={hidden}
        onSetHidden={setHidden}
        pinnedUserId={pinnedUserId}
        onSetPinned={setPinnedUserId}
        settingsOpen={settingsOpen}
        onSetSettingsOpen={setSettingsOpen}
      />
    </PersonMenuProvider>
  );
}

/**
 * Split out because it calls `usePersonMenu`, and a hook cannot be used in the
 * same component that renders the provider it comes from.
 */
function Shell({
  view,
  onSelectView,
  hidden,
  onSetHidden,
  pinnedUserId,
  onSetPinned,
  settingsOpen,
  onSetSettingsOpen,
}: {
  view: View;
  onSelectView: (view: View) => void;
  hidden: boolean;
  onSetHidden: (hidden: boolean) => void;
  pinnedUserId: string | null;
  onSetPinned: (userId: string | null) => void;
  settingsOpen: boolean;
  onSetSettingsOpen: (open: boolean) => void;
}) {
  const chat = useChat();
  const menu = usePersonMenu();
  const t = useT();
  const { settings } = useSettings();
  const { call, supported: callsSupported, startCall } = useCall();

  const {
    ready,
    error,
    connection,
    queued,
    channels,
    incoming,
    friends,
    usersById,
    self,
    activeChannelId,
    selectChannel,
    messagesFor,
    unread,
    typingIn,
    send,
    notifyTyping,
  } = chat;

  // Your own row, your avatar in the top bar and your own bubbles all read from
  // one User, so the profile preferences are folded in once here rather than
  // special-cased in each component that draws you.
  const me = useMemo(
    () => (self ? withProfile(self, settings.profile) : null),
    [self, settings.profile],
  );

  const activeChannel = channels.find((channel) => channel.id === activeChannelId) ?? null;
  const messages = activeChannel ? messagesFor(activeChannel.id) : [];

  const recipient = activeChannel?.recipientId
    ? usersById.get(activeChannel.recipientId)
    : undefined;

  // A pinned profile is dropped when you change conversation: being shown
  // someone from a conversation you have left is worse than showing nobody.
  const profileUser = hidden
    ? undefined
    : ((pinnedUserId ? usersById.get(pinnedUserId) : undefined) ?? recipient);

  const openConversation = useCallback(
    (channelId: string) => {
      onSetPinned(null);
      selectChannel(channelId);
    },
    [onSetPinned, selectChannel],
  );

  // Every row carries the last thing said in it, rendered from this device's
  // own history rather than from anything the server summarised. Flattened
  // to one line: a fence or a backtick says nothing in a twelve pixel preview.
  const previews = new Map<string, Preview>();
  for (const channel of channels) {
    const last = messagesFor(channel.id).at(-1);
    if (!last) continue;
    previews.set(channel.id, {
      text:
        last.state === 'decrypted' || last.state === 'sending'
          ? plainText(last.body ?? '')
          : t('chat.newMessage'),
      at: last.sentAt,
    });
  }

  // The people you keep at the top, lifted out of the list. Pinning is by
  // person rather than by conversation (lib/settings/pinned.ts), so a group
  // channel simply stays where it was.
  const pinned = splitPinned(channels, settings.sidebar.pinned, (channel) => channel.recipientId);

  // Which conversation the live call belongs to, if any. `ended` still counts:
  // the panel is still up, and a second call cannot start until it is gone.
  const callConversationId = call.phase === 'idle' ? null : call.conversationId;
  const callState: 'none' | 'here' | 'elsewhere' =
    callConversationId === null
      ? 'none'
      : callConversationId === activeChannel?.id
        ? 'here'
        : 'elsewhere';

  // The call panel floats above whichever screen is up, settings included: a
  // call does not stop being a call because you went to look at a setting.
  if (settingsOpen && me) {
    return (
      <>
        <SettingsScreen user={me} onClose={() => onSetSettingsOpen(false)} />
        <CallPanel />
      </>
    );
  }

  // Where the activity bar is docked. The attribute is what app.css turns into
  // a row or a column, so the whole placement is one word in two places. Read
  // through the resolver because the stored value is only checked for being a
  // string, and an unknown edge would leave the bar nowhere.
  const activityBar = resolveActivityBar(settings.appearance.activityBar);

  return (
    <div className="app" data-bar={activityBar}>
      <TopBar
        view={view}
        onSelect={onSelectView}
        currentUser={me}
        requestCount={incoming.length}
        connection={connection}
        placement={activityBar}
      />

      <div className="app__body">
        {view === 'friends' ? (
          <main className="panel panel--chat">
            <FriendsScreen />
          </main>
        ) : view === 'vault' ? (
          <main className="panel panel--chat">
            <VaultScreen />
          </main>
        ) : (
          <>
            <div className="panel panel--list">
              <ConversationList
                sections={[
                  {
                    label: t('chat.sectionPinned'),
                    channels: pinned.pinned,
                    pinned: true,
                  },
                  { label: t('chat.sectionDirect'), channels: pinned.rest },
                ]}
                activeChannelId={activeChannel?.id ?? ''}
                onSelect={openConversation}
                usersById={usersById}
                previews={previews}
                unread={unread}
                currentUser={me}
                onOpenSettings={() => onSetSettingsOpen(true)}
              />
            </div>

            <main className="panel panel--chat">
              {error ? (
                <Empty title={t('chat.loadFailed')} body={describeError(error, t)} />
              ) : !ready ? (
                <Empty title={t('chat.loadingTitle')} body={t('chat.loadingBody')} />
              ) : !activeChannel ? (
                <Empty title={t('chat.noneTitle')} body={t('chat.noneBody')} />
              ) : (
                <>
                  <ChatHeader
                    channel={activeChannel}
                    recipient={recipient}
                    members={recipient ? [recipient] : []}
                    profileOpen={Boolean(profileUser)}
                    onToggleProfile={
                      recipient
                        ? () => {
                            onSetPinned(null);
                            onSetHidden(Boolean(profileUser));
                          }
                        : undefined
                    }
                    onCall={
                      recipient && callsSupported
                        ? () => startCall(activeChannel.id, recipient.id)
                        : undefined
                    }
                    callState={callState}
                  />

                  <MessageList
                    channel={activeChannel}
                    messages={messages}
                    usersById={usersById}
                    currentUserId={self?.id ?? ''}
                    currentUserName={self?.name ?? t('chat.you')}
                  />

                  <Composer
                    placeholder={t('chat.composerTo', { name: activeChannel.name })}
                    onSend={(body) => void send(body)}
                    onTyping={notifyTyping}
                    typing={typingIn(activeChannel.id)}
                    // Says what is true: nothing is lost, it just has not left
                    // yet. Silently swallowing a send is the behaviour that
                    // makes people stop trusting a messenger.
                    notice={
                      queued > 0 ? t('chat.queued', { count: queued }) : undefined
                    }
                  />
                </>
              )}
            </main>

            {profileUser && (
              <aside className="panel panel--profile">
                <UserProfile
                  user={profileUser}
                  isFriend={friends.some((friend) => friend.id === profileUser.id)}
                  friendsSince={
                    friends.find((friend) => friend.id === profileUser.id)?.friendsSince
                  }
                  onAction={(action) => menu.act(action, profileUser.id)}
                  onClose={() => {
                    onSetPinned(null);
                    onSetHidden(true);
                  }}
                />
              </aside>
            )}
          </>
        )}
      </div>

      <CallPanel />
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="app__empty">
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}
