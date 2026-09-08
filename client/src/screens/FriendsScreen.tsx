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
import type { Key } from '../lib/i18n/en';
import { shortDay } from '../lib/i18n/format';
import type { Phrase } from '../lib/i18n/translate';
import { colorFor } from '../lib/presentation';
import { useChat } from '../state/ChatProvider';
import { useI18n, useT } from '../state/I18nProvider';
import type { BlockedUserDto, FriendRequestDto } from '../lib/api/types';
import '../styles/friends.css';

type Tab = 'all' | 'add' | 'sent' | 'received' | 'blocked';

export function FriendsScreen() {
  const { friends, incoming, outgoing, blocked } = useChat();
  const t = useT();
  const [tab, setTab] = useState<Tab>('all');

  return (
    <div className="friends">
      <nav className="friends__tabs" aria-label={t('chat.friends')}>
        <TabButton
          tab="all"
          current={tab}
          onSelect={setTab}
          icon={<ProfileIcon size={15} />}
          label={t('friends.tab.all')}
          count={friends.length}
        />
        <TabButton
          tab="add"
          current={tab}
          onSelect={setTab}
          icon={<UserPlusIcon size={15} />}
          label={t('friends.tab.add')}
        />
        <TabButton
          tab="sent"
          current={tab}
          onSelect={setTab}
          icon={<ClockIcon size={15} />}
          label={t('friends.tab.sent')}
          count={outgoing.length}
        />
        {/* The only count drawn in ember: it is the one asking for something. */}
        <TabButton
          tab="received"
          current={tab}
          onSelect={setTab}
          icon={<InboxIcon size={15} />}
          label={t('friends.tab.received')}
          count={incoming.length}
          urgent
        />
        <TabButton
          tab="blocked"
          current={tab}
          onSelect={setTab}
          icon={<BanIcon size={15} />}
          label={t('friends.tab.blocked')}
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
  const t = useT();

  if (friends.length === 0) {
    return <Empty title={t('friends.noneTitle')} body={t('friends.noneBody')} />;
  }

  return (
    <Section label={t('friends.section.friends')} count={friends.length}>
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
              {t('userProfile.message')}
            </button>
            <button
              type="button"
              className="friends__quiet"
              onClick={(event) => menu.open(event, friend.id)}
              aria-label={t('friends.moreFor', {
                name: friend.nickname ?? friend.username,
              })}
            >
              {t('friends.more')}
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
  const t = useT();
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  // A phrase rather than a sentence, so the notice re-renders in the new
  // language if it is on screen when the language changes.
  const [notice, setNotice] = useState<{
    tone: 'ok' | 'bad';
    phrase: Phrase<Key>;
  } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const handle = username.trim();
    if (!handle || busy) return;

    setBusy(true);
    setNotice(null);
    try {
      const result = await addFriend(handle);
      setUsername('');
      setNotice({ tone: 'ok', phrase: outcome(result.status, result.user.username) });
    } catch (error) {
      setNotice({ tone: 'bad', phrase: failure(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="friends__add" onSubmit={(event) => void submit(event)}>
      <label className="eyebrow" htmlFor="add-friend">
        {t('friends.addSomeone')}
      </label>
      <p className="friends__lede">{t('friends.addLede')}</p>
      <div className="friends__add-row">
        <input
          id="add-friend"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder={t('friends.addPlaceholder')}
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
        />
        <button type="submit" disabled={busy || username.trim().length === 0}>
          {t(busy ? 'account.sending' : 'friends.sendRequest')}
        </button>
      </div>
      {notice && (
        <p className={`friends__notice friends__notice--${notice.tone}`}>
          {t(notice.phrase)}
        </p>
      )}
    </form>
  );
}

/* --------------------------------------------------------- requests ------ */

function SentRequests({ requests }: { requests: FriendRequestDto[] }) {
  const { cancelRequest } = useChat();
  const t = useT();

  if (requests.length === 0) {
    return <Empty title={t('friends.sentNone')} body={t('friends.sentNoneBody')} />;
  }

  return (
    <Section label={t('friends.section.sent')} count={requests.length}>
      {requests.map((request) => (
        <RequestRow key={request.id} request={request} note={t('friends.waitingFor')}>
          <button
            type="button"
            className="friends__quiet"
            onClick={() => void cancelRequest(request.id)}
          >
            {t('common.cancel')}
          </button>
        </RequestRow>
      ))}
    </Section>
  );
}

function ReceivedRequests({ requests }: { requests: FriendRequestDto[] }) {
  const { acceptRequest, declineRequest } = useChat();
  const t = useT();

  if (requests.length === 0) {
    return <Empty title={t('friends.recvNone')} body={t('friends.recvNoneBody')} />;
  }

  return (
    <Section label={t('friends.section.received')} count={requests.length}>
      {requests.map((request) => (
        <RequestRow key={request.id} request={request} note={t('friends.wantsToTalk')}>
          <button type="button" onClick={() => void acceptRequest(request.id)}>
            {t('friends.accept')}
          </button>
          <button
            type="button"
            className="friends__quiet"
            onClick={() => void declineRequest(request.id)}
          >
            {t('friends.decline')}
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
  const { locale, t } = useI18n();
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
          {t('friends.unblocked', { name: justUnblocked })}{' '}
          <button type="button" className="friends__inline" onClick={onAdd}>
            {t('friends.addBack')}
          </button>
        </p>
      )}

      {blocked.length === 0 ? (
        <Empty title={t('friends.blockedNone')} body={t('friends.blockedNoneBody')} />
      ) : (
        <Section label={t('friends.section.blocked')} count={blocked.length}>
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
                <span className="friends__handle">
                  {t('friends.blockedOn', { day: shortDay(user.blockedAt, locale) })}
                </span>
              </span>
              <button type="button" onClick={() => void unblock(user)}>
                {t('friends.unblock')}
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

function outcome(status: string, name: string): Phrase<Key> {
  switch (status) {
    case 'accepted':
      // They had already asked. Both sides saying yes is consent, so there is
      // nothing left to wait for.
      return { key: 'friends.outcome.accepted', vars: { name } };
    case 'already_friends':
      return { key: 'friends.outcome.already', vars: { name } };
    default:
      return { key: 'friends.outcome.sent', vars: { name } };
  }
}

/**
 * The one place a server error is translated rather than passed through.
 *
 * These arrive as codes, not prose, which is exactly what makes them
 * translatable: the app decides what each code means in words. Everywhere the
 * server sends a sentence instead, that sentence stays in its own English.
 */
function failure(error: unknown): Phrase<Key> {
  if (!(error instanceof ApiError)) return { key: 'friends.error.generic' };

  switch (error.code) {
    case 'user_not_found':
      return { key: 'friends.error.notFound' };
    case 'cannot_friend_self':
      return { key: 'friends.error.self' };
    case 'blocked':
      return { key: 'friends.error.blocked' };
    case 'rate_limited':
      return { key: 'friends.error.rateLimited' };
    case 'validation_failed':
      return { key: 'friends.error.invalid' };
    default:
      return { key: 'friends.error.generic' };
  }
}
