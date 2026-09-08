import type { Key } from '../lib/i18n/en';
import { useT } from '../state/I18nProvider';
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
  const t = useT();
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
          title={t(presenceLabel(user.presence))}
        />
      )}
    </div>
  );
}

/**
 * The catalogue key for a presence, not the word.
 *
 * Callers translate it. This function is used from the avatar itself, the
 * profile card and the settings preview, none of which agree on whether they
 * have a `t` in scope, and a key is the one thing all three can carry.
 */
export function presenceLabel(presence: Presence): Key {
  switch (presence) {
    case 'online':
      return 'presence.online';
    case 'idle':
      return 'presence.idle';
    case 'dnd':
      return 'presence.dnd';
    case 'offline':
      return 'presence.offline';
  }
}
