# AGENTS.md — packages/crypto (encryption)

Read the root `AGENTS.md` first. This package is the only place in the codebase that should call libsodium directly. `client/` calls into it for every encrypt/decrypt; `server/` may depend on it only for public-key validation/format helpers, never for anything that decrypts.

## Current phase

**Phase 1 (default until this line is updated): `encryptMessage()` and `decryptMessage()` are no-ops that return the input unchanged.** This lets the rest of the app be built and tested against a stable interface before real crypto is wired in. When phase 2 work starts, update this line and the two functions together in the same change, don't let the interface and the implementation drift.

## Public interface

Keep the surface small and stable so `client/` never needs to change when the internals do:

```
generateKeyPair(): { publicKey, privateKey }
encryptMessage(plaintext, recipientPublicKey, senderPrivateKey): Ciphertext
decryptMessage(ciphertext, senderPublicKey, recipientPrivateKey): string
```

`Ciphertext` should carry whatever the scheme needs (nonce, algorithm/version tag) so it can evolve later without breaking old stored messages, don't assume the shape is fixed forever.

## Phase 2 design (what to implement when the time comes)

- Use `libsodium-wrappers` (or `libsodium-wrappers-sumo` if a needed function isn't in the base build). Do not implement any crypto primitive by hand.
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
