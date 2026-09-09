/**
 * One person, rendered as a card.
 *
 * This is the prefab: it takes a `User` and knows nothing about where it is
 * being drawn, so the same component fills the side panel beside a
 * conversation, and can later fill a popout or a modal without being rewritten.
 * Everything that varies between those places is a prop, and the only piece of
 * chrome it owns is its own layout.
 *
 * It deliberately shows both names. A nickname replaces the username
 * everywhere else in the app, so this is the one screen that always says who
 * you are actually talking to, which matters when the label is one you chose
 * and they never agreed to.
 */
import type { FullProfileDto } from '../lib/api/types';
import { shortDay } from '../lib/i18n/format';
import { resolvePicture } from '../lib/settings/types';
import { useI18n } from '../state/I18nProvider';
import type { User } from '../types';
import { Avatar, presenceLabel } from './Avatar';
import { BanIcon, MessageIcon, PencilIcon, UserMinusIcon } from './Icons';
import { useFullProfile } from './useFullProfile';
import '../styles/user-profile.css';

export type ProfileAction = 'message' | 'nickname' | 'unfriend' | 'block';

type Props = {
  user: User;
  /** True when they are in your friend list. Gates the friend-only actions. */
  isFriend: boolean;
  /** Their side of the friendship, ISO-8601. Absent for a non-friend. */
  friendsSince?: string;
  onAction: (action: ProfileAction) => void;
  /** Hidden when the card is already the whole panel. */
  onClose?: () => void;
  /**
   * Where the rest of the card comes from. The list already carried the
   * name, picture and colour; this fetches the banner. Injectable so a test
   * can hand one in without a server.
   */
  loadProfile?: (userId: string) => Promise<FullProfileDto>;
};

export function UserProfile({
  user,
  isFriend,
  friendsSince,
  onAction,
  onClose,
  loadProfile,
}: Props) {
  const { locale, t } = useI18n();
  const full = useFullProfile(user.id, user.profileUpdatedAt, loadProfile);
  // Through the resolver rather than straight into url(): the value came
  // from the server, and only a data: URL of an image is let near CSS.
  const banner = resolvePicture(full?.banner ?? null);

  return (
    <div className="profile">
      {/* Their banner when they chose one; otherwise a band of the person's
          own colour, so two profiles never look alike even before you read
          the name. */}
      <div
        className={banner ? 'profile__banner profile__banner--picture' : 'profile__banner'}
        style={banner ? { backgroundImage: `url(${banner})` } : { background: user.color }}
      >
        {onClose && (
          <button
            type="button"
            className="profile__close"
            onClick={onClose}
            aria-label={t('userProfile.close')}
          >
            <CloseGlyph />
          </button>
        )}
      </div>

      <div className="profile__avatar">
        <Avatar user={user} size={72} showPresence />
      </div>

      <div className="profile__body">
        <h2 className="profile__name">{user.name}</h2>
        <p className="profile__handle mono">{user.username}</p>

        {/* Their own words, kept exactly as typed: line breaks included,
            which is why it is a pre-wrapped paragraph and not a line. */}
        {user.activity && <p className="profile__about">{user.activity}</p>}

        <dl className="profile__facts">
          <div className="profile__fact">
            <dt>{t('userProfile.status')}</dt>
            <dd>{t(presenceLabel(user.presence))}</dd>
          </div>

          {user.nickname && (
            <div className="profile__fact">
              <dt>{t('userProfile.nickname')}</dt>
              <dd>
                {user.nickname}
                <span className="profile__note">{t('userProfile.onlyYou')}</span>
              </dd>
            </div>
          )}

          {friendsSince && (
            <div className="profile__fact">
              <dt>{t('userProfile.friendsSince')}</dt>
              <dd>{shortDay(friendsSince, locale)}</dd>
            </div>
          )}
        </dl>

        <div className="profile__actions">
          {isFriend && (
            <button
              type="button"
              className="profile__button profile__button--primary"
              onClick={() => onAction('message')}
            >
              <MessageIcon size={15} />
              {t('userProfile.message')}
            </button>
          )}

          <button
            type="button"
            className="profile__button"
            onClick={() => onAction('nickname')}
          >
            <PencilIcon size={15} />
            {t(user.nickname ? 'userProfile.changeNickname' : 'userProfile.addNickname')}
          </button>

          {isFriend && (
            <button
              type="button"
              className="profile__button profile__button--danger"
              onClick={() => onAction('unfriend')}
            >
              <UserMinusIcon size={15} />
              {t('userProfile.unfriend')}
            </button>
          )}

          <button
            type="button"
            className="profile__button profile__button--danger"
            onClick={() => onAction('block')}
          >
            <BanIcon size={15} />
            {t('userProfile.block')}
          </button>
        </div>
      </div>
    </div>
  );
}

function CloseGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      aria-hidden
    >
      <path d="m5 5 14 14M19 5 5 19" />
    </svg>
  );
}

