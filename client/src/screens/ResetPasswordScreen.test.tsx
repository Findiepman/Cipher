// @vitest-environment jsdom
/**
 * The reset landing screen.
 *
 * What is worth testing here is not the crypto, which lives in
 * lib/session/authService.test.ts and runs against real libsodium. It is the
 * two decisions this screen makes on the user's behalf: that a dead link is
 * reported before anyone types a password into a form that cannot work, and
 * that discarding the identity is a deliberate act rather than the thing that
 * happens when the recovery code is not to hand.
 *
 * Rendered inside <StrictMode> like every component test here, because the
 * context fetch runs from an effect and a single pass hides the bugs that
 * makes possible.
 */
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import { API_ERROR_CODES } from '../lib/api/types';
import type { SessionContextValue } from '../state/SessionProvider';
import { SessionContext } from '../state/SessionProvider';
import { ResetPasswordScreen } from './ResetPasswordScreen';

afterEach(cleanup);

const EMAIL = 'sam@example.test';
const PASSWORD = 'quiet-harbour-otter-19';

const CONTEXT = {
  email: EMAIL,
  deviceId: 'dev-1',
  publicKey: 'public-key',
  wrappedPrivateKeyRecovery: 'blob-b',
};

function renderScreen(
  overrides: {
    resetContext?: () => Promise<unknown>;
  } = {},
) {
  const auth = {
    resetContext: overrides.resetContext ?? vi.fn(() => Promise.resolve(CONTEXT)),
    resetPasswordWithRecoveryCode: vi.fn(() =>
      Promise.resolve({ recoveryCode: 'AAAAA-BBBBB-CCCCC-DDDDD' }),
    ),
    resetPasswordAndDiscardIdentity: vi.fn(() =>
      Promise.resolve({ recoveryCode: 'EEEEE-FFFFF-GGGGG-HHHHH' }),
    ),
  };
  const onLeave = vi.fn();

  render(
    <StrictMode>
      <SessionContext.Provider value={{ auth } as unknown as SessionContextValue}>
        <ResetPasswordScreen token="a-token" onLeave={onLeave} />
      </SessionContext.Provider>
    </StrictMode>,
  );

  return { auth, onLeave };
}

const codeField = () => screen.getByPlaceholderText('XXXXX-XXXXX-XXXXX-XXXXX');
const passwordField = () => screen.getByLabelText('New password');
const submitButton = () => screen.getByRole('button', { name: /Set new password|Setting it up/ });

async function waitForForm(): Promise<void> {
  await waitFor(() => expect(screen.getByText('Set a new password')).toBeDefined());
}

describe('checking the link', () => {
  it('shows whose account it is once the link checks out', async () => {
    const { auth } = renderScreen();

    expect(screen.getByText('Checking your link…')).toBeDefined();
    await waitForForm();
    expect(screen.getByText(`For ${EMAIL}.`)).toBeDefined();

    // One call, not two. It is not single-use, but /auth/* allows ten requests
    // in fifteen minutes and a reset costs two of them already.
    expect(auth.resetContext).toHaveBeenCalledTimes(1);
    expect(auth.resetContext).toHaveBeenCalledWith('a-token');
  });

  it('says a dead link is dead instead of asking for a password', async () => {
    const expired = new ApiError(
      400,
      API_ERROR_CODES.invalidToken,
      'This reset link is invalid or has expired.',
    );
    renderScreen({ resetContext: () => Promise.reject(expired) });

    await waitFor(() => expect(screen.getByText('That link did not work')).toBeDefined());
    expect(screen.getByText(expired.message)).toBeDefined();
    expect(screen.queryByLabelText('New password')).toBeNull();
  });
});

describe('resetting with the recovery code', () => {
  it('passes the context it already has, so a wrong code costs no round trip', async () => {
    const { auth } = renderScreen();
    await waitForForm();

    fireEvent.change(codeField(), { target: { value: 'aaaaa-bbbbb-ccccc-ddddd' } });
    fireEvent.change(passwordField(), { target: { value: PASSWORD } });
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(auth.resetPasswordWithRecoveryCode).toHaveBeenCalledWith({
        token: 'a-token',
        recoveryCode: 'aaaaa-bbbbb-ccccc-ddddd',
        newPassword: PASSWORD,
        context: CONTEXT,
      }),
    );
    expect(auth.resetPasswordAndDiscardIdentity).not.toHaveBeenCalled();
  });

  it('will not submit a password the local rules reject', async () => {
    // The server cannot judge this, ever: it receives an authHash and a weak
    // password and a strong one look identical. If the check does not happen
    // here it does not happen.
    renderScreen();
    await waitForForm();

    fireEvent.change(codeField(), { target: { value: 'AAAAA' } });
    fireEvent.change(passwordField(), { target: { value: 'short' } });

    expect(submitButton().hasAttribute('disabled')).toBe(true);
  });

  it('shows the replacement code and waits to be told it was saved', async () => {
    const { onLeave } = renderScreen();
    await waitForForm();

    fireEvent.change(codeField(), { target: { value: 'AAAAA-BBBBB-CCCCC-DDDDD' } });
    fireEvent.change(passwordField(), { target: { value: PASSWORD } });
    fireEvent.click(submitButton());

    await waitFor(() => expect(screen.getByText('Your new recovery code')).toBeDefined());
    expect(screen.getByText('AAAAA-BBBBB-CCCCC-DDDDD')).toBeDefined();

    const continueButton = screen.getByRole('button', { name: 'Continue to sign in' });
    expect(continueButton.hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(continueButton);
    expect(onLeave).toHaveBeenCalled();
  });
});

describe('resetting without it', () => {
  it('is a decision, not a fallback', async () => {
    const { auth } = renderScreen();
    await waitForForm();

    fireEvent.click(screen.getByRole('button', { name: 'I do not have my recovery code' }));

    // The consequence is stated, and the button stays dead until it has been
    // acknowledged. Everything already in the account becomes unreadable here,
    // so an accidental click must not be enough.
    expect(
      screen.getByText(/stays sealed to the old\s+one, so it can never be read again/),
    ).toBeDefined();

    fireEvent.change(passwordField(), { target: { value: PASSWORD } });
    expect(submitButton().hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByRole('checkbox'));
    expect(submitButton().hasAttribute('disabled')).toBe(false);

    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(auth.resetPasswordAndDiscardIdentity).toHaveBeenCalledWith({
        token: 'a-token',
        // Taken from the context rather than typed: the auth salt comes from
        // the email, so a mistyped address would derive an authHash that
        // cannot sign in afterwards.
        email: EMAIL,
        newPassword: PASSWORD,
      }),
    );
    expect(auth.resetPasswordWithRecoveryCode).not.toHaveBeenCalled();
  });

  it('lets someone who finds their code go back to keeping their messages', async () => {
    renderScreen();
    await waitForForm();

    fireEvent.click(screen.getByRole('button', { name: 'I do not have my recovery code' }));
    expect(screen.queryByPlaceholderText('XXXXX-XXXXX-XXXXX-XXXXX')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'I found my recovery code after all' }));
    expect(codeField()).toBeDefined();
  });
});
