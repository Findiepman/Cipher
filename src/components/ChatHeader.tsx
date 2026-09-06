import type { Channel, User } from '../types';
import { Avatar } from './Avatar';
import { EyeIcon, LockIcon } from './Icons';
import '../styles/chat-header.css';

const STACK_LIMIT = 4;

type Props = {
  channel: Channel;
  recipient?: User;
  members: User[];
  showCiphertext: boolean;
  onToggleCiphertext: () => void;
};

export function ChatHeader({
  channel,
  recipient,
  members,
  showCiphertext,
  onToggleCiphertext,
}: Props) {
  const shown = members.slice(0, STACK_LIMIT);
  const overflow = members.length - shown.length;

  return (
    <header className="chat-header">
      <h1 className="chat-header__name">{channel.name}</h1>

      <span className="seal-pill" title="End-to-end encrypted">
        <LockIcon size={10} />
        sealed
      </span>

      {channel.topic && <p className="chat-header__topic">{channel.topic}</p>}

      <div className="chat-header__right">
        {/* Members are a stack you glance at, not a column that eats a
            quarter of the window. */}
        {channel.kind === 'dm' && recipient ? (
          <span className="chat-header__key mono">key {recipient.fingerprint}</span>
        ) : (
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

        <button
          type="button"
          className={`icon-button icon-button--framed${
            showCiphertext ? ' icon-button--active' : ''
          }`}
          onClick={onToggleCiphertext}
          aria-pressed={showCiphertext}
          title={
            showCiphertext
              ? 'Show decrypted messages'
              : 'Show what the server stores (ciphertext)'
          }
        >
          <EyeIcon size={16} />
        </button>
      </div>
    </header>
  );
}
