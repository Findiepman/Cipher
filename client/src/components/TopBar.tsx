import type { User } from '../types';
import { Avatar } from './Avatar';
import { BrandMark } from './BrandMark';
import '../styles/top-bar.css';

/**
 * The two places there are to be. Group servers are deliberately absent: they
 * need a key model that has not been chosen (packages/crypto/AGENTS.md), and a
 * rail of rooms that cannot be encrypted would be promising something this app
 * does not do yet.
 */
export type View = 'direct' | 'friends';

type Props = {
  view: View;
  onSelect: (view: View) => void;
  currentUser: User | null;
  /** Pending incoming friend requests, badged on the Friends pill. */
  requestCount: number;
  /** Shown when the socket is not up, so silence is never mistaken for calm. */
  connection: string;
};

export function TopBar({ view, onSelect, currentUser, requestCount, connection }: Props) {
  return (
    <header className="top-bar">
      <div className="top-bar__brand">
        <BrandMark size={22} className="top-bar__mark" />
        <span className="top-bar__wordmark">Cipher</span>
      </div>

      <nav className="top-bar__workspaces" aria-label="Views">
        <WorkspacePill
          label="Direct"
          active={view === 'direct'}
          onClick={() => onSelect('direct')}
        />
        <WorkspacePill
          label="Friends"
          active={view === 'friends'}
          badge={requestCount}
          onClick={() => onSelect('friends')}
        />
      </nav>

      <div className="top-bar__right">
        {connection !== 'online' && (
          <span className="top-bar__connection mono" role="status">
            {connectionLabel(connection)}
          </span>
        )}
        {currentUser && <Avatar user={currentUser} size={32} showPresence />}
      </div>
    </header>
  );
}

/// Says what is true rather than hiding it. A message typed while this is
/// showing is queued, not lost, and the composer says so too.
function connectionLabel(connection: string): string {
  switch (connection) {
    case 'connecting':
      return 'connecting…';
    case 'offline':
      return 'offline — messages will queue';
    default:
      return 'not connected';
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
