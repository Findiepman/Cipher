/**
 * The single libsodium handle for the whole repo.
 *
 * The sumo build rather than the base one: base drops `crypto_pwhash`, which is
 * what password-wrapping the private key needs (packages/crypto/AGENTS.md says
 * to reach for sumo exactly when a needed function is missing).
 *
 * libsodium compiles its WASM asynchronously, so every entry point in this
 * package awaits `ready()` before touching a primitive. That is the
 * reason functions here are async even when the maths underneath is not — the
 * alternative is exporting a half-initialised module and getting silent
 * garbage on the first call.
 */
import _sodium from 'libsodium-wrappers-sumo';

export type Sodium = typeof _sodium;

let initialised: Promise<Sodium> | null = null;

export function ready(): Promise<Sodium> {
  initialised ??= _sodium.ready.then(() => _sodium);
  return initialised;
}
