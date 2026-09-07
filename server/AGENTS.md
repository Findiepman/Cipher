# AGENTS.md: server (backend)

Read the root `AGENTS.md` first. This file covers `server/`: the Node backend.

## Stack

- Node.js + Fastify (or Express) for the HTTP API.
- Socket.io (or plain `ws`) for real-time message delivery to connected clients.
- PostgreSQL via Prisma for storage.

## Hard rule: the server is a dumb relay for message content

Once phase 2 (real encryption) lands, the server's job for message bodies is: accept a ciphertext blob from the sender, store it, and hand it to the recipient. It never decrypts, never inspects, never transforms message content. Concretely:

- Never add a feature that requires reading message content server-side (server-side search, moderation scanning of message text, link-preview generation from message content, etc.) without first raising it. The honest answer for most of these in an E2EE app is "do it client-side" or "it's not supported," not "make an exception."
- Never log message bodies, even at debug level, even temporarily while chasing a bug.
- The server does store and serve public keys (the key registry) and encrypted blobs. It never stores or sees a private key.

## Data model notes

- A message is a **header** (`Message`: who, when, which conversation, the sender's `clientId`) plus **one sealed envelope per participant** (`MessageEnvelope`), the author included. The author's own copy is not redundancy: `crypto_box` seals to one recipient, so without it a sender on a new device could not read their own history. Don't collapse the envelopes back into a body column on `Message`.
- The server validates that a message's recipient set equals the conversation's participant set, and hands each caller only the envelope addressed to them. Never `include: { envelopes: true }` without a `where` on the caller.
- Don't add a plaintext fallback column "just in case."
- Message order is `seq` (autoincrement), not `sentAt`: several sends land in the same millisecond and a timestamp cannot break that tie. Cursors are message ids.
- `users`/`devices`/`keys`: track public keys per user (and per device, if/when multi-device is supported, see root AGENTS.md on deferring that). Rotating or revoking a key should be possible without a schema change; don't hardcode "one key per user forever."
- During phase 1, the body column holds plaintext (since `encryptMessage()` is a no-op upstream). Don't let that tempt you into building server-side features that read it. See above.

## Real-time delivery

- Online recipients get pushed the (ciphertext, once phase 2 lands) message over their socket connection.
- Offline recipients just have it sitting in the `messages` table; on reconnect the client requests the backlog since its last-seen message/cursor.
- Sends are idempotent on `(conversationId, clientId)`. The socket and the HTTP fallback both go through `postMessage()`, so a message that takes both paths is stored once.
- A socket outlives its 15-minute access token, so the session behind it is re-checked before every send and on a periodic sweep (`realtime/index.ts`). Don't remove that: without it, logout would stop the HTTP API and leave the socket delivering.
- Don't build delivery-receipt or read-receipt features that require the server to correlate content, only message IDs/timestamps.
- Voice calls ride the same socket (`realtime/calls.ts`). The server relays session descriptions and ICE candidates and holds who-is-ringing-whom in memory; the audio never touches it. Don't store or log an SDP: it is not message content, but it carries the DTLS fingerprints and the caller's candidate addresses, and there is nothing a server-side copy is for. Don't add a media path (recording, an SFU) without raising it first, for the same reason as server-side search.

## Auth

The server never receives a password. This is the one thing to understand before changing anything under `modules/auth/`.

- The client derives `authHash = argon2id(password, salt from email, domain "auth")` on the device and sends only that. The server hashes it again and stores the result as `User.authVerifier`, so a database dump is not a set of working credentials. `/auth/register` and `/auth/login` take `authHash`; neither has a `password` field, and neither should ever grow one.
- Because of that, **the server cannot judge password strength**, because a weak password and a strong one produce indistinguishable base64. That rule lives in `client/src/lib/session/passwordPolicy.ts` and is advisory only; a hostile client can ignore it. Don't "fix" this by asking for the password.
- Login is by email, not "email or username". The auth salt is derived from the email address, so a client holding only a handle cannot compute an authHash, and accepting one would mean telling an anonymous caller which address sits behind a username.
- `Device` holds the account keypair: the public key (the registry other users look up) and the same private key wrapped twice, under the password and under the recovery code. Both blobs are opaque here. Registration creates the user and the device in one transaction. An account that can sign in but decrypt nothing is worse than one that does not exist.
- Login returns the caller's own device inline so the client can unwrap without a second round trip. Never return anyone else's wrapped blobs from any endpoint; the public registry hands out `publicKey` only.
- Credentials and encryption keys are still separate concerns in one respect: JWT/session cookies handle API auth, and rotating a session touches no key material. But a password change is no longer purely a credentials operation: it re-wraps blob_A, so the client sends a new wrapped key with it.

## Testing

- API and socket tests can run fully against phase 1 plaintext bodies.
- Add a test (once phase 2 lands) asserting that a raw request/response never contains anything that looks like a private key or a decrypted message body, as a guardrail against accidental regressions.
