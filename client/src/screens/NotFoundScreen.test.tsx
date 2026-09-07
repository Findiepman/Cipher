// @vitest-environment jsdom
/**
 * The 404, and the rule that decides when it renders.
 *
 * The rule is the half worth testing. This app has no router: AppRoot matches
 * paths by hand, so "which addresses exist" is a set literal that somebody has
 * to remember to update. A deep link missing from it does not throw, it just
 * starts answering 404 to a link that arrived in somebody's email, which is a
 * failure nothing else in the suite would notice.
 */
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isKnownPath } from '../AppRoot';
import { NotFoundScreen } from './NotFoundScreen';

afterEach(cleanup);

describe('which addresses exist', () => {
  it('knows the app root and both deep links', () => {
    expect(isKnownPath('/')).toBe(true);
    expect(isKnownPath('/verify-email')).toBe(true);
    expect(isKnownPath('/reset-password')).toBe(true);
  });

  /// Both links arrive by email, where a client may well append a slash.
  it('treats a trailing slash as the same address', () => {
    expect(isKnownPath('/verify-email/')).toBe(true);
    expect(isKnownPath('/reset-password/')).toBe(true);
  });

  it('rejects everything else', () => {
    for (const path of ['/settings', '/nope', '/verify', '/reset', '/verify-email/x', '/a/b']) {
      expect(isKnownPath(path), path).toBe(false);
    }
  });
});

describe('the screen', () => {
  it('reports the address that missed', () => {
    render(
      <StrictMode>
        <NotFoundScreen path="/nope?x=1" onHome={vi.fn()} />
      </StrictMode>,
    );

    expect(screen.getByText('404')).toBeTruthy();
    expect(screen.getByText('/nope?x=1')).toBeTruthy();
  });

  it('offers a way home', () => {
    const onHome = vi.fn();
    render(
      <StrictMode>
        <NotFoundScreen path="/nope" onHome={onHome} />
      </StrictMode>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back to your messages' }));
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  /// The UI makes no claim about encryption anywhere (STATUS.md, decision 21),
  /// and a 404 is the worst place to start: it is the one screen a user reaches
  /// while already wondering whether something broke.
  it('reassures without claiming anything about encryption', () => {
    render(
      <StrictMode>
        <NotFoundScreen path="/nope" onHome={vi.fn()} />
      </StrictMode>,
    );

    expect(screen.getByText(/Your conversations are still where you left them/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/encrypt/i);
  });
});
