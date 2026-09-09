/**
 * Landing screen for the link in the email-change confirmation
 * (`APP_URL/change-email?token=…`, see server/src/lib/mailer.ts).
 *
 * Unlike the verification and reset links this one needs you signed in: the
 * server only honours a token for the account that asked, and the client has
 * work of its own to do. The sign-in key is derived from the email address,
 * so moving the account means deriving a new one under the new address, and
 * that takes the password, typed here. The wrapped key blobs carry their own
 * salts and are untouched, which is why no re-wrapping happens and the
 * recovery code keeps working.
 *
 * The address is asked of the server first rather than carried in the link,
 * so a link opened on a device that never saw the request still knows what
 * it is confirming, and so a dead link is found out before anyone types a
 * password. Asking does not spend the token; only confirming does.
 *
 * No router yet, so the path is matched by hand in AppRoot like the others.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PasswordField } from '../components/PasswordField';
import { useT } from '../state/I18nProvider';
import { useSession } from '../state/SessionProvider';
import { AuthErrorNote, AuthShell } from './AuthScreen';
import '../styles/auth.css';

type State =
  | { kind: 'checking' }
  | { kind: 'unusable'; error: unknown }
  | { kind: 'form'; newEmail: string }
  | { kind: 'done'; newEmail: string };

export function ChangeEmailScreen({ token, onLeave }: { token: string; onLeave: () => void }) {
  const { auth, status, refresh } = useSession();
  const t = useT();
  const [state, setState] = useState<State>({ kind: 'checking' });
  const [password, setPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const signedIn = status === 'locked' || status === 'authenticated';

  // Fired once, guarded the way VerifyEmailScreen is and for the same reason
  // (StrictMode runs effects twice). Harmless to repeat, since this does not
  // spend the token, but one request is still the right number.
  const started = useRef(false);

  useEffect(() => {
    if (!signedIn || started.current) return;
    started.current = true;

    void auth
      .changeEmailContext(token)
      .then(({ newEmail }) => setState({ kind: 'form', newEmail }))
      .catch((caught: unknown) => setState({ kind: 'unusable', error: caught }));
  }, [auth, signedIn, token]);

  if (!signedIn) {
    return (
      <AuthShell>
        <h1 className="auth-title">{t('changeEmail.title')}</h1>
        <p className="auth-lede">{t('changeEmail.signedOut')}</p>
        <button className="auth-submit" type="button" onClick={onLeave}>
          {t('changeEmail.back')}
        </button>
      </AuthShell>
    );
  }

  if (state.kind === 'checking') {
    return (
      <AuthShell>
        <h1 className="auth-title">{t('changeEmail.checking')}</h1>
        <p className="auth-lede">{t('reset.oneMoment')}</p>
      </AuthShell>
    );
  }

  if (state.kind === 'unusable') {
    return (
      <AuthShell>
        <h1 className="auth-title">{t('reset.badLink')}</h1>
        <p className="auth-lede">{t('changeEmail.badLinkLede')}</p>
        <AuthErrorNote error={state.error} />
        <button className="auth-submit" type="button" onClick={onLeave}>
          {t('changeEmail.back')}
        </button>
      </AuthShell>
    );
  }

  if (state.kind === 'done') {
    return (
      <AuthShell>
        <h1 className="auth-title">{t('changeEmail.done')}</h1>
        <p className="auth-lede">{t('changeEmail.doneLede', { email: state.newEmail })}</p>
        <button className="auth-submit" type="button" onClick={onLeave}>
          {t('changeEmail.back')}
        </button>
      </AuthShell>
    );
  }

  const { newEmail } = state;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setWorking(true);
    setError(null);
    try {
      await auth.confirmEmailChange(token, newEmail, password);
      setPassword('');
      // The account strip and the settings screen read the address off the
      // session, so it has to be re-read before anyone looks.
      await refresh().catch(() => {});
      setState({ kind: 'done', newEmail });
    } catch (caught) {
      setError(caught);
    } finally {
      setWorking(false);
    }
  }

  return (
    <AuthShell>
      <h1 className="auth-title">{t('changeEmail.title')}</h1>
      <p className="auth-lede">{t('changeEmail.lede', { email: newEmail })}</p>

      <form onSubmit={submit}>
        <PasswordField
          label={t('account.password')}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          disabled={working}
          autoFocus
          required
        />

        {error !== null && <AuthErrorNote error={error} />}

        <button className="auth-submit" type="submit" disabled={working || password.length === 0}>
          {t(working ? 'changeEmail.confirming' : 'changeEmail.confirm')}
        </button>
      </form>
    </AuthShell>
  );
}
