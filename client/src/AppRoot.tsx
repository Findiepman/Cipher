/**
 * What the session state machine actually puts on screen.
 *
 * SessionProvider's four states map one-to-one onto four screens, and the third
 * one is the reason this file exists rather than a plain `account ? app :
 * login`: `locked` means signed in but unable to read anything, which only an
 * end-to-end encrypted app has to render.
 *
 *   loading       → a holding screen, one paint long
 *   anonymous     → sign in / create account
 *   locked        → unlock (the key is not in memory)
 *   authenticated → the app
 */
import { useCallback, useState } from 'react';
import App from './App';
import { AccountStrip } from './components/AccountStrip';
import { LoadingScreen } from './components/LoadingScreen';
import { AuthScreen } from './screens/AuthScreen';
import { ChangeEmailScreen } from './screens/ChangeEmailScreen';
import { NotFoundScreen } from './screens/NotFoundScreen';
import { ResetPasswordScreen } from './screens/ResetPasswordScreen';
import { UnlockScreen } from './screens/UnlockScreen';
import { VerifyEmailScreen } from './screens/VerifyEmailScreen';
import { CallProvider } from './state/CallProvider';
import { ChatProvider } from './state/ChatProvider';
import { ProfileSync } from './state/ProfileSync';
import { SettingsSync } from './state/SettingsSync';
import { VaultProvider } from './state/VaultProvider';
import { BOOT_LABELS, BOOT_STEPS, useSession } from './state/SessionProvider';
import './styles/auth.css';

/**
 * Every path this app answers to. Anything else is a 404, which is only worth
 * stating because without the list an unknown path silently renders the chat
 * app and looks like it worked.
 *
 * The deep links stay in here even though they are also matched by hand
 * below: a link whose token has already been spent still lands on a real
 * screen that can explain itself, rather than on "no such address".
 */
const KNOWN_PATHS = new Set(['/', '/verify-email', '/reset-password', '/change-email']);

/**
 * Exported so the routing rule can be tested without mounting the app, which
 * needs a session, a socket and a key. A trailing slash is the same address as
 * far as anyone typing one is concerned.
 */
export function isKnownPath(pathname: string): boolean {
  if (KNOWN_PATHS.has(pathname)) return true;
  return pathname.endsWith('/') && KNOWN_PATHS.has(pathname.slice(0, -1));
}

/** No router yet: the two deep links that exist are matched by hand. */
function readVerifyToken(): string | null {
  if (typeof window === 'undefined') return null;
  if (window.location.pathname !== '/verify-email') return null;
  return new URLSearchParams(window.location.search).get('token');
}

function readResetToken(): string | null {
  if (typeof window === 'undefined') return null;
  if (window.location.pathname !== '/reset-password') return null;
  return new URLSearchParams(window.location.search).get('token');
}

function readChangeEmailToken(): string | null {
  if (typeof window === 'undefined') return null;
  if (window.location.pathname !== '/change-email') return null;
  return new URLSearchParams(window.location.search).get('token');
}

export function AppRoot() {
  const { status, bootStage } = useSession();
  const [verifyToken, setVerifyToken] = useState(readVerifyToken);
  const [resetToken, setResetToken] = useState(readResetToken);
  const [changeEmailToken, setChangeEmailToken] = useState(readChangeEmailToken);

  const leaveVerify = useCallback(() => {
    // Drop the single-use token from the address bar so a reload does not
    // re-submit it and report a failure for something that worked.
    window.history.replaceState(null, '', '/');
    setVerifyToken(null);
  }, []);

  const leaveReset = useCallback(() => {
    window.history.replaceState(null, '', '/');
    setResetToken(null);
  }, []);

  const leaveChangeEmail = useCallback(() => {
    window.history.replaceState(null, '', '/');
    setChangeEmailToken(null);
  }, []);

  if (verifyToken) {
    return <VerifyEmailScreen token={verifyToken} onContinue={leaveVerify} />;
  }

  // Also ahead of the status switch, but this one needs a session: the screen
  // itself says so and waits, rather than this file bouncing to sign in and
  // losing the link. The first paint is still the loading screen below, so
  // a reload does not flash "sign in first" at somebody who is signed in.
  if (changeEmailToken && status !== 'loading') {
    return <ChangeEmailScreen token={changeEmailToken} onLeave={leaveChangeEmail} />;
  }

  // Ahead of the status switch, like verification, so the link works whatever
  // state this tab happens to be in. A completed reset revokes every session
  // the account had, so a tab that was signed in lands back on sign in as soon
  // as it next asks the server for anything.
  if (resetToken) {
    return <ResetPasswordScreen token={resetToken} onLeave={leaveReset} />;
  }

  // Checked before the session states below: an address that does not exist is
  // not a reason to ask someone to sign in first.
  if (typeof window !== 'undefined' && !isKnownPath(window.location.pathname)) {
    return <NotFoundScreen />;
  }

  // The first paint on every reload, so it is the one screen guaranteed to be
  // seen. Bare text here made the app look like it had not started yet.
  if (status === 'loading') {
    return (
      <LoadingScreen
        tone="boot"
        detail={BOOT_LABELS[bootStage]}
        // The last step is 'ready', so the denominator is the number of steps
        // that involve actually waiting for something.
        progress={BOOT_STEPS.indexOf(bootStage) / (BOOT_STEPS.length - 1)}
      />
    );
  }

  if (status === 'anonymous') return <AuthScreen />;
  if (status === 'locked') return <UnlockScreen />;

  // ChatProvider is mounted only here, inside `authenticated`, because it opens
  // a socket and needs the unwrapped private key. Mounting it any higher would
  // mean starting a chat session for someone who cannot read anything yet.
  // CallProvider sits inside it because call signalling rides that socket.
  return (
    <div className="app-shell">
      <AccountStrip />
      {/* Draw nothing: they keep the account's copy of your settings equal to
          this device's. ProfileSync owns the friend-facing profile; SettingsSync
          owns everything else, the whole settings blob. Here rather than higher
          up because they need the account, and there is none until this branch. */}
      <ProfileSync />
      <SettingsSync />
      <ChatProvider>
        <CallProvider>
          {/* Inside `authenticated` like the rest: the vault is keyed to an
              account, and its own lock sits behind the session's. */}
          <VaultProvider>
            <App />
          </VaultProvider>
        </CallProvider>
      </ChatProvider>
    </div>
  );
}
