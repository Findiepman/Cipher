# AGENTS.md — packages/crypto (encryption)

Read the root `AGENTS.md` first. This package is the only place in the codebase that should call libsodium directly. `client/` calls into it for every encrypt/decrypt; `server/` may depend on it only for public-key validation/format helpers, never for anything that decrypts.

## Current phase

**Phase 1 (still current as of 2026-09-06): `encryptMessage()` and `decryptMessage()` are no-ops that return the input unchanged.** DMs now work end to end in phase 1, which is the precondition `AGENTS.md` sets for starting phase 2 - and everything phase 2 needs on the other side of this package is already built: the public-key registry (`GET /keys/user/:userId`), and the per-recipient envelope model. So the phase 2 change really is these two functions plus this line, with no schema change and no data migration. This lets the rest of the app be built and tested against a stable interface before real crypto is wired in. When phase 2 work starts, update this line and the two functions together in the same change, don't let the interface and the implementation drift.

This applies to the *message* functions and nothing else. The credential half of this package below — keypair generation, Argon2id key wrapping, the auth hash, recovery codes — is real today, because the client's guarantee that a password never leaves the device does not depend on which phase the message pipeline is in. Do not treat a failure there as "it's a stub".

## Public interface

Keep the surface small and stable so `client/` never needs to change when the internals do:

Messages:

```
generateKeyPair(): { publicKey, privateKey }
encryptMessage(plaintext, recipientPublicKey, senderPrivateKey): Ciphertext
decryptMessage(ciphertext, senderPublicKey, recipientPrivateKey): string
serializeCiphertext(ciphertext) / parseCiphertext(string)
```

`Ciphertext` carries whatever the scheme needs (nonce, algorithm/version tag) so it can evolve later without breaking old stored messages, don't assume the shape is fixed forever. It is `{ v, alg, nonce, body }` today, with `alg: 'none'` marking a phase 1 body, and readers dispatch on `alg` rather than assuming — that is what lets phase 1 and phase 2 messages sit in one channel during the rollout.

Credentials and key custody:

```
deriveAuthHash(email, password): string          // the only password-derived value the server sees
wrapPrivateKey(privateKey, secret, domain): WrappedKey
unwrapPrivateKey(blob, secret, domain): Uint8Array   // throws UnwrapError
serializeWrappedKey(blob) / parseWrappedKey(string)
generateRecoveryCode(): string                   // XXXXX-XXXXX-XXXXX-XXXXX
recoveryCodeHash(code): string                   // what the server stores
keyFingerprint(publicKey): string                // the security number to read aloud
toBase64 / fromBase64 / wipe
DOMAIN                                           // the domain-separation labels
```

The private key is wrapped twice, under two different `DOMAIN` labels: `DOMAIN.keywrap` with the password (blob_A) and `DOMAIN.recovery` with the recovery code (blob_B). The labels are what stop one from opening the other, and they are part of the stored format — changing a string invalidates every blob written under it.

## Phase 2 design (what to implement when the time comes)

- The package already depends on `libsodium-wrappers-sumo` — the base build dropped `crypto_pwhash`, which the key wrapping above needs. Everything phase 2 wants is in it. Do not implement any crypto primitive by hand.
- Use `crypto_box` (X25519 + XSalsa20-Poly1305, i.e. NaCl "box") for 1:1 messages: `crypto_box_easy` to encrypt with (recipient public key, sender private key), `crypto_box_open_easy` to decrypt with (sender public key, recipient private key). This gives authenticated encryption for free, don't layer a separate MAC on top.
- Generate a fresh random nonce per message (`crypto_box_NONCEBYTES`), never reuse a nonce with the same key pair. Store the nonce alongside the ciphertext, it isn't secret.
- Keypairs: generate with `crypto_box_keypair()`. The private key is generated and must stay client-side; only the public key ever gets sent to the server (for the key registry).
- Group messaging is out of scope for the first pass. When it's picked up, don't extend `crypto_box` to "encrypt once per recipient in a loop and call it done" without reading `AGENTS.md` at the repo root on group encryption, that approach doesn't scale and there are existing protocols (Megolm/Olm, MLS) worth evaluating first. Flag it for discussion rather than quietly shipping a fan-out implementation as the permanent design.
- Multi-device support (a user's key living on more than one device) is deliberately deferred. If a task seems to require it, check with the other maintainer before building it, it changes the key model significantly.

## Testing

- Round-trip tests: encrypt then decrypt should recover the original plaintext, for a range of message sizes including empty string and unicode/emoji content.
- Tamper tests: flipping a byte in the ciphertext or nonce should make decryption fail, not silently return garbage, this is what confirms the authenticated part of "authenticated encryption" is actually working.
- Cross-check against known libsodium test vectors if available, don't rely solely on round-trip tests against your own implementation.
- Never commit a real private key, even a test one, into a fixture file that looks reusable, generate fresh test keys in the test setup instead.
