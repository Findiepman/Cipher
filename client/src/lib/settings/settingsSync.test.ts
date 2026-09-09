import { describe, expect, it } from 'vitest';
import { SettingsStore, STORAGE_KEY, type SettingsStorage } from './store';
import { applySyncBlob, toSyncBlob } from './settingsSync';
import { DEFAULT_SETTINGS } from './types';

function fakeStorage(seed?: string): SettingsStorage {
  const map = new Map<string, string>();
  if (seed !== undefined) map.set(STORAGE_KEY, seed);
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

describe('toSyncBlob', () => {
  it('carries the synced sections and leaves out the profile channel', () => {
    const store = new SettingsStore(fakeStorage());
    store.patch('appearance', { theme: 'light' });
    store.patch('language', { choice: 'nl' });
    store.patch('profile', { displayName: 'should not travel here' });
    store.patch('privacy', { readReceipts: false, typingIndicators: false });

    const blob = JSON.parse(toSyncBlob(store.current));

    expect(blob.appearance.theme).toBe('light');
    expect(blob.language.choice).toBe('nl');
    expect(blob.version).toBe(DEFAULT_SETTINGS.version);
    // The profile and the two enforced privacy fields belong to the profile
    // channel, so they are absent from the blob.
    expect(blob.profile).toBeUndefined();
    expect(blob.privacy).toEqual({ typingIndicators: false, linkPreviews: DEFAULT_SETTINGS.privacy.linkPreviews });
    expect('readReceipts' in blob.privacy).toBe(false);
    expect('friendRequestsFrom' in blob.privacy).toBe(false);
  });

  it('is stable, so an unchanged state serializes identically', () => {
    const a = new SettingsStore(fakeStorage());
    const b = new SettingsStore(fakeStorage());
    a.patch('appearance', { palette: 'tide', fontScale: 1.1 });
    b.patch('appearance', { palette: 'tide', fontScale: 1.1 });
    expect(toSyncBlob(a.current)).toBe(toSyncBlob(b.current));
  });
});

describe('applySyncBlob', () => {
  it('applies the synced sections onto the store', () => {
    const store = new SettingsStore(fakeStorage());
    const source = new SettingsStore(fakeStorage());
    source.patch('appearance', { theme: 'light', wallpaperDim: 20 });
    source.patch('voice', { inputDeviceId: 'mic-42' });
    source.patch('notifications', { soundOnMessage: false });

    const ok = applySyncBlob(store, toSyncBlob(source.current));

    expect(ok).toBe(true);
    expect(store.current.appearance.theme).toBe('light');
    expect(store.current.appearance.wallpaperDim).toBe(20);
    expect(store.current.voice.inputDeviceId).toBe('mic-42');
    expect(store.current.notifications.soundOnMessage).toBe(false);
  });

  it('round-trips: apply then serialize equals the blob it was given', () => {
    const source = new SettingsStore(fakeStorage());
    source.patch('appearance', { theme: 'light' });
    source.patch('sidebar', { pinned: ['u1', 'u2'] });
    const blob = toSyncBlob(source.current);

    const store = new SettingsStore(fakeStorage());
    applySyncBlob(store, blob);

    // This equality is the sync loop guard: applying the server's blob leaves
    // the store serializing to exactly what arrived.
    expect(toSyncBlob(store.current)).toBe(blob);
  });

  it('never touches the profile or the two enforced privacy fields', () => {
    const store = new SettingsStore(fakeStorage());
    store.patch('profile', { displayName: 'mine', accent: '#abcdef' });
    store.patch('privacy', { readReceipts: false, friendRequestsFrom: 'nobody' });

    const source = new SettingsStore(fakeStorage());
    source.patch('profile', { displayName: 'theirs' });
    source.patch('privacy', {
      readReceipts: true,
      friendRequestsFrom: 'everyone',
      typingIndicators: false,
    });

    applySyncBlob(store, toSyncBlob(source.current));

    // Profile and the enforced pair are untouched.
    expect(store.current.profile.displayName).toBe('mine');
    expect(store.current.profile.accent).toBe('#abcdef');
    expect(store.current.privacy.readReceipts).toBe(false);
    expect(store.current.privacy.friendRequestsFrom).toBe('nobody');
    // The two blob-carried privacy toggles did apply.
    expect(store.current.privacy.typingIndicators).toBe(false);
  });

  it('drops a wrong-typed value to the default rather than storing it', () => {
    const store = new SettingsStore(fakeStorage());
    const ok = applySyncBlob(
      store,
      JSON.stringify({ appearance: { fontScale: 'huge', theme: 'light' }, voice: 'not an object' }),
    );

    expect(ok).toBe(true);
    // The bad field fell back, the good one alongside it still applied.
    expect(store.current.appearance.fontScale).toBe(DEFAULT_SETTINGS.appearance.fontScale);
    expect(store.current.appearance.theme).toBe('light');
    expect(store.current.voice).toEqual(DEFAULT_SETTINGS.voice);
  });

  it('returns false for a blob that will not parse, and leaves the store alone', () => {
    const store = new SettingsStore(fakeStorage());
    store.patch('appearance', { theme: 'light' });

    const ok = applySyncBlob(store, 'not json {');

    expect(ok).toBe(false);
    expect(store.current.appearance.theme).toBe('light');
  });
});
