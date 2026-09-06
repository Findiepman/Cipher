# AGENTS.md — client (frontend, web + desktop UI)

Read the root `AGENTS.md` first. This file covers the React app in `client/`, which is the single UI codebase shared by the web build and the desktop build (wrapped by `../desktop`).

## Stack

- React + Vite + TypeScript.
- Socket.io client for the real-time connection.
- State management: keep it simple (React context / a lightweight store) until there's a concrete reason for more; don't introduce a heavy state library speculatively.
- Styling: pick one approach and stay consistent (CSS modules or Tailwind); don't mix.

## What lives here vs. what doesn't

- All chat UI, auth screens, message composition, and rendering.
- All calls to `packages/crypto`'s `encryptMessage()` / `decryptMessage()` — this is the only place in the frontend that should touch those functions directly. Components should work with already-decrypted message objects; don't spread decryption calls throughout the component tree.
- Nothing platform-specific (file system access, OS keychain, native menus) belongs directly in `client/`. If a feature needs that, it goes behind a small adapter interface that `client/` calls and that `desktop/` (or a web-specific stub) implements. This is what keeps one codebase working for both targets.

## Encryption touch points (client is where the private key lives)

- The user's private key is generated and stored client-side only, and it never gets sent to the server in any request, ever, including telemetry/error reporting. Be deliberate about this when adding logging or crash reporting.
- Web: store the private key in IndexedDB (or similar), scoped and not exposed to any script you don't control (careful with third-party embeds, browser extensions with broad permissions, etc.).
- Desktop: store it via the OS keychain through the adapter described above, not in a plain file, even though it's more convenient during early development. If you need a shortcut for local dev, make it an explicit dev-only code path, not a lowered default.
- During phase 1, `encryptMessage()`/`decryptMessage()` are no-ops, so message content in the UI is genuinely plaintext right now. Don't build UI assumptions (e.g. "we can search message history via the socket in one round trip") that only work because plaintext is currently flowing through the server. Once phase 2 lands, the server can't search or index message content, plan the UI accordingly (client-side search over decrypted local history is the usual answer).

## Real-time and offline behavior

- Messages sent while offline should queue locally and flush on reconnect, not get silently dropped.
- On reconnect, pull any backlog from the server (which will be ciphertext once phase 2 lands) and decrypt client-side before rendering.

## Testing

- Component tests can and should run against phase 1 (plaintext) behavior without needing real libsodium keys; that's the point of isolating crypto behind the two functions.
- Add a couple of tests that specifically assert the app never sends a request containing the raw private key, once phase 2 lands.
