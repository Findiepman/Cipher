/**
 * The account itself: the things the server actually knows about you, and the
 * one action that ends it.
 *
 * Each form is deliberately its own small transaction with its own busy state
 * and its own result line. Bundling them behind one "Save changes" button would
 * mean a failed email change could roll back a successful password change, and
 * a password change here is not a form submission, it re-wraps the private key
 * (see AuthService.changePassword). It either happens completely or not at all.
 */
import { useState, type FormEvent, type ReactNode } from 'react';
import { Actions, Group, Note, Row, TextField } from '../../components/settings/controls';
import { ApiError } from '../../lib/api';
import { checkPassword } from '../../lib/session/passwordPolicy';
import { useSession } from '../../state/SessionProvider';

export function AccountSection() {
  const { account } = useSession();

  if (!account) {
    return (
      <Note tone="warn">
        You are not signed in to a server, so there is no account to change.
        Everything else in settings still works: it all belongs to this device.
      </Note>
    );
  }

  return (
    <>
      <Group title="account">
        <Row label="Username" hint="How you are addressed. Visible to anyone you talk to.">
          <span className="set-value">{account.username}</span>
        </Row>
        <Row
          label="Email"
          hint={
            account.emailVerifiedAt
              ? 'Used to sign in, and to reach you if you ever lose your password.'
              : 'Not verified yet.'
          }
        >
          <span className="set-value">
            {account.email}
            {!account.emailVerifiedAt && <span className="set-flag">unverified</span>}
          </span>
        </Row>
        <Row label="Member since">
          <span className="set-value mono">{formatDate(account.createdAt)}</span>
        </Row>
        {account.lastLoginAt && (
          <Row label="Last sign-in">
            <span className="set-value mono">{formatDate(account.lastLoginAt)}</span>
          </Row>
        )}
      </Group>

      <UsernameForm current={account.username} />
      <EmailForm current={account.email} />
      <PasswordForm email={account.email} username={account.username} />
      <DeleteAccount email={account.email} />
    </>
  );
}

/* ------------------------------------------------------------- username --- */

function UsernameForm({ current }: { current: string }) {
  const { auth, refresh } = useSession();
  const form = useAsyncForm();
  const [username, setUsername] = useState(current);

  const changed = username.trim() !== current && username.trim().length > 0;

  return (
    <Group title="change username">
      <form
        onSubmit={form.submit(async () => {
          await auth.updateProfile({ username: username.trim() });
          await refresh();
          return 'Username updated.';
        })}
      >
        <TextField
          label="New username"
          value={username}
          maxLength={32}
          onChange={setUsername}
          autoComplete="username"
          disabled={form.busy}
        />
        <Actions>
          <button type="submit" className="set-btn" disabled={!changed || form.busy}>
            {form.busy ? 'Saving…' : 'Save'}
          </button>
        </Actions>
        {form.result}
      </form>
    </Group>
  );
}

/* ---------------------------------------------------------------- email --- */

function EmailForm({ current }: { current: string }) {
  const { auth } = useSession();
  const form = useAsyncForm();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const ready = email.includes('@') && email.trim() !== current && password.length > 0;

  return (
    <Group
      title="change email"
      hint="Your sign-in key is derived from your address, so changing it
            re-derives that too. Your messages are unaffected: they are wrapped
            under a key that does not depend on your email."
    >
      <form
        onSubmit={form.submit(async () => {
          await auth.requestEmailChange(email.trim(), password);
          setEmail('');
          setPassword('');
          return 'Check the new address for a confirmation link.';
        })}
      >
        <TextField
          label="New email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          disabled={form.busy}
        />
        <TextField
          label="Current password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          disabled={form.busy}
        />
        <Actions>
          <button type="submit" className="set-btn" disabled={!ready || form.busy}>
            {form.busy ? 'Sending…' : 'Send confirmation'}
          </button>
        </Actions>
        {form.result}
      </form>
    </Group>
  );
}

/* ------------------------------------------------------------- password --- */

function PasswordForm({ email, username }: { email: string; username: string }) {
  const { auth } = useSession();
  const form = useAsyncForm();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  const check = checkPassword(next, { email, username });
  const matches = next.length > 0 && next === confirm;
  const ready = current.length > 0 && check.ok && matches;

  return (
    <Group
      title="change password"
      hint="Your password never leaves this device. It re-wraps your private key
            here, and only the wrapped result is uploaded. Your recovery code
            keeps working."
    >
      <form
        onSubmit={form.submit(async () => {
          await auth.changePassword(current, next);
          setCurrent('');
          setNext('');
          setConfirm('');
          return 'Password changed.';
        })}
      >
        <TextField
          label="Current password"
          type="password"
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
          disabled={form.busy}
        />
        <TextField
          label="New password"
          type="password"
          value={next}
          onChange={setNext}
          autoComplete="new-password"
          disabled={form.busy}
        />
        {next.length > 0 && (
          <>
            <div className="set-meter" aria-hidden>
              {[0, 1, 2, 3].map((index) => (
                <span
                  key={index}
                  className="set-meter__seg"
                  data-on={index < check.score}
                  data-strong={check.score >= 3}
                />
              ))}
            </div>
            {check.problems.length > 0 && (
              <ul className="set-problems">
                {check.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            )}
          </>
        )}
        <TextField
          label="Confirm new password"
          type="password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          disabled={form.busy}
          hint={
            confirm.length > 0 && !matches ? (
              <span className="set-inline-warn">Those do not match.</span>
            ) : undefined
          }
        />
        <Actions>
          <button type="submit" className="set-btn" disabled={!ready || form.busy}>
            {form.busy ? 'Changing…' : 'Change password'}
          </button>
        </Actions>
        {form.result}
      </form>
    </Group>
  );
}

/* --------------------------------------------------------------- delete --- */

function DeleteAccount({ email }: { email: string }) {
  const { auth } = useSession();
  const form = useAsyncForm();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [typed, setTyped] = useState('');

  const ready = password.length > 0 && typed.trim().toLowerCase() === email.toLowerCase();

  return (
    <Group title="danger">
      <Row
        label="Delete this account"
        hint="Your messages are encrypted to a key only you hold. Deleting the
              account destroys that key, so nothing that was ever sent to you
              can be read again, by you or by anyone. There is no way back."
      >
        {!open && (
          <button
            type="button"
            className="set-btn set-btn--danger"
            onClick={() => setOpen(true)}
          >
            Delete account
          </button>
        )}
      </Row>

      {open && (
        <form
          onSubmit={form.submit(async () => {
            await auth.deleteAccount(password);
            return 'Account deleted.';
          })}
        >
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            disabled={form.busy}
          />
          <TextField
            label={`Type ${email} to confirm`}
            value={typed}
            onChange={setTyped}
            disabled={form.busy}
          />
          <Actions>
            <button
              type="submit"
              className="set-btn set-btn--danger"
              disabled={!ready || form.busy}
            >
              {form.busy ? 'Deleting…' : 'Delete permanently'}
            </button>
            <button
              type="button"
              className="set-btn set-btn--quiet"
              onClick={() => setOpen(false)}
              disabled={form.busy}
            >
              Cancel
            </button>
          </Actions>
          {form.result}
        </form>
      )}
    </Group>
  );
}

/* --------------------------------------------------------------- shared --- */

/**
 * The busy / error / confirmation cycle every form on this screen runs, in one
 * place so none of them can get it subtly different. The action returns the
 * line to show once it has worked.
 */
export function useAsyncForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function submit(action: () => Promise<string>) {
    return async (event: FormEvent) => {
      event.preventDefault();
      setBusy(true);
      setError(null);
      setDone(null);
      try {
        setDone(await action());
      } catch (caught) {
        setError(describe(caught));
      } finally {
        setBusy(false);
      }
    };
  }

  const result: ReactNode =
    error !== null ? (
      <Note tone="danger">{error}</Note>
    ) : done !== null ? (
      <Note tone="sealed">{done}</Note>
    ) : null;

  return { busy, submit, result };
}

export function describe(caught: unknown): string {
  if (caught instanceof ApiError || caught instanceof Error) return caught.message;
  return 'Something went wrong.';
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
