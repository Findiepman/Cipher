/**
 * The Tauri shell as a platform.
 *
 * Every method is a command in desktop/src-tauri/src/commands.rs or
 * updater.rs, named the same. The page is bundled into the app and served
 * from its own origin, so Tauri lets it call the shell's own commands; the
 * plugins it may reach are listed in desktop/src-tauri/capabilities.
 *
 * This module is only ever loaded by `loadPlatform()` in index.ts, and only
 * in a desktop build, so the web bundle never carries the Tauri client.
 */
import { invoke } from '@tauri-apps/api/core';
import { pngForNotification } from './notificationIcon';
import { listen } from '@tauri-apps/api/event';
import type {
  NotificationRequest,
  OperatingSystem,
  Platform,
  UpdateCheck,
  UpdateInfo,
  UpdateProgress,
} from './types';

const BASE_TITLE = 'Cipher';

interface ShellInfo {
  version: string;
  os: OperatingSystem;
  arch: string;
}

/**
 * Subscribes to a shell event. `listen` is asynchronous, so the unsubscribe
 * has to cope with being called before the subscription has even landed.
 */
function subscribe<T>(event: string, listener: (payload: T) => void): () => void {
  let disposed = false;
  let unlisten: (() => void) | null = null;
  void listen<T>(event, (received) => listener(received.payload)).then((stop) => {
    if (disposed) stop();
    else unlisten = stop;
  });
  return () => {
    disposed = true;
    unlisten?.();
  };
}

export function createDesktopPlatform(): Platform {
  let info: Promise<ShellInfo> | null = null;
  const shellInfo = () => (info ??= invoke<ShellInfo>('shell_info'));

  return {
    kind: 'desktop',

    async version() {
      return (await shellInfo()).version;
    },

    async os() {
      return (await shellInfo()).os;
    },

    notificationPermission() {
      // The operating system asks, the first time a notification is shown,
      // and remembers the answer where the shell cannot read it. Reporting
      // "granted" is what keeps the settings toggle usable.
      return 'granted';
    },

    async requestNotificationPermission() {
      return 'granted';
    },

    async notify(request: NotificationRequest) {
      // The avatar is re-encoded here rather than in the shell. It arrives as
      // a WebP or JPEG data URL and Windows toasts draw neither, and doing the
      // conversion on this side keeps an image decoder out of the Rust
      // process: what crosses is a PNG the shell only has to base64-decode.
      await invoke('notify', {
        title: request.title,
        body: request.body ?? null,
        icon: await pngForNotification(request.icon),
      });
    },

    dismissNotifications() {
      // The shell hands notifications to the OS and cannot take them back.
    },

    async setBadge(count: number) {
      if (typeof document !== 'undefined') {
        document.title = count > 0 ? `(${count}) ${BASE_TITLE}` : BASE_TITLE;
      }
      await invoke('set_badge', { count });
    },

    async attention(urgent: boolean) {
      await invoke('request_attention', { urgent });
    },

    async focus() {
      await invoke('show_window');
    },

    async openExternal(url: string) {
      await invoke('open_external', { url });
    },

    updates: {
      pending: () => invoke<UpdateInfo | null>('pending_update'),
      check: () => invoke<UpdateCheck>('check_for_updates'),
      install: () => invoke<void>('install_update'),
      onAvailable: (listener) => subscribe<UpdateInfo>('update:available', listener),
      onProgress: (listener) => subscribe<UpdateProgress>('update:progress', listener),
    },

    prefs: {
      setCloseToTray: (enabled) => invoke<void>('set_close_to_tray', { enabled }),
      autostartEnabled: () => invoke<boolean>('autostart_enabled'),
      setAutostart: (enabled) => invoke<void>('set_autostart', { enabled }),
    },
  };
}
