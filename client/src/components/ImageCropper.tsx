/**
 * Choosing which part of a picture is kept.
 *
 * Drag to move, pinch or scroll to zoom, Save to keep it. One cropper for all
 * three pictures the settings screen stores, because the only thing that
 * differs between them is the shape of the frame. An avatar is masked as a
 * squircle rather than a circle, because that is the shape an avatar is drawn
 * in everywhere else in the app (see avatar.css) and a circular cropper would
 * promise corners the app then clips off. A banner and a wallpaper are not
 * masked at all: they are shown at the aspect they will really be drawn at,
 * which is the whole of what there is to line up.
 *
 * Nothing is written to settings until Save: cancelling leaves the old picture
 * alone, and the decoded bitmap is released either way.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type AvatarSource,
  type Crop,
  type Frame,
  MAX_ZOOM,
  centredCrop,
  clampCrop,
  coverSize,
  renderPicture,
} from '../lib/settings/avatarImage';
import type { Key } from '../lib/i18n/en';
import { useT } from '../state/I18nProvider';
import '../styles/avatar-cropper.css';

type Props = {
  source: AvatarSource;
  /** What the crop is baked at. Its aspect is the frame's shape on screen. */
  frame: Frame;
  /** Squircle mask for an avatar, no mask for anything else. */
  shape?: 'avatar' | 'plain';
  /** What the dialog says it is cropping. */
  title: Key;
  body: Key;
  /** Hands back the baked data URL. */
  onSave: (dataUrl: string) => void;
  onCancel: () => void;
};

/**
 * Re-zooms a crop so the point under (`atX`, `atY`), in frame fractions,
 * stays under it. Without this correction every zoom creeps toward the
 * top-left corner of the picture instead of toward what you are looking at.
 */
function zoomCrop(
  source: { width: number; height: number },
  from: Crop,
  zoom: number,
  atX: number,
  atY: number,
  aspect: number,
): Crop {
  const next = Math.min(Math.max(zoom, 1), MAX_ZOOM);
  const before = coverSize(source, from.zoom, aspect);
  const after = coverSize(source, next, aspect);
  // Where the anchor sits on the picture itself, 0 to 1 across the image.
  const u = (atX - from.x) / before.width;
  const v = (atY - from.y) / before.height;
  return { zoom: next, x: atX - u * after.width, y: atY - v * after.height };
}

export function ImageCropper({
  source,
  frame,
  shape = 'plain',
  title,
  body,
  onSave,
  onCancel,
}: Props) {
  const t = useT();
  const aspect = frame.width / frame.height;
  const [crop, setCrop] = useState<Crop>(() => centredCrop(source, aspect));
  const box = useRef<HTMLDivElement>(null);

  /**
   * Live pointers, keyed by id: one is a drag, two are a pinch. Kept in a ref
   * rather than state because a pointermove that waited for a re-render before
   * reading the next event would drop half the gesture on a slow phone.
   */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ crop: Crop; spread: number; atX: number; atY: number } | null>(null);

  /**
   * The frame's width and height in CSS pixels: the units the crop fractions
   * are in. Two numbers rather than one, because x is a fraction of the width
   * and y a fraction of the height, and on a wide banner those differ.
   */
  const side = () => ({
    x: box.current?.clientWidth || 1,
    y: box.current?.clientHeight || 1,
  });

  // Functional updates throughout: several pointer events can arrive between
  // two renders, and each one has to build on the last, not on what was on
  // screen when the handler was created.
  const nudge = useCallback(
    (step: (previous: Crop) => Crop) =>
      setCrop((previous) => clampCrop(source, step(previous), aspect)),
    [source, aspect],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  function begin(event: React.PointerEvent<HTMLDivElement>) {
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    pinch.current = null; // Re-baselined on the first two-finger move.
  }

  function move(event: React.PointerEvent<HTMLDivElement>) {
    const live = pointers.current;
    const previous = live.get(event.pointerId);
    if (!previous) return;
    live.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const points = [...live.values()];
    const s = side();

    if (points.length === 1) {
      // The picture follows the finger one for one, which is the only
      // behaviour that feels like moving a photo rather than a scrollbar.
      const dx = (event.clientX - previous.x) / s.x;
      const dy = (event.clientY - previous.y) / s.y;
      nudge((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
      return;
    }

    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    const [a, b] = points;
    const spread = Math.hypot(a.x - b.x, a.y - b.y);
    const atX = ((a.x + b.x) / 2 - rect.left) / s.x;
    const atY = ((a.y + b.y) / 2 - rect.top) / s.y;

    // Anchored on the midpoint between the fingers, so the detail under them
    // stays put instead of sliding to the middle of the frame.
    if (!pinch.current || pinch.current.spread === 0) {
      pinch.current = { crop, spread, atX, atY };
      return;
    }
    const from = pinch.current;
    nudge(() =>
      zoomCrop(source, from.crop, (spread / from.spread) * from.crop.zoom, atX, atY, aspect),
    );
  }

  function end(event: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    pinch.current = null;
  }

  function wheel(event: React.WheelEvent<HTMLDivElement>) {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    const s = side();
    const atX = (event.clientX - rect.left) / s.x;
    const atY = (event.clientY - rect.top) / s.y;
    // A trackpad reports small deltas continuously and a mouse wheel reports
    // about a hundred in one go; an exponent keeps both feeling proportional.
    const factor = Math.exp(-event.deltaY / 400);
    nudge((c) => zoomCrop(source, c, c.zoom * factor, atX, atY, aspect));
  }

  /** Arrow keys move the picture, so the cropper works without a pointer. */
  function key(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 0.08 : 0.02;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = moves[event.key];
    if (!delta) return;
    event.preventDefault();
    // The frame moves the way the arrow points, so the picture moves against
    // it, the same convention as dragging the image itself.
    nudge((c) => ({ ...c, x: c.x - delta[0], y: c.y - delta[1] }));
  }

  const { width, height } = coverSize(source, crop.zoom, aspect);

  return (
    <div
      className="dialog__scrim"
      onPointerDown={(event) => event.target === event.currentTarget && onCancel()}
    >
      <div className="dialog crop" role="dialog" aria-modal="true" aria-labelledby="crop-title">
        <h2 className="dialog__title" id="crop-title">
          {t(title)}
        </h2>
        <p className="dialog__body">{t(body)}</p>

        <div
          className={`crop__frame crop__frame--${shape}`}
          style={{ aspectRatio: String(aspect) }}
          ref={box}
          role="application"
          aria-label={t('crop.position')}
          tabIndex={0}
          onPointerDown={begin}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onWheel={wheel}
          onKeyDown={key}
        >
          <img
            className="crop__image"
            src={source.previewUrl}
            alt=""
            style={{
              width: `${width * 100}%`,
              height: `${height * 100}%`,
              left: `${crop.x * 100}%`,
              top: `${crop.y * 100}%`,
            }}
            draggable={false}
          />
          {/* Drawn over the picture rather than around it: the mask is what
              shows the exact shape an avatar gets clipped to. A banner and a
              wallpaper are not clipped, so they get no mask at all. */}
          {shape === 'avatar' && <div className="crop__mask" aria-hidden="true" />}
        </div>

        <div className="crop__zoom">
          <span className="crop__zoom-label">{t('crop.zoom')}</span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={crop.zoom}
            aria-label={t('crop.zoom')}
            onChange={(event) => {
              const zoom = Number(event.target.value);
              nudge((c) => zoomCrop(source, c, zoom, 0.5, 0.5, aspect));
            }}
          />
          <span className="crop__zoom-value mono">{crop.zoom.toFixed(1)}×</span>
        </div>

        <div className="dialog__actions">
          <button
            type="button"
            className="dialog__button crop__recentre"
            onClick={() => setCrop(centredCrop(source, aspect))}
          >
            {t('crop.recentre')}
          </button>
          <button type="button" className="dialog__button" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="dialog__button dialog__button--primary"
            onClick={() => onSave(renderPicture(source, crop, frame))}
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
