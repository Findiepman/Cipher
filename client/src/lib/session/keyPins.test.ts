import { describe, expect, it } from 'vitest';
import { MemorySecureStore } from '../storage/secureStore';
import { KeyChangedError, KeyPinStore } from './keyPins';

describe('KeyPinStore', () => {
  it('pins the first key it sees and keeps returning it', async () => {
    const pins = new KeyPinStore(new MemorySecureStore(), 'me');
    expect(await pins.trusted('nova', 'key-1')).toBe('key-1');
    expect(await pins.trusted('nova', 'key-1')).toBe('key-1');
    expect(await pins.observe('nova', 'key-1')).toBeNull();
  });

  it('pins on first sight when observing, and reports rather than throws', async () => {
    const pins = new KeyPinStore(new MemorySecureStore(), 'me');
    expect(await pins.observe('nova', 'key-1')).toBeNull();
    expect(await pins.observe('nova', 'key-2')).toEqual({
      userId: 'nova',
      pinned: 'key-1',
      current: 'key-2',
    });
    await expect(pins.trusted('nova', 'key-2')).rejects.toBeInstanceOf(KeyChangedError);
  });

  it('refuses a different key for the same person until it is accepted', async () => {
    const pins = new KeyPinStore(new MemorySecureStore(), 'me');
    await pins.trusted('nova', 'key-1');

    await expect(pins.trusted('nova', 'key-2')).rejects.toBeInstanceOf(KeyChangedError);
    expect(await pins.observe('nova', 'key-2')).toEqual({
      userId: 'nova',
      pinned: 'key-1',
      current: 'key-2',
    });
    // Refusing did not quietly move the pin.
    expect(await pins.trusted('nova', 'key-1')).toBe('key-1');

    await pins.accept('nova', 'key-2');
    expect(await pins.trusted('nova', 'key-2')).toBe('key-2');
    await expect(pins.trusted('nova', 'key-1')).rejects.toBeInstanceOf(KeyChangedError);
  });

  it('carries the change on the error', async () => {
    const pins = new KeyPinStore(new MemorySecureStore(), 'me');
    await pins.trusted('nova', 'key-1');
    const error = await pins.trusted('nova', 'key-2').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(KeyChangedError);
    expect((error as KeyChangedError).change).toEqual({
      userId: 'nova',
      pinned: 'key-1',
      current: 'key-2',
    });
  });

  it('survives a new store instance over the same storage', async () => {
    const storage = new MemorySecureStore();
    await new KeyPinStore(storage, 'me').trusted('nova', 'key-1');
    await expect(new KeyPinStore(storage, 'me').trusted('nova', 'key-2')).rejects.toBeInstanceOf(
      KeyChangedError,
    );
  });

  it('keeps two accounts on one device apart', async () => {
    const storage = new MemorySecureStore();
    await new KeyPinStore(storage, 'me').trusted('nova', 'key-1');
    // The other account has never seen nova, so its first sight is the pin.
    expect(await new KeyPinStore(storage, 'someone-else').trusted('nova', 'key-2')).toBe('key-2');
  });
});
