/**
 * Sign in and create account.
 *
 * The order of the create flow is not cosmetic. Registration deliberately does
 * not sign you in (see authService.register): it returns a recovery code that
 * exists nowhere else — not on the server, not in storage, not in this
 * component after the user leaves it. So the code is shown on its own step,
 * behind an explicit acknowledgement, before anything else can happen. Skipping
 * that screen would mean silently handing someone an account whose message
 * history dies with the first forgotten password.
 */
import { useState, type FormEvent } from 'react';
import { ApiError } from '../lib/api';
import { API_ERROR_CODES } from '../lib/api/types';
import { checkPassword } from '../lib/session/passwordPolicy';
import { useSession } from '../state/SessionProvider';
import '../styles/auth.css';

type Mode = 'signin' | 'create';
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

  return mode === 'signin' ? (
    <SignInPanel onSwitch={() => setMode('create')} />
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
          <img className="auth-brand-mark" src="/logo.png" alt="" width={30} height={30} />
          <span className="auth-brand-name">Cipher</span>
        </div>
        {children}
      </div>
    </div>
  );
}

function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const message =
    error instanceof ApiError || error instanceof Error
      ? error.message
      : 'Something went wrong.';
  return <p className="auth-error">{message}</p>;
}

/* ------------------------------------------------------------ sign in ---- */

function SignInPanel({ onSwitch }: { onSwitch: () => void }) {
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
      <p className="auth-lede">
        Your password never leaves this device. It unlocks the key your messages
        are encrypted with, here, after the server has answered.
      </p>

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

        <label className="auth-field">
          <span className="auth-label">Password</span>
          <input
            className="auth-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            required
          />
        </label>

        <button className="auth-submit" type="submit" disabled={busy || !email || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      {unverified && (
        <button className="auth-secondary" type="button" onClick={resend} disabled={busy}>
          Resend the verification email
        </button>
      )}

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
      <p className="auth-lede">
        A keypair is generated on this device as you sign up. The private half is
        sealed with your password before it is stored, so the server holds it
        without ever being able to open it.
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
          <p className="auth-hint">Letters, numbers, and single . _ - between them.</p>
        </label>

        <label className="auth-field">
          <span className="auth-label">Password</span>
          <input
            className="auth-input"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            required
          />
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
        </label>

        <button className="auth-submit" type="submit" disabled={!canSubmit}>
          {busy ? 'Creating your keys…' : 'Create account'}
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

function RecoveryCodeStep({ code, onDone }: { code: string; onDone: () => void }) {
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <Shell wide>
      <h1 className="auth-title">Save your recovery code</h1>
      <p className="auth-lede">
        This is shown once. It is the only way back into your messages if you
        forget your password — the server has never seen it and cannot send it
        to you.
      </p>

      <p className="auth-code">{code}</p>

      <p className="auth-warn">
        Write it down somewhere physical, or put it in a password manager.{' '}
        <strong>Without it, a forgotten password means every message you have
        ever received stays encrypted forever.</strong>{' '}
        That is the trade for a server that cannot read your conversations.
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
        Continue
      </button>
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
      <p className="auth-note">
        Running locally with <code>MAIL_TRANSPORT=file</code>? The email is a
        file in <code>server/.mail/</code>.
      </p>
      <button className="auth-submit" type="button" onClick={onSignIn}>
        Back to sign in
      </button>
    </Shell>
  );
}

export { Shell as AuthShell, ErrorNote as AuthErrorNote };
