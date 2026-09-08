/**
 * Picks the platform adapter for this build.
 *
 * The web adapter is synchronous and always available; the desktop one is
 * loaded on demand, and only when `VITE_PLATFORM=desktop`. That guard is a
 * build-time constant, so in the web bundle Vite removes the import along
 * with the branch, and `@tauri-apps/api` is never shipped to a browser.
 */
import type { Platform } from './types';
import { createWebPlatform } from './web';

export type * from './types';
export { describeIncoming, isMuted, shouldNotify } from './notifications';

export const webPlatform: Platform = createWebPlatform();

let loading: Promise<Platform> | null = null;

export function loadPlatform(): Promise<Platform> {
  if (!loading) {
    // The exact expression `import.meta.env.VITE_PLATFORM`, not `isDesktop`
    // from lib/config and not the optional-chained form: only this form is
    // substituted with a string at build time, and that substitution is what
    // lets the bundler drop the import below, and the desktop chunk with it,
    // from the web build. Checked by building the web client and looking for
    // a desktop-*.js in dist/assets; there must be none.
    loading =
      import.meta.env.VITE_PLATFORM === 'desktop'
        ? import('./desktop').then((module) => module.createDesktopPlatform())
        : Promise.resolve(webPlatform);
  }
  return loading;
}
