import { describe, expect, it, vi } from 'vitest';
import { SettingsStore, STORAGE_KEY, type SettingsStorage } from './store';
import { DEFAULT_SETTINGS } from './types';

/** An in-memory Storage, with a hook for making it fail like a blocked one. */
function fakeStorage(seed?: string): SettingsStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  if (seed !== undefined) map.set(STORAGE_KEY, seed);
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

describe('SettingsStore', () => {
  it('starts from the defaults when nothing is stored', () => {
    expect(new SettingsStore(fakeStorage()).current).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps stored values and fills the rest from the defaults', () => {
    const store = new SettingsStore(
      fakeStorage(JSON.stringify({ appearance: { theme: 'light' } })),
    );

    expect(store.current.appearance.theme).toBe('light');
    // A field the stored blob never heard of still arrives.
    expect(store.current.appearance.density).toBe(DEFAULT_SETTINGS.appearance.density);
    expect(store.current.notifications).toEqual(DEFAULT_SETTINGS.notifications);
  });

  it('ignores stored values of the wrong type', () => {
    const store = new SettingsStore(
      fakeStorage(
        JSON.stringify({
          appearance: { fontScale: 'huge', reduceMotion: true },
          privacy: 'not an object',
        }),
      ),
    );

    expect(store.current.appearance.fontScale).toBe(DEFAULT_SETTINGS.appearance.fontScale);
    expect(store.current.appearance.reduceMotion).toBe(true);
    expect(store.current.privacy).toEqual(DEFAULT_SETTINGS.privacy);
  });

  it('accepts a string for a field whose default is null, and null itself', () => {
    const store = new SettingsStore(
      fakeStorage(
        JSON.stringify({
          voice: { inputDeviceId: 'mic-2', outputDeviceId: null },
        }),
      ),
    );

    expect(store.current.voice.inputDeviceId).toBe('mic-2');
    expect(store.current.voice.outputDeviceId).toBeNull();
  });

  it('falls back to the defaults on a malformed blob', () => {
    expect(new SettingsStore(fakeStorage('{not json')).current).toEqual(DEFAULT_SETTINGS);
    expect(new SettingsStore(fakeStorage('[1,2,3]')).current).toEqual(DEFAULT_SETTINGS);
  });

  it('persists a patch and notifies subscribers', () => {
    const storage = fakeStorage();
    const store = new SettingsStore(storage);
    const seen = vi.fn();
    store.subscribe(seen);

    store.patch('appearance', { density: 'compact' });

    expect(store.current.appearance.density).toBe('compact');
    expect(seen).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.map.get(STORAGE_KEY)!).appearance.density).toBe('compact');
    // The patch is a merge, not a replacement.
    expect(store.current.appearance.theme).toBe(DEFAULT_SETTINGS.appearance.theme);
  });

  it('stops notifying after unsubscribe', () => {
    const store = new SettingsStore(fakeStorage());
    const seen = vi.fn();
    store.subscribe(seen)();

    store.patch('privacy', { readReceipts: false });

    expect(seen).not.toHaveBeenCalled();
  });

  it('resets one section without touching the others', () => {
    const store = new SettingsStore(fakeStorage());
    store.patch('voice', { inputVolume: 20 });
    store.patch('privacy', { readReceipts: false });

    store.reset('voice');

    expect(store.current.voice).toEqual(DEFAULT_SETTINGS.voice);
    expect(store.current.privacy.readReceipts).toBe(false);
  });

  it('resets everything when given no section', () => {
    const store = new SettingsStore(fakeStorage());
    store.patch('voice', { inputVolume: 20 });
    store.patch('privacy', { readReceipts: false });

    expect(store.reset()).toEqual(DEFAULT_SETTINGS);
  });

  it('still works when storage is unavailable', () => {
    const blocked: SettingsStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {},
    };
    const store = new SettingsStore(blocked);

    expect(store.current).toEqual(DEFAULT_SETTINGS);
    expect(() => store.patch('appearance', { theme: 'light' })).not.toThrow();
    expect(store.current.appearance.theme).toBe('light');
  });
});
