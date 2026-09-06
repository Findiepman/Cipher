/**
 * Domain separation labels.
 *
 * The same password is stretched more than once — into the value the server
 * compares (`auth`) and into the key that wraps the private key (`keywrap`) —
 * and those two must not be derivable from each other. Mixing a distinct label
 * into each derivation is what guarantees that: a server that has the auth hash
 * still cannot open blob_A, which is the whole reason the split exists.
 *
 * `recovery` separates the second wrapping (blob_B, under the recovery code) so
 * a spent recovery code tells you nothing about the password wrapping.
 *
 * These strings are part of the stored format. Changing one invalidates every
 * blob already written under it, so treat them as frozen.
 */
export const DOMAIN = {
  auth: 'cipher/v1/auth-hash',
  keywrap: 'cipher/v1/key-wrap/password',
  recovery: 'cipher/v1/key-wrap/recovery-code',
  fingerprint: 'cipher/v1/fingerprint',
} as const;

export type WrapDomain = typeof DOMAIN.keywrap | typeof DOMAIN.recovery;
