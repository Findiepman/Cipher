/**
 * Message encryption. The two functions the rest of the app is built around.
 *
 * PHASE 2, as of 2026-09-11: see the "Current phase" line in
 * packages/crypto/AGENTS.md. A message is sealed with `crypto_box`, which is
 * X25519 to agree a key between the sender's private key and the recipient's
 * public key, then XSalsa20-Poly1305 under it. Authenticated, so a body that
 * was altered in transit, or sealed by somebody who does not hold the
 * sender's private key, fails to open rather than opening to garbage. A fresh
 * random nonce per message; it is not secret and travels in the envelope.
 *
 * Sealing to yourself is the ordinary case, not a special one: the sender's
 * own copy of a message is boxed under their own public key, which is what
 * keeps their history readable on a device that was not the one they typed
 * it on (client/AGENTS.md).
 *
 * `crypto_box` has no field for data that is authenticated but not encrypted,
 * so the context a message belongs to travels *inside* the box instead: the
 * plaintext is framed as `{ c: context, m: message }` before sealing, and
 * opening checks the context the caller expects against the one found. A
 * server that lifted a sealed body out of one conversation and served it in
 * another would find it refused, and a session description sealed for a call
 * can never be replayed as a message body, because the two use different
 * contexts.
 *
 * Every read and write in the app routes through here, so this file is the
 * whole of the encryption change. Do not add a second path around it.
 *
 * Phase 1 envelopes (`alg: 'none'`, a base64 body and no nonce) still open,
 * because history written before 2026-09-11 is stored in that form and it is
 * not going to be rewritten. Nothing writes them any more.
 */
import { fromBase64, fromUtf8, toBase64, toUtf8, wipe } from './encoding.js';
import { ready } from './sodium.js';

/** The `alg` tag of a `crypto_box` envelope. */
export const BOX_ALG = 'box';

/** The `alg` tag phase 1 wrote. Readable, never written. */
const LEGACY_ALG = 'none';

/**
 * The wire and at-rest form of a message body. Versioned and algorithm-tagged
 * from the start so a reader dispatches on `alg` rather than assuming what it
 * is holding, which is what lets phase 1 history and phase 2 messages sit in
 * one conversation.
 */
export interface Ciphertext {
  v: 1;
  /**
   * `'box'` for anything written since phase 2, `'none'` for phase 1 history.
   * Typed loosely on purpose: a client has to be able to *parse* an envelope
   * written by a newer peer in order to say "I can't read this" rather than
   * choking on it, so unknown tags are a decrypt-time failure, not a
   * parse-time one.
   */
  alg: string;
  /** base64, `crypto_box_NONCEBYTES` long. Null under `alg: 'none'`. */
  nonce: string | null;
  /** base64. The sealed frame under `'box'`, the bare body under `'none'`. */
  body: string;
}

export class DecryptError extends Error {
  constructor(message = 'This message could not be decrypted.') {
    super(message);
    this.name = 'DecryptError';
  }
}

/** What actually goes inside the box. */
interface Frame {
  c: string;
  m: string;
}

/**
 * Seals `plaintext` so that only the holder of the private half of
 * `recipientPublicKey` can open it, and so that they can tell it came from
 * the holder of `senderPrivateKey`.
 *
 * `context` names where this message belongs (a conversation id, or a label
 * for a use that is not a conversation) and must be given again to open it.
 */
export async function encryptMessage(
  plaintext: string,
  recipientPublicKey: Uint8Array,
  senderPrivateKey: Uint8Array,
  context: string,
): Promise<Ciphertext> {
  const sodium = await ready();
  const frame: Frame = { c: context, m: plaintext };
  const bytes = await fromUtf8(JSON.stringify(frame));
  try {
    const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
    const body = sodium.crypto_box_easy(bytes, nonce, recipientPublicKey, senderPrivateKey);
    const [nonceB64, bodyB64] = await Promise.all([toBase64(nonce), toBase64(body)]);
    return { v: 1, alg: BOX_ALG, nonce: nonceB64, body: bodyB64 };
  } finally {
    wipe(bytes);
  }
}

/**
 * Opens an envelope. Throws `DecryptError` for anything short of a body that
 * was sealed by `senderPublicKey`'s holder, for `recipientPrivateKey`'s
 * holder, in this `context`, and has not been touched since.
 *
 * `senderPublicKey` may be null to say "I do not have it". Phase 1 history
 * opens anyway, since no key was ever involved; a box does not, and the error
 * says why rather than pretending a wrong key was tried.
 */
export async function decryptMessage(
  ciphertext: Ciphertext,
  senderPublicKey: Uint8Array | null,
  recipientPrivateKey: Uint8Array,
  context: string,
): Promise<string> {
  if (ciphertext.alg === LEGACY_ALG) return openLegacy(ciphertext);
  if (ciphertext.alg !== BOX_ALG) {
    // Reached when a newer peer writes a scheme this client has not learnt.
    // Failing here is what puts "can't read this message" on screen instead
    // of rendering nonsense.
    throw new DecryptError('This message uses an encryption scheme this client does not know.');
  }
  if (senderPublicKey === null) {
    throw new DecryptError('There is no key for the sender of this message.');
  }
  if (ciphertext.nonce === null) throw new DecryptError();

  const sodium = await ready();
  let nonce: Uint8Array;
  let body: Uint8Array;
  try {
    [nonce, body] = await Promise.all([fromBase64(ciphertext.nonce), fromBase64(ciphertext.body)]);
  } catch {
    throw new DecryptError();
  }
  if (nonce.length !== sodium.crypto_box_NONCEBYTES) throw new DecryptError();

  let opened: Uint8Array;
  try {
    opened = sodium.crypto_box_open_easy(body, nonce, senderPublicKey, recipientPrivateKey);
  } catch {
    // A wrong key on either side, a flipped byte anywhere, a forged sender:
    // libsodium reports them all the same way, and so does this.
    throw new DecryptError();
  }

  try {
    const frame = parseFrame(await toUtf8(opened));
    if (frame.c !== context) {
      throw new DecryptError('This message was sealed for somewhere else.');
    }
    return frame.m;
  } finally {
    wipe(opened);
  }
}

/// Phase 1 wrote the body base64-encoded and nothing else. There is no
/// context to check and no key involved.
async function openLegacy(ciphertext: Ciphertext): Promise<string> {
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

function parseFrame(text: string): Frame {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DecryptError();
  }
  if (typeof parsed !== 'object' || parsed === null) throw new DecryptError();
  const frame = parsed as Record<string, unknown>;
  if (typeof frame.c !== 'string' || typeof frame.m !== 'string') throw new DecryptError();
  return { c: frame.c, m: frame.m };
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
