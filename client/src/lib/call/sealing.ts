/**
 * Session descriptions travel in the same envelope messages do.
 *
 * The SDP carries each side's DTLS certificate fingerprint. A server that can
 * read and rewrite it can substitute its own and sit in the middle of the
 * call, and neither browser would notice (voice-plan.md, "The encryption
 * story"). Phase 1's envelope is a base64 no-op and stops nothing. But it is
 * the seam: when `encryptMessage` becomes a real `crypto_box` to the peer's
 * key, the server loses the ability to rewrite an offer in the same commit it
 * loses the ability to read a message, with no change here or in the engine.
 *
 * This is the second place in the frontend that calls the two seam functions,
 * beside state/chatController.ts. Components still never do.
 */
import {
  decryptMessage,
  encryptMessage,
  parseCiphertext,
  serializeCiphertext,
} from '@cipher/crypto';
import type { CallSealer, SessionDescription } from './types';

export interface CallSealerOptions {
  /// Our own keypair, unlocked.
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  /// The other person's public key, from the registry friendship already
  /// gated. Null means we do not know them, and the call is refused.
  resolvePeerKey: (peerId: string) => Promise<Uint8Array | null>;
}

export class UnknownPeerError extends Error {
  constructor(peerId: string) {
    super(`No public key for ${peerId}.`);
    this.name = 'UnknownPeerError';
  }
}

export function createCallSealer(options: CallSealerOptions): CallSealer {
  async function peerKey(peerId: string): Promise<Uint8Array> {
    const key = await options.resolvePeerKey(peerId);
    if (!key) throw new UnknownPeerError(peerId);
    return key;
  }

  return {
    async seal(description, peerId) {
      const sealed = await encryptMessage(
        JSON.stringify(description),
        await peerKey(peerId),
        options.privateKey,
      );
      return serializeCiphertext(sealed);
    },

    async open(sealed, peerId) {
      const plaintext = await decryptMessage(
        parseCiphertext(sealed),
        await peerKey(peerId),
        options.privateKey,
      );
      return parseDescription(plaintext);
    },
  };
}

/// What comes out of the envelope is still untrusted: the other side is a
/// browser we do not control. Only the two fields a description has survive.
function parseDescription(plaintext: string): SessionDescription {
  const value = JSON.parse(plaintext) as { type?: unknown; sdp?: unknown };
  if (
    value.type !== 'offer' &&
    value.type !== 'answer' &&
    value.type !== 'pranswer' &&
    value.type !== 'rollback'
  ) {
    throw new Error('Not a session description.');
  }
  if (value.sdp !== undefined && typeof value.sdp !== 'string') {
    throw new Error('Not a session description.');
  }
  return { type: value.type, sdp: value.sdp };
}
