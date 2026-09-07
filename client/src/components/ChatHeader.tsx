import type { Channel, User } from '../types';
import { Avatar } from './Avatar';
import { ProfileIcon } from './Icons';
import { usePersonMenu } from './PersonMenu';
import '../styles/chat-header.css';

const STACK_LIMIT = 4;

type Props = {
  channel: Channel;
  recipient?: User;
  members: User[];
  /** Whether the profile panel is showing. Null when there is nobody to show. */
  profileOpen?: boolean;
  onToggleProfile?: () => void;
};

export function ChatHeader({
  channel,
  recipient,
  members,
  profileOpen = false,
  onToggleProfile,
}: Props) {
  const menu = usePersonMenu();
  const shown = members.slice(0, STACK_LIMIT);
  const overflow = members.length - shown.length;

  return (
    <header
      className="chat-header"
      onContextMenu={recipient ? (event) => menu.open(event, recipient.id) : undefined}
    >
      <h1 className="chat-header__name">{channel.name}</h1>

      {/* The handle, but only when it is not already the title. A nickname that
          silently replaced the username everywhere would leave nowhere to check
          who you are actually talking to. */}
      {recipient && recipient.nickname && (
        <span className="chat-header__handle mono">{recipient.username}</span>
      )}

      {channel.topic && <p className="chat-header__topic">{channel.topic}</p>}

      <div className="chat-header__right">
        {/* Members are a stack you glance at, not a column that eats a
            quarter of the window. */}
        {channel.kind !== 'dm' && (
          <button
            type="button"
            className="avatar-stack"
            title={members.map((m) => m.name).join(', ')}
          >
            {shown.map((member) => (
              <span className="avatar-stack__slot" key={member.id}>
                <Avatar user={member} size={26} />
              </span>
            ))}
            {overflow > 0 && (
              <span className="avatar-stack__slot">
                <span className="avatar-stack__more mono">+{overflow}</span>
              </span>
            )}
          </button>
        )}

        {onToggleProfile && (
          <button
            type="button"
            className={`icon-button icon-button--framed${
              profileOpen ? ' icon-button--active' : ''
            }`}
            onClick={onToggleProfile}
            aria-pressed={profileOpen}
            title={profileOpen ? 'Hide profile' : 'Show profile'}
            aria-label={profileOpen ? 'Hide profile' : 'Show profile'}
          >
            <ProfileIcon size={16} />
          </button>
        )}
      </div>
    </header>
  );
}
