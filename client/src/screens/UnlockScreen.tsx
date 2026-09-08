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
import { useT } from '../state/I18nProvider';
import { useSession } from '../state/SessionProvider';
import { AuthErrorNote, AuthShell } from './AuthScreen';
import '../styles/auth.css';

export function UnlockScreen() {
  const { unlock, logout, account, busy } = useSession();
  const t = useT();
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
      <h1 className="auth-title">{t('unlock.title')}</h1>
      <p className="auth-lede">
        {t('unlock.lede', { account: account?.email ?? t('strip.thisAccount') })}
      </p>

      <AuthErrorNote error={error} />

      <form onSubmit={submit}>
        <PasswordField
          label={t('auth.password')}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          disabled={busy}
          autoFocus
          required
        />

        <button className="auth-submit" type="submit" disabled={busy || !password}>
          {t(busy ? 'unlock.unlocking' : 'unlock.go')}
        </button>
      </form>

      <button className="auth-secondary" type="button" onClick={() => void logout()} disabled={busy}>
        {t('unlock.signOutInstead')}
      </button>
    </AuthShell>
  );
}
