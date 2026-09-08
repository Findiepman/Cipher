/**
 * Everything the user can change about their own client.
 *
 * These are preferences, not account data. The server has no settings
 * endpoint and deliberately does not get one for most of this: an app whose
 * whole claim is "the server cannot read your messages" should not be shipping
 * the server a list of who you have muted. Anything here that *does* belong to
 * the account (username, email, password) is not in this file. It goes
 * through the account API, which is why `profile.displayName` below is an
 * override for local display and not the account's username.
 *
 * Adding a field is safe: `load()` merges what it finds over these defaults, so
 * a settings blob written by an older build is upgraded rather than rejected.
 * Removing or repurposing one is not: bump `SETTINGS_VERSION` if you do.
 */
import type { Presence } from '../../types';

export const SETTINGS_VERSION = 1;

/* The sections below are type aliases rather than interfaces on purpose: an
 * alias for an object type gets an implicit index signature, which is what lets
 * store.ts walk a section field by field when merging a stored blob without
 * casting its way around the type system. */

export type ThemeChoice = 'system' | 'dark' | 'light';
export type Density = 'cozy' | 'compact';
export type InputMode = 'voice-activity' | 'push-to-talk';
export type DirectMessagePolicy = 'everyone' | 'known' | 'nobody';

export type ProfileSettings = {
  /** Shown instead of the account username. Empty means "use the username". */
  displayName: string;
  /** One line under the name. Never leaves this device. */
  about: string;
  /** Avatar tint, and the accent on your own profile card. */
  accent: string;
  /**
   * A downscaled data: URL, or null for the lettered tile.
   *
   * Device-local on purpose. There is no avatar endpoint yet, and when there
   * is one this becomes a cache of it rather than the only copy.
   */
  avatar: string | null;
  /** What other people are told, when the app is online to tell them. */
  presence: Presence;
};

export type AppearanceSettings = {
  theme: ThemeChoice;
  density: Density;
  /** Multiplier on message text only, 0.85 to 1.25. */
  fontScale: number;
  reduceMotion: boolean;
  /** Show the raw ciphertext under every message. Off by default. */
  showCiphertext: boolean;
};

export type VoiceSettings = {
  /** `null` means "whatever the OS considers default". */
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  cameraDeviceId: string | null;
  inputVolume: number;
  outputVolume: number;
  inputMode: InputMode;
  /** Gate threshold for voice activity, 0 to 100. */
  sensitivity: number;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  /** Preview yourself mirrored, the way a mirror would show you. */
  mirrorCamera: boolean;
};

export type NotificationSettings = {
  desktop: boolean;
  /**
   * Whether a desktop notification may contain the message text.
   *
   * This is the one notification setting that is a security decision rather
   * than a taste one: a preview hands decrypted text to the OS notification
   * centre, which may log it, sync it to a phone or paint it on a lock
   * screen. Off by default, and the UI says why.
   */
  preview: boolean;
  soundOnMessage: boolean;
  soundOnMention: boolean;
  soundOnSend: boolean;
  /** ISO-8601 instant, or null when notifications are not paused. */
  mutedUntil: string | null;
  unreadBadge: boolean;
};

export type PrivacySettings = {
  readReceipts: boolean;
  typingIndicators: boolean;
  /**
   * Fetching a preview tells the linked site someone opened the link, which is
   * a metadata leak an encrypted messenger should not make silently.
   */
  linkPreviews: boolean;
  directMessagesFrom: DirectMessagePolicy;
};

/**
 * Preferences that only mean something in the desktop app. Stored with the
 * rest so they survive a reinstall of the shell, and pushed to it by
 * PlatformProvider whenever they change. The web build carries them and
 * ignores them.
 */
export type DesktopSettings = {
  /**
   * Closing the window keeps the app running in the tray, so messages and
   * calls still arrive. Off, closing the window quits.
   */
  closeToTray: boolean;
};

export interface Settings {
  version: number;
  profile: ProfileSettings;
  appearance: AppearanceSettings;
  voice: VoiceSettings;
  notifications: NotificationSettings;
  privacy: PrivacySettings;
  desktop: DesktopSettings;
}

/** The avatar palette. Warm first, because the app is warm. */
export const ACCENTS = [
  '#f2734e',
  '#d9b382',
  '#c9736b',
  '#b98a5e',
  '#7fb08a',
  '#6f93b0',
  '#8f7fb0',
  '#a8677f',
] as const;

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  profile: {
    displayName: '',
    about: '',
    accent: ACCENTS[0],
    avatar: null,
    presence: 'online',
  },
  appearance: {
    theme: 'dark',
    density: 'cozy',
    fontScale: 1,
    reduceMotion: false,
    showCiphertext: false,
  },
  voice: {
    inputDeviceId: null,
    outputDeviceId: null,
    cameraDeviceId: null,
    inputVolume: 100,
    outputVolume: 100,
    inputMode: 'voice-activity',
    sensitivity: 35,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    mirrorCamera: true,
  },
  notifications: {
    desktop: false,
    preview: false,
    soundOnMessage: true,
    soundOnMention: true,
    soundOnSend: false,
    mutedUntil: null,
    unreadBadge: true,
  },
  privacy: {
    readReceipts: true,
    typingIndicators: true,
    linkPreviews: false,
    directMessagesFrom: 'everyone',
  },
  desktop: {
    closeToTray: true,
  },
};

export const FONT_SCALE_RANGE = { min: 0.85, max: 1.25, step: 0.05 } as const;
