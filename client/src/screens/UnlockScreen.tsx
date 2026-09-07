/**
 * The screen a conventional app does not have.
 *
 * After a reload the server can restore the session, but the private key was
 * only ever in memory, so the user is signed in and cannot read a thing until
 * they type their password again. That is not a bug to design around, it is the
 * property the whole app rests on, so this screen asks plainly rather than
 * pretending to be a second login.
 */
import { useState, type FormEvent } from 'react';
import { PasswordField } from '../components/PasswordField';
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
        Signed in as {account?.email ?? 'this account'}. Enter your password to
        pick up where you left off.
      </p>

      <AuthErrorNote error={error} />

      <form onSubmit={submit}>
        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          disabled={busy}
          autoFocus
          required
        />

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
