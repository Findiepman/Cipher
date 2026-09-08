/**
 * The parts every settings section is built out of.
 *
 * One shape, used everywhere: a row states what the setting is, says in a
 * second line what turning it on actually does, and puts the control on the
 * right. The second line is the point: a settings screen where every row is
 * three words is a screen you have to guess at, and this app has several
 * settings whose consequences are not obvious (what a notification preview
 * hands to the OS, what a link preview tells the linked site).
 */
import { useId, type ChangeEvent, type ReactNode } from 'react';
import '../../styles/settings.css';

export function SectionHeader({ title, lede }: { title: string; lede?: string }) {
  return (
    <header className="set-head">
      <h2 className="set-head__title">{title}</h2>
      {lede && <p className="set-head__lede">{lede}</p>}
    </header>
  );
}

export function Group({
  title,
  hint,
  children,
}: {
  title?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="set-group">
      {title && <h3 className="eyebrow set-group__title">{title}</h3>}
      <div className="set-group__body">{children}</div>
      {hint && <p className="set-group__hint">{hint}</p>}
    </section>
  );
}

export function Row({
  label,
  hint,
  htmlFor,
  children,
  stacked = false,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children?: ReactNode;
  /** Put the control under the text instead of beside it. */
  stacked?: boolean;
}) {
  return (
    <div className={stacked ? 'set-row set-row--stacked' : 'set-row'}>
      <div className="set-row__text">
        <label className="set-row__label" htmlFor={htmlFor}>
          {label}
        </label>
        {hint && <p className="set-row__hint">{hint}</p>}
      </div>
      {children && <div className="set-row__control">{children}</div>}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  id,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  id?: string;
  /** For screen readers, when the visible label is the row beside it. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="set-toggle"
      onClick={() => onChange(!checked)}
    >
      <span className="set-toggle__knob" />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div className="set-segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className="set-segmented__option"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  id,
  label,
  disabled = false,
  placeholder,
}: {
  value: T | '';
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  id?: string;
  label: string;
  disabled?: boolean;
  /** Shown as the first entry; selecting it means "no explicit choice". */
  placeholder?: string;
}) {
  return (
    <select
      id={id}
      className="set-select"
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value as T)}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  id,
  label,
  format = (n: number) => String(n),
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (next: number) => void;
  id?: string;
  label: string;
  format?: (value: number) => string;
}) {
  return (
    <div className="set-slider">
      <input
        id={id}
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="set-slider__value mono">{format(value)}</span>
    </div>
  );
}

export function TextField({
  value,
  onChange,
  label,
  hint,
  type = 'text',
  placeholder,
  maxLength,
  autoComplete,
  disabled = false,
  counter = false,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  hint?: ReactNode;
  type?: 'text' | 'email' | 'password';
  placeholder?: string;
  maxLength?: number;
  autoComplete?: string;
  disabled?: boolean;
  counter?: boolean;
}) {
  const id = useId();
  return (
    <div className="set-field">
      <label className="set-field__label" htmlFor={id}>
        {label}
        {counter && maxLength !== undefined && (
          <span className="set-field__counter mono">
            {value.length}/{maxLength}
          </span>
        )}
      </label>
      <input
        id={id}
        className="set-input"
        type={type}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete={autoComplete}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && <p className="set-field__hint">{hint}</p>}
    </div>
  );
}

/**
 * A field for something longer than a name.
 *
 * Separate from TextField rather than a `multiline` flag on it, because almost
 * nothing about the two is shared once the control is a textarea: it grows to
 * fit what is in it, it keeps the line breaks somebody typed and the counter
 * matters more, since the limit is the only thing standing between a profile
 * card and an essay.
 */
export function TextArea({
  value,
  onChange,
  label,
  hint,
  placeholder,
  maxLength,
  rows = 4,
  counter = false,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  hint?: ReactNode;
  placeholder?: string;
  maxLength?: number;
  rows?: number;
  counter?: boolean;
}) {
  const id = useId();
  const near = maxLength !== undefined && value.length > maxLength * 0.9;
  return (
    <div className="set-field">
      <label className="set-field__label" htmlFor={id}>
        {label}
        {counter && maxLength !== undefined && (
          <span className={near ? 'set-field__counter mono set-field__counter--near' : 'set-field__counter mono'}>
            {value.length}/{maxLength}
          </span>
        )}
      </label>
      <textarea
        id={id}
        className="set-input set-textarea"
        value={value}
        rows={rows}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && <p className="set-field__hint">{hint}</p>}
    </div>
  );
}

/**
 * One colour, picked in the browser's own picker.
 *
 * The hex is shown beside the swatch and can be typed into, because a picker
 * is how you find a colour and a hex is how you tell somebody else about one.
 * Anything that is not six hex digits never reaches the stylesheet: see
 * resolveHex in lib/settings/types.ts.
 */
export function ColorField({
  value,
  onChange,
  label,
  hint,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="set-field">
      <label className="set-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="set-colour">
        <input
          id={id}
          type="color"
          className="set-colour__well"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <input
          className="set-input set-colour__hex mono"
          value={value}
          spellCheck={false}
          maxLength={7}
          aria-label={label}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      {hint && <p className="set-field__hint">{hint}</p>}
    </div>
  );
}

export function Note({
  tone = 'plain',
  children,
}: {
  /** `sealed` is the encryption green, and is only ever about encryption. */
  tone?: 'plain' | 'sealed' | 'warn' | 'danger';
  children: ReactNode;
}) {
  return <p className={`set-note set-note--${tone}`}>{children}</p>;
}

export function Actions({ children }: { children: ReactNode }) {
  return <div className="set-actions">{children}</div>;
}
