/**
 * The section a normal messenger does not have.
 *
 * Three things live here because they are the same question asked three ways:
 * "who can read my messages?": the security number that proves which key your
 * contacts are encrypting to, the recovery code that is the only way back into
 * your own history, and the list of sessions that are currently signed in.
 *
 * The first two sit behind a password even though the device is already
 * unlocked. Unlocking happens once and lasts as long as the tab does, so by the
 * time someone opens this screen the password is old news, and these are
 * exactly the two things you would not want read off your screen while you were
 * away from it. The check is local (see KeyManager.verifyPassword) and reveals
 * only for as long as you stay on the section.
 *
 * The recovery code itself is not among what a password can reveal. It is not
 * stored anywhere: only its hash on the server, and a blob wrapped under it.
 * Regenerating is the only way to see one again, and it retires the old one.
 */
import { useCallback, useEffect, useState } from 'react';
import { Actions, Group, Note, Row, TextField } from '../../components/settings/controls';
import { keyManager } from '../../lib/session/keyManager';
import type { SessionDto } from '../../lib/api/types';
import { useSession } from '../../state/SessionProvider';
import { describe, formatDate, useAsyncForm } from './AccountSection';

export function DevicesSection() {
  const { keyState, account } = useSession();
  // Revealing is deliberately component state: leaving the section unmounts
  // this, so coming back asks again rather than staying open all evening.
  const [revealed, setRevealed] = useState(false);

  const locked = keyState !== 'unlocked';

  return (
    <>
      {locked ? (
        <Group title="security number">
          <Note tone="warn">
            {keyState === 'empty'
              ? 'No key on this device yet, so there is no number to compare.'
              : 'This device is locked. Unlock it to see your security number.'}
          </Note>
        </Group>
      ) : revealed ? (
        <>
          <SecurityNumber keyState={keyState} onHide={() => setRevealed(false)} />
          {account && <RecoveryCode />}
        </>
      ) : (
        <PasswordGate onUnlocked={() => setRevealed(true)} />
      )}

      {account && <Sessions />}

      {!account && (
        <Note tone="warn">
          Sessions and the recovery code live on the server, so they need a
          signed-in account.
        </Note>
      )}
    </>
  );
}

/* ----------------------------------------------------------------- gate --- */

function PasswordGate({ onUnlocked }: { onUnlocked: () => void }) {
  const { auth } = useSession();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (await auth.verifyPassword(password)) {
        setPassword('');
        onUnlocked();
      } else {
        setError('That is not your password.');
      }
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Group
      title="security number"
      hint="Checked on this device against your own stored key. Nothing is sent
            anywhere, and your password is not stored by this screen."
    >
      <Row
        label="Hidden until you confirm it is you"
        hint="Your security number and your recovery code are both behind this.
              You unlocked this device a while ago; this asks again before
              putting either of them on screen."
      />
      <form onSubmit={submit}>
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          disabled={busy}
        />
        <Actions>
          <button type="submit" className="set-btn" disabled={busy || !password}>
            {busy ? 'Checking…' : 'Reveal'}
          </button>
        </Actions>
        {error && <Note tone="danger">{error}</Note>}
      </form>
    </Group>
  );
}

/* -------------------------------------------------------- security number --- */

function SecurityNumber({
  keyState,
  onHide,
}: {
  keyState: 'empty' | 'locked' | 'unlocked';
  onHide: () => void;
}) {
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
    <Group
      title="security number"
      hint="Read it to each other out loud, or compare it in person. If two
            devices show the same number, nobody is sitting in the middle of
            your conversation. If it ever changes without an explanation, stop
            and ask why before you send anything."
    >
      {fingerprint ? (
        <p className="set-fingerprint mono">{fingerprint}</p>
      ) : (
        <Note tone="warn">This device is not holding a key to fingerprint.</Note>
      )}
      <Row label="Key state">
        <span className="set-value">
          <span className={`set-dot set-dot--${keyState}`} />
          {keyStateLabel(keyState)}
        </span>
      </Row>
      <Actions>
        <button type="button" className="set-btn set-btn--quiet" onClick={onHide}>
          Hide again
        </button>
      </Actions>
    </Group>
  );
}

function keyStateLabel(state: 'empty' | 'locked' | 'unlocked'): string {
  switch (state) {
    case 'unlocked':
      return 'Unlocked. Messages can be read on this device';
    case 'locked':
      return 'Locked. The key is here but the password is not';
    case 'empty':
      return 'No key on this device';
  }
}

/* -------------------------------------------------------- recovery code --- */

function RecoveryCode() {
  const { auth } = useSession();
  const form = useAsyncForm();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  if (code) {
    return (
      <Group title="recovery code">
        <Note tone="sealed">
          This is your new code. The old one stopped working the moment this one
          was made, and this is the only time it will be shown.
        </Note>
        <p className="set-code mono">{code}</p>
        <Actions>
          <button
            type="button"
            className="set-btn"
            onClick={() => {
              setCode(null);
              setOpen(false);
            }}
          >
            I have saved it
          </button>
        </Actions>
      </Group>
    );
  }

  return (
    <Group
      title="recovery code"
      hint="The one thing that can open your messages without your password.
            Regenerating mints a new code and retires the old one; your messages
            and your security number are untouched."
    >
      <Note>
        Your existing code cannot be shown again. Only its hash is on the server,
        and the copy of your key it guards is locked with the code itself, so
        there is nothing here that could be decoded back into it. If you have
        lost it, make a new one.
      </Note>

      {!open ? (
        <Actions>
          <button type="button" className="set-btn" onClick={() => setOpen(true)}>
            Generate a new code
          </button>
        </Actions>
      ) : (
        <form
          onSubmit={form.submit(async () => {
            const result = await auth.regenerateRecoveryCode(password);
            setPassword('');
            setCode(result.recoveryCode);
            return 'New recovery code created.';
          })}
        >
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            disabled={form.busy}
            hint="Needed to unwrap the key before it can be re-wrapped under the new code."
          />
          <Actions>
            <button
              type="submit"
              className="set-btn"
              disabled={password.length === 0 || form.busy}
            >
              {form.busy ? 'Generating…' : 'Generate'}
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

/* ------------------------------------------------------------- sessions --- */

function Sessions() {
  const { auth } = useSession();
  const [sessions, setSessions] = useState<SessionDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setSessions(await auth.sessions());
    } catch (caught) {
      setError(describe(caught));
      setSessions([]);
    }
  }, [auth]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(id: string) {
    setBusyId(id);
    try {
      await auth.revokeSession(id);
      await load();
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Group
      title="signed in"
      hint="Signing a session out ends its access to the server. It does not
            reach into that device and delete anything already decrypted there."
    >
      {error && <Note tone="danger">{error}</Note>}

      {sessions === null && <p className="set-empty">Loading…</p>}
      {sessions?.length === 0 && !error && <p className="set-empty">No other sessions.</p>}

      {sessions?.map((session) => (
        <div key={session.id} className="set-session">
          <div className="set-session__text">
            <p className="set-session__title">
              {session.deviceLabel ?? 'Unknown device'}
              {session.current && <span className="set-flag set-flag--now">this device</span>}
            </p>
            <p className="set-session__meta mono">
              {[session.ip, `since ${formatDate(session.createdAt)}`]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          {!session.current && (
            <button
              type="button"
              className="set-btn set-btn--quiet"
              disabled={busyId === session.id}
              onClick={() => void revoke(session.id)}
            >
              {busyId === session.id ? 'Signing out…' : 'Sign out'}
            </button>
          )}
        </div>
      ))}

      <Actions>
        <button type="button" className="set-btn set-btn--quiet" onClick={() => void load()}>
          Refresh
        </button>
        <button
          type="button"
          className="set-btn set-btn--danger"
          onClick={() => void auth.logoutEverywhere()}
        >
          Sign out everywhere
        </button>
      </Actions>
    </Group>
  );
}
