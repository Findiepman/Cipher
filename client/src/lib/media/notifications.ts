/**
 * The one place that touches the Notification API.
 *
 * Sibling to sounds.ts and for the same reason: everything about talking to
 * the operating system is awkward in a way that has nothing to do with the app
 * (three of the four calls below can throw, and one of them throws only on
 * Android), and nobody wants that spread through a component tree. What can be
 * decided without a browser is decided in lib/settings/desktopNotifications.ts
 * instead, and tested there.
 *
 * The notifications this app raises are tracked by tag so they can be taken
 * away again. That matters more here than it looks: a notification sits in the
 * Action Centre until it is dismissed, so without this, coming back to the app
 * and reading everything would leave a pile of toasts about messages you have
 * already answered.
 */
import type { NotifyPermission } from '../settings/desktopNotifications';

/** Everything we have raised and not yet taken back, keyed by tag. */
const live = new Map<string, Notification>();

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && typeof Notification !== 'undefined';
}

export function permissionNow(): NotifyPermission {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission;
}

/**
 * Asks, once. A browser that has already answered returns the same answer
 * without prompting, so this is safe to call from a button that got clicked
 * twice.
 */
export async function askPermission(): Promise<NotifyPermission> {
  if (!notificationsSupported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    // Older Safari passes a callback instead of returning a promise, and a
    // page in an iframe without the right permissions policy simply refuses.
    return permissionNow();
  }
}

export interface Toast {
  title: string;
  /** The second line, or nothing. Never a blank string: see previewOf. */
  body?: string | null;
  /**
   * Groups a conversation's notifications. A second message with the same tag
   * replaces the first rather than stacking, which is the difference between a
   * chat you glance at and a notification centre you have to clear.
   */
  tag: string;
  icon?: string;
  onClick?: () => void;
}

/**
 * Raises one, or does nothing at all.
 *
 * Never throws. Permission and every preference are somebody else's decision
 * by the time this is called (`notifiable`), so the only failures left are the
 * browser's own, and none of them is worth taking down a chat client for.
 */
/**
 * The same notification, asked of the service worker instead.
 *
 * Silent on every failure, like everything else here: no registration yet, no
 * worker on this browser, a page that has not finished registering. A missing
 * popup is not worth an error in a chat client.
 */
function viaWorker(toast: Toast): void {
  const container = typeof navigator === 'undefined' ? null : navigator.serviceWorker;
  if (!container) return;
  void container.ready
    .then((registration) => {
      registration.active?.postMessage({
        type: 'notify',
        title: toast.title,
        body: toast.body ?? null,
        tag: toast.tag,
        icon: toast.icon,
      });
    })
    .catch(() => {
      /* No worker, and nothing to be done about it from here. */
    });
}

export function show(toast: Toast): void {
  if (permissionNow() !== 'granted') return;

  let notification: Notification;
  try {
    notification = new Notification(toast.title, {
      body: toast.body ?? undefined,
      tag: toast.tag,
      // The sender's picture when there is one, the app's mark otherwise. An
      // empty icon slot gets filled by the browser with its own logo, which is
      // why a notification for someone with no avatar looks like it came from
      // Chrome rather than from this app.
      icon: toast.icon ?? '/logo.png',
      // The app plays its own sound, chosen per person in Settings. Without
      // this the OS plays one too and you hear both.
      silent: true,
    });
  } catch {
    // Chrome on Android refuses `new Notification` outright, with an Illegal
    // constructor: there, a notification may only be raised through a service
    // worker registration. That is `public/sw.js`, and asking it is the whole
    // fallback. Note this is not push and does not need one: push is
    // notifications while the app is *closed*, and it needs a server half that
    // does not exist. A registration will show one on request whenever the
    // page is running, which is the case that matters on a phone.
    viaWorker(toast);
    return;
  }

  live.set(toast.tag, notification);
  notification.onclose = () => {
    // Only if it is still the one we are holding: a replacement with the same
    // tag closes its predecessor, and that close must not evict the new one.
    if (live.get(toast.tag) === notification) live.delete(toast.tag);
  };
  notification.onclick = () => {
    window.focus();
    notification.close();
    toast.onClick?.();
  };
}

/** Takes back everything this app raised. Anything else is left alone. */
export function dismissAll(): void {
  for (const notification of live.values()) notification.close();
  live.clear();
}
