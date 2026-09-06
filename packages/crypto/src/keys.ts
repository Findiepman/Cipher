/**
 * Identity keypairs.
 *
 * One X25519 keypair per account (packages/crypto/AGENTS.md: multi-device is
 * deliberately deferred, so "the account's key" and "this device's key" are
 * still the same thing). The public half goes to the server's key registry;
 * the private half is generated here and never leaves the device.
 */
import { DOMAIN } from './domain.js';
import { toBase64 } from './encoding.js';
import { ready } from './sodium.js';

export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export async function generateKeyPair(): Promise<KeyPair> {
  const sodium = await ready();
  const pair = sodium.crypto_box_keypair();
  return { publicKey: pair.publicKey, privateKey: pair.privateKey };
}

export async function publicKeyToBase64(publicKey: Uint8Array): Promise<string> {
  return toBase64(publicKey);
}

/**
 * The security number two people read to each other to confirm they are
 * talking to the right key — the thing that closes the "server hands you a
 * public key it made up" hole, which no amount of correct encryption does.
 *
 * Digits rather than hex because they survive being read aloud over a phone
 * line, which is the point of the exercise.
 */
export async function keyFingerprint(publicKey: Uint8Array): Promise<string> {
  const sodium = await ready();
  const digest = sodium.crypto_generichash(
    32,
    publicKey,
    sodium.from_string(DOMAIN.fingerprint),
  );

  const view = new DataView(digest.buffer, digest.byteOffset, digest.byteLength);
  const groups: string[] = [];
  for (let offset = 0; offset < digest.byteLength; offset += 4) {
    groups.push(String(view.getUint32(offset) % 100000).padStart(5, '0'));
  }
  return groups.join(' ');
}
