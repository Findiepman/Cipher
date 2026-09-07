/**
 * Turning stored preferences into the User the rest of the app renders.
 *
 * Your own row, your avatar in the top bar, and your bubbles all read from the
 * same `User` shape as everyone else's, so the profile settings do not get
 * their own rendering path — they are folded into that shape once, here.
 */
import type { User } from '../../types';
import type { ProfileSettings } from './types';

/** What to call the user, given a profile that may not override anything. */
export function displayName(profile: ProfileSettings, fallback: string): string {
  const chosen = profile.displayName.trim();
  return chosen || fallback;
}

/** The letter on a lettered avatar tile. */
export function avatarInitial(name: string): string {
  return [...name.trim()][0]?.toUpperCase() ?? '?';
}

/** The signed-in user as everything else expects to receive them. */
export function withProfile(user: User, profile: ProfileSettings): User {
  return {
    ...user,
    name: displayName(profile, user.name),
    color: profile.accent,
    avatarUrl: profile.avatar ?? undefined,
    presence: profile.presence,
    activity: profile.about.trim() || undefined,
  };
}
