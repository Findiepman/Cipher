/**
 * Turning a picked file into something small enough to keep in settings.
 *
 * The picture is decoded, cropped to a frame, drawn at that frame's size and
 * re-encoded. Two reasons for doing all that locally rather than storing the
 * file as-is: preferences live in localStorage, which is measured in a few
 * megabytes for the whole origin, and re-encoding through a canvas drops every
 * EXIF field the original carried, including, on a phone photo, the GPS
 * coordinates where it was taken.
 *
 * Which part gets kept is the user's to choose. `loadAvatarSource` decodes and
 * hands back the bitmap, the cropper drives a `Crop` over it, and
 * `renderPicture` bakes the result. A centre crop is only the starting point,
 * because on a photo of two people it is reliably the wrong answer.
 *
 * Three frames go through here and the maths is the same for all of them, so
 * every function below takes the frame's aspect rather than assuming a square:
 * the avatar, the wide band across a profile card and a wallpaper. See
 * `PICTURE_FRAMES`.
 */
import type { Key } from '../i18n/en';
import type { Phrase } from '../i18n/translate';

export const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

/** What a baked picture is drawn at, and therefore what gets stored. */
export interface Frame {
  width: number;
  height: number;
  /** Canvas quality, 0 to 1. Lower where the picture is larger. */
  quality: number;
}

/**
 * The three sizes, and the whole storage budget in one place.
 *
 * Everything here ends up base64 in localStorage, which is a few megabytes for
 * the origin, shared with up to ten saved profiles. The avatar and the banner
 * are small enough not to think about. The wallpaper is the one that could
 * fill the budget on its own, so it is capped well under a screen's own
 * resolution and encoded harder: it sits behind a dim and usually a blur, and
 * nobody is going to read it.
 */
export const PICTURE_FRAMES = {
  avatar: { width: 128, height: 128, quality: 0.85 },
  banner: { width: 640, height: 200, quality: 0.82 },
  wallpaper: { width: 1600, height: 900, quality: 0.72 },
} as const satisfies Record<string, Frame>;

/** How far in you can push before you are looking at pixels. */
export const MAX_ZOOM = 4;

export class AvatarError extends Error {
  /**
   * Which catalogue entry says this in words.
   *
   * `message` stays English for logs and for anyone reading a stack trace;
   * `phrase` is what the screen renders. This module has no `t` of its own.
   */
  readonly phrase: Phrase<Key>;

  constructor(phrase: Key, message: string) {
    super(message);
    this.name = 'AvatarError';
    this.phrase = { key: phrase };
  }
}

/**
 * A decoded picture waiting to be cropped.
 *
 * `previewUrl` is the same file as an object URL, because an ImageBitmap cannot
 * be an `<img>` source and re-encoding a 12-megapixel phone photo just to show
 * it would cost more memory than the photo.
 *
 * `close()` releases both. It is the caller's to call: the cropper holds one
 * of these for as long as its dialog is open, which is the one place in the app
 * where a decoded image outlives the function that made it.
 */
export interface AvatarSource {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  previewUrl: string;
  close(): void;
}

/**
 * Where the square sits on the picture.
 *
 * Resolution-independent on purpose: `zoom` is a multiple of the "just covers
 * the square" size, and `x`/`y` are the image's top-left corner as a fraction
 * of the square's side. So the same numbers describe the crop whether the
 * cropper is 280px across on a phone or 340px on a desktop, and they still mean
 * the same thing when the crop is finally rendered at 128px.
 */
export interface Crop {
  zoom: number;
  x: number;
  y: number;
}

export async function loadAvatarSource(file: File): Promise<AvatarSource> {
  if (!file.type.startsWith('image/')) {
    throw new AvatarError('avatar.notAnImage', 'That file is not an image.');
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new AvatarError('avatar.tooBig', 'That image is larger than 8 MB. Try a smaller one.');
  }
  if (typeof createImageBitmap !== 'function') {
    throw new AvatarError('avatar.unsupported', 'This browser cannot read images here.');
  }

  let bitmap: ImageBitmap;
  try {
    // `imageOrientation` matters more than it looks: without it a portrait
    // phone photo decodes on its side, and the crop the user set would be
    // taken from a rotated picture.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new AvatarError('avatar.unreadable', 'That image could not be read.');
  }

  const previewUrl = URL.createObjectURL(file);
  return {
    bitmap,
    width: bitmap.width,
    height: bitmap.height,
    previewUrl,
    close: () => {
      bitmap.close?.();
      URL.revokeObjectURL(previewUrl);
    },
  };
}

/**
 * The size the picture is drawn at when the crop is at `zoom`, as fractions of
 * the frame's own width and height. At zoom 1 it exactly covers the frame,
 * with the overflow on whichever axis has any.
 *
 * Measuring each axis against its own side rather than against a single length
 * is what makes one set of maths serve a square avatar and a wide banner: both
 * axes still clamp against 1, so everything downstream is unchanged.
 */
export function coverSize(
  source: { width: number; height: number },
  zoom: number,
  aspect = 1,
) {
  const ratio = source.width / source.height;
  return ratio > aspect
    ? { width: (ratio / aspect) * zoom, height: zoom }
    : { width: zoom, height: (aspect / ratio) * zoom };
}

/**
 * Pulls a crop back inside the square.
 *
 * Every drag and every zoom goes through here, which is what stops the picture
 * being dragged off its own frame and leaving a wedge of empty canvas in the
 * avatar. Zoom is clamped first, because clamping the offsets depends on it.
 */
export function clampCrop(
  source: { width: number; height: number },
  crop: Crop,
  aspect = 1,
): Crop {
  const zoom = Math.min(Math.max(crop.zoom, 1), MAX_ZOOM);
  const { width, height } = coverSize(source, zoom, aspect);
  // The image's top-left can travel from "right edge flush" (1 - extent) to
  // "left edge flush" (0). At zoom 1 the shorter axis has no slack at all,
  // and clamping pins it at 0 rather than letting it drift.
  return { zoom, x: clampAxis(crop.x, width), y: clampAxis(crop.y, height) };
}

function clampAxis(value: number, extent: number): number {
  const min = 1 - extent; // Negative whenever there is slack to drag through.
  if (min >= 0) return 0; // No slack: the image exactly spans the square.
  return Math.min(Math.max(value, min), 0);
}

/** The crop that shows the middle of the picture, which is where we start. */
export function centredCrop(source: { width: number; height: number }, aspect = 1): Crop {
  const { width, height } = coverSize(source, 1, aspect);
  return { zoom: 1, x: (1 - width) / 2, y: (1 - height) / 2 };
}

/**
 * Bakes a crop into the data URL that gets stored.
 *
 * The canvas is the frame, so the crop's fractions are simply multiplied up:
 * everything the cropper showed inside its frame is what lands here, and
 * everything outside it is discarded rather than stored at a size nothing
 * displays.
 */
export function renderPicture(source: AvatarSource, crop: Crop, frame: Frame): string {
  const canvas = document.createElement('canvas');
  canvas.width = frame.width;
  canvas.height = frame.height;

  const context = canvas.getContext('2d');
  if (!context) throw new AvatarError('avatar.notResized', 'That image could not be resized.');

  const aspect = frame.width / frame.height;
  const safe = clampCrop(source, crop, aspect);
  const { width, height } = coverSize(source, safe.zoom, aspect);

  context.imageSmoothingQuality = 'high';
  context.drawImage(
    source.bitmap,
    safe.x * frame.width,
    safe.y * frame.height,
    width * frame.width,
    height * frame.height,
  );

  // WebP where it exists, JPEG everywhere else. A browser that cannot encode
  // the requested type silently returns a PNG, which is checked for rather
  // than trusted, because a PNG at these sizes is several times larger.
  const webp = canvas.toDataURL('image/webp', frame.quality);
  if (webp.startsWith('data:image/webp')) return webp;
  return canvas.toDataURL('image/jpeg', frame.quality);
}

/**
 * Decode, centre-crop and encode in one step, with no editor in between.
 *
 * Kept for callers that have no UI to offer, such as a drag-and-drop that lands
 * somewhere without a dialog, say. The settings screen uses the cropper.
 */
export async function readPictureFile(file: File, frame: Frame): Promise<string> {
  const source = await loadAvatarSource(file);
  try {
    return renderPicture(source, centredCrop(source, frame.width / frame.height), frame);
  } finally {
    source.close();
  }
}
