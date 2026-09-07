/**
 * Custody of the identity keypair on this device.
 *
 * Three states, and the UI has to be able to render all of them:
 *   empty    — no identity on this device (signed out, or never signed in here)
 *   locked   — the wrapped blob is here, the password is not
 *   unlocked — the private key is in memory and messages can be read
 *
 * The private key is only ever in memory. It is written to storage wrapped, and
 * it is never put in a request body — the secret guard registered here turns
 * that from a convention into an enforced invariant.
 */
import {
  DOMAIN,
  UnwrapError,
  fromBase64,
  keyFingerprint,
  parseWrappedKey,
  toBase64,
  unwrapPrivateKey,
  wipe,
} from '@cipher/crypto';
import { ApiClient, api } from '../api';
import { createSecureStore, type SecureStore } from '../storage/secureStore';

const STORAGE_KEY = 'identity/v1';

/** Everything about the local identity that is safe to persist. */
export interface StoredIdentity {
  userId: string;
  email: string;
  deviceId: string;
  label: string;
  /** base64 X25519 public key. */
  publicKey: string;
  /** blob_A — wrapped under the account password. */
  wrappedPrivateKey: string;
  /** blob_B — wrapped under the recovery code. */
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

  /** Reads whatever identity this device already holds. Leaves it locked. */
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
    this.emit();
    return this.identity;
  }

  /**
   * Called at signup, at login, and after a password reset: records the
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
   * request is made — the answer is already on this device, and asking the
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

  /** Drops the private key from memory but keeps the device enrolled. */
  lock(): void {
    if (this.privateKey) wipe(this.privateKey);
    this.privateKey = null;
    this.privateKeyBase64 = null;
    this.publicKeyBytes = null;
    this.emit();
  }

  /** Full sign-out on this device: the wrapped blob goes too. */
  async forget(): Promise<void> {
    this.lock();
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

  private async setPrivateKey(privateKey: Uint8Array): Promise<void> {
    if (this.privateKey) wipe(this.privateKey);
    this.privateKey = privateKey;
    // Cached because the secret guard runs on every outgoing request and must
    // not be async.
    this.privateKeyBase64 = await toBase64(privateKey);
    this.publicKeyBytes = this.identity ? await fromBase64(this.identity.publicKey) : null;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }
}

export const keyManager = new KeyManager();
