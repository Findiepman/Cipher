import type { Channel, User } from '../types';
import { Avatar } from './Avatar';
import { LockIcon, SettingsIcon, SpeakerIcon } from './Icons';
import '../styles/conversation-list.css';

export type Preview = { text: string; at: string };

type Props = {
  /** Rendered in order; a section with no channels is skipped. */
  sections: { label: string; channels: Channel[] }[];
  activeChannelId: string;
  onSelect: (conversationId: string) => void;
  usersById: Map<string, User>;
  previews: Map<string, Preview>;
  currentUser: User;
  onOpenSettings: () => void;
};

/**
 * One list for channels and DMs alike, each row carrying the last thing said
 * in it. A messenger's list, not a directory of rooms.
 */
export function ConversationList({
  sections,
  activeChannelId,
  onSelect,
  usersById,
  previews,
  currentUser,
  onOpenSettings,
}: Props) {
  return (
    <>
      <div className="conversations scroller">
        {sections
          .filter((section) => section.channels.length > 0)
          .map((section) => (
            <section key={section.label} className="conversations__section">
              <div className="conversations__heading">
                <span className="eyebrow">{section.label}</span>
                <span className="conversations__count mono">
                  {section.channels.length}
                </span>
              </div>

              {section.channels.map((channel) => (
                <ConversationRow
                  key={channel.id}
                  channel={channel}
                  active={channel.id === activeChannelId}
                  recipient={
                    channel.recipientId ? usersById.get(channel.recipientId) : undefined
                  }
                  preview={previews.get(channel.id)}
                  onSelect={() => onSelect(channel.id)}
                />
              ))}
            </section>
          ))}
      </div>

      <div className="key-status">
        <LockIcon size={15} />
        <span className="mono">key {currentUser.fingerprint} · unlocked</span>
        <button
          type="button"
          className="icon-button"
          aria-label="Settings"
          onClick={onOpenSettings}
        >
          <SettingsIcon size={16} />
        </button>
      </div>
    </>
  );
}

function ConversationRow({
  channel,
  active,
  recipient,
  preview,
  onSelect,
}: {
  channel: Channel;
  active: boolean;
  recipient?: User;
  preview?: Preview;
  onSelect: () => void;
}) {
  const unread = channel.unread && !active;

  return (
    <button
      type="button"
      className={`conversation${active ? ' conversation--active' : ''}`}
      onClick={onSelect}
      aria-current={active || undefined}
    >
      {recipient ? (
        <Avatar user={recipient} size={34} showPresence />
      ) : (
        <span className={`conversation__tile${active ? ' conversation__tile--active' : ''}`}>
          {channel.kind === 'voice' ? (
            <SpeakerIcon size={16} />
          ) : (
            <span className="mono">#</span>
          )}
        </span>
      )}

      <span className="conversation__text">
        <span className="conversation__top">
          <span
            className={`conversation__name${unread ? ' conversation__name--unread' : ''}`}
          >
            {channel.name}
          </span>
          {channel.mentions ? (
            <span className="conversation__badge mono">{channel.mentions}</span>
          ) : unread ? (
            <span className="conversation__dot" />
          ) : preview ? (
            <span className="conversation__time mono">{shortTime(preview.at)}</span>
          ) : null}
        </span>

        {preview && (
          <span
            className={`conversation__preview${
              unread ? ' conversation__preview--unread' : ''
            }`}
          >
            {preview.text}
          </span>
        )}
      </span>
    </button>
  );
}

/** Clock time for today, then day counts — the resolution people actually use. */
function shortTime(iso: string): string {
  const then = new Date(iso);
  const now = new Date();

  if (then.toDateString() === now.toDateString()) {
    return then.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  const days = Math.round((now.getTime() - then.getTime()) / 86_400_000);
  return days < 1 ? '1d' : `${days}d`;
}
