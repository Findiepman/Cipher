/**
 * Trust on first use for other people's public keys.
 *
 * Every key this client seals to comes from the server's registry, and the
 * one thing correct encryption cannot do is tell you the registry is honest.
 * A server that handed you its own key in place of a friend's would read
 * everything, and `crypto_box` would work perfectly. Pinning narrows that to
 * one moment: the first time a person's key is seen, it is remembered, and
 * from then on a different key for the same person is a change the user has
 * to accept before anything is sealed to it or opened with it.
 *
 * A change is not always an attack. Resetting a password without the
 * recovery code makes a fresh keypair (backend-plan.md, "security number
 * changed"), and that is exactly what this surfaces: the conversation stops
 * until the person on this side says they know. What it deliberately does not
 * do is decide for them.
 *
 * Pins live in the same secure store as everything else, namespaced by the
 * account that holds them, so two people sharing a browser profile keep
 * separate opinions about who is who. They are public keys, so nothing here
 * is sealed. Your own key is never pinned: it is whatever the unlocked
 * identity says it is.
 */
import type { SecureStore } from '../storage/secureStore';

/** A key the registry serves that is not the one this device pinned. */
export interface KeyChange {
  userId: string;
  /** base64, what this device trusted until now. */
  pinned: string;
  /** base64, what the server says today. */
  current: string;
}

/**
 * Thrown by a key resolver when the person's key has changed and the change
 * has not been accepted. Sealing stops; opening reports it on the message.
 */
export class KeyChangedError extends Error {
  constructor(readonly change: KeyChange) {
    super('The security key for this person has changed.');
    this.name = 'KeyChangedError';
  }
}

function storageKey(ownerId: string, userId: string): string {
  return `keypin/v1/${ownerId}/${userId}`;
}

export class KeyPinStore {
  /// What the store said, so a resolver on the hot path is a map lookup
  /// rather than an IndexedDB transaction per message.
  private readonly cache = new Map<string, string | null>();

  constructor(
    private readonly store: SecureStore,
    private readonly ownerId: string,
  ) {}

  /**
   * The key to use for a person, given what the server says it is now.
   *
   * The first key seen is pinned and returned. A key matching the pin is
   * returned. Anything else throws `KeyChangedError`, which the caller
   * surfaces; nothing is sealed to or opened with the new key until
   * `accept` has been called.
   */
  async trusted(userId: string, current: string): Promise<string> {
    const pinned = await this.read(userId);
    if (pinned === null) {
      await this.write(userId, current);
      return current;
    }
    if (pinned === current) return current;
    throw new KeyChangedError({ userId, pinned, current });
  }

  /**
   * `trusted` for a list load rather than a message: pins a first sighting
   * and reports a change instead of throwing, so the notice can go up the
   * moment the friend list arrives rather than on the first message.
   */
  async observe(userId: string, current: string): Promise<KeyChange | null> {
    try {
      await this.trusted(userId, current);
      return null;
    } catch (error) {
      if (error instanceof KeyChangedError) return error.change;
      throw error;
    }
  }

  /** The user has looked at the change and said it is fine. */
  async accept(userId: string, current: string): Promise<void> {
    await this.write(userId, current);
  }

  private async read(userId: string): Promise<string | null> {
    const cached = this.cache.get(userId);
    if (cached !== undefined) return cached;
    const stored = await this.store.get(storageKey(this.ownerId, userId));
    this.cache.set(userId, stored);
    return stored;
  }

  private async write(userId: string, key: string): Promise<void> {
    await this.store.set(storageKey(this.ownerId, userId), key);
    this.cache.set(userId, key);
  }
}
