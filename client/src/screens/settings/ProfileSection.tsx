/**
 * How you look to the people you talk to.
 *
 * The preview card is the whole idea of this screen: every control under it
 * changes the card immediately, so nothing has to be saved to find out what it
 * did. What it shows is exactly the row your contacts see, security number
 * included: the one detail a normal messenger's profile card does not have and
 * this one cannot leave out.
 */
import { useState } from 'react';
import { Avatar, presenceLabel } from '../../components/Avatar';
import {
  Actions,
  Group,
  Note,
  Row,
  Segmented,
  TextArea,
  TextField,
} from '../../components/settings/controls';
import { PictureField } from '../../components/settings/PictureField';
import { colorFor } from '../../lib/presentation';
import { PICTURE_FRAMES } from '../../lib/settings/avatarImage';
import { accentOf, avatarInitial, displayName } from '../../lib/settings/profile';
import {
  MAX_PROFILES,
  MAX_PROFILE_NAME,
  addBlank,
  duplicate,
  remove,
  rename,
  saveAs,
  suggestName,
  switchTo,
} from '../../lib/settings/savedProfiles';
import type { Key } from '../../lib/i18n/en';
import { ABOUT_MAX, ACCENTS, resolvePicture, type SavedProfile } from '../../lib/settings/types';
import { useT } from '../../state/I18nProvider';
import { useSettings } from '../../state/SettingsProvider';
import type { Presence, User } from '../../types';

/* "Invisible" rather than "Offline" here on purpose: this is the thing you are
   choosing to appear as, not the thing you have become. */
const PRESENCES: { value: Presence; label: Key }[] = [
  { value: 'online', label: 'presence.online' },
  { value: 'idle', label: 'presence.idle' },
  { value: 'dnd', label: 'presence.dnd' },
  { value: 'offline', label: 'presence.invisible' },
];

export function ProfileSection({ user, fallbackName }: { user: User; fallbackName: string }) {
  const { settings, update, reset } = useSettings();
  const t = useT();
  const profile = settings.profile;

  return (
    <>
      <PreviewCard user={user} />

      <ProfilePicker fallbackName={fallbackName} userId={user.id} />

      <Group title={t('profile.group.picture')}>
        <PictureField
          label={t('profile.avatar')}
          hint={t('profile.avatarHint')}
          value={profile.avatar}
          frame={PICTURE_FRAMES.avatar}
          shape="avatar"
          title="crop.title"
          body="crop.body"
          onChange={(avatar) => update('profile', { avatar })}
        />

        <PictureField
          label={t('profile.banner')}
          hint={t('profile.bannerHint')}
          value={profile.banner}
          frame={PICTURE_FRAMES.banner}
          title="crop.bannerTitle"
          body="crop.bannerBody"
          onChange={(banner) => update('profile', { banner })}
        />

        <Row
          label={t('profile.accent')}
          hint={t(profile.avatar ? 'profile.accentHint' : 'profile.accentHintNoPic')}
          stacked
        >
          <div
            className="set-swatches"
            role="radiogroup"
            aria-label={t('profile.accent')}
          >
            {/* First, and painted with the colour your account derives on
                its own: what you have until you choose, and what you get
                back by choosing it. */}
            <button
              type="button"
              role="radio"
              aria-checked={profile.accent === ''}
              aria-label={t('profile.accentAuto')}
              className={profile.accent === '' ? 'set-swatch set-swatch--on' : 'set-swatch'}
              style={{ background: colorFor(user.id) }}
              onClick={() => update('profile', { accent: '' })}
            />
            {ACCENTS.map((accent) => (
              <button
                key={accent}
                type="button"
                role="radio"
                aria-checked={profile.accent === accent}
                aria-label={accent}
                className={
                  profile.accent === accent ? 'set-swatch set-swatch--on' : 'set-swatch'
                }
                style={{ background: accent }}
                onClick={() => update('profile', { accent })}
              />
            ))}
          </div>
        </Row>
      </Group>

      <Group title={t('profile.group.identity')}>
        <TextField
          label={t('profile.displayName')}
          value={profile.displayName}
          maxLength={32}
          counter
          placeholder={fallbackName}
          onChange={(value) => update('profile', { displayName: value })}
          hint={t('profile.displayNameHint')}
        />

        <Row label={t('profile.presence')} hint={t('profile.presenceHint')}>
          <Segmented
            label={t('profile.presence')}
            value={profile.presence}
            options={PRESENCES.map((one) => ({ ...one, label: t(one.label) }))}
            onChange={(presence) => update('profile', { presence })}
          />
        </Row>
      </Group>

      <Group title={t('profile.group.about')} hint={t('profile.aboutHint')}>
        <TextArea
          label={t('profile.about')}
          value={profile.about}
          maxLength={ABOUT_MAX}
          rows={5}
          counter
          placeholder={t('profile.aboutPlaceholder')}
          onChange={(value) => update('profile', { about: value })}
        />
      </Group>

      <Note tone="sealed">{t('profile.note')}</Note>

      <Actions>
        <button
          type="button"
          className="set-btn set-btn--quiet"
          onClick={() => reset('profile')}
        >
          {t('profile.reset')}
        </button>
      </Actions>
    </>
  );
}

/**
 * The shelf of saved profiles.
 *
 * Switching is one click and takes effect immediately, like every other
 * control on this screen. There is no save button for edits: whatever you
 * change while a profile is loaded is already in it, which is why the only
 * thing this asks you to name is the profile itself.
 */
function ProfilePicker({ fallbackName, userId }: { fallbackName: string; userId: string }) {
  const { settings, savedProfiles, applyProfiles } = useSettings();
  const t = useT();
  const { active } = settings.profiles;
  const state = { profile: settings.profile, profiles: settings.profiles };
  const loaded = savedProfiles.find((entry) => entry.id === active) ?? null;
  const full = savedProfiles.length >= MAX_PROFILES;

  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState(false);

  return (
    <Group title={t('profile.group.profiles')}>
      {savedProfiles.length > 0 && (
        <div
          className="set-profiles"
          role="radiogroup"
          aria-label={t('profile.saved')}
        >
          {savedProfiles.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={entry.id === active}
              className={
                entry.id === active ? 'set-profile set-profile--on' : 'set-profile'
              }
              onClick={() => {
                setConfirming(false);
                applyProfiles(switchTo(state, entry.id));
              }}
            >
              <ProfileTile entry={entry} fallbackName={fallbackName} userId={userId} />
              <span className="set-profile__name">{entry.name}</span>
            </button>
          ))}

          <button
            type="button"
            className="set-profile set-profile--new"
            disabled={full}
            title={full ? t('profile.limitShort', { max: MAX_PROFILES }) : undefined}
            onClick={() => {
              setConfirming(false);
              applyProfiles(addBlank(state, suggestName(savedProfiles)));
            }}
          >
            <span className="set-profile__plus" aria-hidden="true">
              +
            </span>
            <span className="set-profile__name">{t('profile.new')}</span>
          </button>
        </div>
      )}

      {loaded ? (
        <>
          <TextField
            label={t('profile.name')}
            value={loaded.name}
            maxLength={MAX_PROFILE_NAME}
            onChange={(value) => applyProfiles(rename(state, loaded.id, value))}
            hint={t('profile.nameHint')}
          />
          <Actions>
            <button
              type="button"
              className="set-btn"
              disabled={full}
              onClick={() =>
                applyProfiles(
                  duplicate(state, loaded.id, t('profile.copyOf', { name: loaded.name })),
                )
              }
            >
              {t('profile.duplicate')}
            </button>
            {confirming ? (
              <>
                <button
                  type="button"
                  className="set-btn set-btn--danger"
                  onClick={() => {
                    setConfirming(false);
                    applyProfiles(remove(state, loaded.id));
                  }}
                >
                  {t('vault.settings.deleteIt')}
                </button>
                <button
                  type="button"
                  className="set-btn set-btn--quiet"
                  onClick={() => setConfirming(false)}
                >
                  {t('vault.settings.keepIt')}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="set-btn set-btn--quiet"
                onClick={() => setConfirming(true)}
              >
                {t('common.delete')}
              </button>
            )}
          </Actions>
          {confirming && (
            <Note tone="warn">{t('profile.deleteNote')}</Note>
          )}
        </>
      ) : (
        <>
          <Row
            label={t(savedProfiles.length === 0 ? 'profile.keepThis' : 'profile.notSaved')}
            hint={t(
              savedProfiles.length === 0 ? 'profile.keepThisHint' : 'profile.notSavedHint',
            )}
            stacked
          >
            <div className="set-profile-save">
              <input
                className="set-input"
                value={draft}
                maxLength={MAX_PROFILE_NAME}
                placeholder={suggestName(savedProfiles)}
                aria-label={t('profile.nameFor')}
                onChange={(event) => setDraft(event.target.value)}
              />
              <button
                type="button"
                className="set-btn"
                disabled={full}
                onClick={() => {
                  applyProfiles(saveAs(state, draft || suggestName(savedProfiles)));
                  setDraft('');
                }}
              >
                {t('common.save')}
              </button>
            </div>
          </Row>
        </>
      )}

      {full && <Note>{t('profile.limit', { max: MAX_PROFILES })}</Note>}
    </Group>
  );
}

/** The little face on a profile chip. The saved one, not the live one. */
function ProfileTile({
  entry,
  fallbackName,
  userId,
}: {
  entry: SavedProfile;
  fallbackName: string;
  userId: string;
}) {
  const name = displayName(entry.profile, fallbackName);
  return entry.profile.avatar ? (
    <img className="set-profile__face" src={entry.profile.avatar} alt="" />
  ) : (
    <span className="set-profile__face" style={{ background: accentOf(entry.profile, userId) }}>
      {avatarInitial(name)}
    </span>
  );
}

function PreviewCard({ user }: { user: User }) {
  const { settings } = useSettings();
  const t = useT();
  const profile = settings.profile;

  // Read through the resolver rather than straight out of settings: this one
  // reaches CSS as url(...), and the settings blob is hand-editable.
  const banner = resolvePicture(profile.banner);

  // `user` already went through withProfile, so its colour is the accent
  // after "auto" has been resolved. The raw setting can be '' here.
  return (
    <div className="set-preview" style={{ ['--accent' as string]: user.color }}>
      <div
        className={banner ? 'set-preview__banner set-preview__banner--picture' : 'set-preview__banner'}
        style={banner ? { backgroundImage: `url(${banner})` } : undefined}
      />
      <div className="set-preview__body">
        <div className="set-preview__avatar">
          {/* No presence dot on the avatar: it is sized as a fraction of the
              avatar, which at 72px is a badge rather than a dot. The line
              below carries the presence instead. */}
          <Avatar user={user} size={72} />
        </div>

        <p className="set-preview__name">{displayName(profile, user.name)}</p>
        <p className="set-preview__meta">
          {/* The handle, not a key fingerprint. The UI makes no claim about
              encryption anywhere (STATUS.md, decision 21), and this preview is
              meant to show what other people will see. */}
          <span className="mono">{user.username}</span>
          <span className="set-preview__sep">·</span>
          <span className={`set-preview__dot set-preview__dot--${profile.presence}`} />
          <span>{t(presenceLabel(profile.presence))}</span>
        </p>

        {profile.about.trim() && <p className="set-preview__about">{profile.about}</p>}
      </div>
    </div>
  );
}
