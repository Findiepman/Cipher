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
import { useCallback, useState } from 'react';
import { ChatHeader } from './components/ChatHeader';
import { Composer } from './components/Composer';
import { ConversationList, type Preview } from './components/ConversationList';
import { MessageList } from './components/MessageList';
import { PersonMenuProvider, usePersonMenu } from './components/PersonMenu';
import { TopBar, type View } from './components/TopBar';
import { UserProfile } from './components/UserProfile';
import { FriendsScreen } from './screens/FriendsScreen';
import { useChat } from './state/ChatProvider';
import './styles/global.css';
import './styles/app.css';

export default function App() {
  const [view, setView] = useState<View>('direct');
  const [hidden, setHidden] = useState(false);
  const [pinnedUserId, setPinnedUserId] = useState<string | null>(null);

  // The panel only exists beside a conversation, so asking for a profile from
  // the Friends screen has to move you there. Without this the menu item is
  // live, does something, and shows nothing.
  const viewProfile = useCallback((userId: string) => {
    setPinnedUserId(userId);
    setHidden(false);
    setView('direct');
  }, []);

  return (
    <PersonMenuProvider onViewProfile={viewProfile}>
      <Shell
        view={view}
        onSelectView={setView}
        hidden={hidden}
        onSetHidden={setHidden}
        pinnedUserId={pinnedUserId}
        onSetPinned={setPinnedUserId}
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
}: {
  view: View;
  onSelectView: (view: View) => void;
  hidden: boolean;
  onSetHidden: (hidden: boolean) => void;
  pinnedUserId: string | null;
  onSetPinned: (userId: string | null) => void;
}) {
  const chat = useChat();
  const menu = usePersonMenu();

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
  // own history rather than from anything the server summarised.
  const previews = new Map<string, Preview>();
  for (const channel of channels) {
    const last = messagesFor(channel.id).at(-1);
    if (!last) continue;
    previews.set(channel.id, {
      text:
        last.state === 'decrypted' || last.state === 'sending'
          ? (last.body ?? '')
          : 'New message',
      at: last.sentAt,
    });
  }

  return (
    <div className="app">
      <TopBar
        view={view}
        onSelect={onSelectView}
        currentUser={self}
        requestCount={incoming.length}
        connection={connection}
      />

      <div className="app__body">
        {view === 'friends' ? (
          <main className="panel panel--chat">
            <FriendsScreen />
          </main>
        ) : (
          <>
            <div className="panel panel--list">
              <ConversationList
                sections={[{ label: 'direct', channels }]}
                activeChannelId={activeChannel?.id ?? ''}
                onSelect={openConversation}
                usersById={usersById}
                previews={previews}
                unread={unread}
                currentUser={self}
              />
            </div>

            <main className="panel panel--chat">
              {error ? (
                <Empty title="Could not load your conversations" body={error.message} />
              ) : !ready ? (
                <Empty title="Loading…" body="Fetching your conversations." />
              ) : !activeChannel ? (
                <Empty
                  title="No conversations yet"
                  body="Add someone under Friends, then start a conversation with them."
                />
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
                  />

                  <MessageList
                    channel={activeChannel}
                    messages={messages}
                    usersById={usersById}
                    currentUserId={self?.id ?? ''}
                    currentUserName={self?.name ?? 'you'}
                  />

                  <Composer
                    placeholder={`message ${activeChannel.name}`}
                    onSend={(body) => void send(body)}
                    onTyping={notifyTyping}
                    typing={typingIn(activeChannel.id)}
                    // Says what is true: nothing is lost, it just has not left
                    // yet. Silently swallowing a send is the behaviour that
                    // makes people stop trusting a messenger.
                    notice={queued > 0 ? `${queued} waiting to send` : undefined}
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
