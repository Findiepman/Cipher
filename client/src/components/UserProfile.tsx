/**
 * One person, rendered as a card.
 *
 * This is the prefab: it takes a `User` and knows nothing about where it is
 * being drawn, so the same component fills the side panel beside a
 * conversation, and can later fill a popout or a modal without being rewritten.
 * Everything that varies between those places is a prop, and the only piece of
 * chrome it owns is its own layout.
 *
 * It deliberately shows both names. A nickname replaces the username
 * everywhere else in the app, so this is the one screen that always says who
 * you are actually talking to, which matters when the label is one you chose
 * and they never agreed to.
 */
import type { User } from '../types';
import { Avatar, presenceLabel } from './Avatar';
import { BanIcon, MessageIcon, PencilIcon, UserMinusIcon } from './Icons';
import '../styles/user-profile.css';

export type ProfileAction = 'message' | 'nickname' | 'unfriend' | 'block';

type Props = {
  user: User;
  /** True when they are in your friend list. Gates the friend-only actions. */
  isFriend: boolean;
  /** Their side of the friendship, ISO-8601. Absent for a non-friend. */
  friendsSince?: string;
  onAction: (action: ProfileAction) => void;
  /** Hidden when the card is already the whole panel. */
  onClose?: () => void;
};

export function UserProfile({ user, isFriend, friendsSince, onAction, onClose }: Props) {
  return (
    <div className="profile">
      {/* A band of the person's own colour, so two profiles never look alike
          even before you read the name. */}
      <div className="profile__banner" style={{ background: user.color }}>
        {onClose && (
          <button
            type="button"
            className="profile__close"
            onClick={onClose}
            aria-label="Close profile"
          >
            <CloseGlyph />
          </button>
        )}
      </div>

      <div className="profile__avatar">
        <Avatar user={user} size={72} showPresence />
      </div>

      <div className="profile__body">
        <h2 className="profile__name">{user.name}</h2>
        <p className="profile__handle mono">{user.username}</p>

        <dl className="profile__facts">
          <div className="profile__fact">
            <dt>Status</dt>
            <dd>{presenceLabel(user.presence)}</dd>
          </div>

          {user.nickname && (
            <div className="profile__fact">
              <dt>Nickname</dt>
              <dd>
                {user.nickname}
                <span className="profile__note">only you see this</span>
              </dd>
            </div>
          )}

          {friendsSince && (
            <div className="profile__fact">
              <dt>Friends since</dt>
              <dd>{formatDay(friendsSince)}</dd>
            </div>
          )}
        </dl>

        <div className="profile__actions">
          {isFriend && (
            <button
              type="button"
              className="profile__button profile__button--primary"
              onClick={() => onAction('message')}
            >
              <MessageIcon size={15} />
              Message
            </button>
          )}

          <button
            type="button"
            className="profile__button"
            onClick={() => onAction('nickname')}
          >
            <PencilIcon size={15} />
            {user.nickname ? 'Change nickname' : 'Add nickname'}
          </button>

          {isFriend && (
            <button
              type="button"
              className="profile__button profile__button--danger"
              onClick={() => onAction('unfriend')}
            >
              <UserMinusIcon size={15} />
              Remove friend
            </button>
          )}

          <button
            type="button"
            className="profile__button profile__button--danger"
            onClick={() => onAction('block')}
          >
            <BanIcon size={15} />
            Block
          </button>
        </div>
      </div>
    </div>
  );
}

function CloseGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      aria-hidden
    >
      <path d="m5 5 14 14M19 5 5 19" />
    </svg>
  );
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
