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
import type { Key } from '../../lib/i18n/en';
import { shortDay } from '../../lib/i18n/format';
import { keyManager } from '../../lib/session/keyManager';
import type { SessionDto } from '../../lib/api/types';
import { useI18n, useT } from '../../state/I18nProvider';
import { useSession } from '../../state/SessionProvider';
import { describe, useAsyncForm } from './AccountSection';

export function DevicesSection() {
  const { keyState, account } = useSession();
  const t = useT();
  // Revealing is deliberately component state: leaving the section unmounts
  // this, so coming back asks again rather than staying open all evening.
  const [revealed, setRevealed] = useState(false);

  const locked = keyState !== 'unlocked';

  return (
    <>
      {locked ? (
        <Group title={t('devices.group.number')}>
          <Note tone="warn">
            {t(keyState === 'empty' ? 'devices.noKey' : 'devices.deviceLocked')}
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
        <Note tone="warn">{t('devices.needAccount')}</Note>
      )}
    </>
  );
}

/* ----------------------------------------------------------------- gate --- */

function PasswordGate({ onUnlocked }: { onUnlocked: () => void }) {
  const { auth } = useSession();
  const t = useT();
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
        setError(t('devices.wrongPassword'));
      }
    } catch (caught) {
      setError(describe(caught, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Group title={t('devices.group.number')} hint={t('devices.gateHint')}>
      <Row label={t('devices.gate')} hint={t('devices.gateWhy')} />
      <form onSubmit={submit}>
        <TextField
          label={t('account.password')}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          disabled={busy}
        />
        <Actions>
          <button type="submit" className="set-btn" disabled={busy || !password}>
            {t(busy ? 'devices.checking' : 'devices.reveal')}
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
  const t = useT();
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
    <Group title={t('devices.group.number')} hint={t('devices.numberHint')}>
      {fingerprint ? (
        <p className="set-fingerprint mono">{fingerprint}</p>
      ) : (
        <Note tone="warn">{t('devices.noFingerprint')}</Note>
      )}
      <Row label={t('devices.keyState')}>
        <span className="set-value">
          <span className={`set-dot set-dot--${keyState}`} />
          {t(keyStateLabel(keyState))}
        </span>
      </Row>
      <Actions>
        <button type="button" className="set-btn set-btn--quiet" onClick={onHide}>
          {t('devices.hide')}
        </button>
      </Actions>
    </Group>
  );
}

function keyStateLabel(state: 'empty' | 'locked' | 'unlocked'): Key {
  switch (state) {
    case 'unlocked':
      return 'devices.state.unlocked';
    case 'locked':
      return 'devices.state.locked';
    case 'empty':
      return 'devices.state.empty';
  }
}

/* -------------------------------------------------------- recovery code --- */

function RecoveryCode() {
  const { auth } = useSession();
  const form = useAsyncForm();
  const t = useT();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  if (code) {
    return (
      <Group title={t('devices.group.recovery')}>
        <Note tone="sealed">{t('devices.newCode')}</Note>
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
            {t('devices.savedIt')}
          </button>
        </Actions>
      </Group>
    );
  }

  return (
    <Group title={t('devices.group.recovery')} hint={t('devices.recoveryHint')}>
      <Note>{t('devices.recoveryNote')}</Note>

      {!open ? (
        <Actions>
          <button type="button" className="set-btn" onClick={() => setOpen(true)}>
            {t('devices.generateNew')}
          </button>
        </Actions>
      ) : (
        <form
          onSubmit={form.submit(async () => {
            const result = await auth.regenerateRecoveryCode(password);
            setPassword('');
            setCode(result.recoveryCode);
            return 'devices.recoveryDone';
          })}
        >
          <TextField
            label={t('account.password')}
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            disabled={form.busy}
            hint={t('devices.recoveryPasswordHint')}
          />
          <Actions>
            <button
              type="submit"
              className="set-btn"
              disabled={password.length === 0 || form.busy}
            >
              {t(form.busy ? 'devices.generating' : 'devices.generate')}
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

/* ------------------------------------------------------------- sessions --- */

function Sessions() {
  const { auth } = useSession();
  const { locale, t } = useI18n();
  const [sessions, setSessions] = useState<SessionDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setSessions(await auth.sessions());
    } catch (caught) {
      setError(describe(caught, t));
      setSessions([]);
    }
  }, [auth, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(id: string) {
    setBusyId(id);
    try {
      await auth.revokeSession(id);
      await load();
    } catch (caught) {
      setError(describe(caught, t));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Group title={t('devices.group.sessions')} hint={t('devices.sessionsHint')}>
      {error && <Note tone="danger">{error}</Note>}

      {sessions === null && <p className="set-empty">{t('devices.loading')}</p>}
      {sessions?.length === 0 && !error && (
        <p className="set-empty">{t('devices.noSessions')}</p>
      )}

      {sessions?.map((session) => (
        <div key={session.id} className="set-session">
          <div className="set-session__text">
            <p className="set-session__title">
              {session.deviceLabel ?? t('devices.unknownDevice')}
              {session.current && (
                <span className="set-flag set-flag--now">{t('devices.thisDevice')}</span>
              )}
            </p>
            <p className="set-session__meta mono">
              {[
                session.ip,
                t('devices.since', {
                  day: shortDay(session.createdAt, locale) || t('common.unknown'),
                }),
              ]
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
              {t(busyId === session.id ? 'devices.signingOut' : 'settings.signOut')}
            </button>
          )}
        </div>
      ))}

      <Actions>
        <button type="button" className="set-btn set-btn--quiet" onClick={() => void load()}>
          {t('devices.refresh')}
        </button>
        <button
          type="button"
          className="set-btn set-btn--danger"
          onClick={() => void auth.logoutEverywhere()}
        >
          {t('devices.signOutEverywhere')}
        </button>
      </Actions>
    </Group>
  );
}
