/**
 * Everything the user can change about their own client.
 *
 * Almost all of it is preference, not account data, and stays on this device:
 * an app whose whole claim is "the server cannot read your messages" should
 * not be shipping the server a list of who you have muted. The rule for what
 * the server does get is a short one. A setting leaves the device only when
 * another person has to see the result, or when the server has to act on it
 * for you. That admits exactly these, and lib/settings/profileSync.ts keeps
 * them in step with the account:
 *
 *   - `profile.displayName`, `about`, `accent`, `avatar`, `banner` and
 *     `presence`: your friends see them, stored in the clear, friends only.
 *   - `privacy.readReceipts`: the server is what tells the other person you
 *     read something, so it has to know not to.
 *   - `privacy.friendRequestsFrom`: the server is what a stranger's request
 *     arrives at.
 *
 * Everything else, the saved profile slots included, is never sent anywhere.
 * The account itself (username, email, password) is not in this file at all.
 *
 * Adding a field is safe: `load()` merges what it finds over these defaults, so
 * a settings blob written by an older build is upgraded rather than rejected.
 * Removing or repurposing one is not: bump `SETTINGS_VERSION` if you do.
 * Version 2 renamed `privacy.directMessagesFrom` to `friendRequestsFrom`,
 * because messages already only come from friends and the old name promised a
 * gate that had nothing to gate; an old blob's value is simply dropped.
 */
import type { LanguageChoice } from '../i18n/locales';
import type { MessageSound, RingSound } from '../media/sounds';
import type { Presence } from '../../types';

export const SETTINGS_VERSION = 2;

/* The sections below are type aliases rather than interfaces on purpose: an
 * alias for an object type gets an implicit index signature, which is what lets
 * store.ts walk a section field by field when merging a stored blob without
 * casting its way around the type system. */

export type ThemeChoice = 'system' | 'dark' | 'light';

/**
 * The colour set, which is a separate choice from light or dark.
 *
 * Every palette is defined for both, so "Tide" plus "System" is a blue app
 * that follows the OS between day and night. Keeping the two apart is what
 * stops the list being every palette twice.
 *
 * There is no green one on purpose: --sage is reserved for encryption and
 * nothing else, and a palette whose accent was green would leave no way to
 * tell "this is a button" from "this is sealed". See styles/theme.css.
 */
export const PALETTES = ['ember', 'tide', 'orchid', 'rose', 'slate'] as const;

/**
 * The palettes we ship, plus the one you write yourself.
 *
 * 'custom' is deliberately not in PALETTES: that list is the swatches on
 * offer, and the custom one is not a swatch, it is two colour pickers. Every
 * other token in that block is mixed out of those two by theme.css, so a
 * custom palette is still the same app rather than a stylesheet a user can
 * break the contrast of.
 */
export type Palette = (typeof PALETTES)[number] | 'custom';

/** Where the bar carrying Direct and Friends sits around the app. */
export const ACTIVITY_BAR_POSITIONS = ['top', 'left', 'right', 'bottom'] as const;
export type ActivityBarPosition = (typeof ACTIVITY_BAR_POSITIONS)[number];

/**
 * These two are read straight onto <html> as attributes that pick a CSS block,
 * and the store type-checks a stored blob field by field rather than against a
 * list of allowed values, so a hand-edited settings file can put any string
 * here. Anything unrecognised falls back rather than leaving the app with no
 * palette at all.
 */
export function resolvePalette(value: string): Palette {
  if (value === 'custom') return 'custom';
  return (PALETTES as readonly string[]).includes(value) ? (value as Palette) : 'ember';
}

export function resolveActivityBar(value: string): ActivityBarPosition {
  return (ACTIVITY_BAR_POSITIONS as readonly string[]).includes(value)
    ? (value as ActivityBarPosition)
    : 'top';
}
/**
 * A colour a person typed, or the fallback.
 *
 * The custom palette's two colours are written onto <html> as CSS variables,
 * so unlike every other setting they end up inside a stylesheet rather than
 * inside a React prop. Nothing but six hex digits is ever let through: a
 * settings blob is hand-editable, and a variable that could hold `red; }` is
 * a stylesheet a file on disk gets to write.
 */
export function resolveHex(value: string, fallback: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

/**
 * A picture we stored ourselves, or nothing.
 *
 * Same reasoning as resolveHex, one step further: a wallpaper reaches CSS as
 * `url(...)`, so a stored string that was not written by renderPicture would
 * be a way to make the app fetch an address off the network, or to close the
 * url() early and write a declaration of its own. Every picture this app keeps
 * is a base64 data: URL it encoded on this device, and the shape of one has no
 * room in it for either, so that is the only thing accepted.
 */
const PICTURE = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

export function resolvePicture(value: string | null): string | null {
  return typeof value === 'string' && PICTURE.test(value) ? value : null;
}

/**
 * Black or white, whichever can be read on top of `hex`.
 *
 * The one token the custom palette cannot mix in CSS. Everything else there is
 * a colour beside the accent, and can be nudged by a fixed amount; this is the
 * text drawn *on* the accent, so on a pale yellow it has to be near-black and
 * on a navy near-white, and there is no `color-mix` that flips. CSS will get
 * `contrast-color()` for exactly this and does not have it yet.
 *
 * Rec. 709 luminance on the sRGB values, gamma left alone: the threshold below
 * was picked against the accents this app ships rather than derived, and a
 * rounder model would not move any of them.
 */
export function readableInk(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.55 ? '#14100e' : '#fdf8f5';
}

/** Keeps a stored number inside the range the slider offers. */
export function clampToRange(value: number, range: { min: number; max: number }): number {
  if (!Number.isFinite(value)) return range.min;
  return Math.min(Math.max(value, range.min), range.max);
}

/** Enough to be the short list it is meant to be, and no more. */
export const MAX_PINNED = 15;

/**
 * The pinned people, after dropping anything that is not an id.
 *
 * Duplicates go too, because the list is rendered in order and the same
 * person twice would be two rows for one conversation.
 */
export function resolvePinned(value: readonly unknown[]): string[] {
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry === 'string' && entry) seen.add(entry);
  }
  return [...seen].slice(0, MAX_PINNED);
}

export type Density = 'cozy' | 'compact';
export type InputMode = 'voice-activity' | 'push-to-talk';
/**
 * Who may send you a friend request. The same three words the server uses,
 * because the server is what enforces it: a request from somebody outside the
 * policy is answered as if you did not exist.
 */
export type FriendRequestPolicy = 'everyone' | 'friends_of_friends' | 'nobody';

export type ProfileSettings = {
  /** Shown instead of the account username. Empty means "use the username". */
  displayName: string;
  /** A few lines under the name. Your friends see it. */
  about: string;
  /**
   * Avatar tint, and the accent on your own profile card.
   *
   * Empty means "auto": the colour derived from your user id, which is what
   * everyone got before accents could be chosen and what people who never
   * open this screen still get. It is the same colour on every device and in
   * everyone's list, so a lettered tile stays recognisable without anyone
   * having picked anything.
   */
  accent: string;
  /**
   * The band across the top of your profile card, or null for the accent.
   *
   * Stored the same way as the avatar and for the same reasons: a data: URL
   * this device encoded, wider than it is tall, small enough to sit in
   * localStorage beside everything else.
   */
  banner: string | null;
  /**
   * A downscaled data: URL, or null for the lettered tile.
   *
   * This copy is the one the app draws you from; the server holds the same
   * bytes and hands them to your friends. profileSync keeps the two equal.
   */
  avatar: string | null;
  /**
   * What other people are told, when the app is online to tell them.
   *
   * 'offline' here means invisible: the server shows you as gone while you
   * are connected. The server's own word for it is 'invisible', mapped in
   * profileSync, because on the wire it also has to say 'offline' about
   * people who really are.
   */
  presence: Presence;
};

/**
 * One saved profile, under a name you chose.
 *
 * `profile` is a whole `ProfileSettings`, not a diff, because a saved profile
 * is meant to be a complete look you can drop into: a name, a picture, a
 * colour, a line about yourself and what your contacts are told you are doing.
 * A diff would make "this one has no picture" and "this one does not say"
 * the same thing, and they are not.
 */
export type SavedProfile = {
  id: string;
  /** Whatever you want to call it. Never shown to anyone else. */
  name: string;
  profile: ProfileSettings;
};

/**
 * The named profiles, and which one is loaded.
 *
 * `profile` above stays the live one that the rest of the app renders, and
 * this is the shelf it came off. Keeping both means every existing reader of
 * `settings.profile` is untouched, and it means "no saved profiles yet" is a
 * real state rather than a special first row: `saved` is empty until you save
 * something, and `active` is empty with it.
 *
 * The live copy is mirrored back into its slot on every edit (see
 * SettingsProvider), so there is no unsaved-changes state to explain and
 * switching never quietly loses a change.
 */
export type ProfilesSettings = {
  /** Id of the saved profile the live one came from. Empty means none. */
  active: string;
  saved: SavedProfile[];
};

/**
 * Which language the app is drawn in.
 *
 * Its own section rather than a field on `appearance`, because language is
 * not a matter of looks and because somebody hunting for it will not think to
 * look under a heading about colours. Nothing here is ever sent to the server:
 * an app whose claim is that the server cannot read your messages has no
 * business telling it what language you read them in.
 */
export type LanguageSettings = {
  /** 'system' follows the browser. Anything unknown falls back to it. */
  choice: LanguageChoice;
};

export type AppearanceSettings = {
  theme: ThemeChoice;
  /** Which colour set the theme is drawn in. */
  palette: Palette;
  /**
   * The two colours the custom palette is mixed out of. Read only when
   * `palette` is 'custom', and kept when it is not, so switching away to look
   * at Tide and back does not lose what you wrote.
   */
  customAccent: string;
  customTint: string;
  /**
   * A picture behind the whole app, or null for the palette's own backdrop.
   *
   * The panels go slightly translucent when there is one, which is the only
   * reason a wallpaper is visible at all: nothing in this layout is
   * background, every pixel belongs to a panel floating on the ground.
   */
  wallpaper: string | null;
  /** How much black sits between the wallpaper and the app, 0 to 90. */
  wallpaperDim: number;
  /** Blur on the wallpaper in pixels, 0 to 24. What makes text readable. */
  wallpaperBlur: number;
  /** Which edge the Direct/Friends bar is docked to. */
  activityBar: ActivityBarPosition;
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
  /** Which preset a message plays. Named in lib/media/sounds.ts. */
  messageSound: MessageSound;
  /** Which pattern rings for an incoming call. */
  callSound: RingSound;
  /**
   * Per person overrides, keyed by user id.
   *
   * The point is telling people apart without looking: a housemate on Knock and
   * a partner on Bell means the phone tells you whether to get up. Only the
   * people you have actually changed appear here, so the map stays small and a
   * removed friend costs nothing but a stale key.
   */
  perPerson: Record<string, PersonSounds>;
  /** ISO-8601 instant, or null when notifications are not paused. */
  mutedUntil: string | null;
  unreadBadge: boolean;
};

/** Whatever this one person is set to. Absent fields fall back to the defaults. */
export type PersonSounds = {
  message?: MessageSound;
  call?: RingSound;
};

/**
 * The conversation list's own preferences.
 *
 * `pinned` holds user ids rather than conversation ids, because pinning is
 * something you do to a person: it survives the right-click on a friends row
 * as well as on a conversation row, and a DM you have not opened yet has no
 * conversation to name. Device-local like everything else here, which is the
 * trade: the order of your list does not follow you to another browser, and
 * the server is not told who you care about most.
 */
export type SidebarSettings = {
  pinned: string[];
};

export type PrivacySettings = {
  /**
   * Synced to the server, which is the only party that can honour it: your
   * read position is still recorded (it is what clears your own badges on
   * another device) but the other participant is no longer told.
   */
  readReceipts: boolean;
  /** Local: off means this device simply never emits a typing signal. */
  typingIndicators: boolean;
  /**
   * Fetching a preview tells the linked site someone opened the link, which is
   * a metadata leak an encrypted messenger should not make silently.
   *
   * There is no preview feature yet, so nothing reads this and the settings
   * screen does not offer it. Kept so the default is already off the day
   * link previews arrive.
   */
  linkPreviews: boolean;
  /** Synced to the server, which is where a stranger's request arrives. */
  friendRequestsFrom: FriendRequestPolicy;
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
  profiles: ProfilesSettings;
  sidebar: SidebarSettings;
  language: LanguageSettings;
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
    accent: '',
    avatar: null,
    banner: null,
    presence: 'online',
  },
  profiles: {
    active: '',
    saved: [],
  },
  sidebar: {
    pinned: [],
  },
  language: {
    choice: 'system',
  },
  appearance: {
    theme: 'dark',
    palette: 'ember',
    // Ember's own two colours, so picking Custom opens on the app as it is
    // rather than on something nobody chose.
    customAccent: '#f2734e',
    customTint: '#6b4a3a',
    wallpaper: null,
    wallpaperDim: 45,
    wallpaperBlur: 0,
    activityBar: 'top',
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
    messageSound: 'ding',
    callSound: 'bells',
    perPerson: {},
    mutedUntil: null,
    unreadBadge: true,
  },
  privacy: {
    readReceipts: true,
    typingIndicators: true,
    linkPreviews: false,
    friendRequestsFrom: 'everyone',
  },
  desktop: {
    closeToTray: true,
  },
};

export const FONT_SCALE_RANGE = { min: 0.85, max: 1.25, step: 0.05 } as const;
export const WALLPAPER_DIM_RANGE = { min: 0, max: 90, step: 5 } as const;
export const WALLPAPER_BLUR_RANGE = { min: 0, max: 24, step: 1 } as const;

/** Long enough for a paragraph, short enough to stay a card. */
export const ABOUT_MAX = 190;
