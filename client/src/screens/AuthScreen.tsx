/**
 * Sign in and create account.
 *
 * The order of the create flow is not cosmetic. Registration deliberately does
 * not sign you in (see authService.register): it returns a recovery code that
 * exists nowhere else, not on the server, not in storage, not in this component
 * after the user leaves it. So the code is shown on its own step, behind an
 * explicit acknowledgement, before anything else can happen. Skipping that
 * screen would mean silently handing someone an account whose message history
 * dies with the first forgotten password.
 */
import { useState, type FormEvent } from 'react';
import { BrandMark } from '../components/BrandMark';
import { PasswordField } from '../components/PasswordField';
import { ApiError } from '../lib/api';
import { isDevelopment } from '../lib/config';
import { API_ERROR_CODES } from '../lib/api/types';
import type { Key } from '../lib/i18n/en';
import { checkPassword } from '../lib/session/passwordPolicy';
import { describeError, useT } from '../state/I18nProvider';
import { useSession } from '../state/SessionProvider';
import '../styles/auth.css';

type Mode = 'signin' | 'create' | 'forgot';
type Step = { kind: 'form' } | { kind: 'recovery'; code: string } | { kind: 'check-email' };

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('signin');
  const [step, setStep] = useState<Step>({ kind: 'form' });

  if (step.kind === 'recovery') {
    return <RecoveryCodeStep code={step.code} onDone={() => setStep({ kind: 'check-email' })} />;
  }

  if (step.kind === 'check-email') {
    return (
      <CheckEmailStep
        onSignIn={() => {
          setMode('signin');
          setStep({ kind: 'form' });
        }}
      />
    );
  }

  if (mode === 'forgot') {
    return <ForgotPasswordPanel onBack={() => setMode('signin')} />;
  }

  return mode === 'signin' ? (
    <SignInPanel onSwitch={() => setMode('create')} onForgot={() => setMode('forgot')} />
  ) : (
    <CreateAccountPanel
      onSwitch={() => setMode('signin')}
      onRegistered={(code) => setStep({ kind: 'recovery', code })}
    />
  );
}

/* ------------------------------------------------------------- shell ----- */

function Shell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="auth">
      <div className={wide ? 'auth-panel auth-panel--wide' : 'auth-panel'}>
        <div className="auth-brand">
          <BrandMark size={30} />
          <span className="auth-brand-name">Cipher</span>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Field-level messages come up alongside the summary when the server sends
 * them. Without this, a rejected username reads as "some of the values you
 * entered are not valid", which does not tell anyone which one or why.
 */
function ErrorNote({ error }: { error: unknown }) {
  const t = useT();
  if (!error) return null;

  // Server prose stays in the server's English. It arrives as a sentence
  // rather than as a code, so there is nothing to look up. See i18n-plan.md.
  const message = describeError(error, t);

  const details = error instanceof ApiError ? fieldMessages(error.details) : [];

  return (
    <div className="auth-error">
      <p className="auth-error__summary">{details.length === 1 ? details[0] : message}</p>
      {details.length > 1 && (
        <ul className="auth-error__fields">
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function fieldMessages(details: unknown): string[] {
  if (!Array.isArray(details)) return [];
  return details
    .map((entry) =>
      typeof entry === 'object' && entry !== null && typeof (entry as { message?: unknown }).message === 'string'
        ? (entry as { message: string }).message
        : null,
    )
    .filter((message): message is string => message !== null);
}

/* ------------------------------------------------------------ sign in ---- */

function SignInPanel({ onSwitch, onForgot }: { onSwitch: () => void; onForgot: () => void }) {
  const { login, busy, auth } = useSession();
  const t = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [resent, setResent] = useState(false);

  const unverified = error instanceof ApiError && error.code === API_ERROR_CODES.emailNotVerified;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setResent(false);
    try {
      await login({ email, password });
    } catch (caught) {
      setError(caught);
    }
  }

  async function resend() {
    try {
      await auth.resendVerification(email);
      setResent(true);
    } catch (caught) {
      setError(caught);
    }
  }

  return (
    <Shell>
      <h1 className="auth-title">{t('auth.signIn')}</h1>
      <p className="auth-lede">{t('auth.welcomeBack')}</p>

      <ErrorNote error={error} />
      {resent && <p className="auth-note">{t('auth.resent')}</p>}

      <form onSubmit={submit}>
        <label className="auth-field">
          <span className="auth-label">{t('auth.email')}</span>
          <input
            className="auth-input"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            required
          />
        </label>

        <PasswordField
          label={t('auth.password')}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          disabled={busy}
          required
        />

        <button className="auth-submit" type="submit" disabled={busy || !email || !password}>
          {t(busy ? 'auth.signingIn' : 'auth.signIn')}
        </button>
      </form>

      {unverified && (
        <button className="auth-secondary" type="button" onClick={resend} disabled={busy}>
          {t('auth.resend')}
        </button>
      )}

      <p className="auth-aside">
        <button type="button" onClick={onForgot}>
          {t('auth.forgot')}
        </button>
      </p>

      <p className="auth-switch">
        {t('auth.noAccount')}{' '}
        <button type="button" onClick={onSwitch}>
          {t('auth.createOne')}
        </button>
      </p>
    </Shell>
  );
}

/* ------------------------------------------------------ create account --- */

function CreateAccountPanel({
  onSwitch,
  onRegistered,
}: {
  onSwitch: () => void;
  onRegistered: (recoveryCode: string) => void;
}) {
  const { register, busy } = useSession();
  const t = useT();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);

  const strength = checkPassword(password, { email, username });
  const showProblems = password.length > 0 && !strength.ok;
  const canSubmit = !busy && Boolean(email && username) && strength.ok;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const { recoveryCode } = await register({ email, username, password });
      onRegistered(recoveryCode);
    } catch (caught) {
      setError(caught);
    }
  }

  return (
    <Shell>
      <h1 className="auth-title">{t('auth.create')}</h1>
      <p className="auth-lede">{t('auth.createLede')}</p>

      <ErrorNote error={error} />

      <form onSubmit={submit}>
        <label className="auth-field">
          <span className="auth-label">{t('auth.email')}</span>
          <input
            className="auth-input"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            required
          />
        </label>

        <label className="auth-field">
          <span className="auth-label">{t('auth.username')}</span>
          <input
            className="auth-input"
            type="text"
            autoComplete="nickname"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={busy}
            minLength={3}
            maxLength={32}
            required
          />
          <p className="auth-hint">{t('auth.usernameHint')}</p>
        </label>

        <PasswordField
          label={t('auth.password')}
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          disabled={busy}
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
          <p className="auth-hint">{t('auth.passwordWarn')}</p>
        </PasswordField>

        <button className="auth-submit" type="submit" disabled={!canSubmit}>
          {t(busy ? 'auth.settingUp' : 'auth.createButton')}
        </button>
      </form>

      <p className="auth-switch">
        {t('auth.haveAccount')}{' '}
        <button type="button" onClick={onSwitch}>
          {t('auth.signIn')}
        </button>
      </p>
    </Shell>
  );
}

/* ----------------------------------------------------- the recovery code -- */

/**
 * The one screen that shows a recovery code.
 *
 * Signup is not the only place a code is minted: a password reset spends the
 * old one and hands back a new one, and so does rotating it from settings. The
 * words around it change, the checkbox and the fact that this is the only time
 * anyone will ever see the value do not, so the panel is shared rather than
 * copied and left to drift.
 */
function RecoveryCodeStep({
  code,
  onDone,
  title = 'auth.recovery.title',
  lede = 'auth.recovery.lede',
  actionLabel = 'auth.continue',
}: {
  code: string;
  onDone: () => void;
  /* Catalogue keys, so the reset screen can substitute its own wording
     without either screen holding a sentence. */
  title?: Key;
  lede?: Key;
  actionLabel?: Key;
}) {
  const t = useT();
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <Shell wide>
      <h1 className="auth-title">{t(title)}</h1>
      <p className="auth-lede">{t(lede)}</p>

      <p className="auth-code">{code}</p>

      <p className="auth-warn">
        {t('auth.recovery.write')} <strong>{t('auth.recovery.withoutIt')}</strong>
      </p>

      <label className="auth-confirm">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
        />
        <span>{t('auth.recovery.confirm')}</span>
      </label>

      <button className="auth-submit" type="button" onClick={onDone} disabled={!acknowledged}>
        {t(actionLabel)}
      </button>
    </Shell>
  );
}

/* ---------------------------------------------------- forgot password ---- */

/**
 * Asking for a reset link.
 *
 * The server answers identically whether or not the address has an account, so
 * this screen cannot say "no such address" and does not pretend to. What it can
 * do is set the expectation the reset screen will hold the user to: the link
 * gets the account back, the recovery code is what gets the messages back.
 */
function ForgotPasswordPanel({ onBack }: { onBack: () => void }) {
  const { auth } = useSession();
  const t = useT();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setWorking(true);
    try {
      await auth.forgotPassword(email);
      setSent(true);
    } catch (caught) {
      setError(caught);
    } finally {
      setWorking(false);
    }
  }

  if (sent) {
    return (
      <Shell>
        <h1 className="auth-title">{t('auth.checkEmail')}</h1>
        <p className="auth-lede">{t('auth.resetSent', { email })}</p>
        <p className="auth-note">{t('auth.resetHaveCode')}</p>
        <button className="auth-submit" type="button" onClick={onBack}>
          {t('auth.backToSignIn')}
        </button>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="auth-title">{t('auth.forgotTitle')}</h1>
      <p className="auth-lede">{t('auth.forgotLede')}</p>

      <ErrorNote error={error} />

      <form onSubmit={submit}>
        <label className="auth-field">
          <span className="auth-label">{t('auth.email')}</span>
          <input
            className="auth-input"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={working}
            required
            autoFocus
          />
        </label>

        <button className="auth-submit" type="submit" disabled={working || !email}>
          {t(working ? 'account.sending' : 'auth.sendLink')}
        </button>
      </form>

      <p className="auth-aside">
        <button type="button" onClick={onBack}>
          {t('auth.backToSignIn')}
        </button>
      </p>
    </Shell>
  );
}

function CheckEmailStep({ onSignIn }: { onSignIn: () => void }) {
  const t = useT();
  return (
    <Shell>
      <h1 className="auth-title">{t('auth.checkEmail')}</h1>
      <p className="auth-lede">{t('auth.verifySent')}</p>
      {/* The local-mail hint is a developer affordance and reads as nonsense in
          front of a real user, who has no server/ directory. Vite drops the
          whole branch from the production bundle. What a real user actually
          needs is the spam prompt: a domain that has only just started sending
          gets filtered until it builds a reputation. */}
      {isDevelopment ? (
        <p className="auth-note">
          Running locally with <code>MAIL_TRANSPORT=file</code>? The email is a
          file in <code>server/.mail/</code>.
        </p>
      ) : (
        <p className="auth-note">{t('auth.checkSpam')}</p>
      )}
      <button className="auth-submit" type="button" onClick={onSignIn}>
        {t('auth.backToSignIn')}
      </button>
    </Shell>
  );
}

export {
  Shell as AuthShell,
  ErrorNote as AuthErrorNote,
  RecoveryCodeStep as AuthRecoveryCodeStep,
};
