import { useEffect, useRef } from 'react';
import { previewCiphertext } from '../lib/envelope';
import type { Channel, Message, User } from '../types';
import { Avatar } from './Avatar';
import { BrandMark } from './BrandMark';
import { LockIcon } from './Icons';
import '../styles/messages.css';

type Props = {
  channel: Channel;
  messages: Message[];
  usersById: Map<string, User>;
  currentUserId: string;
  currentUserName: string;
  showCiphertext: boolean;
};

/** Consecutive messages from one author stay in the same run for this long. */
const RUN_WINDOW_MS = 5 * 60_000;

export function MessageList({
  channel,
  messages,
  usersById,
  currentUserId,
  currentUserName,
  showCiphertext,
}: Props) {
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
            {newDay && <DateDivider iso={message.sentAt} />}
            <Bubble
              message={message}
              author={author}
              own={message.authorId === currentUserId}
              runStart={runStart}
              runEnd={runEnd}
              mentionsMe={mentions(message, currentUserName)}
              showCiphertext={showCiphertext}
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
  showCiphertext,
}: {
  message: Message;
  author?: User;
  own: boolean;
  runStart: boolean;
  runEnd: boolean;
  mentionsMe: boolean;
  showCiphertext: boolean;
}) {
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
            <span className="message__key mono">{author.fingerprint}</span>
            {author.bot && <span className="message__bot mono">bot</span>}
          </span>
        )}

        {locked && !showCiphertext ? (
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
            {showCiphertext ? (
              <span className="bubble__ciphertext mono">
                {previewCiphertext(message.ciphertext, 180)}
              </span>
            ) : (
              <span className="bubble__body">{message.body}</span>
            )}
            <span className="bubble__meta mono">
              {message.edited && 'edited · '}
              {formatTime(message.sentAt)}
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
      <span className="locked-bubble__text mono">
        {failed ? 'decrypt failed · signature did not verify' : 'no key · unregistered device'}
      </span>
      {!failed && (
        <button type="button" className="locked-bubble__action mono">
          request key
        </button>
      )}
    </div>
  );
}

function ChannelIntro({ channel }: { channel: Channel }) {
  return (
    <div className="messages__intro">
      <div className="messages__intro-icon">
        <BrandMark size={34} />
      </div>
      <h2>{channel.name}</h2>
      <p>
        The start of this conversation. Everything below was sealed on someone's
        device before it was sent — the server only ever held the blob.
      </p>
    </div>
  );
}

function DateDivider({ iso }: { iso: string }) {
  return (
    <div className="messages__divider">
      <span className="eyebrow">{formatDate(iso)}</span>
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

function mentions(message: Message, name: string): boolean {
  return message.body?.includes(`@${name}`) ?? false;
}

function isSameDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'today';
  if (date.toDateString() === yesterday.toDateString()) return 'yesterday';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
