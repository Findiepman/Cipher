/**
 * The public surface of @cipher/crypto.
 *
 * Keep it small and stable: client/ should never have to change because the
 * internals did. Nothing below this file may be imported from outside the
 * package, and libsodium may not be imported anywhere else in the repo.
 */
export { DOMAIN, type WrapDomain } from './domain.js';
export {
  DeviceKeyUnavailableError,
  createDeviceKey,
  deviceKeysSupported,
  openFromDevice,
  sealToDevice,
  type DeviceKey,
  type DeviceSealed,
} from './deviceKey.js';
export { equalBytes, fromBase64, fromUtf8, toBase64, toUtf8, wipe } from './encoding.js';
export { generateKeyPair, keyFingerprint, publicKeyToBase64, type KeyPair } from './keys.js';
export {
  DecryptError,
  decryptMessage,
  encryptMessage,
  parseCiphertext,
  serializeCiphertext,
  type Ciphertext,
} from './message.js';
export {
  SealError,
  generateSecretKey,
  openWithKey,
  parseSealed,
  sealWithKey,
  serializeSealed,
  type Sealed,
} from './secret.js';
export {
  UnwrapError,
  deriveAuthHash,
  generateRecoveryCode,
  normalizeRecoveryCode,
  parseWrappedKey,
  recoveryCodeHash,
  serializeWrappedKey,
  unwrapPrivateKey,
  wrapPrivateKey,
  type WrappedKey,
} from './password.js';
