/**
 * Every account flow, end to end. This is the file to read to understand what
 * the client actually does with a password.
 *
 * The rule that shapes all of it: the password is never sent anywhere. It is
 * turned into two unrelated values locally (`authHash`, which goes to the
 * server, and a wrapping key, which does not) and only the first one leaves
 * the device. Same for the recovery code: the server gets its SHA-256, never
 * the code.
 *
 * Ordering matters in a few places and is called out where it does.
 */
import type { Translatable } from '../i18n/errors';
import {
  DOMAIN,
  UnwrapError,
  deriveAuthHash,
  generateKeyPair,
  generateRecoveryCode,
  parseWrappedKey,
  publicKeyToBase64,
  recoveryCodeHash,
  serializeWrappedKey,
  unwrapPrivateKey,
  wrapPrivateKey,
} from '@cipher/crypto';
import { ApiClient, api } from '../api';
import { createAccountApi, createAuthApi } from '../api/endpoints';
import type { AccountDto, DeviceDto, ResetContextResponse } from '../api/types';
import { KeyManager, keyManager as defaultKeyManager } from './keyManager';

export interface RegisterInput {
  email: string;
  username: string;
  password: string;
  deviceLabel?: string;
}

export interface LoginInput {
  email: string;
  password: string;
  deviceLabel?: string;
}

/**
 * Thrown when the server accepted the password but the stored blob_A will not
 * open with it. It means the account's key material is out of step with its
 * credentials. Rare, but the UI must offer the recovery-code path rather than
 * saying "wrong password", which would be a lie.
 */
/**
 * The recovery code did not open the blob it was given.
 *
 * An `UnwrapError` so every existing catch still works, with a phrase so the
 * screen can say which of the two secrets was wrong. Told apart from a bad
 * reset link on purpose: they are different mistakes with different fixes.
 */
export class WrongRecoveryCode extends UnwrapError implements Translatable {
  readonly phrase = { key: 'error.wrongRecoveryCode' } as const;

  constructor() {
    super('That recovery code does not match this account.');
    this.name = 'WrongRecoveryCode';
  }
}

export class IdentityUnavailableError extends Error implements Translatable {
  readonly phrase = { key: 'error.identityUnavailable' } as const;

  constructor() {
    super('Signed in, but this account’s encryption key could not be unlocked.');
    this.name = 'IdentityUnavailableError';
  }
}

export class AuthService {
  private readonly auth: ReturnType<typeof createAuthApi>;
  private readonly account: ReturnType<typeof createAccountApi>;

  constructor(
    private readonly keys: KeyManager = defaultKeyManager,
    private readonly client: ApiClient = api,
  ) {
    this.auth = createAuthApi(client);
    this.account = createAccountApi(client);
  }

  /**
   * Signup. The keypair is generated here, wrapped twice and only the wrapped
   * forms are uploaded. The recovery code is returned to the caller to show
   * once and never again: it is not stored anywhere, by design.
   */
  async register(input: RegisterInput): Promise<{ recoveryCode: string }> {
    const { email, username, password } = input;
    const keyPair = await generateKeyPair();
    const recoveryCode = await generateRecoveryCode();

    const [authHash, blobA, blobB, codeHash, publicKey] = await Promise.all([
      deriveAuthHash(email, password),
      wrapPrivateKey(keyPair.privateKey, password, DOMAIN.keywrap),
      wrapPrivateKey(keyPair.privateKey, recoveryCode, DOMAIN.recovery),
      recoveryCodeHash(recoveryCode),
      publicKeyToBase64(keyPair.publicKey),
    ]);

    await this.auth.register({
      email,
      username,
      authHash,
      recoveryCodeHash: codeHash,
      device: {
        label: input.deviceLabel ?? describeDevice(),
        publicKey,
        wrappedPrivateKey: serializeWrappedKey(blobA),
        wrappedPrivateKeyRecovery: serializeWrappedKey(blobB),
      },
    });

    // The identity is deliberately not adopted here. Registration returns a
    // generic acknowledgement (no account id, so account enumeration stays
    // impossible), and the wrapped blobs are safe on the server. The first
    // successful login downloads and unwraps them.
    return { recoveryCode };
  }

  async login(input: LoginInput): Promise<AccountDto> {
    const authHash = await deriveAuthHash(input.email, input.password);
    const response = await this.auth.login({
      email: input.email,
      authHash,
      deviceLabel: input.deviceLabel ?? describeDevice(),
    });

    this.client.setTokens(response.tokens);

    if (response.device) {
      await this.adoptDevice(response.user, response.device, input.password);
    }
    return response.user;
  }

  /** Re-derives the key on a device that already holds the wrapped blob. */
  async unlock(password: string): Promise<void> {
    await this.keys.unlock(password);
  }

  lock(): Promise<void> {
    return this.keys.lock();
  }

  /**
   * Re-confirms the password without unlocking, signing in or calling the
   * server. Used to gate revealing something on a device that is already
   * unlocked. See DevicesSection.
   */
  verifyPassword(password: string): Promise<boolean> {
    return this.keys.verifyPassword(password);
  }

  async logout(): Promise<void> {
    try {
      await this.auth.logout();
    } finally {
      // Local state is cleared even if the call failed: a user who pressed
      // sign-out must not be left holding a decrypted key.
      this.client.clearTokens();
      await this.keys.forget();
    }
  }

  async logoutEverywhere(): Promise<void> {
    try {
      await this.auth.logoutAll();
    } finally {
      this.client.clearTokens();
      await this.keys.forget();
    }
  }

  verifyEmail(token: string) {
    return this.auth.verifyEmail({ token });
  }

  resendVerification(email: string) {
    return this.auth.resendVerification({ email });
  }

  /** Always resolves the same way whether or not the account exists. */
  forgotPassword(email: string) {
    return this.auth.forgotPassword({ email });
  }

  /**
   * Password change while signed in and unlocked. blob_A is re-wrapped under
   * the new password; blob_B is untouched, so the existing recovery code keeps
   * working.
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const identity = this.keys.current;
    if (!identity) throw new UnwrapError('No identity is stored on this device');
    const privateKey = this.keys.requirePrivateKey();

    const [currentAuthHash, newAuthHash, blobA] = await Promise.all([
      deriveAuthHash(identity.email, currentPassword),
      deriveAuthHash(identity.email, newPassword),
      wrapPrivateKey(privateKey, newPassword, DOMAIN.keywrap),
    ]);
    const wrappedPrivateKey = serializeWrappedKey(blobA);

    await this.account.changePassword({ currentAuthHash, newAuthHash, wrappedPrivateKey });
    // Only after the server has accepted the new blob, so a failed request
    // cannot leave this device holding a blob the server does not have.
    await this.keys.updateBlobs({ wrappedPrivateKey });
  }

  /** Step 1 of an email change: sends the confirmation mail. */
  async requestEmailChange(newEmail: string, password: string): Promise<void> {
    const identity = this.keys.current;
    if (!identity) throw new UnwrapError('No identity is stored on this device');
    const authHash = await deriveAuthHash(identity.email, password);
    await this.account.changeEmail({ newEmail, authHash });
  }

  /**
   * Step 2. The auth salt is derived from the email, so the new address needs a
   * newly derived authHash. The wrapped key blobs carry their own random salts
   * and are unaffected: no re-wrapping, and the recovery code still works.
   */
  async confirmEmailChange(token: string, newEmail: string, password: string): Promise<void> {
    const newAuthHash = await deriveAuthHash(newEmail, password);
    await this.account.confirmEmailChange({ token, newAuthHash });
    await this.keys.updateBlobs({ email: newEmail });
  }

  /**
   * What a reset token is worth: the account's email and blob_B, which is
   * still sealed under a recovery code the server has never seen.
   *
   * A reset screen calls this first, for two reasons that both matter. It says
   * whether the link is any good before the user types a password into a form
   * that is going to fail, and it supplies the email address the new authHash
   * has to be derived under, which a signed-out device on a machine that has
   * never held this account has no other way to learn.
   *
   * The token is not spent by this, only by the reset itself.
   */
  resetContext(token: string): Promise<ResetContextResponse> {
    return this.auth.resetContext({ token });
  }

  /**
   * Password reset WITH the recovery code. blob_B is fetched against the reset
   * token, opened with the code and the key is re-wrapped under the new
   * password. Identity and message history survive.
   *
   * The old recovery code is spent by this, so a fresh one is minted and
   * returned to show the user once.
   *
   * Pass `context` if you already hold one. A caller that does not is charged a
   * round trip per attempt, and a mistyped recovery code is the likeliest way
   * to get here twice: the unwrap that catches it happens on this device, so
   * with the context in hand a wrong code costs nothing at all.
   */
  async resetPasswordWithRecoveryCode(input: {
    token: string;
    recoveryCode: string;
    newPassword: string;
    context?: ResetContextResponse;
  }): Promise<{ recoveryCode: string }> {
    const context = input.context ?? (await this.auth.resetContext({ token: input.token }));

    let privateKey: Uint8Array;
    try {
      privateKey = await unwrapPrivateKey(
        parseWrappedKey(context.wrappedPrivateKeyRecovery),
        input.recoveryCode,
        DOMAIN.recovery,
      );
    } catch {
      // Distinguishable from "bad reset link" so the UI can say which one the
      // user got wrong.
      throw new WrongRecoveryCode();
    }

    const nextRecoveryCode = await generateRecoveryCode();
    const [authHash, blobA, blobB, codeHash] = await Promise.all([
      deriveAuthHash(context.email, input.newPassword),
      wrapPrivateKey(privateKey, input.newPassword, DOMAIN.keywrap),
      wrapPrivateKey(privateKey, nextRecoveryCode, DOMAIN.recovery),
      recoveryCodeHash(nextRecoveryCode),
    ]);

    await this.auth.resetPassword({
      token: input.token,
      authHash,
      identityReset: false,
      wrappedPrivateKey: serializeWrappedKey(blobA),
      wrappedPrivateKeyRecovery: serializeWrappedKey(blobB),
      recoveryCodeHash: codeHash,
    });

    return { recoveryCode: nextRecoveryCode };
  }

  /**
   * Password reset WITHOUT the recovery code. There is no way back to the old
   * private key, and that is the design working, not a failure. A fresh keypair is
   * generated, every message encrypted to the old key stays permanently
   * unreadable, and contacts must be shown a "security number changed" warning.
   *
   * Callers must confirm this with the user explicitly before calling it.
   */
  async resetPasswordAndDiscardIdentity(input: {
    token: string;
    email: string;
    newPassword: string;
  }): Promise<{ recoveryCode: string }> {
    const keyPair = await generateKeyPair();
    const recoveryCode = await generateRecoveryCode();

    const [authHash, blobA, blobB, codeHash, publicKey] = await Promise.all([
      deriveAuthHash(input.email, input.newPassword),
      wrapPrivateKey(keyPair.privateKey, input.newPassword, DOMAIN.keywrap),
      wrapPrivateKey(keyPair.privateKey, recoveryCode, DOMAIN.recovery),
      recoveryCodeHash(recoveryCode),
      publicKeyToBase64(keyPair.publicKey),
    ]);

    await this.auth.resetPassword({
      token: input.token,
      authHash,
      identityReset: true,
      publicKey,
      wrappedPrivateKey: serializeWrappedKey(blobA),
      wrappedPrivateKeyRecovery: serializeWrappedKey(blobB),
      recoveryCodeHash: codeHash,
    });

    // The device is holding a key for an identity that no longer exists.
    await this.keys.forget();
    return { recoveryCode };
  }

  /** Mints a new recovery code and invalidates the old one. */
  async regenerateRecoveryCode(password: string): Promise<{ recoveryCode: string }> {
    const identity = this.keys.current;
    if (!identity) throw new UnwrapError('No identity is stored on this device');
    const privateKey = this.keys.requirePrivateKey();

    const recoveryCode = await generateRecoveryCode();
    const [authHash, blobB, codeHash] = await Promise.all([
      deriveAuthHash(identity.email, password),
      wrapPrivateKey(privateKey, recoveryCode, DOMAIN.recovery),
      recoveryCodeHash(recoveryCode),
    ]);
    const wrappedPrivateKeyRecovery = serializeWrappedKey(blobB);

    await this.account.regenerateRecoveryCode({
      authHash,
      recoveryCodeHash: codeHash,
      wrappedPrivateKeyRecovery,
    });
    await this.keys.updateBlobs({ wrappedPrivateKeyRecovery });

    return { recoveryCode };
  }

  async deleteAccount(password: string): Promise<void> {
    const identity = this.keys.current;
    if (!identity) throw new UnwrapError('No identity is stored on this device');
    const authHash = await deriveAuthHash(identity.email, password);
    await this.account.deleteAccount({ authHash });
    this.client.clearTokens();
    await this.keys.forget();
  }

  me(): Promise<AccountDto> {
    return this.account.me();
  }

  /**
   * Profile fields the server owns. Nothing here is key material, so unlike
   * every other account change it needs no password and no re-wrapping.
   */
  updateProfile(input: { username?: string }): Promise<AccountDto> {
    return this.account.updateProfile(input);
  }

  sessions() {
    return this.account.sessions();
  }

  revokeSession(id: string) {
    return this.account.revokeSession(id);
  }

  private async adoptDevice(
    user: AccountDto,
    device: DeviceDto,
    password: string,
  ): Promise<void> {
    let privateKey: Uint8Array;
    try {
      privateKey = await unwrapPrivateKey(
        parseWrappedKey(device.wrappedPrivateKey),
        password,
        DOMAIN.keywrap,
      );
    } catch {
      throw new IdentityUnavailableError();
    }

    await this.keys.adopt(
      {
        userId: user.id,
        email: user.email,
        deviceId: device.id,
        label: device.label,
        publicKey: device.publicKey,
        wrappedPrivateKey: device.wrappedPrivateKey,
        wrappedPrivateKeyRecovery: device.wrappedPrivateKeyRecovery,
      },
      privateKey,
    );
  }
}

/** A human-readable device label for the user's own session list. */
export function describeDevice(): string {
  if (typeof navigator === 'undefined') return 'Unknown device';
  const ua = navigator.userAgent;
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Browser';
  const platform =
    /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Android/.test(ua) ? 'Android'
    : /(iPhone|iPad)/.test(ua) ? 'iOS'
    : /Linux/.test(ua) ? 'Linux'
    : 'Unknown';
  return `${browser} on ${platform}`;
}

export const authService = new AuthService();
