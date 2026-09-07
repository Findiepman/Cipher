/**
 * blob_C: the private key sealed under a key that never leaves this device.
 *
 * blob_A and blob_B exist so the *server* can hold key material it cannot open.
 * This third wrapping exists for a different reason: so a *reload* does not
 * have to ask for the password. The trade is deliberate and it is not free, so
 * it is worth being precise about what it does and does not buy.
 *
 *   password      --> blob_A, on the server, opened at login
 *   recovery code --> blob_B, on the server, opened when the password is gone
 *   device key    --> blob_C, on this device only, opened on every reload
 *
 * The device key is created with `extractable: false`. That flag is the entire
 * point. The browser will encrypt and decrypt with the key and it will refuse
 * to hand the bytes back to script: there is no export that succeeds, so no
 * amount of JavaScript running on this origin can copy the key to another
 * machine. It is stored as a live key object in IndexedDB (structured clone
 * preserves the flag), which is why it cannot go through `SecureStore`, whose
 * values are strings.
 *
 * What this protects against: anything that reads storage and leaves. A stolen
 * disk, a copied browser profile, a backup, an extension or an injected script
 * that dumps IndexedDB and exfiltrates it. All of those now get blob_C, which
 * is inert without a key they cannot obtain.
 *
 * What it does not protect against: code executing on this origin that bothers
 * to *use* the key rather than steal it. An injected script can call
 * `openFromDevice` exactly as this module does. Non-extractability narrows a
 * key theft to a session compromise, it does not prevent one. The honest
 * summary is that leaving a device unlocked is a real weakening of the previous
 * behaviour, accepted because a password prompt on every reload pushes people
 * towards short passwords, which is a worse weakening.
 *
 * The sealed blob is bound to an account id through AES-GCM's additional
 * authenticated data, so a blob_C belonging to one account cannot be swapped in
 * for another on a shared browser profile.
 */
import { DOMAIN } from './domain.js';
import { fromBase64, toBase64 } from './encoding.js';
import { UnwrapError } from './password.js';

const ALGORITHM = 'AES-GCM';
const KEY_BITS = 256;
/** 96 bits, the nonce size AES-GCM is specified for. */
const NONCE_BYTES = 12;

/**
 * The device key, as much of it as anyone outside WebCrypto is allowed to see.
 *
 * This is deliberately structural rather than `CryptoKey`. `packages/crypto` is
 * compiled by `server/` as well as by `client/`, and the server's tsconfig has
 * no DOM lib, so naming the DOM type here would force DOM globals into a
 * TypeScript project that must not have them. A real `CryptoKey` satisfies this
 * shape, so `client/` can hand one straight back.
 */
export interface DeviceKey {
  readonly type: string;
  readonly algorithm: { readonly name: string };
}

/** blob_C at rest. Self-describing for the same reason `WrappedKey` is. */
export interface DeviceSealed {
  v: 1;
  alg: 'aes-256-gcm';
  /** base64, the AES-GCM nonce. */
  nonce: string;
  /** base64, the sealed private key. */
  body: string;
}

/**
 * Thrown when this environment has no WebCrypto at all. Separate from
 * `UnwrapError` because it means "staying unlocked is not available here",
 * which a caller should answer by falling back to the password prompt rather
 * than by telling the user something failed.
 */
export class DeviceKeyUnavailableError extends Error {
  constructor() {
    super('This browser cannot store a device key.');
    this.name = 'DeviceKeyUnavailableError';
  }
}

type BinaryData = ArrayBuffer | ArrayBufferView;

interface GcmParams {
  name: string;
  iv: BinaryData;
  additionalData?: BinaryData;
}

/** Only the four calls this module makes, for the reason given on DeviceKey. */
interface SubtleLike {
  generateKey(
    algorithm: { name: string; length: number },
    extractable: boolean,
    usages: readonly string[],
  ): Promise<DeviceKey>;
  encrypt(algorithm: GcmParams, key: DeviceKey, data: BinaryData): Promise<ArrayBuffer>;
  decrypt(algorithm: GcmParams, key: DeviceKey, data: BinaryData): Promise<ArrayBuffer>;
}

interface WebCryptoLike {
  subtle?: SubtleLike;
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

/**
 * The cast is the price of the structural typing above: under the client's DOM
 * lib `globalThis.crypto` is already a `Crypto`, and the two declarations are
 * compatible in practice but not by TypeScript's overlap rule.
 */
function webCrypto(): WebCryptoLike | undefined {
  return (globalThis as unknown as { crypto?: WebCryptoLike }).crypto;
}

/** True when `createDeviceKey` has any chance of working. */
export function deviceKeysSupported(): boolean {
  return typeof webCrypto()?.subtle?.generateKey === 'function';
}

function subtle(): SubtleLike {
  const available = webCrypto()?.subtle;
  if (!available) throw new DeviceKeyUnavailableError();
  return available;
}

/**
 * A fresh device key. `extractable: false` is the load-bearing argument: pass
 * `true` here and blob_C becomes a raw private key in IndexedDB wearing a
 * costume.
 */
export function createDeviceKey(): Promise<DeviceKey> {
  return subtle().generateKey({ name: ALGORITHM, length: KEY_BITS }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/** `${DOMAIN.device}:${accountId}`, authenticated but not encrypted. */
function context(accountId: string): Uint8Array {
  return new TextEncoder().encode(`${DOMAIN.device}:${accountId}`);
}

export async function sealToDevice(
  deviceKey: DeviceKey,
  privateKey: Uint8Array,
  accountId: string,
): Promise<string> {
  const random = webCrypto();
  if (!random) throw new DeviceKeyUnavailableError();
  const nonce = random.getRandomValues(new Uint8Array(NONCE_BYTES));
  const body = await subtle().encrypt(
    { name: ALGORITHM, iv: nonce, additionalData: context(accountId) },
    deviceKey,
    privateKey,
  );
  const [nonceB64, bodyB64] = await Promise.all([
    toBase64(nonce),
    toBase64(new Uint8Array(body)),
  ]);
  const blob: DeviceSealed = { v: 1, alg: 'aes-256-gcm', nonce: nonceB64, body: bodyB64 };
  return JSON.stringify(blob);
}

/**
 * Opens blob_C. Every failure lands as one `UnwrapError`: a wrong device key, a
 * blob from another account, a tampered blob and a truncated one are all the
 * same answer, and a caller's response to all of them is the same too (drop the
 * record, ask for the password).
 */
export async function openFromDevice(
  deviceKey: DeviceKey,
  sealed: string,
  accountId: string,
): Promise<Uint8Array> {
  const blob = parseDeviceSealed(sealed);
  try {
    const [nonce, body] = await Promise.all([fromBase64(blob.nonce), fromBase64(blob.body)]);
    // GCM is authenticated, so a tampered blob or the wrong account id throws
    // here rather than returning plausible-looking bytes.
    const opened = await subtle().decrypt(
      { name: ALGORITHM, iv: nonce, additionalData: context(accountId) },
      deviceKey,
      body,
    );
    return new Uint8Array(opened);
  } catch (caught) {
    if (caught instanceof DeviceKeyUnavailableError) throw caught;
    throw new UnwrapError('This device could not reopen its stored key.');
  }
}

function parseDeviceSealed(value: string): DeviceSealed {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new UnwrapError('Stored device key material is not readable.');
  }
  if (!isDeviceSealed(parsed)) {
    throw new UnwrapError('Stored device key material is not in a recognised format.');
  }
  return parsed;
}

function isDeviceSealed(value: unknown): value is DeviceSealed {
  if (typeof value !== 'object' || value === null) return false;
  const blob = value as Record<string, unknown>;
  return (
    blob.v === 1 &&
    blob.alg === 'aes-256-gcm' &&
    typeof blob.nonce === 'string' &&
    typeof blob.body === 'string'
  );
}
