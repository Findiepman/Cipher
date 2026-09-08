import { useEffect, useRef } from 'react';
import { clockTime, isSameDay, shortDay } from '../lib/i18n/format';
import type { Locale } from '../lib/i18n/locales';
import { useI18n, useT, type Translate } from '../state/I18nProvider';
import type { Channel, Message, User } from '../types';
import { Avatar } from './Avatar';
import { BrandMark } from './BrandMark';
import { LockIcon } from './Icons';
import { usePersonMenu } from './PersonMenu';
import '../styles/messages.css';

type Props = {
  channel: Channel;
  messages: Message[];
  usersById: Map<string, User>;
  currentUserId: string;
  currentUserName: string;
};

/** Consecutive messages from one author stay in the same run for this long. */
const RUN_WINDOW_MS = 5 * 60_000;

export function MessageList({
  channel,
  messages,
  usersById,
  currentUserId,
  currentUserName,
}: Props) {
  const { locale, t } = useI18n();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [channel.id, messages.length]);

  return (
    <div className="messages scroller">
      <ChannelIntro channel={channel} />

      {messages.map((message, index) => {
        const previous = messages[index - 1];
        const next = messages[index + 1];
        const author = usersById.get(message.authorId);
        const newDay = !previous || !isSameDay(previous.sentAt, message.sentAt);

        const runStart = newDay || !sameRun(previous, message);
        const runEnd = !sameRun(message, next);

        return (
          <div key={message.id}>
            {newDay && <DateDivider iso={message.sentAt} locale={locale} t={t} />}
            <Bubble
              message={message}
              author={author}
              own={message.authorId === currentUserId}
              runStart={runStart}
              runEnd={runEnd}
              mentionsMe={mentions(message, currentUserName)}
              locale={locale}
            />
          </div>
        );
      })}

      <div ref={bottomRef} className="messages__anchor" />
    </div>
  );
}

function Bubble({
  message,
  author,
  own,
  runStart,
  runEnd,
  mentionsMe,
  locale,
}: {
  message: Message;
  author?: User;
  own: boolean;
  runStart: boolean;
  runEnd: boolean;
  mentionsMe: boolean;
  locale: Locale;
}) {
  const menu = usePersonMenu();
  const t = useT();
  const locked = message.state === 'encrypted' || message.state === 'failed';

  return (
    <article
      className={[
        'message',
        own && 'message--own',
        runEnd && 'message--run-end',
        message.state === 'sending' && 'message--pending',
      ]
        .filter(Boolean)
        .join(' ')}
      onContextMenu={author && !own ? (event) => menu.open(event, author.id) : undefined}
    >
      {/* The avatar sits beside the LAST bubble of a run, so a burst of
          messages reads as one turn in the conversation. */}
      {!own &&
        (runEnd && author ? (
          <Avatar user={author} size={30} />
        ) : (
          <span className="message__avatar-space" />
        ))}

      <div className="message__column">
        {runStart && !own && author && (
          <span className="message__author" style={{ color: author.color }}>
            {author.name}
            {author.bot && <span className="message__bot mono">{t('chat.bot')}</span>}
          </span>
        )}

        {locked ? (
          <LockedBubble state={message.state} tail={runEnd} />
        ) : (
          <div
            className={[
              'bubble',
              own ? 'bubble--out' : 'bubble--in',
              runEnd && (own ? 'bubble--tail-out' : 'bubble--tail-in'),
              mentionsMe && 'bubble--mention',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <span className="bubble__body">{message.body}</span>
            <span className="bubble__meta mono">
              {message.edited && `${t('chat.edited')} · `}
              {clockTime(message.sentAt, locale)}
            </span>
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * A message this device cannot read keeps its place in the conversation and
 * says why. Missing key offers a way out; a bad signature does not, because
 * retrying a forged message is not a recovery path.
 */
function LockedBubble({ state, tail }: { state: Message['state']; tail: boolean }) {
  const t = useT();
  const failed = state === 'failed';

  return (
    <div
      className={[
        'locked-bubble',
        tail && 'bubble--tail-in',
        failed && 'locked-bubble--failed',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <LockIcon size={15} />
      <span className="locked-bubble__text">
        {t(failed ? 'chat.lockedFailed' : 'chat.lockedHere')}
      </span>
    </div>
  );
}

function ChannelIntro({ channel }: { channel: Channel }) {
  const t = useT();
  return (
    <div className="messages__intro">
      <div className="messages__intro-icon">
        <BrandMark size={34} />
      </div>
      <h2>{channel.name}</h2>
      <p>{t('chat.intro', { name: channel.name })}</p>
    </div>
  );
}

function DateDivider({ iso, locale, t }: { iso: string; locale: Locale; t: Translate }) {
  return (
    <div className="messages__divider">
      <span className="eyebrow">{formatDate(iso, locale, t)}</span>
    </div>
  );
}

function sameRun(a: Message | undefined, b: Message | undefined): boolean {
  if (!a || !b) return false;
  return (
    a.authorId === b.authorId &&
    isSameDay(a.sentAt, b.sentAt) &&
    Math.abs(Date.parse(b.sentAt) - Date.parse(a.sentAt)) < RUN_WINDOW_MS
  );
}

/** Exported so the notification sound uses the same rule the bubble does. */
export function mentions(message: Message, name: string): boolean {
  return message.body?.includes(`@${name}`) ?? false;
}

function formatDate(iso: string, locale: Locale, t: Translate): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (isSameDay(date, today)) return t('common.today');
  if (isSameDay(date, yesterday)) return t('common.yesterday');
  return shortDay(date, locale);
}
