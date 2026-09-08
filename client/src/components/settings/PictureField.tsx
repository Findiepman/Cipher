/**
 * Pick a picture, position it, keep it or take it away.
 *
 * Three settings rows are this exact thing (the avatar, the profile banner and
 * the wallpaper) and the interesting part is the same in all three: a file has
 * to be decoded before it can be cropped, decoding can fail in four different
 * ways, and the decoded bitmap outlives the render that made it, so it has to
 * be released whether the dialog was saved or cancelled. Three copies of that
 * would be three chances to leak a bitmap.
 *
 * What differs is only the frame it is baked at, the mask over the cropper and
 * the words. Those are props.
 */
import { useEffect, useRef, useState } from 'react';
import { Actions, Note, Row } from './controls';
import { ImageCropper } from '../ImageCropper';
import {
  type AvatarSource,
  type Frame,
  AvatarError,
  loadAvatarSource,
} from '../../lib/settings/avatarImage';
import type { Key } from '../../lib/i18n/en';
import { useT } from '../../state/I18nProvider';

type Props = {
  label: string;
  hint?: string;
  /** The stored data URL, or null. Only its presence is read here. */
  value: string | null;
  /** What the crop is baked at. Its aspect is the cropper's shape on screen. */
  frame: Frame;
  shape?: 'avatar' | 'plain';
  /** What the cropper dialog says it is cropping. */
  title: Key;
  body: Key;
  /** Null when the picture is removed. */
  onChange: (picture: string | null) => void;
};

export function PictureField({
  label,
  hint,
  value,
  frame,
  shape = 'plain',
  title,
  body,
  onChange,
}: Props) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  /* The picked file, decoded and waiting to be positioned. Held here rather
     than inside the cropper so the dialog can be unmounted without leaking the
     bitmap it was drawing. */
  const [cropping, setCropping] = useState<AvatarSource | null>(null);

  // A decoded image outlives a render, so it cannot be left to the collector.
  useEffect(() => () => cropping?.close(), [cropping]);

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      setCropping(await loadAvatarSource(file));
    } catch (caught) {
      setError(t(caught instanceof AvatarError ? caught.phrase : 'profile.badImage'));
    }
  }

  return (
    <>
      <Row label={label} hint={hint}>
        <Actions>
          <button type="button" className="set-btn" onClick={() => input.current?.click()}>
            {t(value ? 'profile.replace' : 'profile.upload')}
          </button>
          {value && (
            <button
              type="button"
              className="set-btn set-btn--quiet"
              onClick={() => onChange(null)}
            >
              {t('common.remove')}
            </button>
          )}
        </Actions>
      </Row>

      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          void pick(event.target.files?.[0]);
          // Cleared so picking the same file twice still fires a change.
          event.target.value = '';
        }}
      />

      {error && <Note tone="warn">{error}</Note>}

      {cropping && (
        <ImageCropper
          source={cropping}
          frame={frame}
          shape={shape}
          title={title}
          body={body}
          onCancel={() => setCropping(null)}
          onSave={(picture) => {
            onChange(picture);
            setCropping(null);
          }}
        />
      )}
    </>
  );
}
