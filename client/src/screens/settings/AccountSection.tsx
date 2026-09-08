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
import type { Key } from '../../lib/i18n/en';
import { shortDay } from '../../lib/i18n/format';
import { checkPassword } from '../../lib/session/passwordPolicy';
import { describeError, useI18n, useT, type Translate } from '../../state/I18nProvider';
import { useSession } from '../../state/SessionProvider';

export function AccountSection() {
  const { account } = useSession();
  const { locale, t } = useI18n();

  if (!account) {
    return <Note tone="warn">{t('account.signedOut')}</Note>;
  }

  const day = (iso: string) => shortDay(iso, locale) || t('common.unknown');

  return (
    <>
      <Group title={t('account.group')}>
        <Row label={t('account.username')} hint={t('account.usernameHint')}>
          <span className="set-value">{account.username}</span>
        </Row>
        <Row
          label={t('account.email')}
          hint={t(account.emailVerifiedAt ? 'account.emailHint' : 'account.unverifiedHint')}
        >
          <span className="set-value">
            {account.email}
            {!account.emailVerifiedAt && (
              <span className="set-flag">{t('account.unverified')}</span>
            )}
          </span>
        </Row>
        <Row label={t('account.since')}>
          <span className="set-value mono">{day(account.createdAt)}</span>
        </Row>
        {account.lastLoginAt && (
          <Row label={t('account.lastLogin')}>
            <span className="set-value mono">{day(account.lastLoginAt)}</span>
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
  const t = useT();
  const [username, setUsername] = useState(current);

  const changed = username.trim() !== current && username.trim().length > 0;

  return (
    <Group title={t('account.group.username')}>
      <form
        onSubmit={form.submit(async () => {
          await auth.updateProfile({ username: username.trim() });
          await refresh();
          return 'account.usernameDone';
        })}
      >
        <TextField
          label={t('account.newUsername')}
          value={username}
          maxLength={32}
          onChange={setUsername}
          autoComplete="username"
          disabled={form.busy}
        />
        <Actions>
          <button type="submit" className="set-btn" disabled={!changed || form.busy}>
            {t(form.busy ? 'account.saving' : 'common.save')}
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
  const t = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const ready = email.includes('@') && email.trim() !== current && password.length > 0;

  return (
    <Group title={t('account.group.email')} hint={t('account.group.emailHint')}>
      <form
        onSubmit={form.submit(async () => {
          await auth.requestEmailChange(email.trim(), password);
          setEmail('');
          setPassword('');
          return 'account.emailSent';
        })}
      >
        <TextField
          label={t('account.newEmail')}
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          disabled={form.busy}
        />
        <TextField
          label={t('account.currentPassword')}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          disabled={form.busy}
        />
        <Actions>
          <button type="submit" className="set-btn" disabled={!ready || form.busy}>
            {t(form.busy ? 'account.sending' : 'account.sendConfirmation')}
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
  const t = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  const check = checkPassword(next, { email, username });
  const matches = next.length > 0 && next === confirm;
  const ready = current.length > 0 && check.ok && matches;

  return (
    <Group title={t('account.group.password')} hint={t('account.group.passwordHint')}>
      <form
        onSubmit={form.submit(async () => {
          await auth.changePassword(current, next);
          setCurrent('');
          setNext('');
          setConfirm('');
          return 'account.passwordDone';
        })}
      >
        <TextField
          label={t('account.currentPassword')}
          type="password"
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
          disabled={form.busy}
        />
        <TextField
          label={t('account.newPassword')}
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
                  <li key={problem.key}>{t(problem)}</li>
                ))}
              </ul>
            )}
          </>
        )}
        <TextField
          label={t('account.confirmPassword')}
          type="password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          disabled={form.busy}
          hint={
            confirm.length > 0 && !matches ? (
              <span className="set-inline-warn">{t('account.mismatch')}</span>
            ) : undefined
          }
        />
        <Actions>
          <button type="submit" className="set-btn" disabled={!ready || form.busy}>
            {t(form.busy ? 'account.changing' : 'account.changePassword')}
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
  const t = useT();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [typed, setTyped] = useState('');

  const ready = password.length > 0 && typed.trim().toLowerCase() === email.toLowerCase();

  return (
    <Group title={t('vault.settings.dangerGroup')}>
      <Row label={t('account.delete')} hint={t('account.deleteHint')}>
        {!open && (
          <button
            type="button"
            className="set-btn set-btn--danger"
            onClick={() => setOpen(true)}
          >
            {t('account.deleteButton')}
          </button>
        )}
      </Row>

      {open && (
        <form
          onSubmit={form.submit(async () => {
            await auth.deleteAccount(password);
            return 'account.deleteDone';
          })}
        >
          <TextField
            label={t('account.password')}
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            disabled={form.busy}
          />
          <TextField
            label={t('account.typeToConfirm', { email })}
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
              {t(form.busy ? 'account.deleting' : 'account.deleteForever')}
            </button>
            <button
              type="button"
              className="set-btn set-btn--quiet"
              onClick={() => setOpen(false)}
              disabled={form.busy}
            >
              {t('common.cancel')}
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
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Key | null>(null);

  /** The action returns the catalogue key of the line to show once it worked. */
  function submit(action: () => Promise<Key>) {
    return async (event: FormEvent) => {
      event.preventDefault();
      setBusy(true);
      setError(null);
      setDone(null);
      try {
        setDone(await action());
      } catch (caught) {
        setError(describe(caught, t));
      } finally {
        setBusy(false);
      }
    };
  }

  const result: ReactNode =
    error !== null ? (
      <Note tone="danger">{error}</Note>
    ) : done !== null ? (
      <Note tone="sealed">{t(done)}</Note>
    ) : null;

  return { busy, submit, result };
}

/**
 * Failure, in words.
 *
 * An error the server sent comes through in the server's own English, and it
 * stays that way. The API answers with prose rather than with codes, so there
 * is nothing here to look up in a catalogue, and inventing a translation for a
 * sentence we did not write would mean guessing at what it said. Only the
 * fallback, which is ours, is translated. See i18n-plan.md.
 */
export function describe(caught: unknown, t: Translate): string {
  return describeError(caught, t);
}
