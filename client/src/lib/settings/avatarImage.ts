/**
 * Turning a picked file into something small enough to keep in settings.
 *
 * The picture is decoded, centre-cropped to a square, drawn at 128px and
 * re-encoded. Two reasons for doing all that locally rather than storing the
 * file as-is: preferences live in localStorage, which is measured in a few
 * megabytes for the whole origin, and re-encoding through a canvas drops every
 * EXIF field the original carried, including, on a phone photo, the GPS
 * coordinates where it was taken.
 */
export const AVATAR_SIZE = 128;
export const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

export class AvatarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AvatarError';
  }
}

export async function readAvatarFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new AvatarError('That file is not an image.');
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new AvatarError('That image is larger than 8 MB. Try a smaller one.');
  }

  const bitmap = await decode(file);
  try {
    return draw(bitmap);
  } finally {
    bitmap.close?.();
  }
}

async function decode(file: File): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== 'function') {
    throw new AvatarError('This browser cannot read images here.');
  }
  try {
    return await createImageBitmap(file);
  } catch {
    throw new AvatarError('That image could not be read.');
  }
}

function draw(bitmap: ImageBitmap): string {
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;

  const context = canvas.getContext('2d');
  if (!context) throw new AvatarError('That image could not be resized.');

  // Centre crop: take the largest square the picture contains, so a wide photo
  // loses its edges rather than being squashed.
  const side = Math.min(bitmap.width, bitmap.height);
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    AVATAR_SIZE,
    AVATAR_SIZE,
  );

  // WebP where it exists, JPEG everywhere else. A browser that cannot encode
  // the requested type silently returns a PNG, which is checked for rather
  // than trusted, because a PNG at this size is several times larger.
  const webp = canvas.toDataURL('image/webp', 0.85);
  if (webp.startsWith('data:image/webp')) return webp;
  return canvas.toDataURL('image/jpeg', 0.85);
}
