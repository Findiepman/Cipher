/**
 * Message encryption. The two functions the rest of the app is built around.
 *
 * PHASE 1 — see the "Current phase" line in packages/crypto/AGENTS.md.
 * `encryptMessage()` and `decryptMessage()` do not encrypt anything yet. A body
 * goes onto the wire base64-encoded and comes back off it decoded, and the
 * envelope is tagged `alg: 'none'` so it is obvious in a database dump that
 * nothing is protecting it.
 *
 * The point of shipping them as no-ops is that every read and write in the app
 * already routes through here, so phase 2 is a change to this file rather than
 * a change to every call site. Do not add a second path around them.
 *
 * Phase 2 replaces the two bodies with crypto_box (X25519 + XSalsa20-Poly1305):
 * `crypto_box_easy` under (recipient public key, sender private key), a fresh
 * `crypto_box_NONCEBYTES` nonce per message stored in `nonce`, and a new `alg`
 * tag. The key arguments below are already threaded through for that reason —
 * they are unused today and deliberately not removed. When that lands, update
 * the AGENTS.md phase line in the same commit.
 */
import { fromBase64, fromUtf8, toBase64, toUtf8, wipe } from './encoding.js';

/**
 * The wire and at-rest form of a message body. Versioned and algorithm-tagged
 * from the start so phase 1 and phase 2 messages can coexist in one channel:
 * a reader dispatches on `alg` rather than assuming what it is holding, which
 * is what stops the phase 2 rollout from orphaning existing history.
 */
export interface Ciphertext {
  v: 1;
  /**
   * `'none'` while phase 1 is current; phase 2 adds the crypto_box tag. Typed
   * loosely on purpose — a client has to be able to *parse* an envelope written
   * by a newer peer in order to say "I can't read this" rather than choking on
   * it, so unknown tags are a decrypt-time failure, not a parse-time one.
   */
  alg: string;
  /** base64. Null under `alg: 'none'`, which has no nonce. */
  nonce: string | null;
  /** base64 body. Encoded, not encrypted, under `alg: 'none'`. */
  body: string;
}

export class DecryptError extends Error {
  constructor(message = 'This message could not be decrypted.') {
    super(message);
    this.name = 'DecryptError';
  }
}

export async function encryptMessage(
  plaintext: string,
  _recipientPublicKey: Uint8Array,
  _senderPrivateKey: Uint8Array,
): Promise<Ciphertext> {
  const bytes = await fromUtf8(plaintext);
  try {
    return { v: 1, alg: 'none', nonce: null, body: await toBase64(bytes) };
  } finally {
    wipe(bytes);
  }
}

export async function decryptMessage(
  ciphertext: Ciphertext,
  _senderPublicKey: Uint8Array,
  _recipientPrivateKey: Uint8Array,
): Promise<string> {
  if (ciphertext.alg !== 'none') {
    // Reached once phase 2 messages exist and this client has not been updated.
    // Failing here is what puts "can't read this message" on screen instead of
    // rendering nonsense.
    throw new DecryptError('This message uses an encryption scheme this client does not know.');
  }
  let bytes: Uint8Array;
  try {
    bytes = await fromBase64(ciphertext.body);
  } catch {
    throw new DecryptError();
  }
  try {
    return await toUtf8(bytes);
  } finally {
    wipe(bytes);
  }
}

export function serializeCiphertext(ciphertext: Ciphertext): string {
  return JSON.stringify(ciphertext);
}

export function parseCiphertext(value: string): Ciphertext {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new DecryptError('This message is not in a readable format.');
  }
  if (!isCiphertext(parsed)) {
    throw new DecryptError('This message is not in a recognised format.');
  }
  return parsed;
}

function isCiphertext(value: unknown): value is Ciphertext {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.v === 1 &&
    typeof candidate.alg === 'string' &&
    typeof candidate.body === 'string' &&
    (candidate.nonce === null || typeof candidate.nonce === 'string')
  );
}
