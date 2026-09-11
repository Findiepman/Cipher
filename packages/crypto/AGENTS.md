# AGENTS.md: packages/crypto (encryption)

Read the root `AGENTS.md` first. This package is the only place in the codebase that should call libsodium directly. `client/` calls into it for every encrypt/decrypt; `server/` may depend on it only for public-key validation/format helpers, never for anything that decrypts.

## Current phase

**Phase 2, since 2026-09-11: `encryptMessage()` and `decryptMessage()` are real.** A message is sealed with `crypto_box` (X25519 + XSalsa20-Poly1305) to one recipient's public key under the sender's private key, with a fresh random nonce per message. The envelope is tagged `alg: 'box'`. Envelopes written under phase 1 (`alg: 'none'`, a base64 body, no nonce) still open, because history from before that date is stored in that form; nothing writes them any more. Update this line and the two functions together if the scheme ever changes again.

Everything else in the package (keypair generation, Argon2id key wrapping, the auth hash, recovery codes, the device key, the vault's symmetric seal) was real before phase 2 and is unchanged by it.

## Public interface

Keep the surface small and stable so `client/` never needs to change when the internals do:

Messages:

```
generateKeyPair(): { publicKey, privateKey }
encryptMessage(plaintext, recipientPublicKey, senderPrivateKey, context): Ciphertext
decryptMessage(ciphertext, senderPublicKey | null, recipientPrivateKey, context): string
serializeCiphertext(ciphertext) / parseCiphertext(string)
BOX_ALG                                          // 'box', the current alg tag
```

`Ciphertext` is `{ v: 1, alg, nonce, body }`. Readers dispatch on `alg` rather than assuming: `'box'` is current, `'none'` is phase 1 history, anything else is a `DecryptError` saying the scheme is unknown, so a client that meets an envelope from a newer peer says "can't read this" instead of rendering nonsense.

`context` is where the message belongs. The client passes `conversation:<id>` for a message body and `call` for a session description. `crypto_box` has no field for authenticated-but-unencrypted data, so the context travels *inside* the box: the plaintext is framed as `{ c: context, m: message }` and opening checks the context it finds against the one the caller expects. That is what stops a server moving a sealed body from one conversation to another, and what stops a sealed message being replayed as a call offer.

`senderPublicKey` may be null to mean "I hold no key for this person". Phase 1 history opens anyway; a box fails with an error that says so.

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

The private key is wrapped twice, under two different `DOMAIN` labels: `DOMAIN.keywrap` with the password (blob_A) and `DOMAIN.recovery` with the recovery code (blob_B). The labels are what stop one from opening the other, and they are part of the stored format, so changing a string invalidates every blob written under it.

## The design, as built

- The package depends on `libsodium-wrappers-sumo`, because the base build dropped `crypto_pwhash`, which the key wrapping needs. Do not implement any crypto primitive by hand.
- `crypto_box_easy` to encrypt with (recipient public key, sender private key), `crypto_box_open_easy` to decrypt with (sender public key, recipient private key). Authenticated encryption, so there is no separate MAC and a wrong key on either side, a flipped byte or a forged sender all arrive as one `DecryptError`.
- A fresh random nonce per message (`crypto_box_NONCEBYTES`), never reused with the same key pair. It is not secret and is stored alongside the ciphertext.
- Sealing to yourself is the ordinary case: a sender's own copy of a message is boxed under their own public key, which is what keeps their history readable on another device. The client never seals that copy to what the server says the sender's key is; it uses the unlocked identity.
- Keypairs come from `crypto_box_keypair()`. The private key is generated and stays client-side; only the public key ever goes to the server's registry.
- **No forward secrecy, on purpose.** A leaked private key opens everything sealed to it, past and future. A ratchet would buy that property and then lose it again to the self-addressed copy and to history that follows you to a new device, both of which this app wants more. If that trade is ever revisited, it is a product decision first.
- **The registry is only as honest as the server.** Correct encryption to a key the server made up is worthless, so `client/` pins each person's key the first time it sees it and refuses a different one until the user accepts it (`client/src/lib/session/keyPins.ts`). That is a client concern, not this package's, but it is the other half of the security story and is worth knowing about when reading this file.
- **Group chats and servers will not be end-to-end encrypted.** Decided 2026-09-11, see the root `AGENTS.md`. Do not evaluate MLS, Megolm or a fan-out scheme for them, and do not extend the envelope model past DMs.
- Multi-device support (a user's key living on more than one device) is still deferred. If a task seems to require it, check with the other maintainer before building it, it changes the key model significantly.

## Testing

- Round-trip tests over a range of message sizes including empty string and unicode/emoji content, and sealing to yourself.
- Tamper tests: a flipped byte in the body or the nonce, a truncated body, the wrong recipient key, a forged sender and a mismatched context must all fail as `DecryptError`, never return garbage. This is what confirms the authenticated part of "authenticated encryption".
- The published NaCl box test vector runs through `crypto_box_easy` directly, since `encryptMessage` cannot reproduce it (random nonce, framed plaintext). It checks the primitive underneath rather than the wrapper, which a round trip against our own code cannot.
- Never commit a real private key, even a test one, into a fixture file that looks reusable, generate fresh test keys in the test setup instead.
