/**
 * The vault: a conversation with nobody but yourself.
 *
 * Three phases, one screen. `absent` sets it up, `locked` asks for the passkey,
 * `open` looks like a chat because it is one, minus the other person.
 *
 * The copy here does a job the code cannot: it says what a short passkey is
 * actually worth. A padlock drawn over a six digit PIN would be implying a
 * guarantee this does not make, so the setup screen prints the number of
 * combinations and the unlock screen never claims more than "not without this".
 * vault-plan.md, *The encryption story, stated honestly*.
 */
import { useState, type FormEvent } from 'react';
import { Composer } from '../components/Composer';
import { CloseIcon, LockIcon } from '../components/Icons';
import { PasswordField } from '../components/PasswordField';
import {
  PASSKEY_RULES,
  checkPasskey,
  combinations,
  type PasskeyKind,
} from '../lib/vault/passkeyPolicy';
import { clockTime } from '../lib/i18n/format';
import { useI18n, useT } from '../state/I18nProvider';
import { useVault } from '../state/VaultProvider';
import '../styles/vault.css';

export function VaultScreen() {
  const vault = useVault();

  if (vault.phase === 'absent') return <SetUp />;
  if (vault.phase === 'locked') return <Unlock />;
  return <Open />;
}

/* --- first time ---------------------------------------------------------- */

function SetUp() {
  const { create, busy, error } = useVault();
  const t = useT();
  const [kind, setKind] = useState<PasskeyKind>('digits');
  const [passkey, setPasskey] = useState('');
  const [again, setAgain] = useState('');
  const [password, setPassword] = useState('');

  const check = checkPasskey(passkey, kind);
  const matches = passkey.length > 0 && passkey === again;
  const ready = check.ok && matches && password.length > 0 && !busy;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    try {
      await create({ passkey, password, kind });
    } catch {
      // The provider already turned it into a sentence under the form.
    }
  }

  return (
    <div className="vault vault--form">
      <form className="vault-card" onSubmit={(event) => void submit(event)}>
        <LockIcon size={24} className="vault-card__mark" />
        <h2 className="vault-card__title">{t('vault.setup.title')}</h2>
        <p className="vault-card__lede">{t('vault.setup.lede')}</p>

        <div className="vault-kind" role="radiogroup" aria-label={t('vault.setup.kind')}>
          {(Object.keys(PASSKEY_RULES) as PasskeyKind[]).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={option === kind}
              className={option === kind ? 'vault-kind__option vault-kind__option--on' : 'vault-kind__option'}
              onClick={() => {
                setKind(option);
                setPasskey('');
                setAgain('');
              }}
            >
              <span className="vault-kind__label">{t(PASSKEY_RULES[option].label)}</span>
              <span className="vault-kind__hint">{t(PASSKEY_RULES[option].hint)}</span>
            </button>
          ))}
        </div>

        <PasswordField
          label={t('vault.field.passkey')}
          value={passkey}
          onChange={setPasskey}
          autoComplete="new-password"
          inputMode={kind === 'digits' ? 'numeric' : 'text'}
        />
        <PasswordField
          label={t('vault.field.passkeyAgain')}
          value={again}
          onChange={setAgain}
          autoComplete="new-password"
          inputMode={kind === 'digits' ? 'numeric' : 'text'}
        />

        <p className="vault-card__meter mono">{t(combinations(passkey.length, kind))}</p>

        <hr className="vault-card__rule" />

        <PasswordField
          label={t('vault.field.password')}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        <p className="vault-card__note">{t('vault.setup.note')}</p>

        {passkey.length > 0 && !check.ok && (
          <p className="vault-card__problem">{t(check.problems[0])}</p>
        )}
        {again.length > 0 && !matches && (
          <p className="vault-card__problem">{t('vault.setup.mismatch')}</p>
        )}
        {error && <p className="vault-card__problem">{t(error)}</p>}

        <button type="submit" className="vault-card__go" disabled={!ready}>
          {t(busy ? 'vault.setup.sealing' : 'vault.setup.go')}
        </button>
      </form>
    </div>
  );
}

/* --- shut ---------------------------------------------------------------- */

function Unlock() {
  const { unlock, unlockWithPassword, kind, busy, error } = useVault();
  const { locale, t } = useI18n();
  const [passkey, setPasskey] = useState('');
  const [password, setPassword] = useState('');
  const [forgot, setForgot] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      if (forgot) await unlockWithPassword(password);
      else await unlock(passkey);
    } catch {
      // Shown under the form by the provider.
    }
  }

  return (
    <div className="vault vault--form">
      <form className="vault-card" onSubmit={(event) => void submit(event)}>
        <LockIcon size={24} className="vault-card__mark" />
        <h2 className="vault-card__title">{t('vault.title')}</h2>
        <p className="vault-card__lede">
          {forgot
            ? t('vault.unlock.forgotLede')
            : t('vault.unlock.lede', {
                kind: t(PASSKEY_RULES[kind ?? 'digits'].label).toLocaleLowerCase(locale),
              })}
        </p>

        {forgot ? (
          <PasswordField
            label={t('vault.field.password')}
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />
        ) : (
          <PasswordField
            label={t('vault.field.passkey')}
            value={passkey}
            onChange={setPasskey}
            autoComplete="off"
            inputMode={kind === 'digits' ? 'numeric' : 'text'}
          />
        )}

        {error && <p className="vault-card__problem">{t(error)}</p>}

        <button
          type="submit"
          className="vault-card__go"
          disabled={busy || (forgot ? password.length === 0 : passkey.length === 0)}
        >
          {t(busy ? 'vault.unlock.opening' : 'vault.unlock.go')}
        </button>

        <button
          type="button"
          className="vault-card__link"
          onClick={() => setForgot((value) => !value)}
        >
          {t(forgot ? 'vault.unlock.usePasskey' : 'vault.unlock.forgot')}
        </button>
      </form>
    </div>
  );
}

/* --- open ---------------------------------------------------------------- */

function Open() {
  const { entries, add, remove, lock, busy } = useVault();
  const { locale, t } = useI18n();

  return (
    <div className="vault">
      <header className="vault__head">
        <div className="vault__head-text">
          <h2 className="vault__title">{t('vault.title')}</h2>
          <span className="vault__sub">
            {entries.length === 0
              ? t('vault.open.empty')
              : t('vault.open.count', { count: entries.length })}
          </span>
        </div>
        <button type="button" className="vault__lock" onClick={lock}>
          <LockIcon size={14} />
          <span>{t('vault.open.lock')}</span>
        </button>
      </header>

      <div className="vault__scroll scroller">
        {entries.length === 0 ? (
          <p className="vault__empty">{t('vault.open.blank')}</p>
        ) : (
          <ol className="vault__list">
            {entries.map((entry) => (
              <li key={entry.id} className="vault-note">
                <div className="bubble bubble--out bubble--tail-out vault-note__bubble">
                  <span className="bubble__body">{entry.body}</span>
                  <span className="bubble__meta mono">
                    {clockTime(entry.createdAt, locale)}
                  </span>
                </div>
                <button
                  type="button"
                  className="vault-note__remove"
                  aria-label={t('vault.open.deleteNote')}
                  disabled={busy}
                  onClick={() => void remove(entry.id)}
                >
                  <CloseIcon size={13} />
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      <Composer placeholder={t('vault.open.composer')} onSend={(body) => void add(body)} />
    </div>
  );
}

