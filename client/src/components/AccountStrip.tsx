/**
 * Who is signed in, which key they are holding, and the two ways out.
 *
 * "Lock" and "Sign out" are genuinely different and both are offered: locking
 * drops the private key from memory but leaves the device enrolled, while
 * signing out also throws away the wrapped blob, so the next sign-in has to
 * fetch it from the server again.
 */
import { useEffect, useState } from 'react';
import { keyManager } from '../lib/session/keyManager';
import { useSession } from '../state/SessionProvider';
import '../styles/auth.css';

export function AccountStrip() {
  const { account, lock, logout, busy, keyState } = useSession();
  const [fingerprint, setFingerprint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void keyManager.fingerprint().then((value) => {
      if (!cancelled) setFingerprint(value);
    });
    return () => {
      cancelled = true;
    };
  }, [keyState]);

  return (
    <div className="account-strip">
      <span className="account-strip-who">
        Signed in as <strong>{account?.username ?? account?.email ?? '—'}</strong>
      </span>

      {fingerprint && (
        // The security number. Shown short here; the full one belongs in a
        // verification screen where two people compare it out of band.
        <span className="account-strip-key" title={`Security number: ${fingerprint}`}>
          key {fingerprint.split(' ').slice(0, 2).join(' ')}
        </span>
      )}

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
