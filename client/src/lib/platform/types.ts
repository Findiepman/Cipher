/**
 * What the app is allowed to ask of the thing it is running in.
 *
 * client/AGENTS.md: nothing platform-specific belongs in the app itself. This
 * is the adapter it describes. Components and providers call these methods
 * and never find out whether a browser tab or the desktop shell answered;
 * `web.ts` and `desktop.ts` are the two answers, and `index.ts` picks one at
 * build time.
 *
 * The surface is deliberately small. Every method here exists because a
 * screen needs it today, not because a shell could offer it. When a new
 * native feature is wanted, add it here first, give it a web behaviour (which
 * may be "do nothing"), and only then teach the shell about it.
 */

export type PlatformKind = 'web' | 'desktop';

/**
 * Whether a notification may be shown. The web answer is the browser's
 * permission; the desktop answer is `granted`, because the operating system
 * handles the asking itself the first time one is shown.
 */
export type NotificationPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export interface NotificationRequest {
  title: string;
  body?: string;
  /**
   * Replaces an earlier notification carrying the same tag, where the platform
   * can. A second message from the same person should not stack a second
   * popup on the first.
   */
  tag?: string;
  /**
   * Called when the notification is clicked, where the platform reports it.
   * The browser does; the desktop shell does not, so nothing may depend on
   * this firing.
   */
  onClick?: () => void;
}

/** A newer build the shell found. */
export interface UpdateInfo {
  version: string;
  /** The release notes from the manifest, if any. */
  notes: string | null;
  /** ISO-8601 publication time, if the manifest carried one. */
  date: string | null;
}

export type UpdateCheck =
  /** A build that never checks: `npm run dev` in desktop/. */
  | { status: 'disabled' }
  | { status: 'none' }
  | { status: 'available'; update: UpdateInfo }
  | { status: 'error'; message: string };

export interface UpdateProgress {
  downloaded: number;
  /** Unknown until the server says. */
  total: number | null;
}

/**
 * The updater, on the platforms that have one. The shell checks on its own
 * at start and every few hours; this is how the page hears about it and how
 * a person asks for a check by hand.
 */
export interface Updates {
  /** An update the shell already found and is holding, if any. */
  pending(): Promise<UpdateInfo | null>;
  check(): Promise<UpdateCheck>;
  /**
   * Downloads, verifies, installs and restarts. Resolves only if something
   * stopped it before the restart, which is the failure case.
   */
  install(): Promise<void>;
  onAvailable(listener: (update: UpdateInfo) => void): () => void;
  onProgress(listener: (progress: UpdateProgress) => void): () => void;
}

/** Preferences that live in the shell rather than in the page. */
export interface DesktopPrefs {
  /** Whether closing the window keeps the app running in the tray. */
  setCloseToTray(enabled: boolean): Promise<void>;
  autostartEnabled(): Promise<boolean>;
  setAutostart(enabled: boolean): Promise<void>;
}

export type OperatingSystem = 'windows' | 'macos' | 'linux';

export interface Platform {
  kind: PlatformKind;
  /** The shell's own version. Null on the web, where the page has none. */
  version(): Promise<string | null>;
  /** The operating system the shell runs on. Null on the web. */
  os(): Promise<OperatingSystem | null>;

  notificationPermission(): Promise<NotificationPermission>;
  requestNotificationPermission(): Promise<NotificationPermission>;
  notify(request: NotificationRequest): Promise<void>;

  /** Unread count on the app icon and in the title. Zero clears it. */
  setBadge(count: number): Promise<void>;
  /**
   * Ask for the user's attention without taking it: flash the taskbar entry,
   * bounce the dock icon. `urgent` is for a ringing call.
   */
  attention(urgent: boolean): Promise<void>;
  /** Bring the app to the front. */
  focus(): Promise<void>;
  /** Open a link outside the app: a browser tab, or the system browser. */
  openExternal(url: string): Promise<void>;

  /** Null where there is no updater: the web, which is always current. */
  updates: Updates | null;
  /** Null where there is no shell to hold a preference. */
  prefs: DesktopPrefs | null;
}
