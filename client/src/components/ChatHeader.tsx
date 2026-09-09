import { useT } from '../state/I18nProvider';
import type { Channel, User } from '../types';
import { Avatar } from './Avatar';
import { PhoneIcon, ProfileIcon } from './Icons';
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
  /**
   * Ring the other person. Absent when there is nobody to ring or this build
   * cannot place calls.
   */
  onCall?: () => void;
  /**
   *   none       no call anywhere
   *   here       the call in progress is in this conversation
   *   elsewhere  a call is in progress in another conversation, so this one
   *              cannot start a second
   */
  callState?: 'none' | 'here' | 'elsewhere';
};

export function ChatHeader({
  channel,
  recipient,
  members,
  profileOpen = false,
  onToggleProfile,
  onCall,
  callState = 'none',
}: Props) {
  const menu = usePersonMenu();
  const t = useT();
  const shown = members.slice(0, STACK_LIMIT);
  const overflow = members.length - shown.length;

  return (
    <header
      className="chat-header"
      onContextMenu={recipient ? (event) => menu.open(event, recipient.id) : undefined}
    >
      {/* The person, not just their name. A DM header that shows only text is
          the one place in the app where you cannot see who you are talking to
          or whether they are around, which is exactly what a header is for.
          The presence dot is the same one the conversation list draws, so the
          two can never disagree. */}
      {recipient && (
        <span className="chat-header__face">
          <Avatar user={recipient} size={30} showPresence />
        </span>
      )}

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

        {/* The call this conversation is on, or the button that would start
            one. Where the call itself is controlled is the floating panel;
            this is only so the conversation says what it is doing. */}
        {callState === 'here' ? (
          <span className="chat-header__action chat-header__action--live" role="status">
            <span className="chat-header__call-dot" aria-hidden />
            <span className="chat-header__action-label">{t('call.inACall')}</span>
          </span>
        ) : (
          onCall && (
            <button
              type="button"
              className="chat-header__action"
              onClick={onCall}
              disabled={callState === 'elsewhere'}
              title={
                callState === 'elsewhere'
                  ? t('call.alreadyIn')
                  : t('call.callName', { name: channel.name })
              }
              aria-label={
                callState === 'elsewhere'
                  ? t('call.alreadyIn')
                  : t('call.callName', { name: channel.name })
              }
            >
              <PhoneIcon size={17} />
              <span className="chat-header__action-label">{t('call.call')}</span>
            </button>
          )
        )}

        {onToggleProfile && (
          <button
            type="button"
            className={`chat-header__action${profileOpen ? ' chat-header__action--active' : ''}`}
            onClick={onToggleProfile}
            aria-pressed={profileOpen}
            title={t(profileOpen ? 'chat.hideProfile' : 'chat.showProfile')}
            aria-label={t(profileOpen ? 'chat.hideProfile' : 'chat.showProfile')}
          >
            <ProfileIcon size={17} />
            <span className="chat-header__action-label">{t('chat.profile')}</span>
          </button>
        )}
      </div>
    </header>
  );
}
