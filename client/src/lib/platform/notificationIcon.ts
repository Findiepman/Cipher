/**
 * An avatar, turned into something Windows will actually draw on a toast.
 *
 * Two conversions, and both are needed:
 *
 *   Format. Avatars are produced by `lib/settings/avatarImage.ts`, which
 *   prefers WebP and falls back to JPEG. Windows toast images are PNG, JPEG or
 *   GIF; WebP is not among them, and a toast with an image it cannot decode
 *   draws no image rather than complaining, which is the worst way to find
 *   out. So everything is re-encoded to PNG, including a JPEG that would
 *   probably have worked, because one path is easier to reason about than two.
 *
 *   Size. The stored avatar is as large as the cropper made it, and this one
 *   crosses an IPC boundary as a base64 string and is then written to disk by
 *   the shell. The toast draws it at about 48 logical pixels, so 96 covers a
 *   high-DPI screen with nothing to spare and keeps the string small.
 *
 * Everything here fails to `null` rather than throwing. A missing picture on a
 * notification is a smaller problem than a notification that never appears,
 * and every caller is already in the business of being told there is no icon.
 */

/** What the toast draws it at, doubled for high-DPI. */
const SIZE = 96;

/**
 * Keyed by the source data URL, which is the avatar's identity: the settings
 * store rewrites the whole string when the picture changes, so a stale entry
 * is not reachable. Bounded because a browser profile can accumulate friends
 * and each one is a few kilobytes held for the life of the session.
 */
const cache = new Map<string, string | null>();
const MOST_KEPT = 32;

function remember(source: string, png: string | null): string | null {
  if (cache.size >= MOST_KEPT) {
    // Oldest first. Map keeps insertion order, so the first key is the least
    // recently added, which is close enough to least recently useful here.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(source, png);
  return png;
}

/** Decodes a data URL, or resolves null if the browser will not have it. */
function decode(source: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = source;
  });
}

/**
 * A square PNG data URL for `source`, or null when there is nothing usable.
 *
 * Null covers all of: no avatar set, a picture the browser cannot decode, and
 * a context with no canvas at all. The caller sends the notification either
 * way.
 */
export async function pngForNotification(source: string | undefined): Promise<string | null> {
  if (!source) return null;

  const cached = cache.get(source);
  if (cached !== undefined) return cached;

  if (typeof document === 'undefined' || typeof Image === 'undefined') return null;

  const image = await decode(source);
  if (!image) return remember(source, null);

  try {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const context = canvas.getContext('2d');
    if (!context) return remember(source, null);

    // Cover, not stretch: avatars are square already, but a non-square one
    // arriving from somewhere else should be cropped like every other frame in
    // this app rather than squashed.
    const side = Math.min(image.width, image.height);
    if (side <= 0) return remember(source, null);
    context.drawImage(
      image,
      (image.width - side) / 2,
      (image.height - side) / 2,
      side,
      side,
      0,
      0,
      SIZE,
      SIZE,
    );

    const png = canvas.toDataURL('image/png');
    return remember(source, png.startsWith('data:image/png') ? png : null);
  } catch {
    // A tainted canvas, or no 2d context worth the name.
    return remember(source, null);
  }
}
