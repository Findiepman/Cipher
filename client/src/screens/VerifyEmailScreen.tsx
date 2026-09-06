/**
 * Landing screen for the link in the verification email
 * (`APP_URL/verify-email?token=…`, see server/src/lib/mailer.ts).
 *
 * There is no router in this app yet, so the path is matched by hand in
 * AppRoot. When one arrives this becomes a route; nothing else about it changes.
 */
import { useEffect, useRef, useState } from 'react';
import { useSession } from '../state/SessionProvider';
import { AuthErrorNote, AuthShell } from './AuthScreen';
import '../styles/auth.css';

type State = { kind: 'working' } | { kind: 'done' } | { kind: 'failed'; error: unknown };

export function VerifyEmailScreen({ token, onContinue }: { token: string; onContinue: () => void }) {
  const { auth } = useSession();
  const [state, setState] = useState<State>({ kind: 'working' });
  // The token is single-use, so this must fire exactly once. StrictMode
  // double-invokes effects in development and a reload would re-submit a token
  // that has already been spent, so both are guarded: the ref stops the second
  // effect, and the URL is rewritten the moment the request goes out.
  //
  // Note there is deliberately no `cancelled` flag here. Pairing one with the
  // ref guard is what broke this before: the cleanup between StrictMode's two
  // effect runs set it, the second run returned early without clearing it, and
  // the in-flight response was then discarded against a closure that already
  // considered itself cancelled - verifying the address and leaving the screen
  // on "Verifying..." forever. A setState after unmount is a no-op in React 18+
  // and is the lesser problem by far.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '/verify-email');
    }

    void auth
      .verifyEmail(token)
      .then(() => setState({ kind: 'done' }))
      .catch((error: unknown) => setState({ kind: 'failed', error }));
  }, [auth, token]);

  return (
    <AuthShell>
      {state.kind === 'working' && (
        <>
          <h1 className="auth-title">Verifying…</h1>
          <p className="auth-lede">One moment.</p>
        </>
      )}

      {state.kind === 'done' && (
        <>
          <h1 className="auth-title">Email verified</h1>
          <p className="auth-lede">Your address is confirmed. You can sign in now.</p>
          <button className="auth-submit" type="button" onClick={onContinue}>
            Continue to sign in
          </button>
        </>
      )}

      {state.kind === 'failed' && (
        <>
          <h1 className="auth-title">That link did not work</h1>
          <p className="auth-lede">
            Most likely it has already been used — verification links work once
            and then expire, so if you have opened this one before, your address
            is verified and you can just sign in. Otherwise ask for a new link
            from the sign-in screen; links also expire after 24 hours.
          </p>
          <AuthErrorNote error={state.error} />
          <button className="auth-submit" type="button" onClick={onContinue}>
            Go to sign in
          </button>
        </>
      )}
    </AuthShell>
  );
}
