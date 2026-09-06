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
import { AuthScreen } from './screens/AuthScreen';
import { UnlockScreen } from './screens/UnlockScreen';
import { VerifyEmailScreen } from './screens/VerifyEmailScreen';
import { isMockBackend } from './lib/config';
import { useSession } from './state/SessionProvider';
import './styles/auth.css';

/** No router yet: the one deep link that exists is matched by hand. */
function readVerifyToken(): string | null {
  if (typeof window === 'undefined') return null;
  if (window.location.pathname !== '/verify-email') return null;
  return new URLSearchParams(window.location.search).get('token');
}

export function AppRoot() {
  const { status } = useSession();
  const [verifyToken, setVerifyToken] = useState(readVerifyToken);

  const leaveVerify = useCallback(() => {
    // Drop the single-use token from the address bar so a reload does not
    // re-submit it and report a failure for something that worked.
    window.history.replaceState(null, '', '/');
    setVerifyToken(null);
  }, []);

  if (verifyToken) {
    return <VerifyEmailScreen token={verifyToken} onContinue={leaveVerify} />;
  }

  // VITE_BACKEND=mock has no server to sign in against, so the chat UI is
  // shown straight away off its fixtures. Everything below needs a real one.
  if (isMockBackend) return <App />;

  if (status === 'loading') {
    return <div className="auth-centered">Loading…</div>;
  }

  if (status === 'anonymous') return <AuthScreen />;
  if (status === 'locked') return <UnlockScreen />;

  return (
    <div className="app-shell">
      <AccountStrip />
      <App />
    </div>
  );
}
