import { useLayoutEffect, useRef, useState } from 'react';
import { hasOpenFence } from '../lib/chat/format';
import { useT } from '../state/I18nProvider';
import { EmojiIcon, PlusIcon } from './Icons';
import '../styles/composer.css';

type Props = {
  placeholder: string;
  onSend: (body: string) => void;
  /** Names shown in the "… is typing" line under the box. */
  typing?: string[];
  /** Fired as the user types, throttled here rather than by the caller. */
  onTyping?: () => void;
  /** Shown on the right of the footer. Used for queue depth. */
  notice?: string;
  /** Nothing can be sent right now, and the notice above the box says why. */
  disabled?: boolean;
};

const MAX_HEIGHT = 160;
/** One typing signal per this long, however fast someone types. */
const TYPING_THROTTLE_MS = 2_500;

export function Composer({
  placeholder,
  onSend,
  typing = [],
  onTyping,
  notice,
  disabled = false,
}: Props) {
  const t = useT();
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingAt = useRef(0);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  function send() {
    const body = value.trim();
    if (!body || disabled) return;
    onSend(body);
    setValue('');
  }

  /// Throttled here rather than at the call site: a typing signal per keystroke
  /// would be a socket frame per keystroke, which is a lot of traffic to say
  /// one thing.
  function change(next: string) {
    setValue(next);
    if (!onTyping || next.length === 0) return;

    const now = Date.now();
    if (now - lastTypingAt.current < TYPING_THROTTLE_MS) return;
    lastTypingAt.current = now;
    onTyping();
  }

  const empty = value.trim().length === 0;

  return (
    <div className="composer">
      <div className="composer__pill">
        <textarea
          ref={textareaRef}
          className="composer__input scroller"
          rows={1}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => change(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              // Inside an open ``` fence, Enter is a line break: a code block
              // is typed the way it will be read. Closing the fence, or the
              // send button, sends it.
              if (hasOpenFence(value)) return;
              event.preventDefault();
              send();
            }
          }}
        />

        <button type="button" className="icon-button" aria-label={t('chat.upload')}>
          <PlusIcon size={19} />
        </button>
        <button type="button" className="icon-button" aria-label={t('chat.emoji')}>
          <EmojiIcon size={19} />
        </button>

        <button
          type="button"
          className="composer__send"
          onClick={send}
          disabled={empty || disabled}
          aria-label={t('chat.send')}
          title={t('chat.send')}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.3}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="m4 12 16-7-6 16-2.5-6.5L4 12Z" />
          </svg>
        </button>
      </div>

      <div className="composer__footer">
        <span className="composer__typing mono">
          {typing.length > 0 && (
            <>
              <span className="composer__dots">
                <i />
                <i />
                <i />
              </span>
              {t('chat.typing', { names: typing.join(', '), count: typing.length })}
            </>
          )}
        </span>
        {notice && (
          <span
            className="composer__notice mono"
            title={t('chat.queuedHint')}
          >
            {notice}
          </span>
        )}
      </div>
    </div>
  );
}
