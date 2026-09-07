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
import { checkPassword } from '../lib/session/passwordPolicy';
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
  if (!error) return null;

  const message =
    error instanceof ApiError || error instanceof Error
      ? error.message
      : 'Something went wrong.';

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
      <h1 className="auth-title">Sign in</h1>
      <p className="auth-lede">Welcome back.</p>

      <ErrorNote error={error} />
      {resent && <p className="auth-note">Sent. Check your inbox for a new link.</p>}

      <form onSubmit={submit}>
        <label className="auth-field">
          <span className="auth-label">Email</span>
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
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          disabled={busy}
          required
        />

        <button className="auth-submit" type="submit" disabled={busy || !email || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      {unverified && (
        <button className="auth-secondary" type="button" onClick={resend} disabled={busy}>
          Resend the verification email
        </button>
      )}

      <p className="auth-aside">
        <button type="button" onClick={onForgot}>
          Forgot your password?
        </button>
      </p>

      <p className="auth-switch">
        No account yet?{' '}
        <button type="button" onClick={onSwitch}>
          Create one
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
      <h1 className="auth-title">Create an account</h1>
      <p className="auth-lede">Pick a handle people can find you by, and a password.</p>

      <ErrorNote error={error} />

      <form onSubmit={submit}>
        <label className="auth-field">
          <span className="auth-label">Email</span>
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
          <span className="auth-label">Username</span>
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
          <p className="auth-hint">Letters, numbers and single . _ - between them.</p>
        </label>

        <PasswordField
          label="Password"
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
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
          <p className="auth-hint">
            There is no password reset that keeps your messages. Choose something
            you will still have in a year.
          </p>
        </PasswordField>

        <button className="auth-submit" type="submit" disabled={!canSubmit}>
          {busy ? 'Setting things up…' : 'Create account'}
        </button>
      </form>

      <p className="auth-switch">
        Already have an account?{' '}
        <button type="button" onClick={onSwitch}>
          Sign in
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
  title = 'Save your recovery code',
  lede = 'This is shown once, and it is the only way back into your messages if you forget your password. Nobody can send it to you later.',
  actionLabel = 'Continue',
}: {
  code: string;
  onDone: () => void;
  title?: string;
  lede?: string;
  actionLabel?: string;
}) {
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <Shell wide>
      <h1 className="auth-title">{title}</h1>
      <p className="auth-lede">{lede}</p>

      <p className="auth-code">{code}</p>

      <p className="auth-warn">
        Write it down somewhere physical, or put it in a password manager.{' '}
        <strong>Without it, a forgotten password means losing every message you
        have ever received.</strong>
      </p>

      <label className="auth-confirm">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
        />
        <span>I have saved this code somewhere I will still have it later.</span>
      </label>

      <button className="auth-submit" type="button" onClick={onDone} disabled={!acknowledged}>
        {actionLabel}
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
        <h1 className="auth-title">Check your email</h1>
        <p className="auth-lede">
          If there is an account for {email}, a link to set a new password is on
          its way. It works once and expires in an hour.
        </p>
        <p className="auth-note">
          Have your recovery code ready. It is the only thing that can carry your
          existing messages over to the new password, and nobody here can send it
          to you.
        </p>
        <button className="auth-submit" type="button" onClick={onBack}>
          Back to sign in
        </button>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="auth-title">Forgot your password</h1>
      <p className="auth-lede">
        Give us the address on the account and we will send a link to set a new
        password.
      </p>

      <ErrorNote error={error} />

      <form onSubmit={submit}>
        <label className="auth-field">
          <span className="auth-label">Email</span>
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
          {working ? 'Sending…' : 'Send the link'}
        </button>
      </form>

      <p className="auth-aside">
        <button type="button" onClick={onBack}>
          Back to sign in
        </button>
      </p>
    </Shell>
  );
}

function CheckEmailStep({ onSignIn }: { onSignIn: () => void }) {
  return (
    <Shell>
      <h1 className="auth-title">Check your email</h1>
      <p className="auth-lede">
        We have sent a verification link. Open it, then come back and sign in.
      </p>
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
        <p className="auth-note">
          Not there within a minute? Check your spam folder, it usually is at
          first.
        </p>
      )}
      <button className="auth-submit" type="button" onClick={onSignIn}>
        Back to sign in
      </button>
    </Shell>
  );
}

export {
  Shell as AuthShell,
  ErrorNote as AuthErrorNote,
  RecoveryCodeStep as AuthRecoveryCodeStep,
};
