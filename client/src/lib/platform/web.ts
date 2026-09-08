/**
 * The browser as a platform.
 *
 * Most of what the desktop shell does natively has a browser equivalent that
 * is smaller and asks permission: a `Notification`, a count in the tab title
 * (and on the installed-app icon, where `setAppBadge` exists). Attention is
 * the one thing a page cannot ask for at all, so it does nothing here rather
 * than pretending.
 */
import type { NotificationPermission, NotificationRequest, Platform } from './types';

const BASE_TITLE = 'Cipher';

function readPermission(): NotificationPermission {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/** The Badging API, present on an installed web app and absent in a tab. */
interface BadgingNavigator {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}

export function createWebPlatform(): Platform {
  return {
    kind: 'web',

    async version() {
      return null;
    },

    async os() {
      return null;
    },

    async notificationPermission() {
      return readPermission();
    },

    async requestNotificationPermission() {
      if (typeof Notification === 'undefined') return 'unsupported';
      return Notification.requestPermission();
    },

    async notify(request: NotificationRequest) {
      if (readPermission() !== 'granted') return;
      const notification = new Notification(request.title, {
        body: request.body,
        tag: request.tag,
      });
      notification.onclick = () => {
        window.focus();
        request.onClick?.();
        notification.close();
      };
    },

    async setBadge(count: number) {
      if (typeof document !== 'undefined') {
        document.title = count > 0 ? `(${count}) ${BASE_TITLE}` : BASE_TITLE;
      }
      // An installed web app has an icon to badge. A tab does not, and the
      // method is absent there, so this is the whole check.
      const nav =
        typeof navigator === 'undefined' ? null : (navigator as unknown as BadgingNavigator);
      try {
        if (count > 0) await nav?.setAppBadge?.(count);
        else await nav?.clearAppBadge?.();
      } catch {
        // Badging refused (no permission, not installed): the title carries it.
      }
    },

    async attention() {
      // A page cannot flash a taskbar entry. The title badge is what there is.
    },

    async focus() {
      if (typeof window !== 'undefined') window.focus();
    },

    async openExternal(url: string) {
      if (typeof window === 'undefined') return;
      window.open(url, '_blank', 'noopener,noreferrer');
    },

    updates: null,
    prefs: null,
  };
}
