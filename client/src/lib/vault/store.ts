/**
 * The vault at rest.
 *
 * One record per account, written through the same `SecureStore` that holds the
 * wrapped identity key, and sealed under a key that is not derived from
 * anything the server has ever seen.
 *
 * The shape, and why it is this shape:
 *
 *   vaultKey            32 random bytes, generated here, never typed
 *   passkeyBlob         vaultKey wrapped under the passkey (DOMAIN.vault)
 *   passwordBlob        the SAME vaultKey wrapped under the account password
 *                       (DOMAIN.vaultReset)
 *   entries             the notes, sealed under vaultKey
 *
 * Wrapping one key twice is the trick `packages/crypto` already plays on the
 * private key with the password and the recovery code, and it is what makes
 * "I forgot my passkey" survivable: the password opens the second wrap, the
 * vault key comes out unchanged, and not a single entry has to be
 * re-encrypted. Changing the passkey is the same move, and equally cheap.
 *
 * What this file deliberately does not do is go anywhere near
 * `encryptMessage`. That seals to a recipient's public key, which is the
 * wrong shape for notes to yourself on one device; the vault uses the
 * symmetric half of the crypto package, under a key only this device holds.
 * See vault-plan.md, *The encryption story, stated honestly*.
 */
import {
  DOMAIN,
  UnwrapError,
  generateSecretKey,
  openWithKey,
  parseSealed,
  parseWrappedKey,
  sealWithKey,
  serializeSealed,
  serializeWrappedKey,
  unwrapPrivateKey,
  wrapPrivateKey,
} from '@cipher/crypto';
import type { SecureStore } from '../storage/secureStore';
import type { PasskeyKind } from './passkeyPolicy';

/** One thing you kept. Text only until stage 3 of vault-plan.md. */
export interface VaultEntry {
  id: string;
  body: string;
  /** ISO-8601. */
  createdAt: string;
}

/** What the store holds for one account. Every field here is sealed or opaque. */
interface VaultRecord {
  v: 1;
  /** Which shape the passkey is, so the unlock screen can offer the right pad. */
  kind: PasskeyKind;
  createdAt: string;
  /** serializeWrappedKey, opened by the passkey. */
  passkeyBlob: string;
  /** serializeWrappedKey, opened by the account password. */
  passwordBlob: string;
  /** serializeSealed, opened by the vault key. */
  entries: string;
}

/**
 * What the provider needs from a vault, as an interface.
 *
 * `VaultStore` below is the real one and does real sealing. The seam exists
 * because component tests run under jsdom, where libsodium's
 * `instanceof Uint8Array` check fails against the test realm's typed arrays
 * (see client/vite.config.ts), so a screen test has to drive a stub while the
 * crypto claims are proved in the node suite next door.
 */
export interface VaultBackend {
  summary(): Promise<VaultSummary>;
  create(passkey: string, password: string, kind: PasskeyKind): Promise<Uint8Array>;
  unlock(passkey: string): Promise<Uint8Array>;
  unlockWithPassword(password: string): Promise<Uint8Array>;
  entries(vaultKey: Uint8Array): Promise<VaultEntry[]>;
  save(vaultKey: Uint8Array, entries: VaultEntry[]): Promise<void>;
  changePasskey(vaultKey: Uint8Array, passkey: string, kind: PasskeyKind): Promise<void>;
  forget(): Promise<void>;
}

/** Thrown when there is no vault for this account yet. */
export class NoVaultError extends Error {
  constructor() {
    super('There is no vault on this device for this account.');
    this.name = 'NoVaultError';
  }
}

export interface VaultSummary {
  exists: boolean;
  kind: PasskeyKind | null;
  createdAt: string | null;
}

/**
 * Namespaced by account, because a browser profile is shared and a second
 * account signing in must not be shown the first one's vault, sealed or not.
 */
function storageKey(userId: string): string {
  return `vault/v1/${userId}`;
}

export class VaultStore implements VaultBackend {
  constructor(
    private readonly store: SecureStore,
    private readonly userId: string,
  ) {}

  async summary(): Promise<VaultSummary> {
    const record = await this.read();
    return record
      ? { exists: true, kind: record.kind, createdAt: record.createdAt }
      : { exists: false, kind: null, createdAt: null };
  }

  /**
   * Sets up the vault. The password is taken here as well as the passkey so
   * that the reset path exists from the first minute rather than from whenever
   * somebody remembers to build it. Callers should verify the password against
   * `AuthService.verifyPassword` first: a typo here would not fail until the
   * day the passkey is forgotten, which is the worst possible moment to find
   * out.
   */
  async create(passkey: string, password: string, kind: PasskeyKind): Promise<Uint8Array> {
    const vaultKey = await generateSecretKey();
    const [passkeyBlob, passwordBlob, entries] = await Promise.all([
      wrapPrivateKey(vaultKey, passkey, DOMAIN.vault),
      wrapPrivateKey(vaultKey, password, DOMAIN.vaultReset),
      sealWithKey(JSON.stringify([]), vaultKey),
    ]);

    await this.write({
      v: 1,
      kind,
      createdAt: new Date().toISOString(),
      passkeyBlob: serializeWrappedKey(passkeyBlob),
      passwordBlob: serializeWrappedKey(passwordBlob),
      entries: serializeSealed(entries),
    });

    return vaultKey;
  }

  /** Throws `UnwrapError` on a wrong passkey, exactly as the key manager does. */
  async unlock(passkey: string): Promise<Uint8Array> {
    const record = await this.require();
    return unwrapPrivateKey(parseWrappedKey(record.passkeyBlob), passkey, DOMAIN.vault);
  }

  /** The way back in when the passkey is gone. Same key, second wrapping. */
  async unlockWithPassword(password: string): Promise<Uint8Array> {
    const record = await this.require();
    return unwrapPrivateKey(
      parseWrappedKey(record.passwordBlob),
      password,
      DOMAIN.vaultReset,
    );
  }

  async entries(vaultKey: Uint8Array): Promise<VaultEntry[]> {
    const record = await this.require();
    const json = await openWithKey(parseSealed(record.entries), vaultKey);
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  }

  async save(vaultKey: Uint8Array, entries: VaultEntry[]): Promise<void> {
    const record = await this.require();
    const sealed = await sealWithKey(JSON.stringify(entries), vaultKey);
    await this.write({ ...record, entries: serializeSealed(sealed) });
  }

  /**
   * Re-wraps the same vault key under a new passkey. The entries are untouched,
   * which is the point of wrapping a key rather than deriving one from the
   * passkey directly.
   */
  async changePasskey(
    vaultKey: Uint8Array,
    passkey: string,
    kind: PasskeyKind,
  ): Promise<void> {
    const record = await this.require();
    const wrapped = await wrapPrivateKey(vaultKey, passkey, DOMAIN.vault);
    await this.write({ ...record, kind, passkeyBlob: serializeWrappedKey(wrapped) });
  }

  /**
   * Re-wraps under a new account password. Called after a password change,
   * because the old passwordBlob would otherwise still be openable by a
   * password the account no longer accepts.
   */
  async rewrapForPassword(vaultKey: Uint8Array, password: string): Promise<void> {
    const record = await this.require();
    const wrapped = await wrapPrivateKey(vaultKey, password, DOMAIN.vaultReset);
    await this.write({ ...record, passwordBlob: serializeWrappedKey(wrapped) });
  }

  /** Removes the vault and everything in it from this device. Not reversible. */
  async forget(): Promise<void> {
    await this.store.remove(storageKey(this.userId));
  }

  private async require(): Promise<VaultRecord> {
    const record = await this.read();
    if (!record) throw new NoVaultError();
    return record;
  }

  private async read(): Promise<VaultRecord | null> {
    const raw = await this.store.get(storageKey(this.userId));
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isRecord(parsed) ? parsed : null;
    } catch {
      // A corrupt record reads as "no vault" rather than throwing on every
      // render. The entries are gone either way, and `create` will overwrite.
      return null;
    }
  }

  private async write(record: VaultRecord): Promise<void> {
    await this.store.set(storageKey(this.userId), JSON.stringify(record));
  }
}

function isRecord(value: unknown): value is VaultRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.v === 1 &&
    (record.kind === 'digits' || record.kind === 'mixed') &&
    typeof record.createdAt === 'string' &&
    typeof record.passkeyBlob === 'string' &&
    typeof record.passwordBlob === 'string' &&
    typeof record.entries === 'string'
  );
}

function isEntry(value: unknown): value is VaultEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.body === 'string' &&
    typeof entry.createdAt === 'string'
  );
}

export { UnwrapError };
