// @vitest-environment jsdom
/**
 * Regression tests for the email verification landing screen.
 *
 * The first version of this screen verified the address correctly and then sat
 * on "Verifying…" forever, because a `cancelled` flag was being set by the
 * cleanup React runs between StrictMode's two effect passes. The account was
 * live and the user had no way to know. Every test here is rendered inside
 * <StrictMode> for that reason: under a single effect pass the broken version
 * passed too.
 */
import { StrictMode } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import { API_ERROR_CODES } from '../lib/api/types';
import type { SessionContextValue } from '../state/SessionProvider';
import { SessionContext } from '../state/SessionProvider';
import { VerifyEmailScreen } from './VerifyEmailScreen';

afterEach(cleanup);

function renderScreen(verifyEmail: (token: string) => Promise<unknown>) {
  const onContinue = vi.fn();
  const session = {
    status: 'anonymous',
    account: null,
    keyState: 'empty',
    error: null,
    busy: false,
    auth: { verifyEmail },
  } as unknown as SessionContextValue;

  render(
    <StrictMode>
      <SessionContext.Provider value={session}>
        <VerifyEmailScreen token="a-token" onContinue={onContinue} />
      </SessionContext.Provider>
    </StrictMode>,
  );

  return { onContinue };
}

describe('VerifyEmailScreen', () => {
  it('reports success instead of hanging on the spinner', async () => {
    renderScreen(() => Promise.resolve({ ok: true }));

    expect(screen.getByText('Verifying…')).toBeDefined();
    await waitFor(() => expect(screen.getByText('Email verified')).toBeDefined());
  });

  it('submits the token exactly once', async () => {
    // The token is single-use. A second call under StrictMode would spend it
    // and turn a successful verification into a visible error.
    const verifyEmail = vi.fn(() => Promise.resolve({ ok: true }));
    renderScreen(verifyEmail);

    await waitFor(() => expect(screen.getByText('Email verified')).toBeDefined());
    expect(verifyEmail).toHaveBeenCalledTimes(1);
    expect(verifyEmail).toHaveBeenCalledWith('a-token');
  });

  it('takes the token out of the address bar so a reload cannot replay it', async () => {
    renderScreen(() => Promise.resolve({ ok: true }));

    await waitFor(() => expect(screen.getByText('Email verified')).toBeDefined());
    expect(window.location.search).toBe('');
  });

  it('explains a spent link rather than failing silently', async () => {
    const spent = new ApiError(
      400,
      API_ERROR_CODES.invalidToken,
      'This verification link is invalid or has expired.',
    );
    renderScreen(() => Promise.reject(spent));

    await waitFor(() => expect(screen.getByText('That link did not work')).toBeDefined());
    expect(screen.getByText(spent.message)).toBeDefined();
  });
});
