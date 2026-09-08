/**
 * Sealing a document under a key you already hold.
 *
 * The rest of this package wraps a key under a *secret* a person types
 * (`wrapPrivateKey`) or seals a message to a *recipient* (`encryptMessage`).
 * The vault needs the third shape: a symmetric seal over a key that was
 * generated, not typed, so the thing being protected can be any size and the
 * expensive Argon2id run happens once on the key rather than once per write.
 *
 * `crypto_secretbox` again, the same primitive the key wrapping uses, so this
 * adds no new cryptography to the repo. Authenticated, so a tampered body and
 * a wrong key both arrive as a thrown error rather than as plausible bytes.
 *
 * Note for anyone reaching for this from the message path: do not. Messages go
 * through `encryptMessage`/`decryptMessage`, which is the seam phase 2 plugs
 * into. This is for content that is sealed *before* it is handed to that seam,
 * which today means the vault and nothing else.
 */
import { fromBase64, fromUtf8, toBase64, toUtf8, wipe } from './encoding.js';
import { ready } from './sodium.js';

/** Thrown when a sealed document will not open: wrong key, or tampered bytes. */
export class SealError extends Error {
  constructor(message = 'Could not open this content with the key provided.') {
    super(message);
    this.name = 'SealError';
  }
}

/**
 * A sealed document at rest. Self-describing for the same reason `WrappedKey`
 * is: the algorithm is recorded so today's blobs still open after the scheme
 * moves on.
 */
export interface Sealed {
  v: 1;
  alg: 'secretbox';
  /** base64, the nonce. Not secret, and never reused with the same key. */
  nonce: string;
  /** base64, the sealed body. */
  body: string;
}

/** A fresh symmetric key. Generated, never typed, so it has full entropy. */
export async function generateSecretKey(): Promise<Uint8Array> {
  const sodium = await ready();
  return sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES);
}

export async function sealWithKey(plaintext: string, key: Uint8Array): Promise<Sealed> {
  const sodium = await ready();
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const bytes = await fromUtf8(plaintext);
  try {
    const body = sodium.crypto_secretbox_easy(bytes, nonce, key);
    const [nonceB64, bodyB64] = await Promise.all([toBase64(nonce), toBase64(body)]);
    return { v: 1, alg: 'secretbox', nonce: nonceB64, body: bodyB64 };
  } finally {
    wipe(bytes);
  }
}

export async function openWithKey(sealed: Sealed, key: Uint8Array): Promise<string> {
  const sodium = await ready();
  try {
    const [nonce, body] = await Promise.all([
      fromBase64(sealed.nonce),
      fromBase64(sealed.body),
    ]);
    const opened = sodium.crypto_secretbox_open_easy(body, nonce, key);
    try {
      return await toUtf8(opened);
    } finally {
      wipe(opened);
    }
  } catch (error) {
    if (error instanceof SealError) throw error;
    throw new SealError();
  }
}

export function serializeSealed(sealed: Sealed): string {
  return JSON.stringify(sealed);
}

export function parseSealed(value: string): Sealed {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new SealError('Stored content is not readable.');
  }
  if (!isSealed(parsed)) {
    throw new SealError('Stored content is not in a recognised format.');
  }
  return parsed;
}

function isSealed(value: unknown): value is Sealed {
  if (typeof value !== 'object' || value === null) return false;
  const sealed = value as Record<string, unknown>;
  return (
    sealed.v === 1 &&
    sealed.alg === 'secretbox' &&
    typeof sealed.nonce === 'string' &&
    typeof sealed.body === 'string'
  );
}
