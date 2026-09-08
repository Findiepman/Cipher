/**
 * A password box with a reveal toggle.
 *
 * There is a real reason this app wants one more than most do. A password here
 * is not a credential you can reset out of band: it unwraps the key, and typing
 * it wrong on the create screen produces an account whose messages nobody can
 * read. Being able to look at what you typed is worth the moment of exposure.
 *
 * The button is `tabIndex={-1}` so tabbing out of the box lands on the next
 * field, which is where a person filling in a form expects to be. It stays
 * reachable by mouse and by screen reader, and its label says which way it will
 * move the state rather than which state it is in.
 */
import { useId, useState } from 'react';
import { useT } from '../state/I18nProvider';
import { EyeIcon, EyeOffIcon } from './Icons';

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password' | 'off';
  disabled?: boolean;
  /**
   * `numeric` puts a phone's keypad under a digits-only secret, which the vault
   * passkey can be. Text everywhere else, which is the default a password wants.
   */
  inputMode?: 'text' | 'numeric';
  autoFocus?: boolean;
  required?: boolean;
  /** Rendered under the input, inside the same label. */
  children?: React.ReactNode;
};

export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  disabled,
  autoFocus,
  required,
  inputMode,
  children,
}: Props) {
  const t = useT();
  const [revealed, setRevealed] = useState(false);
  const id = useId();

  return (
    <div className="auth-field">
      <label className="auth-label" htmlFor={id}>
        {label}
      </label>

      <div className="auth-password">
        <input
          id={id}
          className="auth-input auth-input--password"
          type={revealed ? 'text' : 'password'}
          autoComplete={autoComplete}
          inputMode={inputMode}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          autoFocus={autoFocus}
          required={required}
        />
        <button
          type="button"
          className="auth-reveal"
          onClick={() => setRevealed((current) => !current)}
          disabled={disabled}
          tabIndex={-1}
          aria-pressed={revealed}
          aria-label={t(revealed ? 'field.hidePassword' : 'field.showPassword')}
          title={t(revealed ? 'field.hidePassword' : 'field.showPassword')}
        >
          {revealed ? <EyeOffIcon size={17} /> : <EyeIcon size={17} />}
        </button>
      </div>

      {children}
    </div>
  );
}
