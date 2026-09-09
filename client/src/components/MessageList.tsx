import { useEffect, useRef, useState } from 'react';
import { clockTime, isSameDay, shortDay } from '../lib/i18n/format';
import type { Locale } from '../lib/i18n/locales';
import { useChat } from '../state/ChatProvider';
import { useI18n, useT, type Translate } from '../state/I18nProvider';
import type { Channel, Message, User } from '../types';
import { Avatar } from './Avatar';
import { BrandMark } from './BrandMark';
import { CheckIcon, CopyIcon, LockIcon } from './Icons';
import { MessageBody } from './MessageBody';
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
  const { seenUpTo } = useChat();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Where the other party has read to, and which of your messages should say
  // so. Computed once per render rather than per bubble: it is a scan of the
  // list, and doing it inside the map would make it a scan per message.
  const seenId = seenUpTo(channel.id);
  const seenIndex = seenId ? messages.findIndex((entry) => entry.id === seenId) : -1;
  const lastOwnSeen =
    seenIndex < 0
      ? -1
      : messages.reduce(
          (best, entry, at) =>
            at <= seenIndex && entry.authorId === currentUserId ? at : best,
          -1,
        );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [channel.id, messages.length]);

  return (
    <div className="messages scroller">
      <ChannelIntro
        channel={channel}
        person={channel.recipientId ? usersById.get(channel.recipientId) : undefined}
      />

      {messages.map((message, index) => {
        const previous = messages[index - 1];
        const next = messages[index + 1];
        const author = usersById.get(message.authorId);
        const newDay = !previous || !isSameDay(previous.sentAt, message.sentAt);

        const runStart = newDay || !sameRun(previous, message);
        const runEnd = !sameRun(message, next);
        // "Seen" belongs to one message: the last of yours they have read.
        // Marking every read message would put the word down the whole column.
        const seenHere = seenIndex >= 0 && index === lastOwnSeen;

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
              seen={seenHere}
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
  seen,
}: {
  message: Message;
  author?: User;
  own: boolean;
  runStart: boolean;
  runEnd: boolean;
  mentionsMe: boolean;
  locale: Locale;
  /** True on the last of your messages the other party has read. */
  seen: boolean;
}) {
  const menu = usePersonMenu();
  const t = useT();
  const { retrySend } = useChat();
  // `unsent` is deliberately not locked. It is your own message, you can read
  // it perfectly well, and the only thing wrong with it is that it never left
  // this device. Drawing a padlock over it said the opposite.
  const locked = message.state === 'encrypted' || message.state === 'failed';
  const unsent = message.state === 'unsent';

  return (
    <article
      className={[
        'message',
        own && 'message--own',
        runEnd && 'message--run-end',
        message.state === 'sending' && 'message--pending',
        unsent && 'message--unsent',
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
            <MessageBody body={message.body ?? ''} />
            {/* One clock per run, on the bubble that carries the avatar. The
                others keep theirs for a pointer that pauses, which is where
                Discord puts it too: fifteen messages in the same minute do not
                need fifteen timestamps, but you still want to be able to ask
                about any one of them. */}
            <span
              className={runEnd ? 'bubble__meta mono' : 'bubble__meta bubble__meta--hover mono'}
              title={runEnd ? undefined : clockTime(message.sentAt, locale)}
            >
              {message.edited && `${t('chat.edited')} · `}
              {clockTime(message.sentAt, locale)}
            </span>
          </div>
        )}

        {/* On hover, over the bubble's corner. Copy only, deliberately: the
            server has no route to edit or delete a message, so an Edit button
            here would be a lie. When those routes exist this is where they
            go. */}
        {!locked && message.body && (
          <CopyMessage body={message.body} own={own} />
        )}

        {seen && (
          <p className="message__seen mono">{t('chat.seen')}</p>
        )}

        {/* Under the bubble rather than inside it: the message is still the
            message, and this is a fact about its delivery. The outbox has
            already given up by the time this shows, so the button is the only
            thing that will ever try it again. */}
        {unsent && (
          <p className="message__unsent" role="status">
            <span>{t('chat.notSent')}</span>
            <button
              type="button"
              className="message__retry"
              onClick={() => void retrySend(message.clientId ?? message.id)}
            >
              {t('chat.retry')}
            </button>
          </p>
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

/**
 * The top of a conversation: who this is, not what app you are in.
 *
 * It used to draw the app's own logo and a line of generic text, which is the
 * one screen where that helps least. This is the first thing anyone sees after
 * adding a friend, so it says the things you would want at that moment: their
 * face, their name, what they wrote about themselves, and since when.
 *
 * Everything past the name is conditional, because all of it can be absent: a
 * new account has no picture and no about line, and a group has no single
 * person at all. What is left then is the name and the app's own mark, which
 * is where this started.
 */
function ChannelIntro({ channel, person }: { channel: Channel; person: User | undefined }) {
  const t = useT();
  const about = person?.activity?.trim();

  return (
    <div className="messages__intro">
      <div className="messages__intro-icon">
        {person ? <Avatar user={person} size={56} /> : <BrandMark size={34} />}
      </div>
      <h2>{channel.name}</h2>
      {person && person.username !== channel.name && (
        <p className="messages__intro-handle mono">{person.username}</p>
      )}
      {about && <p className="messages__intro-about">{about}</p>}
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

/**
 * Copies what was said, without the timestamp or the name around it.
 *
 * Its own component so the copied/failed flash is per message rather than one
 * shared flag that would light up on every bubble at once.
 */
function CopyMessage({ body, own }: { body: string; own: boolean }) {
  const t = useT();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copy() {
    let next: 'copied' | 'failed' = 'copied';
    try {
      // Absent outside a secure context, where the property read itself
      // throws and lands here like any other refusal.
      await navigator.clipboard.writeText(body);
    } catch {
      next = 'failed';
    }
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1400);
  }

  const label =
    state === 'copied'
      ? t('chat.copied')
      : state === 'failed'
        ? t('chat.copyFailed')
        : t('chat.copyMessage');

  return (
    <div className={own ? 'message__tools message__tools--own' : 'message__tools'}>
      <button type="button" className="message__tool" onClick={() => void copy()} title={label}
        aria-label={label}>
        {state === 'copied' ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
      </button>
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
