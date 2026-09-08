import type { Key } from '../lib/i18n/en';
import type { ActivityBarPosition } from '../lib/settings/types';
import { useT } from '../state/I18nProvider';
import type { User } from '../types';
import { Avatar } from './Avatar';
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
  currentUser: User | null;
  /** Pending incoming friend requests, badged on the Friends pill. */
  requestCount: number;
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
  currentUser,
  requestCount,
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
          active={view === 'direct'}
          onClick={() => onSelect('direct')}
        />
        <WorkspacePill
          label={t('chat.friends')}
          active={view === 'friends'}
          badge={requestCount}
          onClick={() => onSelect('friends')}
        />
        <WorkspacePill
          label={t('vault.title')}
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
        {currentUser && <Avatar user={currentUser} size={32} showPresence />}
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

function WorkspacePill({
  label,
  active,
  badge,
  dot,
  onClick,
}: {
  label: string;
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
    >
      {active && <span className="workspace__dot" />}
      {!active && dot && <span className="workspace__dot workspace__dot--unread" />}
      <span className="workspace__label">{label}</span>
      {badge ? <span className="workspace__badge mono">{badge}</span> : null}
    </button>
  );
}
