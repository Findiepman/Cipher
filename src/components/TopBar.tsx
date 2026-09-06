import type { Server, User } from '../types';
import { Avatar } from './Avatar';
import { KeyholeIcon, PlusIcon, SearchIcon } from './Icons';
import '../styles/top-bar.css';

type Props = {
  servers: Server[];
  activeServerId: string;
  onSelect: (serverId: string) => void;
  currentUser: User;
  /** Unread direct conversations, badged on the DM pill. */
  dmUnread: number;
};

/**
 * Workspaces live up here as text, not as a column of icons down the side.
 * You can read where you are instead of decoding a monogram.
 */
export function TopBar({
  servers,
  activeServerId,
  onSelect,
  currentUser,
  dmUnread,
}: Props) {
  return (
    <header className="top-bar">
      <div className="top-bar__brand">
        <KeyholeIcon size={20} className="top-bar__mark" />
        <span className="top-bar__wordmark">Cipher</span>
      </div>

      <nav className="top-bar__workspaces" aria-label="Workspaces">
        <WorkspacePill
          label="Direct"
          active={activeServerId === '@me'}
          badge={dmUnread}
          onClick={() => onSelect('@me')}
        />
        {servers.map((server) => (
          <WorkspacePill
            key={server.id}
            label={server.name}
            active={activeServerId === server.id}
            badge={server.mentions}
            dot={server.unread}
            onClick={() => onSelect(server.id)}
          />
        ))}
        <button type="button" className="top-bar__add" aria-label="Add a workspace">
          <PlusIcon size={14} />
        </button>
      </nav>

      <div className="top-bar__right">
        <button type="button" className="top-bar__search">
          <SearchIcon size={14} />
          <span>Search or jump to…</span>
        </button>
        <Avatar user={currentUser} size={32} showPresence />
      </div>
    </header>
  );
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
