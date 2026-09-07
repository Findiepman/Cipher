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
import { BrandMark } from './components/BrandMark';
import { AuthScreen } from './screens/AuthScreen';
import { ResetPasswordScreen } from './screens/ResetPasswordScreen';
import { UnlockScreen } from './screens/UnlockScreen';
import { VerifyEmailScreen } from './screens/VerifyEmailScreen';
import { ChatProvider } from './state/ChatProvider';
import { useSession } from './state/SessionProvider';
import './styles/auth.css';

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

export function AppRoot() {
  const { status } = useSession();
  const [verifyToken, setVerifyToken] = useState(readVerifyToken);
  const [resetToken, setResetToken] = useState(readResetToken);

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

  if (verifyToken) {
    return <VerifyEmailScreen token={verifyToken} onContinue={leaveVerify} />;
  }

  // Ahead of the status switch, like verification, so the link works whatever
  // state this tab happens to be in. A completed reset revokes every session
  // the account had, so a tab that was signed in lands back on sign in as soon
  // as it next asks the server for anything.
  if (resetToken) {
    return <ResetPasswordScreen token={resetToken} onLeave={leaveReset} />;
  }

  // The first paint on every reload, so it is the one screen guaranteed to be
  // seen. Bare text here made the app look like it had not started yet.
  if (status === 'loading') {
    return (
      <div className="auth-centered">
        <div className="auth-splash">
          <BrandMark size={44} label="Cipher" />
          <span>Loading…</span>
        </div>
      </div>
    );
  }

  if (status === 'anonymous') return <AuthScreen />;
  if (status === 'locked') return <UnlockScreen />;

  // ChatProvider is mounted only here, inside `authenticated`, because it opens
  // a socket and needs the unwrapped private key. Mounting it any higher would
  // mean starting a chat session for someone who cannot read anything yet.
  return (
    <div className="app-shell">
      <AccountStrip />
      <ChatProvider>
        <App />
      </ChatProvider>
    </div>
  );
}
