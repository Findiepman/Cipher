/**
 * The bar along the bottom of a phone, and the only navigation there.
 *
 * A narrow screen drops the conversation list (`app.css`, the 820px rule), and
 * the settings gear used to live inside it. So a phone had no way into
 * settings at all, and once inside, the list pane hides the close button and
 * left no way out either. Both of those are the same missing thing: a phone
 * had no navigation that was always on screen.
 *
 * Hence a bar rather than another button. It is present on every screen this
 * app shows, settings included, which is what makes it an escape as well as a
 * destination: you leave settings by going somewhere, not by hunting for a
 * cross. That is how a phone app is expected to work, and it is why the four
 * entries are the four places rather than three places and a lid.
 *
 * Deliberately labelled, not icons alone. This is a chat app people open
 * rarely at first, and an unlabelled glyph is a thing you learn once and
 * forget. The labels cost one line of text each.
 *
 * Above 820px this renders nothing: `top-bar.tsx` is the navigation there and
 * two bars would be one too many.
 */
import { Avatar } from './Avatar';
import { LockIcon, MessageIcon, ProfileIcon } from './Icons';
import { useT } from '../state/I18nProvider';
import type { User } from '../types';
import type { View } from './TopBar';
import '../styles/mobile-nav.css';

interface Props {
  /** Null while settings is open, so no destination reads as current. */
  view: View | null;
  onSelect: (view: View) => void;
  /** Highlights the last entry, which is you rather than a workspace. */
  accountOpen: boolean;
  onOpenAccount: () => void;
  currentUser: User | null;
  /** Pending friend requests, badged the way the wide bar badges them. */
  requestCount: number;
}

export function MobileNav({
  view,
  onSelect,
  accountOpen,
  onOpenAccount,
  currentUser,
  requestCount,
}: Props) {
  const t = useT();

  return (
    <nav className="mnav" aria-label={t('chat.views')}>
      <Tab
        label={t('chat.direct')}
        active={view === 'direct'}
        onClick={() => onSelect('direct')}
        icon={<MessageIcon size={20} />}
      />
      <Tab
        label={t('chat.friends')}
        active={view === 'friends'}
        onClick={() => onSelect('friends')}
        icon={<ProfileIcon size={20} />}
        badge={requestCount}
      />
      <Tab
        label={t('vault.title')}
        active={view === 'vault'}
        onClick={() => onSelect('vault')}
        icon={<LockIcon size={20} />}
      />
      <Tab
        label={t('account.you')}
        active={accountOpen}
        onClick={onOpenAccount}
        // Your own face, the way every phone app puts "you" in the last slot.
        // It opens the account panel rather than settings: tapping your face
        // and landing in "My Account" was the confusion this replaces, since
        // that is a settings section and not a profile.
        icon={
          currentUser ? (
            <Avatar user={currentUser} size={22} />
          ) : (
            <ProfileIcon size={20} />
          )
        }
      />
    </nav>
  );
}

function Tab({
  label,
  active,
  onClick,
  icon,
  badge = 0,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  badge?: number;
}) {
  return (
    <button
      type="button"
      className={active ? 'mnav__tab mnav__tab--active' : 'mnav__tab'}
      aria-current={active || undefined}
      onClick={onClick}
    >
      <span className="mnav__icon">
        {icon}
        {badge > 0 && <span className="mnav__badge">{badge > 99 ? '99+' : badge}</span>}
      </span>
      <span className="mnav__label">{label}</span>
    </button>
  );
}
