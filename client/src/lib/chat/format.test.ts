/**
 * The message parser and, above all, the code detector.
 *
 * The detector is the one piece here that can be wrong in both directions,
 * and the two directions cost differently: a snippet it misses can be fenced
 * by hand, a sentence it claims cannot be unclaimed. So the prose cases are
 * the ones to add to when something slips through, and each of them is a
 * message somebody could plausibly send.
 */
import { describe, expect, it } from 'vitest';
import { hasOpenFence, looksLikeCode, parseInline, parseMessage, plainText } from './format';

describe('fences', () => {
  it('turns a fenced block with a tag into code', () => {
    expect(parseMessage('```js\nconsole.log(1)\n```')).toEqual([
      { kind: 'code', code: 'console.log(1)', language: 'js', detected: false },
    ]);
  });

  it('keeps the prose around a block, without the line breaks that framed it', () => {
    expect(parseMessage('try this:\n```\nls -la\n```\nand tell me')).toEqual([
      { kind: 'text', parts: [{ kind: 'text', text: 'try this:' }] },
      { kind: 'code', code: 'ls -la', language: null, detected: false },
      { kind: 'text', parts: [{ kind: 'text', text: 'and tell me' }] },
    ]);
  });

  it('runs an unclosed fence to the end of the message', () => {
    expect(parseMessage('```py\nprint(1)\nprint(2)')).toEqual([
      { kind: 'code', code: 'print(1)\nprint(2)', language: 'py', detected: false },
    ]);
  });

  /// A tag is only a tag on the fence's own line. On one line the word after
  /// the backticks is the code.
  it('reads a one-line fence as untagged code', () => {
    expect(parseMessage('```echo hi```')).toEqual([
      { kind: 'code', code: 'echo hi', language: null, detected: false },
    ]);
  });

  it('leaves an empty fence as the backticks that were typed', () => {
    expect(parseMessage('``````')).toEqual([
      { kind: 'text', parts: [{ kind: 'text', text: '``````' }] },
    ]);
    expect(parseMessage('```')).toEqual([{ kind: 'text', parts: [{ kind: 'text', text: '```' }] }]);
  });

  it('keeps blank lines inside a block and drops the one before the closing fence', () => {
    expect(parseMessage('```\na\n\nb\n```')).toEqual([
      { kind: 'code', code: 'a\n\nb', language: null, detected: false },
    ]);
  });

  it('handles two blocks in one message', () => {
    const blocks = parseMessage('```\none\n```\nthen\n```\ntwo\n```');
    expect(blocks.map((block) => block.kind)).toEqual(['code', 'text', 'code']);
  });
});

describe('inline', () => {
  it('finds code between single backticks', () => {
    expect(parseInline('run `npm test` first')).toEqual([
      { kind: 'text', text: 'run ' },
      { kind: 'code', text: 'npm test' },
      { kind: 'text', text: ' first' },
    ]);
  });

  it('does not let inline code span a line', () => {
    expect(parseInline('a `b\nc` d')).toEqual([{ kind: 'text', text: 'a `b\nc` d' }]);
  });

  it('links an https address and a www one', () => {
    expect(parseInline('see https://example.com/a?b=1 or www.example.org')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', href: 'https://example.com/a?b=1', text: 'https://example.com/a?b=1' },
      { kind: 'text', text: ' or ' },
      { kind: 'link', href: 'https://www.example.org/', text: 'www.example.org' },
    ]);
  });

  it('leaves the sentence punctuation after a link to the sentence', () => {
    expect(parseInline('look at https://example.com.')).toEqual([
      { kind: 'text', text: 'look at ' },
      { kind: 'link', href: 'https://example.com/', text: 'https://example.com' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('gives an unbalanced bracket back and keeps a balanced one', () => {
    expect(parseInline('(https://example.com/x)')).toEqual([
      { kind: 'text', text: '(' },
      { kind: 'link', href: 'https://example.com/x', text: 'https://example.com/x' },
      { kind: 'text', text: ')' },
    ]);
    expect(parseInline('https://en.wikipedia.org/wiki/Go_(game)')).toEqual([
      {
        kind: 'link',
        href: 'https://en.wikipedia.org/wiki/Go_(game)',
        text: 'https://en.wikipedia.org/wiki/Go_(game)',
      },
    ]);
  });

  it('does not link a scheme with nothing after it, or a word that merely contains www', () => {
    expect(parseInline('https:// nothing')).toEqual([{ kind: 'text', text: 'https:// nothing' }]);
    expect(parseInline('awww.no')).toEqual([{ kind: 'text', text: 'awww.no' }]);
  });

  it('does not link inside inline code', () => {
    expect(parseInline('`https://example.com`')).toEqual([
      { kind: 'code', text: 'https://example.com' },
    ]);
  });
});

describe('the detector', () => {
  const code = [
    'npm install highlight.js',
    'git commit -m "fix"',
    'console.log("hello")',
    'const x = 5;',
    'def greet(name):',
    'SELECT * FROM users WHERE id = 1',
    '<div class="a">hi</div>',
    'x => x * 2',
    'function add(a, b) {\n  return a + b;\n}',
    'for i in range(10):\n    print(i)\n    total += i',
    'import os\nimport sys\n\nprint(os.getcwd())',
    '{\n  "name": "cipher",\n  "version": "0.1.0"\n}',
    'let a = 1\nlet b = 2\nconsole.log(a + b)',
    '#include <stdio.h>\nint main() {\n  return 0;\n}',
  ];

  it.each(code)('reads this as code: %s', (body) => {
    expect(looksLikeCode(body)).toBe(true);
  });

  const prose = [
    'hey',
    'let me know (tomorrow)',
    'return the book please',
    'class starts at 9',
    'I will print the tickets',
    'see you at 5 ;)',
    'great :)',
    'what do you think?',
    'call me at (020) 123 4567',
    'the file is called notes.txt',
    'ok; sure',
    'https://example.com/a?b=c',
    'if you want, we can go for (a) pizza or (b) sushi',
    'the meeting is from 2 to 3',
    'Are you coming tonight?\nWe start at eight.\nBring something to drink.',
    'first line\nsecond line',
    'I am fine.\nx = 1',
    'A list:\n- one\n- two\n- three',
    'Dear all,\n\nthe deploy is done.\n\nFin',
  ];

  it.each(prose)('reads this as prose: %s', (body) => {
    expect(looksLikeCode(body)).toBe(false);
  });

  it('marks a detected block as detected, with no language', () => {
    expect(parseMessage('const x = 5;')).toEqual([
      { kind: 'code', code: 'const x = 5;', language: null, detected: true },
    ]);
  });

  it('never detects inside a message that already has a fence', () => {
    const blocks = parseMessage('const x = 5;\n```\ny\n```');
    expect(blocks[0]).toEqual({ kind: 'text', parts: [{ kind: 'text', text: 'const x = 5;' }] });
  });
});

describe('plainText', () => {
  it('flattens fences and backticks to one line', () => {
    expect(plainText('look:\n```js\nconsole.log(1)\n```')).toBe('look: console.log(1)');
    expect(plainText('run `npm test`\nplease')).toBe('run npm test please');
  });
});

describe('hasOpenFence', () => {
  it('is open after one fence and closed after two', () => {
    expect(hasOpenFence('```js\nfoo')).toBe(true);
    expect(hasOpenFence('```js\nfoo\n```')).toBe(false);
    expect(hasOpenFence('plain')).toBe(false);
  });
});

describe('emphasis', () => {
  /** The text a tree stands for, so a test can assert on shape and content. */
  function flat(parts: import('./format').Inline[]): string {
    return parts
      .map((part) =>
        part.kind === 'emphasis' ? flat(part.parts) : part.kind === 'text' ? part.text : '',
      )
      .join('');
  }

  it('reads **bold** and *italic*', () => {
    const bold = parseInline('a **b** c');
    expect(bold[1]).toMatchObject({ kind: 'emphasis', style: 'bold' });
    const italic = parseInline('a *b* c');
    expect(italic[1]).toMatchObject({ kind: 'emphasis', style: 'italic' });
  });

  it('reads ~~strike~~ and ||spoiler||', () => {
    expect(parseInline('~~x~~')[0]).toMatchObject({ style: 'strike' });
    expect(parseInline('||x||')[0]).toMatchObject({ style: 'spoiler' });
  });

  it('tries the long marker first, so bold is not two empty italics', () => {
    const parts = parseInline('**b**');
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ style: 'bold' });
    expect(flat(parts)).toBe('b');
  });

  it('nests, so bold can hold an italic', () => {
    const parts = parseInline('**a *b* c**');
    expect(parts[0]).toMatchObject({ kind: 'emphasis', style: 'bold' });
    expect(flat(parts)).toBe('a b c');
  });

  it('leaves a lone marker as the character it is', () => {
    // The failure this guards: "2 * 3 and 4 * 5" coming out italic.
    expect(flat(parseInline('2 * 3'))).toBe('2 * 3');
    expect(parseInline('2 * 3').every((part) => part.kind !== 'emphasis')).toBe(true);
  });

  it('does not let an unclosed marker swallow the next line', () => {
    const parts = parseInline('*a\nb');
    expect(parts.every((part) => part.kind !== 'emphasis')).toBe(true);
  });

  it('leaves markers inside a code span alone', () => {
    const parts = parseInline('`**x**`');
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ kind: 'code', text: '**x**' });
  });

  it('does not italicise snake_case, which is why _ is not a marker', () => {
    expect(parseInline('some_variable_name').every((p) => p.kind !== 'emphasis')).toBe(true);
  });

  it('strips markers from the conversation preview', () => {
    expect(plainText('**hello** there')).toBe('hello there');
  });
});
