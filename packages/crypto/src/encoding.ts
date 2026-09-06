/**
 * Byte/string conversions and the one destructive helper.
 *
 * Base64 here is the standard, padded alphabet, not libsodium's URL-safe
 * default: these strings travel in JSON bodies and get stored in Postgres
 * columns the server also reads, so the boring encoding is the right one.
 */
import { ready } from './sodium.js';

export async function toBase64(bytes: Uint8Array): Promise<string> {
  const sodium = await ready();
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
}

export async function fromBase64(value: string): Promise<Uint8Array> {
  const sodium = await ready();
  return sodium.from_base64(value, sodium.base64_variants.ORIGINAL);
}

export async function toUtf8(bytes: Uint8Array): Promise<string> {
  const sodium = await ready();
  return sodium.to_string(bytes);
}

export async function fromUtf8(value: string): Promise<Uint8Array> {
  const sodium = await ready();
  return sodium.from_string(value);
}

/**
 * Overwrites a buffer in place. Called on the private key at lock/sign-out.
 *
 * This is best-effort, not a guarantee: a JS engine may already have copied the
 * bytes during a GC move, and it does nothing for strings, which are immutable.
 * It still removes the longest-lived copy, which is the one worth removing.
 */
export function wipe(bytes: Uint8Array): void {
  bytes.fill(0);
}

/** Constant-time comparison, for anything derived from a secret. */
export async function equalBytes(a: Uint8Array, b: Uint8Array): Promise<boolean> {
  if (a.length !== b.length) return false;
  const sodium = await ready();
  return sodium.memcmp(a, b);
}
