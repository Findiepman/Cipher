/**
 * Who is signed in, and the two ways out.
 *
 * "Lock" and "Sign out" are genuinely different and both are offered: locking
 * drops the private key from memory but leaves the device enrolled, while
 * signing out also throws away the wrapped blob, so the next sign-in has to
 * fetch it from the server again.
 */
import { useT } from '../state/I18nProvider';
import { useSession } from '../state/SessionProvider';
import '../styles/auth.css';

export function AccountStrip() {
  const { account, lock, logout, busy } = useSession();
  const t = useT();

  return (
    <div className="account-strip">
      <span className="account-strip-who">
        {t('strip.signedInAs')}{' '}
        <strong>{account?.username ?? account?.email ?? t('strip.thisAccount')}</strong>
      </span>

      <span className="account-strip-spacer" />

      <button type="button" onClick={lock} disabled={busy}>
        {t('settings.lock')}
      </button>
      <button type="button" onClick={() => void logout()} disabled={busy}>
        {t('settings.signOut')}
      </button>
    </div>
  );
}
