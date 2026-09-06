/**
 * Adding people, and answering the people who added you.
 *
 * Adding is by exact username. There is no search box here on purpose: a
 * directory you can browse is a list of everyone with an account on this
 * server, which is not a thing a private messenger should hand out. You type a
 * handle somebody gave you, or you do not find them.
 */
import { useState, type FormEvent } from 'react';
import { Avatar } from '../components/Avatar';
import { ApiError } from '../lib/api';
import { colorFor } from '../lib/presentation';
import { useChat } from '../state/ChatProvider';
import type { FriendRequestDto } from '../lib/api/types';
import '../styles/friends.css';

export function FriendsScreen() {
  const { friends, incoming, outgoing, usersById, openDmWith, removeFriend } = useChat();

  return (
    <div className="friends scroller">
      <AddFriend />

      {incoming.length > 0 && (
        <RequestSection title="Wants to talk to you" requests={incoming} />
      )}
      {outgoing.length > 0 && <RequestSection title="Waiting on them" requests={outgoing} />}

      <section className="friends__section">
        <div className="friends__heading">
          <span className="eyebrow">friends</span>
          <span className="mono friends__count">{friends.length}</span>
        </div>

        {friends.length === 0 ? (
          <p className="friends__empty">
            Nobody yet. Add someone by the exact username they gave you.
          </p>
        ) : (
          friends.map((friend) => {
            const user = usersById.get(friend.id);
            return (
              <div key={friend.id} className="friends__row">
                {user && <Avatar user={user} size={34} showPresence />}
                <span className="friends__text">
                  <span className="friends__name">{friend.username}</span>
                  {/* Truncated, and labelled as unchecked: a fingerprint nobody
                      has compared out of band is a label, not a guarantee. */}
                  <span className="friends__key mono" title="Not verified out of band">
                    key {user?.fingerprint ?? '····'} · unverified
                  </span>
                </span>
                <button type="button" onClick={() => void openDmWith(friend.id)}>
                  Message
                </button>
                <button
                  type="button"
                  className="friends__quiet"
                  onClick={() => void removeFriend(friend.id)}
                >
                  Remove
                </button>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}

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

function RequestSection({ title, requests }: { title: string; requests: FriendRequestDto[] }) {
  const { acceptRequest, declineRequest } = useChat();

  return (
    <section className="friends__section">
      <div className="friends__heading">
        <span className="eyebrow">{title}</span>
        <span className="mono friends__count">{requests.length}</span>
      </div>

      {requests.map((request) => (
        <div key={request.id} className="friends__row">
          <Avatar
            user={{
              id: request.user.id,
              name: request.user.username,
              color: colorFor(request.user.id),
              fingerprint: '····',
              presence: 'offline',
            }}
            size={34}
          />
          <span className="friends__text">
            <span className="friends__name">{request.user.username}</span>
            <span className="friends__key mono">
              {request.direction === 'incoming' ? 'sent you a request' : 'request sent'}
            </span>
          </span>

          {request.direction === 'incoming' ? (
            <>
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
            </>
          ) : (
            <button
              type="button"
              className="friends__quiet"
              onClick={() => void declineRequest(request.id)}
            >
              Cancel
            </button>
          )}
        </div>
      ))}
    </section>
  );
}

function outcomeText(status: string, username: string): string {
  switch (status) {
    case 'accepted':
      // They had already asked. Both sides saying yes is consent, so there is
      // nothing left to wait for.
      return `You and ${username} are now friends — they had already asked.`;
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
      return 'No account with that username. Check the spelling — it has to be exact.';
    case 'cannot_friend_self':
      return 'That is you.';
    case 'blocked':
      return 'You have blocked this user. Unblock them first.';
    case 'rate_limited':
      return 'Too many requests for now. Try again in an hour.';
    case 'validation_failed':
      return 'That does not look like a username.';
    default:
      return 'Could not send that request.';
  }
}
