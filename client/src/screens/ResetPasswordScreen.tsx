/**
 * Landing screen for the link in the reset email
 * (`APP_URL/reset-password?token=…`, see server/src/lib/mailer.ts).
 *
 * This is the screen where the shape of the whole app becomes visible, so it is
 * worth being explicit about what it can and cannot do. The link proves control
 * of the inbox, and that is enough to get the account back: a new password, a
 * new authHash, sessions everywhere else revoked. It is not enough to get the
 * messages back. Those are readable only through a private key that is wrapped
 * under the recovery code, and the server has never held the code, so nobody
 * here can do anything with the link alone.
 *
 * Hence two paths, and hence the second one being a decision rather than a
 * fallback. Choosing it discards the keypair and every message already sealed
 * to it, permanently, which is the design working rather than failing. It is
 * behind its own confirmation for that reason.
 *
 * There is no router yet, so the path is matched by hand in AppRoot, the same
 * way the verification link is.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PasswordField } from '../components/PasswordField';
import type { ResetContextResponse } from '../lib/api/types';
import { checkPassword } from '../lib/session/passwordPolicy';
import { useT } from '../state/I18nProvider';
import { useSession } from '../state/SessionProvider';
import { AuthErrorNote, AuthRecoveryCodeStep, AuthShell } from './AuthScreen';
import '../styles/auth.css';

type State =
  | { kind: 'checking' }
  | { kind: 'unusable'; error: unknown }
  | { kind: 'form'; context: ResetContextResponse }
  | { kind: 'done'; code: string };

export function ResetPasswordScreen({
  token,
  onLeave,
}: {
  token: string;
  onLeave: () => void;
}) {
  const { auth } = useSession();
  const t = useT();
  const [state, setState] = useState<State>({ kind: 'checking' });

  // Fetching the context is what tells us the link is good, and it hands back
  // the email address the new authHash has to be derived under. A device that
  // has never held this account has no other way to learn it, and getting it
  // wrong would produce an authHash that cannot sign in.
  //
  // Fired exactly once, guarded the same way VerifyEmailScreen is and for the
  // same reason: StrictMode runs effects twice in development. Deliberately no
  // `cancelled` flag, see the note there for the bug that pairing the two
  // caused. Unlike verification this does not spend the token, so a duplicate
  // request would be harmless anyway.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void auth
      .resetContext(token)
      .then((context) => setState({ kind: 'form', context }))
      .catch((error: unknown) => setState({ kind: 'unusable', error }));
  }, [auth, token]);

  if (state.kind === 'checking') {
    return (
      <AuthShell>
        <h1 className="auth-title">{t('reset.checking')}</h1>
        <p className="auth-lede">{t('reset.oneMoment')}</p>
      </AuthShell>
    );
  }

  if (state.kind === 'unusable') {
    return (
      <AuthShell>
        <h1 className="auth-title">{t('reset.badLink')}</h1>
        <p className="auth-lede">{t('reset.badLinkLede')}</p>
        <AuthErrorNote error={state.error} />
        <button className="auth-submit" type="button" onClick={onLeave}>
          {t('reset.goToSignIn')}
        </button>
      </AuthShell>
    );
  }

  if (state.kind === 'done') {
    return (
      <AuthRecoveryCodeStep
        code={state.code}
        onDone={onLeave}
        title="reset.newCodeTitle"
        lede="reset.newCodeLede"
        actionLabel="reset.continueToSignIn"
      />
    );
  }

  return (
    <ResetForm
      token={token}
      context={state.context}
      onDone={(code) => setState({ kind: 'done', code })}
    />
  );
}

function ResetForm({
  token,
  context,
  onDone,
}: {
  token: string;
  context: ResetContextResponse;
  onDone: (recoveryCode: string) => void;
}) {
  const { auth } = useSession();
  const t = useT();
  const [path, setPath] = useState<'recovery' | 'discard'>('recovery');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [password, setPassword] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const strength = checkPassword(password, { email: context.email });
  const showProblems = password.length > 0 && !strength.ok;
  const canSubmit =
    !working &&
    strength.ok &&
    (path === 'recovery' ? recoveryCode.trim().length > 0 : understood);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setWorking(true);
    try {
      // Both calls do all their real work here on the device: unwrap, generate,
      // re-wrap. The server is sent an authHash and two opaque blobs, and the
      // recovery code itself never leaves this function.
      const result =
        path === 'recovery'
          ? await auth.resetPasswordWithRecoveryCode({
              token,
              recoveryCode,
              newPassword: password,
              // Already in hand, so a mistyped code costs no round trip: the
              // unwrap that catches it happens here.
              context,
            })
          : await auth.resetPasswordAndDiscardIdentity({
              token,
              email: context.email,
              newPassword: password,
            });
      onDone(result.recoveryCode);
    } catch (caught) {
      setError(caught);
    } finally {
      setWorking(false);
    }
  }

  function choosePath(next: 'recovery' | 'discard') {
    setPath(next);
    setError(null);
    setUnderstood(false);
  }

  return (
    <AuthShell wide>
      <h1 className="auth-title">{t('reset.title')}</h1>
      <p className="auth-lede">{t('reset.forEmail', { email: context.email })}</p>

      <AuthErrorNote error={error} />

      <form onSubmit={submit}>
        {path === 'recovery' ? (
          <label className="auth-field">
            <span className="auth-label">{t('reset.recoveryCode')}</span>
            <input
              className="auth-input auth-input--code"
              type="text"
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={working}
              required
              autoFocus
            />
            <p className="auth-hint">{t('reset.recoveryCodeHint')}</p>
          </label>
        ) : (
          <>
            <p className="auth-warn">
              {t('reset.discardLead')} <strong>{t('reset.discardWarn')}</strong>{' '}
              {t('reset.discardKeeps')}
            </p>

            <label className="auth-confirm">
              <input
                type="checkbox"
                checked={understood}
                onChange={(e) => setUnderstood(e.target.checked)}
                disabled={working}
              />
              <span>{t('reset.discardConfirm')}</span>
            </label>
          </>
        )}

        <PasswordField
          label={t('account.newPassword')}
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          disabled={working}
          required
        >
          <div className="auth-meter" aria-hidden="true">
            {[0, 1, 2, 3].map((index) => (
              <span
                key={index}
                className="auth-meter-seg"
                data-on={password.length > 0 && index < strength.score}
                data-strong={strength.score >= 3}
              />
            ))}
          </div>
          {showProblems && (
            <ul className="auth-problems">
              {strength.problems.map((problem) => (
                <li key={problem.key}>{t(problem)}</li>
              ))}
            </ul>
          )}
        </PasswordField>

        <button className="auth-submit" type="submit" disabled={!canSubmit}>
          {t(working ? 'reset.settingUp' : 'reset.setPassword')}
        </button>
      </form>

      <p className="auth-aside">
        {path === 'recovery' ? (
          <button type="button" onClick={() => choosePath('discard')} disabled={working}>
            {t('reset.noCode')}
          </button>
        ) : (
          <button type="button" onClick={() => choosePath('recovery')} disabled={working}>
            {t('reset.foundCode')}
          </button>
        )}
      </p>
    </AuthShell>
  );
}
