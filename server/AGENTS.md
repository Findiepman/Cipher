# AGENTS.md — server (backend)

Read the root `AGENTS.md` first. This file covers `server/`: the Node backend.

## Stack

- Node.js + Fastify (or Express) for the HTTP API.
- Socket.io (or plain `ws`) for real-time message delivery to connected clients.
- PostgreSQL via Prisma for storage.

## Hard rule: the server is a dumb relay for message content

Once phase 2 (real encryption) lands, the server's job for message bodies is: accept a ciphertext blob from the sender, store it, and hand it to the recipient. It never decrypts, never inspects, never transforms message content. Concretely:

- Never add a feature that requires reading message content server-side (server-side search, moderation scanning of message text, link-preview generation from message content, etc.) without first raising it — the honest answer for most of these in an E2EE app is "do it client-side" or "it's not supported," not "make an exception."
- Never log message bodies, even at debug level, even temporarily while chasing a bug.
- The server does store and serve public keys (the key registry) and encrypted blobs. It never stores or sees a private key.

## Data model notes

- `messages` table: store the body as `bytea` (or equivalent), plus whatever metadata the crypto scheme needs (nonce, sender key id, recipient key id). Don't add a plaintext fallback column "just in case."
- `users`/`devices`/`keys`: track public keys per user (and per device, if/when multi-device is supported — see root AGENTS.md on deferring that). Rotating or revoking a key should be possible without a schema change; don't hardcode "one key per user forever."
- During phase 1, the body column holds plaintext (since `encryptMessage()` is a no-op upstream). Don't let that tempt you into building server-side features that read it — see above.

## Real-time delivery

- Online recipients get pushed the (ciphertext, once phase 2 lands) message over their socket connection.
- Offline recipients just have it sitting in the `messages` table; on reconnect the client requests the backlog since its last-seen message/cursor.
- Don't build delivery-receipt or read-receipt features that require the server to correlate content, only message IDs/timestamps.

## Auth

- Standard email/password or OAuth, JWT or session cookies for API auth. This is entirely separate from the E2E keypair; a user can reset their login credentials without that touching their encryption keys, and vice versa.

## Testing

- API and socket tests can run fully against phase 1 plaintext bodies.
- Add a test (once phase 2 lands) asserting that a raw request/response never contains anything that looks like a private key or a decrypted message body, as a guardrail against accidental regressions.
