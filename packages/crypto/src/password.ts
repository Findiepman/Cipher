/**
 * Everything that turns a password (or a recovery code) into key material.
 *
 * The shape client/src/lib/session/authService.ts depends on: one password is
 * stretched into two unrelated values, and only one of them leaves the device.
 *
 *   password --+-- deriveAuthHash()  --> authHash, sent to the server
 *              |
 *              +-- wrapPrivateKey()  --> blob_A, an encrypted private key
 *
 * The server stores the authHash and both blobs and can do nothing with them:
 * the blobs are sealed under a key pulled through a different domain label, so
 * holding the authHash does not open them. That is the property that lets the
 * server keep a user account's key material without being able to read a
 * single message.
 */
import { DOMAIN, type WrapDomain } from './domain.js';
import { fromBase64, toBase64, wipe } from './encoding.js';
import { ready, type Sodium } from './sodium.js';

/**
 * Thrown whenever key material will not open: wrong password, wrong recovery
 * code, tampered blob, or no identity present at all. Deliberately one error
 * for all of them, because telling the caller which one it was is an oracle.
 */
export class UnwrapError extends Error {
  constructor(message = 'Could not unlock this key with the secret provided.') {
    super(message);
    this.name = 'UnwrapError';
  }
}

/**
 * A private key at rest. Self-describing so the KDF cost can be raised later
 * without stranding blobs written under the old parameters: an unwrap reads the
 * parameters out of the blob rather than assuming today's.
 */
export interface WrappedKey {
  v: 1;
  kdf: 'argon2id13';
  ops: number;
  mem: number;
  /** base64, KDF salt. */
  salt: string;
  /** base64, secretbox nonce. */
  nonce: string;
  /** base64, the sealed private key. */
  body: string;
}

/**
 * Argon2id cost. Interactive is the right tier for something a user waits on at
 * a login prompt; the value is recorded in every blob, so raising it later only
 * affects newly written ones.
 */
function costs(sodium: Sodium): { ops: number; mem: number } {
  return {
    ops: sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    mem: sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
  };
}

/** Argon2id, then a domain-separated pull from the result. */
async function stretch(
  secret: string,
  salt: Uint8Array,
  domain: string,
  ops: number,
  mem: number,
): Promise<Uint8Array> {
  const sodium = await ready();
  const base = sodium.crypto_pwhash(
    32,
    secret,
    salt,
    ops,
    mem,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
  try {
    // Keyed BLAKE2b with the Argon2 output as the key: two domains give two
    // independent keys from one expensive run, so the second costs nothing.
    return sodium.crypto_generichash(32, sodium.from_string(domain), base);
  } finally {
    wipe(base);
  }
}

/**
 * The value the server compares at login. Deterministic, and salted from the
 * email rather than from a random value, because the client has to reproduce it
 * before it has spoken to the server at all.
 *
 * Consequence worth knowing: two accounts sharing an email and a password would
 * produce the same authHash. Emails are unique per account so they cannot, but
 * do not reuse this function anywhere that is not true.
 */
export async function deriveAuthHash(email: string, password: string): Promise<string> {
  const sodium = await ready();
  const { ops, mem } = costs(sodium);
  const salt = sodium.crypto_generichash(
    sodium.crypto_pwhash_SALTBYTES,
    sodium.from_string(normalizeEmail(email)),
    sodium.from_string(DOMAIN.auth),
  );
  const hash = sodium.crypto_pwhash(
    32,
    password,
    salt,
    ops,
    mem,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
  try {
    return await toBase64(hash);
  } finally {
    wipe(hash);
  }
}

export async function wrapPrivateKey(
  privateKey: Uint8Array,
  secret: string,
  domain: WrapDomain,
): Promise<WrappedKey> {
  const sodium = await ready();
  const { ops, mem } = costs(sodium);
  const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const key = await stretch(secret, salt, domain, ops, mem);

  try {
    const body = sodium.crypto_secretbox_easy(privateKey, nonce, key);
    const [saltB64, nonceB64, bodyB64] = await Promise.all([
      toBase64(salt),
      toBase64(nonce),
      toBase64(body),
    ]);
    return { v: 1, kdf: 'argon2id13', ops, mem, salt: saltB64, nonce: nonceB64, body: bodyB64 };
  } finally {
    wipe(key);
  }
}

export async function unwrapPrivateKey(
  blob: WrappedKey,
  secret: string,
  domain: WrapDomain,
): Promise<Uint8Array> {
  const sodium = await ready();
  let key: Uint8Array | null = null;
  try {
    const [salt, nonce, body] = await Promise.all([
      fromBase64(blob.salt),
      fromBase64(blob.nonce),
      fromBase64(blob.body),
    ]);
    key = await stretch(secret, salt, domain, blob.ops, blob.mem);
    // secretbox is authenticated: a wrong secret and a tampered blob both land
    // here as a thrown error, never as plausible-looking bytes.
    return sodium.crypto_secretbox_open_easy(body, nonce, key);
  } catch {
    throw new UnwrapError();
  } finally {
    if (key) wipe(key);
  }
}

export function serializeWrappedKey(blob: WrappedKey): string {
  return JSON.stringify(blob);
}

export function parseWrappedKey(value: string): WrappedKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new UnwrapError('Stored key material is not readable.');
  }
  if (!isWrappedKey(parsed)) {
    throw new UnwrapError('Stored key material is not in a recognised format.');
  }
  return parsed;
}

function isWrappedKey(value: unknown): value is WrappedKey {
  if (typeof value !== 'object' || value === null) return false;
  const blob = value as Record<string, unknown>;
  return (
    blob.v === 1 &&
    blob.kdf === 'argon2id13' &&
    typeof blob.ops === 'number' &&
    typeof blob.mem === 'number' &&
    typeof blob.salt === 'string' &&
    typeof blob.nonce === 'string' &&
    typeof blob.body === 'string'
  );
}

const RECOVERY_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const RECOVERY_GROUPS = 4;
const RECOVERY_GROUP_LENGTH = 5;

/**
 * The one thing standing between a forgotten password and a permanently
 * unreadable message history. Twenty characters over a 36-symbol alphabet is
 * about 103 bits: it is a key, not a PIN. It is never stored anywhere. The
 * caller shows it to the user once and the server only ever sees its hash.
 */
export async function generateRecoveryCode(): Promise<string> {
  const sodium = await ready();
  const groups: string[] = [];
  for (let group = 0; group < RECOVERY_GROUPS; group += 1) {
    let chars = '';
    for (let index = 0; index < RECOVERY_GROUP_LENGTH; index += 1) {
      // randombytes_uniform rather than a modulo of a random byte, which would
      // quietly favour the first four symbols of the alphabet.
      chars += RECOVERY_ALPHABET[sodium.randombytes_uniform(RECOVERY_ALPHABET.length)];
    }
    groups.push(chars);
  }
  return groups.join('-');
}

/**
 * What the server stores. A plain SHA-256 and not Argon2: the code is already
 * high-entropy, so there is no dictionary for a slow hash to defend against.
 */
export async function recoveryCodeHash(recoveryCode: string): Promise<string> {
  const sodium = await ready();
  const digest = sodium.crypto_hash_sha256(
    sodium.from_string(normalizeRecoveryCode(recoveryCode)),
  );
  return toBase64(digest);
}

/** Dashes and case are presentation, not secret material. */
export function normalizeRecoveryCode(recoveryCode: string): string {
  return recoveryCode.replace(/[\s-]/g, '').toUpperCase();
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
