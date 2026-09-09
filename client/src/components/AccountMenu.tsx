/**
 * You, as one panel: who you are, and everything you can do about it.
 *
 * It exists because the app had grown four separate account controls and not
 * one of them was a profile. A strip across the top said "signed in as" and
 * offered Lock and Sign out; the foot of the conversation list, the activity
 * bar and the phone's bottom bar each went straight into Settings. So tapping
 * your own face landed you in "My Account", which is a settings section and
 * not a profile, and getting anywhere else meant a back link most people never
 * found.
 *
 * The shape is the one every chat app has settled on: the account control
 * opens *you*, and Settings is an item inside that rather than the whole
 * destination. It is a popover beside the control on a wide screen and a sheet
 * along the bottom on a phone, which is the same component with a different
 * media query, because it is the same idea in both places.
 *
 * Lock and Sign out live here now. They are genuinely different and both are
 * offered: locking drops the private key from memory and leaves the device
 * enrolled, signing out also throws away the wrapped blob, so the next sign-in
 * has to fetch it from the server again.
 */
import { useEffect, useRef, useState } from 'react';
import { Avatar } from './Avatar';
import { LockIcon, ProfileIcon, SettingsIcon } from './Icons';
import { useT } from '../state/I18nProvider';
import { useSession } from '../state/SessionProvider';
import { useSettings } from '../state/SettingsProvider';
import type { SectionId } from '../screens/settings/SettingsScreen';
import type { User } from '../types';
import '../styles/account-menu.css';

const PRESENCE_LABEL = {
  online: 'presence.online',
  idle: 'presence.idle',
  dnd: 'presence.dnd',
  offline: 'presence.offline',
  invisible: 'presence.invisible',
} as const;

/**
 * What you can actually choose, and what each one is called here.
 *
 * `offline` is labelled Invisible on purpose, matching the profile section:
 * the stored value is offline because that is what everyone else is told, and
 * "invisible" is what it means to the person choosing it. Real offline is a
 * fact about your socket, not a setting.
 */
const PRESENCE_CHOICES = [
  { value: 'online', label: 'presence.online' },
  { value: 'idle', label: 'presence.idle' },
  { value: 'dnd', label: 'presence.dnd' },
  { value: 'offline', label: 'presence.invisible' },
] as const;

interface Props {
  open: boolean;
  onClose: () => void;
  /** Opens settings, optionally straight to a section. */
  onOpenSettings: (section?: SectionId) => void;
  currentUser: User | null;
}

export function AccountMenu({ open, onClose, onOpenSettings, currentUser }: Props) {
  const t = useT();
  const { account, lock, logout, busy } = useSession();
  const { settings, update } = useSettings();
  const [pickingPresence, setPickingPresence] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  // Escape closes it, like every other layer in this app. Bound while open
  // only, so a closed menu is not holding a global key handler.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // The first thing in the panel takes focus, so a keyboard or a screen reader
  // lands inside it rather than continuing down the page behind.
  useEffect(() => {
    if (open) panel.current?.querySelector('button')?.focus();
  }, [open]);

  if (!open || !currentUser) return null;

  const presence = settings.profile.presence;
  const about = settings.profile.about.trim();

  return (
    <>
      {/* Clicking away closes it. A real element rather than a document
          listener, so the click that closes cannot also press what is under
          it, which is the usual bug with menus like this. */}
      <button
        type="button"
        className="acct__scrim"
        aria-label={t('common.close')}
        onClick={onClose}
      />

      <div className="acct" ref={panel} role="dialog" aria-label={t('account.you')}>
        <div className="acct__card">
          <Avatar user={currentUser} size={56} showPresence />
          <div className="acct__names">
            <span className="acct__name">{currentUser.name}</span>
            {account && <span className="acct__handle mono">{account.username}</span>}
            <span className="acct__presence">{t(PRESENCE_LABEL[presence])}</span>
          </div>
        </div>

        {about && <p className="acct__about">{about}</p>}

        {/* Your status, changeable here rather than four clicks away in
            settings. It is the one profile field people change several times a
            day, and every other chat app puts it exactly here for that reason.
            Collapsed to a single row until you ask, so the panel stays a
            glance. */}
        <div className="acct__actions">
          <button
            type="button"
            className="acct__item"
            aria-expanded={pickingPresence}
            onClick={() => setPickingPresence((open) => !open)}
          >
            <span className="acct__item-icon">
              <span className={`acct__dot acct__dot--${presence}`} aria-hidden />
            </span>
            <span>{t(PRESENCE_LABEL[presence])}</span>
            <span className="acct__chevron" aria-hidden>
              {pickingPresence ? '‹' : '›'}
            </span>
          </button>

          {pickingPresence &&
            PRESENCE_CHOICES.map((choice) => (
              <button
                key={choice.value}
                type="button"
                className={
                  choice.value === presence
                    ? 'acct__item acct__item--sub acct__item--on'
                    : 'acct__item acct__item--sub'
                }
                onClick={() => {
                  update('profile', { presence: choice.value });
                  setPickingPresence(false);
                }}
              >
                <span className="acct__item-icon">
                  <span className={`acct__dot acct__dot--${choice.value}`} aria-hidden />
                </span>
                <span>{t(choice.label)}</span>
              </button>
            ))}
        </div>

        <div className="acct__actions">
          <Item
            icon={<ProfileIcon size={16} />}
            label={t('account.editProfile')}
            onClick={() => {
              onClose();
              onOpenSettings('profile');
            }}
          />
          <Item
            icon={<SettingsIcon size={16} />}
            label={t('settings.back')}
            onClick={() => {
              onClose();
              onOpenSettings();
            }}
          />
          <Item
            icon={<LockIcon size={16} />}
            label={t('settings.lock')}
            disabled={busy}
            onClick={() => {
              onClose();
              void lock();
            }}
          />
          <Item
            label={t('settings.signOut')}
            danger
            disabled={busy}
            onClick={() => {
              onClose();
              void logout();
            }}
          />
        </div>
      </div>
    </>
  );
}

function Item({
  icon,
  label,
  onClick,
  danger = false,
  disabled = false,
}: {
  icon?: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={danger ? 'acct__item acct__item--danger' : 'acct__item'}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="acct__item-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
