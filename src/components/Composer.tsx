import { useLayoutEffect, useRef, useState } from 'react';
import { EmojiIcon, PlusIcon } from './Icons';
import '../styles/composer.css';

type Props = {
  placeholder: string;
  onSend: (body: string) => void;
  /** Names shown in the "… is typing" line under the box. */
  typing?: string[];
};

const MAX_HEIGHT = 160;

export function Composer({ placeholder, onSend, typing = [] }: Props) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  function send() {
    const body = value.trim();
    if (!body) return;
    onSend(body);
    setValue('');
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
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />

        <button type="button" className="icon-button" aria-label="Upload a file">
          <PlusIcon size={19} />
        </button>
        <button type="button" className="icon-button" aria-label="Pick an emoji">
          <EmojiIcon size={19} />
        </button>

        <button
          type="button"
          className="composer__send"
          onClick={send}
          disabled={empty}
          aria-label="Seal and send"
          title="Seal and send"
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
              {typing.join(', ')}
              {typing.length === 1 ? ' is typing…' : ' are typing…'}
            </>
          )}
        </span>
        <span
          className="composer__sealed mono"
          title="Encrypted on this device before sending"
        >
          sealed on this device · x25519
        </span>
      </div>
    </div>
  );
}
