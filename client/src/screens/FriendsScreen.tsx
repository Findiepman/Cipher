/**
 * Everything about the people you know, behind five tabs.
 *
 * Adding is by exact username. There is no search box here on purpose: a
 * directory you can browse is a list of everyone with an account on this
 * server, which is not a thing a private messenger should hand out. You type a
 * handle somebody gave you, or you do not find them.
 *
 * The two directions of a pending request are separate tabs rather than two
 * sections of one, because they are different jobs. Received is a queue you
 * work through; Sent is a list you occasionally give up on. Putting them
 * together meant the thing needing an answer was below the thing that did not.
 */
import { useState, type FormEvent, type ReactNode } from 'react';
import { Avatar } from '../components/Avatar';
import { usePersonMenu } from '../components/PersonMenu';
import { BanIcon, ClockIcon, InboxIcon, ProfileIcon, UserPlusIcon } from '../components/Icons';
import { ApiError } from '../lib/api';
import { colorFor } from '../lib/presentation';
import { useChat } from '../state/ChatProvider';
import type { BlockedUserDto, FriendRequestDto } from '../lib/api/types';
import '../styles/friends.css';

type Tab = 'all' | 'add' | 'sent' | 'received' | 'blocked';

export function FriendsScreen() {
  const { friends, incoming, outgoing, blocked } = useChat();
  const [tab, setTab] = useState<Tab>('all');

  return (
    <div className="friends">
      <nav className="friends__tabs" aria-label="Friends">
        <TabButton
          tab="all"
          current={tab}
          onSelect={setTab}
          icon={<ProfileIcon size={15} />}
          label="All friends"
          count={friends.length}
        />
        <TabButton
          tab="add"
          current={tab}
          onSelect={setTab}
          icon={<UserPlusIcon size={15} />}
          label="Add friend"
        />
        <TabButton
          tab="sent"
          current={tab}
          onSelect={setTab}
          icon={<ClockIcon size={15} />}
          label="Sent"
          count={outgoing.length}
        />
        {/* The only count drawn in ember: it is the one asking for something. */}
        <TabButton
          tab="received"
          current={tab}
          onSelect={setTab}
          icon={<InboxIcon size={15} />}
          label="Received"
          count={incoming.length}
          urgent
        />
        <TabButton
          tab="blocked"
          current={tab}
          onSelect={setTab}
          icon={<BanIcon size={15} />}
          label="Blocked"
          count={blocked.length}
        />
      </nav>

      <div className="friends__pane scroller">
        {tab === 'all' && <AllFriends />}
        {tab === 'add' && <AddFriend />}
        {tab === 'sent' && <SentRequests requests={outgoing} />}
        {tab === 'received' && <ReceivedRequests requests={incoming} />}
        {tab === 'blocked' && <BlockedUsers blocked={blocked} onAdd={() => setTab('add')} />}
      </div>
    </div>
  );
}

function TabButton({
  tab,
  current,
  onSelect,
  icon,
  label,
  count,
  urgent = false,
}: {
  tab: Tab;
  current: Tab;
  onSelect: (tab: Tab) => void;
  icon: ReactNode;
  label: string;
  count?: number;
  urgent?: boolean;
}) {
  const active = tab === current;

  return (
    <button
      type="button"
      className={`friends__tab${active ? ' friends__tab--active' : ''}`}
      onClick={() => onSelect(tab)}
      aria-current={active || undefined}
    >
      <span className="friends__tab-icon">{icon}</span>
      <span className="friends__tab-label">{label}</span>
      {count ? (
        <span className={`friends__tab-count mono${urgent ? ' friends__tab-count--urgent' : ''}`}>
          {count}
        </span>
      ) : null}
    </button>
  );
}

/* ------------------------------------------------------------- all ------- */

function AllFriends() {
  const { friends, usersById, openDmWith } = useChat();
  const menu = usePersonMenu();

  if (friends.length === 0) {
    return (
      <Empty
        title="No friends yet"
        body="Add someone by the exact username they gave you, under Add friend."
      />
    );
  }

  return (
    <Section label="friends" count={friends.length}>
      {friends.map((friend) => {
        const user = usersById.get(friend.id);
        return (
          <div
            key={friend.id}
            className="friends__row"
            onContextMenu={(event) => menu.open(event, friend.id)}
          >
            {user && <Avatar user={user} size={34} showPresence />}
            <span className="friends__text">
              <span className="friends__name">{friend.nickname ?? friend.username}</span>
              {/* The handle stays visible under a nickname. Renaming someone
                  should not make it harder to check who they are. */}
              <span className="friends__handle mono">{friend.username}</span>
            </span>
            <button type="button" onClick={() => void openDmWith(friend.id)}>
              Message
            </button>
            <button
              type="button"
              className="friends__quiet"
              onClick={(event) => menu.open(event, friend.id)}
              aria-label={`More actions for ${friend.nickname ?? friend.username}`}
            >
              More
            </button>
          </div>
        );
      })}
    </Section>
  );
}

/* ------------------------------------------------------------- add ------- */

function AddFriend() {
  const { addFriend } = useChat();
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const handle = username.trim();
    if (!handle || busy) return;

    setBusy(true);
    setNotice(null);
    try {
      const result = await addFriend(handle);
      setUsername('');
      setNotice({ tone: 'ok', text: outcomeText(result.status, result.user.username) });
    } catch (error) {
      setNotice({ tone: 'bad', text: failureText(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="friends__add" onSubmit={(event) => void submit(event)}>
      <label className="eyebrow" htmlFor="add-friend">
        add someone
      </label>
      <p className="friends__lede">
        You need their exact username. There is no directory to browse, which is
        deliberate: it would be a list of everyone with an account here.
      </p>
      <div className="friends__add-row">
        <input
          id="add-friend"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="their exact username"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
        />
        <button type="submit" disabled={busy || username.trim().length === 0}>
          {busy ? 'Sending…' : 'Send request'}
        </button>
      </div>
      {notice && <p className={`friends__notice friends__notice--${notice.tone}`}>{notice.text}</p>}
    </form>
  );
}

/* --------------------------------------------------------- requests ------ */

function SentRequests({ requests }: { requests: FriendRequestDto[] }) {
  const { cancelRequest } = useChat();

  if (requests.length === 0) {
    return <Empty title="Nothing waiting" body="Requests you send show up here until they answer." />;
  }

  return (
    <Section label="sent" count={requests.length}>
      {requests.map((request) => (
        <RequestRow key={request.id} request={request} note="waiting for them">
          <button
            type="button"
            className="friends__quiet"
            onClick={() => void cancelRequest(request.id)}
          >
            Cancel
          </button>
        </RequestRow>
      ))}
    </Section>
  );
}

function ReceivedRequests({ requests }: { requests: FriendRequestDto[] }) {
  const { acceptRequest, declineRequest } = useChat();

  if (requests.length === 0) {
    return <Empty title="Nothing to answer" body="Requests other people send you land here." />;
  }

  return (
    <Section label="received" count={requests.length}>
      {requests.map((request) => (
        <RequestRow key={request.id} request={request} note="wants to talk to you">
          <button type="button" onClick={() => void acceptRequest(request.id)}>
            Accept
          </button>
          <button
            type="button"
            className="friends__quiet"
            onClick={() => void declineRequest(request.id)}
          >
            Decline
          </button>
        </RequestRow>
      ))}
    </Section>
  );
}

function RequestRow({
  request,
  note,
  children,
}: {
  request: FriendRequestDto;
  note: string;
  children: ReactNode;
}) {
  return (
    <div className="friends__row">
      <Avatar
        user={{
          id: request.user.id,
          name: request.user.username,
          username: request.user.username,
          color: colorFor(request.user.id),
          presence: 'offline',
        }}
        size={34}
      />
      <span className="friends__text">
        <span className="friends__name">{request.user.username}</span>
        <span className="friends__handle">{note}</span>
      </span>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------- blocked ------ */

function BlockedUsers({ blocked, onAdd }: { blocked: BlockedUserDto[]; onAdd: () => void }) {
  const { unblockUser } = useChat();
  // Kept after the row disappears, because unblocking is the first half of
  // "unblock and then add them again" and the list is the wrong place to
  // finish that: they are not blocked any more, so they are not in it.
  const [justUnblocked, setJustUnblocked] = useState<string | null>(null);

  async function unblock(user: BlockedUserDto) {
    await unblockUser(user.id);
    setJustUnblocked(user.username);
  }

  return (
    <>
      {justUnblocked && (
        <p className="friends__notice friends__notice--ok">
          {justUnblocked} is unblocked. You are strangers again, so either of you
          can send a friend request.{' '}
          <button type="button" className="friends__inline" onClick={onAdd}>
            Add them back
          </button>
        </p>
      )}

      {blocked.length === 0 ? (
        <Empty
          title="Nobody blocked"
          body="Blocking someone ends the friendship and stops them reaching you. They are never told."
        />
      ) : (
        <Section label="blocked" count={blocked.length}>
          {blocked.map((user) => (
            <div key={user.id} className="friends__row">
              <Avatar
                user={{
                  id: user.id,
                  name: user.username,
                  username: user.username,
                  color: colorFor(user.id),
                  presence: 'offline',
                }}
                size={34}
              />
              <span className="friends__text">
                <span className="friends__name">{user.username}</span>
                <span className="friends__handle">blocked {formatDay(user.blockedAt)}</span>
              </span>
              <button type="button" onClick={() => void unblock(user)}>
                Unblock
              </button>
            </div>
          ))}
        </Section>
      )}
    </>
  );
}

/* ------------------------------------------------------------ shared ----- */

function Section({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="friends__section">
      <div className="friends__heading">
        <span className="eyebrow">{label}</span>
        <span className="mono friends__count">{count}</span>
      </div>
      {children}
    </section>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="friends__empty">
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function outcomeText(status: string, username: string): string {
  switch (status) {
    case 'accepted':
      // They had already asked. Both sides saying yes is consent, so there is
      // nothing left to wait for.
      return `You and ${username} are now friends, because they had already asked.`;
    case 'already_friends':
      return `You are already friends with ${username}.`;
    default:
      return `Request sent to ${username}.`;
  }
}

function failureText(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Could not send that request.';

  switch (error.code) {
    case 'user_not_found':
      return 'No account with that username. Check the spelling, it has to be exact.';
    case 'cannot_friend_self':
      return 'That is you.';
    case 'blocked':
      return 'You have blocked this user. Unblock them first, under Blocked.';
    case 'rate_limited':
      return 'Too many requests for now. Try again in an hour.';
    case 'validation_failed':
      return 'That does not look like a username.';
    default:
      return 'Could not send that request.';
  }
}
