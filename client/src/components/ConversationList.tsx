import { clockTime } from '../lib/i18n/format';
import type { Locale } from '../lib/i18n/locales';
import { useI18n, type Translate } from '../state/I18nProvider';
import type { Channel, User } from '../types';
import { Avatar } from './Avatar';
import { usePersonMenu } from './PersonMenu';
import { PinIcon, SearchIcon, SettingsIcon, SpeakerIcon } from './Icons';
import '../styles/conversation-list.css';

export type Preview = { text: string; at: string };

export type Section = {
  label: string;
  channels: Channel[];
  /**
   * Draws the section as the pinned one: a pin beside the heading, and rows
   * that sit on their own strip so the shortcut reads as a shelf above the
   * list rather than as the first few of it.
   */
  pinned?: boolean;
};

type Props = {
  /** Rendered in order; a section with no channels is skipped. Already
      translated by the caller, which is the only place that knows what the
      sections are. */
  sections: Section[];
  activeChannelId: string;
  onSelect: (conversationId: string) => void;
  usersById: Map<string, User>;
  previews: Map<string, Preview>;
  /**
   * How many messages are waiting in each channel. A count rather than a flag
   * because "3 waiting" and "1 waiting" are different enough to act on, and
   * the number is already known: the server sends it with the list.
   */
  unread: Record<string, number>;
  /** Null on the first paint, before the account has loaded. */
  currentUser: User | null;
  /** Opens the account panel: who you are and what you can do about it. */
  onOpenAccount: () => void;
  /** Straight to settings, from the cog. No panel in between. */
  onOpenSettings: () => void;
  /** Opens the go-anywhere palette. */
  onOpenSwitcher: () => void;
};

/**
 * One list for channels and DMs alike, each row carrying the last thing said
 * in it. A messenger's list, not a directory of rooms.
 */
/** The word under your name in the foot. Same set the account panel uses. */
const PRESENCE_LABEL = {
  online: 'presence.online',
  idle: 'presence.idle',
  dnd: 'presence.dnd',
  offline: 'presence.offline',
  invisible: 'presence.invisible',
} as const;

export function ConversationList({
  sections,
  activeChannelId,
  onSelect,
  usersById,
  previews,
  unread,
  currentUser,
  onOpenAccount,
  onOpenSettings,
  onOpenSwitcher,
}: Props) {
  const { locale, t } = useI18n();
  return (
    <>
      {/* Above the list, because it is the thing you reach for instead of
          reading the list. Styled as a field rather than a button so it reads
          as somewhere to type, which is what it becomes. */}
      <button type="button" className="clist-find" onClick={onOpenSwitcher}>
        <SearchIcon size={14} />
        <span>{t('switcher.open')}</span>
        <kbd className="clist-find__key mono">Ctrl K</kbd>
      </button>

      <div className="conversations scroller">
        {sections
          .filter((section) => section.channels.length > 0)
          .map((section) => (
            <section
              key={section.label}
              className={
                section.pinned
                  ? 'conversations__section conversations__section--pinned'
                  : 'conversations__section'
              }
            >
              <div className="conversations__heading">
                {section.pinned && (
                  <PinIcon size={11} className="conversations__pin" />
                )}
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
                  unread={unread[channel.id] ?? 0}
                  locale={locale}
                  t={t}
                  onSelect={() => onSelect(channel.id)}
                />
              ))}
            </section>
          ))}
      </div>

      {/* You, at the foot of the list, as two targets rather than one. The
          name and face open the account panel; the cog goes straight to
          settings. They are different destinations and a single button had to
          guess which you meant, which is how tapping your own face ended up
          in a settings section. Discord splits them the same way. */}
      <div className="list-foot">
        <button
          type="button"
          className="list-foot__me"
          onClick={onOpenAccount}
          aria-label={t('account.you')}
        >
          {currentUser && <Avatar user={currentUser} size={30} showPresence />}
          <span className="list-foot__who">
            <span className="list-foot__name">{currentUser?.name ?? t('chat.loading')}</span>
            <span className="list-foot__presence">
              {t(PRESENCE_LABEL[currentUser?.presence ?? 'offline'])}
            </span>
          </span>
        </button>

        <button
          type="button"
          className="list-foot__cog"
          onClick={onOpenSettings}
          title={t('settings.back')}
          aria-label={t('settings.back')}
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
  unread,
  locale,
  t,
  onSelect,
}: {
  channel: Channel;
  active: boolean;
  recipient?: User;
  preview?: Preview;
  unread: number;
  locale: Locale;
  t: Translate;
  onSelect: () => void;
}) {
  const menu = usePersonMenu();
  // Nothing is unread in the conversation you are looking at, and the count
  // clears a moment later anyway. Drawing it would be a flash of a badge that
  // is about to disappear.
  const waiting = active ? 0 : unread;

  return (
    <button
      type="button"
      className={`conversation${active ? ' conversation--active' : ''}`}
      onClick={onSelect}
      // Right-clicking a row acts on the person in it, which is why a group
      // channel does not get a menu: there is no single "them" to act on.
      onContextMenu={recipient ? (event) => menu.open(event, recipient.id) : undefined}
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
            className={`conversation__name${waiting ? ' conversation__name--unread' : ''}`}
          >
            {channel.name}
          </span>
          {waiting ? (
            <span
              className="conversation__badge mono"
              aria-label={t('chat.unread', { count: waiting })}
            >
              {waiting > 99 ? '99+' : waiting}
            </span>
          ) : preview ? (
            <span className="conversation__time mono">
              {shortTime(preview.at, locale, t)}
            </span>
          ) : null}
        </span>

        {preview && (
          <span
            className={`conversation__preview${
              waiting ? ' conversation__preview--unread' : ''
            }`}
          >
            {preview.text}
          </span>
        )}
      </span>
    </button>
  );
}

/** Clock time for today, then day counts: the resolution people actually use. */
function shortTime(iso: string, locale: Locale, t: Translate): string {
  const then = new Date(iso);
  const now = new Date();

  if (then.toDateString() === now.toDateString()) return clockTime(then, locale);

  const days = Math.round((now.getTime() - then.getTime()) / 86_400_000);
  return t('chat.daysAgo', { count: days < 1 ? 1 : days });
}
