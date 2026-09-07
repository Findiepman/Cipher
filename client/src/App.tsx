/**
 * The chat window.
 *
 * Everything here comes from the server through ChatProvider. The fixtures this
 * file used to render (the nova/ren/kestrel conversations) now live only behind
 * VITE_BACKEND=mock, which is the escape hatch for working on the design with
 * no backend running. See MockApp.
 */
import { useState } from 'react';
import { ChatHeader } from './components/ChatHeader';
import { Composer } from './components/Composer';
import { ConversationList, type Preview } from './components/ConversationList';
import { MessageList } from './components/MessageList';
import { PersonMenuProvider } from './components/PersonMenu';
import { TopBar, type View } from './components/TopBar';
import { FriendsScreen } from './screens/FriendsScreen';
import { useChat } from './state/ChatProvider';
import './styles/global.css';
import './styles/app.css';

export default function App() {
  const chat = useChat();
  const [view, setView] = useState<View>('direct');

  const {
    ready,
    error,
    connection,
    queued,
    channels,
    incoming,
    usersById,
    self,
    activeChannelId,
    selectChannel,
    messagesFor,
    typingIn,
    send,
    notifyTyping,
  } = chat;

  const activeChannel = channels.find((channel) => channel.id === activeChannelId) ?? null;
  const messages = activeChannel ? messagesFor(activeChannel.id) : [];

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

  const recipient = activeChannel?.recipientId
    ? usersById.get(activeChannel.recipientId)
    : undefined;

  return (
    <PersonMenuProvider>
      <div className="app">
        <TopBar
          view={view}
          onSelect={setView}
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
                  onSelect={selectChannel}
                  usersById={usersById}
                  previews={previews}
                  currentUser={self}
                />
              </div>

              <main className="panel panel--chat">
                {error ? (
                  <Empty
                    title="Could not load your conversations"
                    body={error.message}
                  />
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
            </>
          )}
        </div>
      </div>
    </PersonMenuProvider>
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
