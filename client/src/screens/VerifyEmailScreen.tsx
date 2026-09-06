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
  // StrictMode double-invokes effects in development, and the token is
  // single-use: the second call would always fail and show an error for a
  // verification that actually succeeded.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    let cancelled = false;
    void auth
      .verifyEmail(token)
      .then(() => {
        if (!cancelled) setState({ kind: 'done' });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ kind: 'failed', error });
      });

    return () => {
      cancelled = true;
    };
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
            Verification links expire after 24 hours and can only be used once.
            If you have already verified, just sign in.
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
