/**
 * Colouring a block of code.
 *
 * highlight.js, with a hand-picked set of grammars rather than all 190: the
 * languages people in a chat paste from, which is a short list. This module
 * is loaded on demand by the first code block that renders (see
 * components/MessageBody.tsx), so a conversation with no code in it never
 * pays for a grammar.
 *
 * The output is highlight.js's own HTML: the source escaped, wrapped in spans
 * carrying `hljs-*` classes and nothing else. That is the one place in the
 * app where a string somebody typed becomes markup, and it is acceptable
 * only because the library escapes the source before it emits a tag. Nothing
 * else may be spliced into that string on the way to the DOM.
 */
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import php from 'highlight.js/lib/languages/php';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const GRAMMARS = {
  bash,
  c,
  cpp,
  csharp,
  css,
  go,
  java,
  javascript,
  json,
  kotlin,
  php,
  powershell,
  python,
  rust,
  sql,
  swift,
  typescript,
  xml,
  yaml,
};

for (const [name, grammar] of Object.entries(GRAMMARS)) {
  hljs.registerLanguage(name, grammar);
}

/** The ids the guesser may pick from. Every registered grammar. */
const SUBSET = Object.keys(GRAMMARS);

/**
 * Below this, a guess is a coin toss over prose-shaped text and colouring by
 * it would put keyword purple on an English word. Tags typed by hand skip
 * this: somebody who wrote ```js meant it.
 */
const MIN_RELEVANCE = 3;

export interface Highlighted {
  /** What to print above the block: the grammar's own name, or null. */
  name: string | null;
  /** Marked-up source, or null to print the code as it is. */
  html: string | null;
}

/**
 * `language` is the tag as typed after a fence, or null for a block with
 * none, in which case the grammar is guessed. Aliases (`js`, `py`, `sh`,
 * `html`) are the ones highlight.js already knows.
 */
export function highlight(code: string, language: string | null): Highlighted {
  if (language) {
    const grammar = hljs.getLanguage(language);
    if (!grammar) return { name: language, html: null };
    const result = hljs.highlight(code, { language, ignoreIllegals: true });
    return { name: grammar.name ?? language, html: result.value };
  }

  const guess = hljs.highlightAuto(code, SUBSET);
  if (!guess.language || guess.relevance < MIN_RELEVANCE) return { name: null, html: null };
  return { name: hljs.getLanguage(guess.language)?.name ?? guess.language, html: guess.value };
}
