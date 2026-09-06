# Stack recommendation: encrypted messenger (web + desktop)

Decided/proposed on 2026-09-06. Two devs, both using AI assistants to build, so the stack favors mainstream, well-documented tech over niche choices.

## Overall shape

One TypeScript codebase, one React UI, shipped two ways:
- Web: the React app served normally (Vite or Next.js).
- Desktop: the same React app wrapped in Tauri (or Electron), so there's no separate desktop codebase to maintain.

Tauri vs Electron: Tauri gives a Rust backend, much smaller binaries, and a smaller attack surface (good fit for a security-focused app), but Electron has a bigger ecosystem and more AI training data/examples to lean on if you get stuck. Either is a fine choice; Tauri is the better long-term fit for this kind of app if you're comfortable touching a little Rust.

## Backend

- Node.js with Fastify or Express for the HTTP API (auth, user lookup, key registry, message history).
- Socket.io (or plain `ws`) for real-time delivery to online clients. Offline recipients just pull the encrypted backlog from the DB on reconnect.
- PostgreSQL for storage: users, devices, public keys, channels/servers, and messages (message body stored as an encrypted blob, e.g. `bytea`, never plaintext).
- Prisma as the ORM, mostly so both of you get type-safe queries and migrations without hand-writing much SQL.

## The encryption model (the part to get right first)

Real end-to-end encryption means the server only ever touches ciphertext. Concretely:

- Every account generates a public/private keypair on first login. The private key never leaves the device (browser: IndexedDB / OS keychain via Tauri; never send it to the server).
- Use `libsodium` (via `libsodium-wrappers` in JS) rather than rolling your own crypto. Its `crypto_box` primitive (X25519 + XSalsa20-Poly1305) is exactly "encrypt at sender with recipient's public key, decrypt at receiver with their private key," authenticated, well-audited, and has JS bindings that work in browser, Node, and Tauri alike.
- Start with 1:1 DMs only. That's a direct fit for `crypto_box`.
- Group chats (the Discord-like part) are the genuinely hard part: you can't efficiently encrypt one ciphertext for N recipients with plain public-key boxes. The two realistic paths are (a) fan out: encrypt a per-message symmetric key separately for each group member (simple, works, doesn't scale to huge groups), or (b) adopt an existing group-key protocol like Matrix's Megolm/Olm or MLS (Messaging Layer Security) instead of inventing your own. Strongly recommend building and shipping DMs first, then tackling groups once that's solid.
- Don't forget key rotation/multi-device support is where most homegrown E2EE projects fall apart — worth deciding early whether v1 supports only one device per account (much simpler) before allowing multi-device.

## Auth

Standard email/password or OAuth for the account itself, JWT or session cookies for API auth. This is separate from the E2E keypair, which is generated and stored client-side after login.

## Why this stack

Every piece here (React, Node, Postgres, Socket.io, libsodium, Tauri/Electron) is extremely well documented, which matters a lot given both of you are leaning on AI assistants — obscure stacks produce much worse AI-generated code because there's less training data to draw from.