import type { Key } from '../lib/i18n/en';
import type { ActivityBarPosition } from '../lib/settings/types';
import { LockIcon, MessageIcon, ProfileIcon } from './Icons';
import { useT } from '../state/I18nProvider';
import { BrandMark } from './BrandMark';
import '../styles/top-bar.css';

/**
 * The three places there are to be. Group servers are deliberately absent: they
 * need a key model that has not been chosen (packages/crypto/AGENTS.md), and a
 * rail of rooms that cannot be encrypted would be promising something this app
 * does not do yet.
 *
 * Vault is the odd one out and belongs here anyway: it behaves like a
 * conversation, so it wants the same way in as the other conversations rather
 * than a gesture somebody has to be told about. See vault-plan.md.
 */
export type View = 'direct' | 'friends' | 'vault';

type Props = {
  view: View;
  onSelect: (view: View) => void;
  /** Pending incoming friend requests, badged on the Friends pill. */
  requestCount: number;
  /** Unread messages across every conversation, badged on Direct. */
  unreadCount: number;
  /** Shown when the socket is not up, so silence is never mistaken for calm. */
  connection: string;
  /**
   * Which edge this is docked to (Appearance, Activity bar). Left and right
   * turn it into a vertical rail; the layout around it is in app.css, the bar's
   * own two shapes are in top-bar.css. It is an attribute rather than a class
   * so one rule can cover both rail sides.
   */
  placement?: ActivityBarPosition;
};

export function TopBar({
  view,
  onSelect,
  requestCount,
  unreadCount,
  connection,
  placement = 'top',
}: Props) {
  const t = useT();
  return (
    <header className="top-bar" data-placement={placement}>
      <div className="top-bar__brand">
        <BrandMark size={22} className="top-bar__mark" />
        <span className="top-bar__wordmark">Cipher</span>
      </div>

      <nav className="top-bar__workspaces" aria-label={t('chat.views')}>
        <WorkspacePill
          label={t('chat.direct')}
          icon={<MessageIcon size={20} />}
          active={view === 'direct'}
          /* Unread waiting in Direct, shown while you are somewhere else. The
             count is on the conversation list, which you cannot see from
             Friends or the Vault, so without this the rail is the one place
             that knows something arrived and says nothing about it. */
          badge={view === 'direct' ? 0 : unreadCount}
          onClick={() => onSelect('direct')}
        />
        <WorkspacePill
          label={t('chat.friends')}
          icon={<ProfileIcon size={20} />}
          active={view === 'friends'}
          badge={requestCount}
          onClick={() => onSelect('friends')}
        />
        <WorkspacePill
          label={t('vault.title')}
          icon={<LockIcon size={20} />}
          active={view === 'vault'}
          onClick={() => onSelect('vault')}
        />
      </nav>

      <div className="top-bar__right">
        {connection !== 'online' && (
          <span className="top-bar__connection mono" role="status">
            {t(connectionLabel(connection))}
          </span>
        )}
      </div>
    </header>
  );
}

/// Says what is true rather than hiding it. A message typed while this is
/// showing is queued, not lost, and the composer says so too.
function connectionLabel(connection: string): Key {
  switch (connection) {
    case 'connecting':
      return 'chat.connecting';
    case 'offline':
      return 'chat.offlineQueue';
    default:
      return 'chat.notConnected';
  }
}

/**
 * One destination in the rail.
 *
 * The label is the tooltip and the accessible name rather than visible text,
 * which is what turns a 132px column of words into a strip of icons and hands
 * the width back to the conversation. Discord's rail works the same way and
 * for the same reason: three destinations are learned in a day, and after that
 * the words are just a wall.
 *
 * The phone's bar keeps its labels. There the bar is the only navigation and
 * the screen is short, so an unlabelled glyph is something you learn once and
 * forget.
 */
function WorkspacePill({
  label,
  icon,
  active,
  badge,
  dot,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  badge?: number;
  dot?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`workspace${active ? ' workspace--active' : ''}`}
      onClick={onClick}
      aria-current={active || undefined}
      title={label}
      aria-label={label}
    >
      {/* The marker Discord puts against the edge for where you are. It reads
          at a glance from the corner of the eye, which a colour change alone
          does not. */}
      <span className="workspace__marker" aria-hidden />
      <span className="workspace__icon">{icon}</span>
      {!active && dot && <span className="workspace__dot workspace__dot--unread" />}
      {badge ? <span className="workspace__badge mono">{badge > 99 ? '99+' : badge}</span> : null}
    </button>
  );
}
