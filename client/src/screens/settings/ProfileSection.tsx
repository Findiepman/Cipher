/**
 * How you look to the people you talk to.
 *
 * The preview card is the whole idea of this screen: every control under it
 * changes the card immediately, so nothing has to be saved to find out what it
 * did. What it shows is exactly the row your contacts see, security number
 * included — the one detail a normal messenger's profile card does not have and
 * this one cannot leave out.
 */
import { useRef, useState } from 'react';
import { Avatar, presenceLabel } from '../../components/Avatar';
import { Actions, Group, Note, Row, Segmented, TextField } from '../../components/settings/controls';
import { AvatarError, readAvatarFile } from '../../lib/settings/avatarImage';
import { displayName } from '../../lib/settings/profile';
import { ACCENTS } from '../../lib/settings/types';
import { useSettings } from '../../state/SettingsProvider';
import type { Presence, User } from '../../types';

const PRESENCES: { value: Presence; label: string }[] = [
  { value: 'online', label: 'Online' },
  { value: 'idle', label: 'Idle' },
  { value: 'dnd', label: 'Do not disturb' },
  { value: 'offline', label: 'Invisible' },
];

export function ProfileSection({ user, fallbackName }: { user: User; fallbackName: string }) {
  const { settings, update, reset } = useSettings();
  const profile = settings.profile;
  const fileInput = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  async function pickAvatar(file: File | undefined) {
    if (!file) return;
    setImageError(null);
    try {
      update('profile', { avatar: await readAvatarFile(file) });
    } catch (caught) {
      setImageError(
        caught instanceof AvatarError ? caught.message : 'That image could not be used.',
      );
    }
  }

  return (
    <>
      <PreviewCard user={user} />

      <Group title="picture">
        <Row
          label="Avatar"
          hint="Cropped square and scaled to 128px. Everything the file carried
                — including where a phone photo was taken — is dropped in the
                process."
        >
          <Actions>
            <button
              type="button"
              className="set-btn"
              onClick={() => fileInput.current?.click()}
            >
              {profile.avatar ? 'Replace' : 'Upload'}
            </button>
            {profile.avatar && (
              <button
                type="button"
                className="set-btn set-btn--quiet"
                onClick={() => update('profile', { avatar: null })}
              >
                Remove
              </button>
            )}
          </Actions>
        </Row>

        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            void pickAvatar(event.target.files?.[0]);
            // Cleared so picking the same file twice still fires a change.
            event.target.value = '';
          }}
        />

        {imageError && <Note tone="warn">{imageError}</Note>}

        <Row
          label="Accent"
          hint={
            profile.avatar
              ? 'Used behind your name and wherever your picture does not fit.'
              : 'The tile you get until you upload a picture.'
          }
          stacked
        >
          <div className="set-swatches" role="radiogroup" aria-label="Accent colour">
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

      <Group title="identity">
        <TextField
          label="Display name"
          value={profile.displayName}
          maxLength={32}
          counter
          placeholder={fallbackName}
          onChange={(value) => update('profile', { displayName: value })}
          hint="What people see instead of your username. Leave it empty to use your username."
        />

        <TextField
          label="About"
          value={profile.about}
          maxLength={140}
          counter
          placeholder="Something short."
          onChange={(value) => update('profile', { about: value })}
        />

        <Row label="Presence" hint="What your contacts are told you are up to.">
          <Segmented
            label="Presence"
            value={profile.presence}
            options={PRESENCES}
            onChange={(presence) => update('profile', { presence })}
          />
        </Row>
      </Group>

      <Note tone="sealed">
        Your profile is stored on this device, not on the server. Sharing it with
        your contacts needs an endpoint that does not exist yet — and when it
        does, it will be sent encrypted, the same way your messages are.
      </Note>

      <Actions>
        <button
          type="button"
          className="set-btn set-btn--quiet"
          onClick={() => reset('profile')}
        >
          Reset profile
        </button>
      </Actions>
    </>
  );
}

function PreviewCard({ user }: { user: User }) {
  const { settings } = useSettings();
  const profile = settings.profile;

  return (
    <div className="set-preview" style={{ ['--accent' as string]: profile.accent }}>
      <div className="set-preview__banner" />
      <div className="set-preview__body">
        <div className="set-preview__avatar">
          {/* No presence dot on the avatar: it is sized as a fraction of the
              avatar, which at 72px is a badge rather than a dot. The line
              below carries the presence instead. */}
          <Avatar user={user} size={72} />
        </div>

        <p className="set-preview__name">{displayName(profile, user.name)}</p>
        <p className="set-preview__meta">
          <span className="mono">{user.fingerprint}</span>
          <span className="set-preview__sep">·</span>
          <span className={`set-preview__dot set-preview__dot--${profile.presence}`} />
          <span>{presenceLabel(profile.presence)}</span>
        </p>

        {profile.about.trim() && <p className="set-preview__about">{profile.about}</p>}
      </div>
    </div>
  );
}
