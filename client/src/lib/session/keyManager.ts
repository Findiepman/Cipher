/**
 * Custody of the identity keypair on this device.
 *
 * Three states, and the UI has to be able to render all of them:
 *   empty    (no identity on this device: signed out, or never signed in here)
 *   locked   (the wrapped blob is here, the secret that opens it is not)
 *   unlocked (the private key is in memory and messages can be read)
 *
 * The private key is only ever in memory. It is written to storage wrapped, and
 * it is never put in a request body: the secret guard registered here turns
 * that from a convention into an enforced invariant.
 *
 * Reaching `unlocked` costs a password prompt once, not once per reload. Every
 * unlock also seals the key under this device's non-extractable key (blob_C,
 * see ../storage/deviceKeyStore.ts) and `restore()` reopens it, so a reload
 * comes back unlocked. The record expires REMEMBER_TTL_MS after the last use
 * and `lock()` destroys both halves of it, which is what keeps "Lock" meaning
 * something.
 */
import {
  DOMAIN,
  UnwrapError,
  fromBase64,
  keyFingerprint,
  openFromDevice,
  parseWrappedKey,
  sealToDevice,
  toBase64,
  unwrapPrivateKey,
  wipe,
} from '@cipher/crypto';
import { ApiClient, api } from '../api';
import { createDeviceKeyStore, type DeviceKeyStore } from '../storage/deviceKeyStore';
import { createSecureStore, type SecureStore } from '../storage/secureStore';

const STORAGE_KEY = 'identity/v1';
const REMEMBER_KEY = 'identity/device-unlock/v1';

/**
 * How long a device stays unlocked without the password being entered again.
 * Idle, not absolute: every successful resume pushes the expiry out, so an
 * account in daily use is never asked, and a browser profile abandoned on a
 * machine someone no longer owns goes cold on its own.
 */
const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * blob_C plus the two things needed to decide whether to trust it. The account
 * id is checked before the blob is opened as well as being authenticated
 * inside it, so a record left by another account on a shared browser profile is
 * discarded rather than presented to WebCrypto.
 */
interface RememberedUnlock {
  v: 1;
  userId: string;
  sealed: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

/** Everything about the local identity that is safe to persist. */
export interface StoredIdentity {
  userId: string;
  email: string;
  deviceId: string;
  label: string;
  /** base64 X25519 public key. */
  publicKey: string;
  /** blob_A: wrapped under the account password. */
  wrappedPrivateKey: string;
  /** blob_B: wrapped under the recovery code. */
  wrappedPrivateKeyRecovery: string;
}

export type KeyState = 'empty' | 'locked' | 'unlocked';

export class KeyLockedError extends Error {
  constructor() {
    super('This device is locked. Enter your password to unlock your messages.');
    this.name = 'KeyLockedError';
  }
}

export class KeyManager {
  private identity: StoredIdentity | null = null;
  private privateKey: Uint8Array | null = null;
  private privateKeyBase64: string | null = null;
  private publicKeyBytes: Uint8Array | null = null;
  private readonly listeners = new Set<(state: KeyState) => void>();

  constructor(
    private readonly store: SecureStore = createSecureStore(),
    client: ApiClient = api,
    private readonly deviceKeys: DeviceKeyStore = createDeviceKeyStore(),
  ) {
    // If the unwrapped key ever appears in an outgoing body, the request is
    // refused rather than sent. See client/AGENTS.md.
    client.registerSecretGuard(() => (this.privateKeyBase64 ? [this.privateKeyBase64] : []));
  }

  get state(): KeyState {
    if (!this.identity) return 'empty';
    return this.privateKey ? 'unlocked' : 'locked';
  }

  get current(): StoredIdentity | null {
    return this.identity;
  }

  subscribe(listener: (state: KeyState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Reads whatever identity this device already holds, and reopens it if this
   * device is still remembered. Callers must therefore check `state` afterwards
   * rather than assuming `locked`, which is what SessionProvider's bootstrap
   * does.
   */
  async restore(): Promise<StoredIdentity | null> {
    const raw = await this.store.get(STORAGE_KEY);
    if (!raw) return null;
    try {
      this.identity = JSON.parse(raw) as StoredIdentity;
    } catch {
      // A corrupt record is not recoverable and would block sign-in forever.
      await this.store.remove(STORAGE_KEY);
      this.identity = null;
    }
    if (this.identity) await this.resumeFromDevice();
    this.emit();
    return this.identity;
  }

  /**
   * Called at signup, at login and after a password reset: records the
   * identity and holds the already-unwrapped private key in memory.
   */
  async adopt(identity: StoredIdentity, privateKey: Uint8Array): Promise<void> {
    this.identity = identity;
    await this.store.set(STORAGE_KEY, JSON.stringify(identity));
    await this.setPrivateKey(privateKey);
  }

  /** Updates the stored blobs after a password or recovery-code change. */
  async updateBlobs(patch: Partial<Pick<StoredIdentity,
    'wrappedPrivateKey' | 'wrappedPrivateKeyRecovery' | 'email' | 'publicKey' | 'deviceId'
  >>): Promise<void> {
    if (!this.identity) return;
    this.identity = { ...this.identity, ...patch };
    await this.store.set(STORAGE_KEY, JSON.stringify(this.identity));
    this.emit();
  }

  async unlock(password: string): Promise<void> {
    await this.unwrapInto(password, 'wrappedPrivateKey', DOMAIN.keywrap);
  }

  async unlockWithRecoveryCode(recoveryCode: string): Promise<void> {
    await this.unwrapInto(recoveryCode, 'wrappedPrivateKeyRecovery', DOMAIN.recovery);
  }

  /**
   * Checks a password against the stored blob and throws nothing away.
   *
   * Deliberately not `unlock`: this is for re-confirming who is at the keyboard
   * before revealing something, so it must not change the device's state either
   * way. The key it unwraps is wiped immediately rather than adopted, and no
   * request is made. The answer is already on this device, and asking the
   * server would turn a local check into a password oracle.
   */
  async verifyPassword(password: string): Promise<boolean> {
    if (!this.identity) return false;
    let probe: Uint8Array | null = null;
    try {
      probe = await unwrapPrivateKey(
        parseWrappedKey(this.identity.wrappedPrivateKey),
        password,
        DOMAIN.keywrap,
      );
      return true;
    } catch {
      return false;
    } finally {
      if (probe) wipe(probe);
    }
  }

  /**
   * Drops the private key from memory but keeps the device enrolled.
   *
   * Async because it also has to forget the device key. Locking without that
   * would be theatre: the next reload would walk straight back in through
   * `restore()`. The in-memory half happens synchronously before the first
   * await, so the UI still flips immediately.
   */
  async lock(): Promise<void> {
    if (this.privateKey) wipe(this.privateKey);
    this.privateKey = null;
    this.privateKeyBase64 = null;
    this.publicKeyBytes = null;
    this.emit();
    await this.forgetDevice();
  }

  /** Full sign-out on this device: the wrapped blob goes too. */
  async forget(): Promise<void> {
    await this.lock();
    this.identity = null;
    await this.store.remove(STORAGE_KEY);
    this.emit();
  }

  requirePrivateKey(): Uint8Array {
    if (!this.privateKey) throw new KeyLockedError();
    return this.privateKey;
  }

  requirePublicKey(): Uint8Array {
    if (!this.publicKeyBytes) throw new KeyLockedError();
    return this.publicKeyBytes;
  }

  /** The security number to compare out of band. Null while empty. */
  async fingerprint(): Promise<string | null> {
    if (!this.publicKeyBytes) return null;
    return keyFingerprint(this.publicKeyBytes);
  }

  private async unwrapInto(
    secret: string,
    field: 'wrappedPrivateKey' | 'wrappedPrivateKeyRecovery',
    domain: typeof DOMAIN.keywrap | typeof DOMAIN.recovery,
  ): Promise<void> {
    if (!this.identity) throw new UnwrapError('No identity is stored on this device');
    const blob = parseWrappedKey(this.identity[field]);
    const privateKey = await unwrapPrivateKey(blob, secret, domain);
    await this.setPrivateKey(privateKey);
  }

  /**
   * Reopens blob_C if this device still holds the key for it.
   *
   * Every rejected path clears the record rather than leaving it: a record this
   * device cannot open is not going to become openable later, and one that has
   * expired should not be reconsidered on the next reload.
   */
  private async resumeFromDevice(): Promise<void> {
    if (!this.identity) return;
    const record = await this.readRemembered();
    if (!record || record.userId !== this.identity.userId || record.expiresAt <= Date.now()) {
      if (record) await this.forgetDevice();
      return;
    }
    const deviceKey = await this.deviceKeys.get();
    if (!deviceKey) {
      await this.forgetDevice();
      return;
    }
    try {
      const privateKey = await openFromDevice(deviceKey, record.sealed, this.identity.userId);
      // setPrivateKey re-seals, which is what slides the idle window forward.
      await this.setPrivateKey(privateKey);
    } catch {
      await this.forgetDevice();
    }
  }

  /**
   * Seals the private key under this device's key so the next reload does not
   * need the password.
   *
   * Failures are swallowed on purpose. Staying unlocked is a convenience, and a
   * browser that will not store a CryptoKey should land the user on the
   * password prompt, not on an error about a feature they never asked for.
   */
  private async remember(privateKey: Uint8Array): Promise<void> {
    if (!this.identity) return;
    const userId = this.identity.userId;
    try {
      const deviceKey = (await this.deviceKeys.get()) ?? (await this.deviceKeys.create());
      if (!deviceKey) return;
      const sealed = await sealToDevice(deviceKey, privateKey, userId);
      const record: RememberedUnlock = {
        v: 1,
        userId,
        sealed,
        expiresAt: Date.now() + REMEMBER_TTL_MS,
      };
      await this.store.set(REMEMBER_KEY, JSON.stringify(record));
    } catch {
      await this.forgetDevice();
    }
  }

  private async readRemembered(): Promise<RememberedUnlock | null> {
    const raw = await this.store.get(REMEMBER_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as RememberedUnlock;
      if (
        parsed.v !== 1 ||
        typeof parsed.userId !== 'string' ||
        typeof parsed.sealed !== 'string' ||
        typeof parsed.expiresAt !== 'number'
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Drops both halves: the record, and the key that would open it. Never
   * throws, because it is the failure path of everything above it and the one
   * thing worse than not clearing storage is turning that into a thrown error
   * out of `lock()`.
   */
  private async forgetDevice(): Promise<void> {
    try {
      await this.store.remove(REMEMBER_KEY);
    } catch {
      // Falls through to clearing the key, which alone makes the record inert.
    }
    await this.deviceKeys.clear();
  }

  private async setPrivateKey(privateKey: Uint8Array): Promise<void> {
    if (this.privateKey) wipe(this.privateKey);
    this.privateKey = privateKey;
    // Cached because the secret guard runs on every outgoing request and must
    // not be async.
    this.privateKeyBase64 = await toBase64(privateKey);
    this.publicKeyBytes = this.identity ? await fromBase64(this.identity.publicKey) : null;
    // adopt(), unlock(), unlockWithRecoveryCode() and resumeFromDevice() all
    // funnel through here, so remembering in one place covers every way a
    // device can become unlocked.
    await this.remember(privateKey);
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }
}

export const keyManager = new KeyManager();
