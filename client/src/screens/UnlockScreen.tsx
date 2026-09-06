/**
 * The screen a conventional app does not have.
 *
 * After a reload the server can restore the session, but the private key was
 * only ever in memory — so the user is signed in and cannot read a thing until
 * they type their password again. That is not a bug to design around, it is the
 * property that makes "the server cannot read your messages" true, so this
 * screen says so rather than pretending to be a second login.
 */
import { useState, type FormEvent } from 'react';
import { useSession } from '../state/SessionProvider';
import { AuthErrorNote, AuthShell } from './AuthScreen';
import '../styles/auth.css';

export function UnlockScreen() {
  const { unlock, logout, account, busy } = useSession();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await unlock(password);
    } catch (caught) {
      setError(caught);
    }
  }

  return (
    <AuthShell>
      <h1 className="auth-title">Unlock your messages</h1>
      <p className="auth-lede">
        Signed in as {account?.email ?? 'this account'}. Your key is not in
        memory yet — nothing can be decrypted until you enter your password.
      </p>

      <AuthErrorNote error={error} />

      <form onSubmit={submit}>
        <label className="auth-field">
          <span className="auth-label">Password</span>
          <input
            className="auth-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            autoFocus
            required
          />
        </label>

        <button className="auth-submit" type="submit" disabled={busy || !password}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>

      <button className="auth-secondary" type="button" onClick={() => void logout()} disabled={busy}>
        Sign out instead
      </button>
    </AuthShell>
  );
}
