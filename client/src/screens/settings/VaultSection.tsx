/**
 * The vault's settings: change the passkey, or give the vault up.
 *
 * Changing it costs the **account password**, not the old passkey. That is the
 * deliberate choice: it makes "I changed it because I forgot it" and "I changed
 * it because I felt like it" the same flow, so there is no separate recovery
 * path to get wrong, and it matches what the password already does everywhere
 * else in this app.
 *
 * Nothing here can be done while the vault is absent, because there is nothing
 * to change. The section says so rather than showing a dead form.
 */
import { useState } from 'react';
import { Actions, Group, Note, Row } from '../../components/settings/controls';
import { PasswordField } from '../../components/PasswordField';
import {
  PASSKEY_RULES,
  checkPasskey,
  combinations,
  type PasskeyKind,
} from '../../lib/vault/passkeyPolicy';
import { useT } from '../../state/I18nProvider';
import { useVault } from '../../state/VaultProvider';

const KINDS: PasskeyKind[] = ['digits', 'mixed'];

export function VaultSection() {
  const { phase, kind, entries, busy, error, changePasskey, forget } = useVault();
  const t = useT();
  const [password, setPassword] = useState('');
  const [passkey, setPasskey] = useState('');
  const [nextKind, setNextKind] = useState<PasskeyKind>(kind ?? 'digits');
  const [done, setDone] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (phase === 'absent') {
    return (
      <Group title={t('settings.section.vault').toLocaleLowerCase()}>
        <Row label={t('vault.settings.absent')} hint={t('vault.settings.absentHint')} />
      </Group>
    );
  }

  const check = checkPasskey(passkey, nextKind);
  const ready = check.ok && password.length > 0 && !busy;

  async function submit() {
    setDone(false);
    try {
      await changePasskey({ password, passkey, kind: nextKind });
      setPassword('');
      setPasskey('');
      setDone(true);
    } catch {
      // The provider turned it into a sentence, shown below.
    }
  }

  return (
    <>
      <Group title={t('vault.settings.group')}>
        <Row label={t('vault.settings.shape')} hint={t('vault.settings.shapeHint')}>
          <div
            className="set-segmented"
            role="radiogroup"
            aria-label={t('vault.settings.shape')}
          >
            {KINDS.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={option === nextKind}
                className="set-segmented__option"
                onClick={() => {
                  setNextKind(option);
                  setPasskey('');
                }}
              >
                {t(PASSKEY_RULES[option].label)}
              </button>
            ))}
          </div>
        </Row>

        <div className="set-field">
          <PasswordField
            label={t('vault.field.password')}
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />
        </div>

        <div className="set-field">
          <PasswordField
            label={t('vault.settings.newPasskey')}
            value={passkey}
            onChange={setPasskey}
            autoComplete="new-password"
            inputMode={nextKind === 'digits' ? 'numeric' : 'text'}
          />
          <p className="set-field__hint mono">
            {t(combinations(passkey.length, nextKind))}
          </p>
          {passkey.length > 0 && !check.ok && (
            <p className="set-field__hint">{t(check.problems[0])}</p>
          )}
        </div>

        <Actions>
          <button
            type="button"
            className="set-btn"
            disabled={!ready}
            onClick={() => void submit()}
          >
            {t(busy ? 'vault.settings.changing' : 'vault.settings.change')}
          </button>
          {done && <span className="set-flag">{t('vault.settings.changed')}</span>}
          {error && <span className="set-inline-warn">{t(error)}</span>}
        </Actions>
      </Group>

      <Note>{t('vault.settings.note')}</Note>

      <Group title={t('vault.settings.dangerGroup')}>
        <Row
          label={t('vault.settings.forget')}
          hint={[
            t('vault.settings.forgetHint'),
            phase === 'open'
              ? entries.length > 0
                ? t('vault.settings.forgetCount', { count: entries.length })
                : t('vault.settings.forgetEmpty')
              : t('vault.settings.forgetShut'),
            t('vault.settings.forgetFinal'),
          ].join(' ')}
        >
          {confirming ? (
            <Actions>
              <button
                type="button"
                className="set-btn set-btn--danger"
                disabled={busy}
                onClick={() => void forget()}
              >
                {t('vault.settings.deleteIt')}
              </button>
              <button
                type="button"
                className="set-btn set-btn--quiet"
                onClick={() => setConfirming(false)}
              >
                {t('vault.settings.keepIt')}
              </button>
            </Actions>
          ) : (
            <button
              type="button"
              className="set-btn set-btn--quiet"
              onClick={() => setConfirming(true)}
            >
              {t('vault.settings.forget')}
            </button>
          )}
        </Row>
      </Group>
    </>
  );
}
