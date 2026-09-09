/**
 * What a message body means, worked out before anything draws it.
 *
 * A body is the text somebody typed and nothing else: no markup travels over
 * the wire, and the server (once phase 2 lands) cannot see it anyway. So
 * everything a bubble shows beyond the raw words is decided here, on the
 * reading device, from the text alone:
 *
 *   - a fenced block, three backticks on a line of its own with an optional
 *     language after the opening fence, is code
 *   - a message with no fences that nonetheless reads as code is treated as
 *     one block of it, see `looksLikeCode`
 *   - `inline code` between single backticks stays on the line
 *   - an address starting with http://, https:// or www. is a link
 *
 * All of it is pure and all of it is tested, because the detector in
 * particular is a heuristic, and a heuristic that puts somebody's sentence in
 * monospace by mistake is worse than one that misses a snippet. The bias is
 * deliberately towards prose: a snippet the detector misses can still be
 * fenced by hand, a sentence it wrongly claims cannot be unfenced.
 *
 * Nothing here escapes or sanitises anything. The output is a tree of typed
 * parts that React renders as text nodes, which is what keeps a body that
 * contains `<script>` a body that says `<script>`.
 */

export type Emphasis = 'bold' | 'italic' | 'strike' | 'spoiler';

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; text: string }
  /** Recursive, so `**bold with *italic* inside**` is one tree, not two runs. */
  | { kind: 'emphasis'; style: Emphasis; parts: Inline[] };

export type Block =
  | { kind: 'text'; parts: Inline[] }
  | {
      kind: 'code';
      code: string;
      /** The tag after the opening fence, as typed. Null when there was none. */
      language: string | null;
      /** True when the message had no fence and the detector decided. */
      detected: boolean;
    };

const FENCE = '```';
/** A language tag directly after the opening fence, on the fence's own line. */
const FENCE_TAG = /^([A-Za-z0-9+#.-]{1,20})?[ \t]*\r?\n/;

export function parseMessage(body: string): Block[] {
  const raw = splitFences(body);
  const fenced = raw.some((block) => block.kind === 'code');

  if (!fenced) {
    if (looksLikeCode(body)) {
      return [{ kind: 'code', code: body.trim(), language: null, detected: true }];
    }
    return [{ kind: 'text', parts: parseInline(body) }];
  }

  const blocks: Block[] = [];
  raw.forEach((block, index) => {
    if (block.kind === 'code') {
      blocks.push({ kind: 'code', code: block.code, language: block.language, detected: false });
      return;
    }
    // The line break that separates prose from a fence is layout, not
    // content: keeping it would open a blank line above every block.
    let text = block.text;
    if (index > 0) text = text.replace(/^\r?\n/, '');
    if (index < raw.length - 1) text = text.replace(/\r?\n$/, '');
    if (text.length === 0) return;
    blocks.push({ kind: 'text', parts: parseInline(text) });
  });
  return blocks;
}

type RawBlock =
  | { kind: 'text'; text: string }
  | { kind: 'code'; code: string; language: string | null };

/**
 * Fences the way people actually type them: a closing fence may be missing
 * (the block runs to the end of the message, as it does on Discord), and a
 * fence with nothing inside is just three backticks somebody typed.
 */
function splitFences(body: string): RawBlock[] {
  const out: RawBlock[] = [];
  let at = 0;

  while (at <= body.length) {
    const open = body.indexOf(FENCE, at);
    if (open === -1) {
      out.push({ kind: 'text', text: body.slice(at) });
      break;
    }
    out.push({ kind: 'text', text: body.slice(at, open) });

    let start = open + FENCE.length;
    let language: string | null = null;
    const tag = FENCE_TAG.exec(body.slice(start));
    if (tag) {
      language = tag[1] ?? null;
      start += tag[0].length;
    }

    const close = body.indexOf(FENCE, start);
    const end = close === -1 ? body.length : close;
    const code = body.slice(start, end).replace(/\r?\n$/, '');
    at = close === -1 ? body.length + 1 : close + FENCE.length;

    if (code.trim().length === 0) {
      out.push({ kind: 'text', text: body.slice(open, close === -1 ? body.length : at) });
    } else {
      out.push({ kind: 'code', code, language });
    }
  }

  return mergeText(out).filter((block) => block.kind === 'code' || block.text.length > 0);
}

function mergeText(blocks: RawBlock[]): RawBlock[] {
  const out: RawBlock[] = [];
  for (const block of blocks) {
    const last = out[out.length - 1];
    if (block.kind === 'text' && last?.kind === 'text') {
      last.text += block.text;
    } else {
      out.push({ ...block });
    }
  }
  return out;
}

/* --- inline: `code`, emphasis and links ---------------------------------- */

const INLINE_CODE = /`([^`\n]+)`/g;

/**
 * The wrappers, longest marker first.
 *
 * Order is the whole correctness of this: `**` has to be tried before `*`, or
 * bold parses as two empty italics.
 *
 * A single `_` is deliberately not an italic marker. It is the character in
 * snake_case identifiers and file names, and a message full of
 * `some_variable_name` should not come out half italic. Asterisks are
 * unambiguous enough on their own.
 */
const WRAPPERS: readonly { marker: string; style: Emphasis }[] = [
  { marker: '***', style: 'bold' },
  { marker: '**', style: 'bold' },
  { marker: '__', style: 'bold' },
  { marker: '||', style: 'spoiler' },
  { marker: '~~', style: 'strike' },
  { marker: '*', style: 'italic' },
];

export function parseInline(text: string): Inline[] {
  const parts: Inline[] = [];
  let at = 0;
  // Code first and unconditionally: what is inside backticks is not markup,
  // and `**` in a code span is two asterisks somebody meant to type.
  for (const match of text.matchAll(INLINE_CODE)) {
    parts.push(...emphasise(text.slice(at, match.index)));
    parts.push({ kind: 'code', text: match[1] });
    at = match.index + match[0].length;
  }
  parts.push(...emphasise(text.slice(at)));
  return parts;
}

/**
 * Wraps runs between matching markers, recursing into what is inside.
 *
 * A marker with no partner is left as the characters it is, which is what
 * keeps "2 * 3 and 4 * 5" arithmetic rather than an italic. Nothing here may
 * span a newline: an unclosed marker at the end of one line would otherwise
 * swallow the rest of the message.
 */
function emphasise(text: string): Inline[] {
  if (!text) return [];

  for (const { marker, style } of WRAPPERS) {
    const open = text.indexOf(marker);
    if (open === -1) continue;
    const close = text.indexOf(marker, open + marker.length);
    if (close === -1) continue;

    const inner = text.slice(open + marker.length, close);
    // An empty pair is not emphasis, and a run crossing a line is a marker
    // somebody typed rather than one they meant.
    if (!inner.trim() || inner.includes('\n')) continue;

    // `***` is bold and italic at once, which is why it carries a nested
    // italic rather than having a style of its own.
    const body: Inline[] =
      marker === '***'
        ? [{ kind: 'emphasis', style: 'italic', parts: emphasise(inner) }]
        : emphasise(inner);

    return [
      ...emphasise(text.slice(0, open)),
      { kind: 'emphasis', style, parts: body },
      ...emphasise(text.slice(close + marker.length)),
    ];
  }

  return linkify(text);
}

const URL_CANDIDATE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
/** Sentence punctuation that belongs to the prose around a link, not to it. */
const TRAILING = /[.,;:!?'"]+$/;

function linkify(text: string): Inline[] {
  const parts: Inline[] = [];
  let at = 0;
  for (const match of text.matchAll(URL_CANDIDATE)) {
    const link = toLink(match[0]);
    if (!link) continue;
    if (match.index > at) parts.push({ kind: 'text', text: text.slice(at, match.index) });
    parts.push(link);
    at = match.index + link.text.length;
  }
  if (at < text.length) parts.push({ kind: 'text', text: text.slice(at) });
  return parts;
}

/**
 * Trims what the regex over-ate and checks the rest is an address a browser
 * would accept. "(see https://example.com/a)" keeps its bracket; a Wikipedia
 * link with a bracket of its own, "https://en.wikipedia.org/wiki/Go_(game)",
 * keeps that one because it is balanced.
 */
function toLink(candidate: string): Extract<Inline, { kind: 'link' }> | null {
  let text = candidate.replace(TRAILING, '');
  for (const [open, close] of [
    ['(', ')'],
    ['[', ']'],
  ]) {
    while (text.endsWith(close) && count(text, close) > count(text, open)) {
      text = text.slice(0, -1).replace(TRAILING, '');
    }
  }
  if (text.length === 0) return null;

  const href = /^www\./i.test(text) ? `https://${text}` : text;
  try {
    const url = new URL(href);
    if (url.hostname.length === 0) return null;
    return { kind: 'link', href: url.href, text };
  } catch {
    return null;
  }
}

function count(text: string, char: string): number {
  let n = 0;
  for (const c of text) if (c === char) n += 1;
  return n;
}

/* --- the detector -------------------------------------------------------- */

/**
 * Whether an unfenced message is, as a whole, a piece of code.
 *
 * One line has to prove it on its own, so only shapes that prose almost never
 * takes count: a shell command, a dotted call, a keyword that is not also an
 * English word next to something structural. Several lines are judged
 * together: at least two of them have to look like code and be the majority,
 * and lines that read as sentences have to be outnumbered.
 */
export function looksLikeCode(body: string): boolean {
  const lines = body.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return false;
  if (lines.length === 1) return isCodeAlone(lines[0]);

  const code = lines.filter((line) => isCodeLine(line)).length;
  const prose = lines.filter((line) => !isCodeLine(line) && isSentence(line)).length;
  return code >= 2 && code * 2 >= lines.length && prose < code;
}

/** Keywords no English sentence starts with. */
const KEYWORD_STRICT =
  /^\s*(?:import|export|const|function|async|def|struct|enum|impl|fn|pub|interface|namespace|using|package|#include|#define|elif|lambda|foreach|printf|println|console\.log|System\.out|std::|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/;
/** Keywords that are also ordinary words, so they need company. */
const KEYWORD_LOOSE =
  /^\s*(?:let|var|return|class|type|if|else|for|while|switch|case|new|this|int|string|void|bool|float|double|public|private|static|final|try|catch|throw|yield|print|echo|from|end)\b/;
const STRUCTURAL = /[=(){};:<>[\]]/;
const STRONG_STRUCTURAL = /[=;{}]|\w\(/;
const SHELL =
  /^\s*(?:[$#>]\s+)?(?:npm|npx|yarn|pnpm|git|sudo|cd|ls|curl|wget|pip3?|python3?|node|deno|bun|cargo|rustup|docker|kubectl|apt(?:-get)?|brew|make|chmod|chown|mkdir|rm|cp|mv|cat|grep|ssh|scp|tar|systemctl|prisma)\s+\S/;
const HTML_TAG = /^\s*<\/?[a-zA-Z][\w-]*(?:\s[^<>]*)?\/?>/;
const DOTTED_CALL = /^\s*[\w$]+(?:\.[\w$]+)+\(.*\)\s*;?$/;
const QUOTED_CALL = /^\s*[\w$.]+\(\s*["'`].*["'`]\s*\)\s*;?$/;
const OPERATORS = /=>|===|!==|::|->|\$\{|<\/|\/>|\+=|-=|\*=|&&|\|\|/;
/** The operators prose never borrows. `->` is left out: "a -> b" is how people draw an arrow. */
const OPERATORS_ALONE = /=>|===|!==|::|\$\{|<\/|\/>/;
const ENDS_LIKE_CODE = /[;{}]\s*$/;
const STARTS_WITH_CLOSER = /^\s*[)}\]]/;
const INDENTED = /^(?:\t| {2,})\S/;
const ASSIGNMENT = /^\s*[\w$.[\]]+\s*(?:[:+\-*/]?=)\s*\S/;
const COMMENT = /^\s*(?:\/\/|\/\*|\*\/|#!)/;
const WEB_ADDRESS = /\b(?:https?:\/\/|www\.)/i;

function isCodeAlone(line: string): boolean {
  if (WEB_ADDRESS.test(line)) return false;
  return (
    SHELL.test(line) ||
    DOTTED_CALL.test(line) ||
    QUOTED_CALL.test(line) ||
    HTML_TAG.test(line) ||
    (KEYWORD_STRICT.test(line) && STRUCTURAL.test(line)) ||
    (KEYWORD_LOOSE.test(line) && STRONG_STRUCTURAL.test(line)) ||
    (ENDS_LIKE_CODE.test(line) && /[=(]/.test(line)) ||
    OPERATORS_ALONE.test(line)
  );
}

/** Looser than `isCodeAlone`, because the other lines share the burden of proof. */
function isCodeLine(line: string): boolean {
  return (
    isCodeAlone(line) ||
    KEYWORD_STRICT.test(line) ||
    ENDS_LIKE_CODE.test(line) ||
    STARTS_WITH_CLOSER.test(line) ||
    INDENTED.test(line) ||
    ASSIGNMENT.test(line) ||
    COMMENT.test(line) ||
    OPERATORS.test(line)
  );
}

function isSentence(line: string): boolean {
  const trimmed = line.trim();
  return /^[A-Za-z]/.test(trimmed) && /[.!?]$/.test(trimmed) && trimmed.split(/\s+/).length >= 4;
}

/* --- helpers for the places that show a body without drawing it ----------- */

/**
 * A body as one line of plain text, for a conversation row's preview. Fences
 * and backticks are dropped rather than shown, because three backticks in a
 * twelve-pixel preview say nothing about what was sent.
 */
/** One inline part as the characters it stands for, markers and all gone. */
function flatten(part: Inline): string {
  if (part.kind === 'emphasis') return part.parts.map(flatten).join('');
  return part.text;
}

export function plainText(body: string): string {
  const pieces: string[] = [];
  for (const block of parseMessage(body)) {
    if (block.kind === 'code') pieces.push(block.code);
    else pieces.push(block.parts.map(flatten).join(''));
  }
  return pieces.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Whether a draft has a fence that is not yet closed. The composer lets Enter
 * insert a line break inside one instead of sending, so a block can be typed
 * the way it will be read.
 */
export function hasOpenFence(draft: string): boolean {
  return (draft.match(/```/g) ?? []).length % 2 === 1;
}
