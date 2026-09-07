/** Inline icons so the app ships with no icon dependency. */
type Props = { className?: string; size?: number };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'currentColor',
  'aria-hidden': true,
});

export function SpeakerIcon({ size = 24, className }: Props) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M11.383 3.076A1 1 0 0 1 12 4v16a1 1 0 0 1-1.707.707L5.586 16H3a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h2.586l4.707-4.707a1 1 0 0 1 1.09-.217ZM15.293 8.293a1 1 0 0 1 1.414 0A5.98 5.98 0 0 1 18.5 12.5a5.98 5.98 0 0 1-1.793 4.207 1 1 0 1 1-1.414-1.414A3.98 3.98 0 0 0 16.5 12.5a3.98 3.98 0 0 0-1.207-2.793 1 1 0 0 1 0-1.414Z" />
    </svg>
  );
}

export function PlusIcon({ size = 24, className }: Props) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M13 5a1 1 0 1 0-2 0v6H5a1 1 0 1 0 0 2h6v6a1 1 0 1 0 2 0v-6h6a1 1 0 1 0 0-2h-6V5Z" />
    </svg>
  );
}

export function LockIcon({ size = 24, className }: Props) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm3 8H9V7a3 3 0 1 1 6 0v3Zm-3 4a1.5 1.5 0 0 1 .5 2.915V18a.5.5 0 0 1-1 0v-1.085A1.5 1.5 0 0 1 12 14Z" />
    </svg>
  );
}

export function EyeIcon({ size = 24, className }: Props) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 5c-5 0-9.27 3.11-11 7 1.73 3.89 6 7 11 7s9.27-3.11 11-7c-1.73-3.89-6-7-11-7Zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
    </svg>
  );
}

export function SearchIcon({ size = 24, className }: Props) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M10.5 3a7.5 7.5 0 1 0 4.55 13.46l4.24 4.25a1 1 0 0 0 1.42-1.42l-4.25-4.24A7.5 7.5 0 0 0 10.5 3Zm-5.5 7.5a5.5 5.5 0 1 1 11 0 5.5 5.5 0 0 1-11 0Z" />
    </svg>
  );
}

export function EmojiIcon({ size = 24, className }: Props) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-3.5 7a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm7 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM12 18c-2.28 0-4.24-1.32-5.13-3.24a.75.75 0 0 1 1.36-.64C8.9 15.55 10.34 16.5 12 16.5s3.1-.95 3.77-2.38a.75.75 0 1 1 1.36.64C16.24 16.68 14.28 18 12 18Z" />
    </svg>
  );
}

export function SettingsIcon({ size = 24, className }: Props) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.58.24-1.12.55-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L2.67 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.31.6.22l2.39-.96c.5.39 1.04.7 1.62.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.58-.24 1.12-.55 1.62-.94l2.39.96c.22.09.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" />
    </svg>
  );
}

/// Paired with EyeIcon for the password reveal. Drawn as the open eye with a
/// slash rather than a different glyph, so the two states read as one control.
export function EyeOffIcon({ size = 24, className }: Props) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3.28 2.22a.75.75 0 1 0-1.06 1.06l2.7 2.7C3.2 7.11 1.94 8.66 1 10.5c1.73 3.89 6 7 11 7 1.86 0 3.6-.43 5.14-1.16l3.58 3.58a.75.75 0 0 0 1.06-1.06L3.28 2.22Zm7.1 9.22 2.68 2.68a3 3 0 0 1-2.68-2.68ZM12 5c-1.1 0-2.16.11-3.16.31l2.02 2.02A5 5 0 0 1 16.67 13l3.2 3.2c1.35-1.06 2.44-2.4 3.13-3.7C21.27 8.61 17 5.5 12 5.5V5Z" />
    </svg>
  );
}

export function PencilIcon({ size = 24, className }: Props) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M17.3 3.29a1 1 0 0 1 1.41 0l2 2a1 1 0 0 1 0 1.42l-1.8 1.8-3.42-3.42 1.8-1.8ZM14.08 6.5l3.42 3.42-8.3 8.3a1 1 0 0 1-.46.26l-4 1a1 1 0 0 1-1.22-1.21l1-4a1 1 0 0 1 .26-.47l8.3-8.3Z" />
    </svg>
  );
}

export function MessageIcon({ size = 24, className }: Props) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9.41l-4.7 4.7A1 1 0 0 1 3 21V5a2 2 0 0 1 1-1.73V3Z" />
    </svg>
  );
}

export function UserMinusIcon({ size = 24, className }: Props) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M10 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 1.5c-3.86 0-7 2.24-7 5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1.5c0-2.76-3.14-5-7-5ZM16 9.5a1 1 0 0 1 1-1h4a1 1 0 1 1 0 2h-4a1 1 0 0 1-1-1Z" />
    </svg>
  );
}

export function BanIcon({ size = 24, className }: Props) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM4 12a8 8 0 0 1 12.9-6.31L5.69 16.9A7.96 7.96 0 0 1 4 12Zm8 8a7.96 7.96 0 0 1-4.9-1.69L18.31 7.1A8 8 0 0 1 12 20Z" />
    </svg>
  );
}
