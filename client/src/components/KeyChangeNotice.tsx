/**
 * "This person's security key has changed", between the messages and the
 * composer, for as long as nobody on this side has said that it is fine.
 *
 * The one piece of encryption UI in a conversation, and it exists because
 * encryption alone cannot provide it: a key the server hands out is only as
 * honest as the server, so the client remembers the first one it saw and
 * stops here when a different one turns up (lib/session/keyPins.ts). While
 * it is up, nothing is sealed to the new key and nothing sealed under it is
 * opened; the composer is disabled beside it. The button is the whole
 * consent, and it re-opens whatever was refused in the meantime.
 *
 * It says what a change usually means and asks the person to check some
 * other way if that is not it. It does not show the fingerprints: comparing
 * those is a considered screen of its own (STATUS.md, decision 21), not a
 * strip above the composer.
 */
import { useState } from 'react';
import type { KeyChange } from '../lib/session/keyPins';
import { useT } from '../state/I18nProvider';
import { LockIcon } from './Icons';
import '../styles/key-change.css';

export function KeyChangeNotice({
  name,
  change,
  onAccept,
}: {
  /** What this person is called on screen: the nickname, or the username. */
  name: string;
  change: KeyChange;
  onAccept: (userId: string) => Promise<void>;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);

  function accept() {
    setBusy(true);
    void onAccept(change.userId).finally(() => setBusy(false));
  }

  return (
    <div className="key-change" role="alert">
      <LockIcon size={16} />
      <div className="key-change__text">
        <p className="key-change__title">{t('chat.keyChanged', { name })}</p>
        <p className="key-change__body">{t('chat.keyChangedBody')}</p>
      </div>
      <button type="button" className="key-change__accept" disabled={busy} onClick={accept}>
        {t('chat.keyChangedAccept')}
      </button>
    </div>
  );
}
