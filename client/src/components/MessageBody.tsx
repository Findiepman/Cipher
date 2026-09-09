/**
 * A message body, drawn.
 *
 * The words are parsed on this device (lib/chat/format.ts) into prose, inline
 * code, links and code blocks, and each becomes an element here. The parse is
 * the only thing that decides what is what; this file just draws it.
 *
 * Two rules worth knowing:
 *
 *   - A link opens through the platform adapter, never through the anchor
 *     itself. In a browser tab those are the same thing; in the desktop shell
 *     the anchor would open inside the WebView and the adapter opens the
 *     system browser. The `href` is still set, so the address can be copied
 *     and middle-clicked like any link.
 *   - Colouring is loaded on demand. The grammars are a chunk the first code
 *     block asks for, and until it arrives the block is drawn plain, which is
 *     what it would look like with no colouring at all. A conversation with no
 *     code in it never loads them.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { parseMessage, type Inline } from '../lib/chat/format';
import type { Highlighted } from '../lib/chat/highlight';
import { usePlatform } from '../state/PlatformProvider';
import { useT } from '../state/I18nProvider';
import { CheckIcon, CopyIcon } from './Icons';

export function MessageBody({ body }: { body: string }) {
  const blocks = useMemo(() => parseMessage(body), [body]);

  return (
    <div className="bubble__body">
      {blocks.map((block, index) =>
        block.kind === 'code' ? (
          <CodeBlock key={index} code={block.code} language={block.language} />
        ) : (
          <span key={index} className="bubble__text">
            {block.parts.map((part, at) => (
              <InlinePart key={at} part={part} />
            ))}
          </span>
        ),
      )}
    </div>
  );
}

function InlinePart({ part }: { part: Inline }) {
  const platform = usePlatform();

  if (part.kind === 'text') return <>{part.text}</>;
  if (part.kind === 'code') return <code className="bubble__inline-code mono">{part.text}</code>;

  if (part.kind === 'emphasis') {
    // Recursive, because emphasis nests: bold inside italic inside a link is
    // one tree and rendering it flat would lose the inner half.
    const inner = part.parts.map((child, index) => <InlinePart key={index} part={child} />);
    if (part.style === 'bold') return <strong>{inner}</strong>;
    if (part.style === 'italic') return <em>{inner}</em>;
    if (part.style === 'strike') return <s>{inner}</s>;
    // A spoiler is hidden until asked for, so it is a button rather than a
    // span: it is a thing you press, and a keyboard has to be able to press it.
    return <Spoiler>{inner}</Spoiler>;
  }

  return (
    <a
      className="bubble__link"
      href={part.href}
      target="_blank"
      rel="noopener noreferrer"
      title={part.href}
      onClick={(event) => {
        event.preventDefault();
        void platform.openExternal(part.href);
      }}
      // The bubble's right-click opens the person menu. On a link the
      // browser's own menu is the useful one: it is where "copy link" lives.
      onContextMenu={(event) => event.stopPropagation()}
    >
      {part.text}
    </a>
  );
}

/**
 * Hidden text, revealed on a press and not before.
 *
 * Once shown it stays shown: re-hiding on a second click reads as a mistake,
 * and the point was never to keep it secret from the person who asked.
 */
function Spoiler({ children }: { children: React.ReactNode }) {
  const [shown, setShown] = useState(false);
  const t = useT();
  return (
    <button
      type="button"
      className={shown ? 'bubble__spoiler bubble__spoiler--shown' : 'bubble__spoiler'}
      aria-label={shown ? undefined : t('chat.spoiler')}
      onClick={() => setShown(true)}
      // The bubble's right-click menu should still work over one.
      onContextMenu={(event) => event.stopPropagation()}
    >
      {children}
    </button>
  );
}

/* --- code blocks ---------------------------------------------------------- */

let grammars: Promise<typeof import('../lib/chat/highlight')> | null = null;

function loadGrammars() {
  grammars ??= import('../lib/chat/highlight');
  return grammars;
}

function useHighlighted(code: string, language: string | null): Highlighted | null {
  const [lit, setLit] = useState<Highlighted | null>(null);

  useEffect(() => {
    let live = true;
    void loadGrammars().then((module) => {
      if (live) setLit(module.highlight(code, language));
    });
    return () => {
      live = false;
    };
  }, [code, language]);

  return lit;
}

function CodeBlock({ code, language }: { code: string; language: string | null }) {
  const t = useT();
  const lit = useHighlighted(code, language);
  const label = lit?.name ?? language ?? t('chat.code');

  return (
    <div className="code-block">
      <div className="code-block__head">
        <span className="code-block__lang eyebrow">{label}</span>
        <CopyButton text={code} />
      </div>
      <pre className="code-block__pre mono">
        {lit?.html ? (
          // highlight.js escaped the source before wrapping it in its spans;
          // see the note at the top of lib/chat/highlight.ts. Nothing else
          // is ever spliced into this string.
          <code dangerouslySetInnerHTML={{ __html: lit.html }} />
        ) : (
          <code>{code}</code>
        )}
      </pre>
    </div>
  );
}

type CopyState = 'idle' | 'copied' | 'failed';

/** Clears after this long, so the button is a button again. */
const COPIED_FOR_MS = 1_800;

function CopyButton({ text }: { text: string }) {
  const t = useT();
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    let next: CopyState = 'copied';
    try {
      // Absent outside a secure context, in which case the property read
      // throws and lands here like any other refusal.
      await navigator.clipboard.writeText(text);
    } catch {
      next = 'failed';
    }
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), COPIED_FOR_MS);
  }

  const label =
    state === 'copied'
      ? t('chat.copied')
      : state === 'failed'
        ? t('chat.copyFailed')
        : t('chat.copyCode');

  return (
    <button
      type="button"
      className={`code-block__copy${state === 'copied' ? ' code-block__copy--done' : ''}`}
      onClick={() => void copy()}
      aria-label={t('chat.copyCode')}
      title={t('chat.copyCode')}
    >
      {state === 'copied' ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
      <span>{label}</span>
    </button>
  );
}
