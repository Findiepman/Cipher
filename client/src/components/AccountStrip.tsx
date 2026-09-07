/**
 * Who is signed in, and the two ways out.
 *
 * "Lock" and "Sign out" are genuinely different and both are offered: locking
 * drops the private key from memory but leaves the device enrolled, while
 * signing out also throws away the wrapped blob, so the next sign-in has to
 * fetch it from the server again.
 */
import { useSession } from '../state/SessionProvider';
import '../styles/auth.css';

export function AccountStrip() {
  const { account, lock, logout, busy } = useSession();

  return (
    <div className="account-strip">
      <span className="account-strip-who">
        Signed in as <strong>{account?.username ?? account?.email ?? 'this account'}</strong>
      </span>

      <span className="account-strip-spacer" />

      <button type="button" onClick={lock} disabled={busy}>
        Lock
      </button>
      <button type="button" onClick={() => void logout()} disabled={busy}>
        Sign out
      </button>
    </div>
  );
}
