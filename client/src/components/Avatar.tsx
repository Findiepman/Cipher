import { avatarInitial } from '../lib/settings/profile';
import type { Presence, User } from '../types';
import '../styles/avatar.css';

type Props = {
  user: User;
  size?: number;
  /** Presence dot in the corner, punched out of the avatar like Discord's. */
  showPresence?: boolean;
};

export function Avatar({ user, size = 40, showPresence = false }: Props) {
  return (
    <div className="avatar" style={{ width: size, height: size }}>
      {user.avatarUrl ? (
        <img className="avatar__image" src={user.avatarUrl} alt="" draggable={false} />
      ) : (
        <div
          className="avatar__image"
          style={{ background: user.color, fontSize: size * 0.4 }}
        >
          {avatarInitial(user.name)}
        </div>
      )}
      {showPresence && (
        <span
          className={`avatar__presence avatar__presence--${user.presence}`}
          style={{ width: size * 0.35, height: size * 0.35 }}
          title={presenceLabel(user.presence)}
        />
      )}
    </div>
  );
}

export function presenceLabel(presence: Presence): string {
  switch (presence) {
    case 'online':
      return 'Online';
    case 'idle':
      return 'Idle';
    case 'dnd':
      return 'Do Not Disturb';
    case 'offline':
      return 'Offline';
  }
}
