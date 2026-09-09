// @vitest-environment jsdom
/**
 * The bubble's body: links, inline code and code blocks.
 *
 * The parse has tests of its own (lib/chat/format.test.ts). What is checked
 * here is the part that only exists once there is a DOM: that a link goes out
 * through the platform adapter rather than the anchor, that the copy button
 * really hands the code to the clipboard, that colouring arrives, and that a
 * body which looks like markup is drawn as the text it is.
 */
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { webPlatform, type Platform } from '../lib/platform';
import { PlatformProvider } from '../state/PlatformProvider';
import { Providers } from '../test/providers';
import { MessageBody } from './MessageBody';

afterEach(cleanup);

function mount(body: string, platform: Platform = webPlatform) {
  return render(
    <StrictMode>
      <Providers>
        <PlatformProvider platform={platform}>
          <MessageBody body={body} />
        </PlatformProvider>
      </Providers>
    </StrictMode>,
  );
}

describe('links', () => {
  it('opens through the platform, not the anchor', () => {
    const openExternal = vi.fn(async () => {});
    mount('see https://example.com/x now', { ...webPlatform, openExternal });

    const link = screen.getByRole('link', { name: 'https://example.com/x' });
    expect(link.getAttribute('href')).toBe('https://example.com/x');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');

    const click = fireEvent.click(link);
    expect(click).toBe(false);
    expect(openExternal).toHaveBeenCalledWith('https://example.com/x');
  });
});

describe('markup in a body', () => {
  it('is text, not elements', () => {
    const { container } = mount('<script>alert(1)</script> and <b>bold</b>');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script> and <b>bold</b>');
  });
});

describe('inline code', () => {
  it('is drawn in a code element', () => {
    const { container } = mount('run `npm test` first');
    const code = container.querySelector('code.bubble__inline-code');
    expect(code?.textContent).toBe('npm test');
  });
});

describe('a code block', () => {
  it('copies the code, and says so for a moment', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    mount('```js\nconst x = 1;\n```');
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));

    await waitFor(() => expect(screen.getByText('Copied')).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith('const x = 1;');
  });

  it('reports a clipboard that refused', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });

    mount('```\nls\n```');
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));

    await waitFor(() => expect(screen.getByText('Could not copy')).toBeTruthy());
  });

  it('is coloured once the grammars arrive, and named after the tag', async () => {
    const { container } = mount('```js\nconst x = 1;\n```');
    // Plain first: the code is readable before the chunk lands.
    expect(container.querySelector('.code-block__pre')?.textContent).toBe('const x = 1;');

    await waitFor(() => expect(container.querySelector('.hljs-keyword')).toBeTruthy());
    expect(screen.getByText('JavaScript')).toBeTruthy();
    expect(container.querySelector('.code-block__pre')?.textContent).toBe('const x = 1;');
  });

  it('keeps an unknown tag as the label and leaves the code plain', async () => {
    const { container } = mount('```brainfuck\n+++\n```');
    expect(screen.getByText('brainfuck')).toBeTruthy();
    await waitFor(() => expect(container.querySelector('.code-block__pre code')).toBeTruthy());
    expect(container.querySelector('[class^="hljs-"]')).toBeNull();
  });

  it('says "code" over a block nobody tagged and nothing recognised', () => {
    mount('```\nlorem ipsum\n```');
    expect(screen.getByText('code')).toBeTruthy();
  });

  it('keeps the prose around it', () => {
    const { container } = mount('try:\n```\nls -la\n```\nthen tell me');
    const texts = [...container.querySelectorAll('.bubble__text')].map((el) => el.textContent);
    expect(texts).toEqual(['try:', 'then tell me']);
  });
});
