# AGENTS.md: client (frontend, web + desktop UI)

Read the root `AGENTS.md` first. This file covers the React app in `client/`, which is the single UI codebase shared by the web build and the desktop build (wrapped by `../desktop`).

## Stack

- React + Vite + TypeScript.
- Socket.io client for the real-time connection.
- State management: keep it simple (React context / a lightweight store) until there's a concrete reason for more; don't introduce a heavy state library speculatively.
- Styling: pick one approach and stay consistent (CSS modules or Tailwind); don't mix.

## What lives here vs. what doesn't

- All chat UI, auth screens, message composition, and rendering.
- All calls to `packages/crypto`'s `encryptMessage()` / `decryptMessage()`. This is the only place in the frontend that should touch those functions directly, and in practice it is two files: `state/chatController.ts` for message bodies and `lib/call/sealing.ts` for the session descriptions that set up a voice call, which travel in the same envelope on purpose so phase 2 secures both at once. Components receive already-decrypted `Message` objects; don't spread decryption calls throughout the component tree.
- Sending seals **once per participant, the sender included**, see `lib/transport/types.ts`. That self-addressed copy is what keeps a sender's own history readable on a second device, so don't drop it as a duplicate just because phase 1 makes every envelope identical.
- `state/ChatProvider.tsx` is the seam between the session (who you are, your unwrapped key) and the transport. Components read from `useChat()`; none of them should call the API, the socket, or the crypto module directly.
- Nothing platform-specific (file system access, OS keychain, native menus) belongs directly in `client/`. It goes behind the adapter in `lib/platform/`: `types.ts` is the interface, `web.ts` the browser behaviour, `desktop.ts` the calls into the Tauri shell, and `usePlatform()` is how a component gets whichever one this build has. Notifications, the unread badge, attention for a call, external links, the updater and the desktop preferences all go through it today. Adding a native feature means adding it there first, with a web behaviour, and only then teaching `desktop/` about it. This is what keeps one codebase working for both targets.
- The desktop build is the same source with `VITE_PLATFORM=desktop`, bearer auth and the API URL set (`.env.desktop`). `isDesktop` in `lib/config.ts` exists for the rare thing that is genuinely absent in one build (the Desktop settings section); reach for `usePlatform()` before it.

## Encryption touch points (client is where the private key lives)

- The user's private key is generated and stored client-side only, and it never gets sent to the server in any request, ever, including telemetry/error reporting. Be deliberate about this when adding logging or crash reporting.
- Web: store the private key in IndexedDB (or similar), scoped and not exposed to any script you don't control (careful with third-party embeds, browser extensions with broad permissions, etc.).
- Desktop: the OS keychain, through `NativeSecureStorage` in `lib/storage/secureStore.ts`, is the goal and is not built; today the desktop stores the wrapped key and the device key in the WebView's IndexedDB exactly as the browser does, and the refresh token beside them (`lib/storage/refreshTokenStore.ts`, which says what that costs). Never a plain file, and never a lowered default for convenience: a dev shortcut is an explicit dev-only code path.
- Since phase 2 (2026-09-11) `encryptMessage()`/`decryptMessage()` are real `crypto_box`, so the server cannot search or index message content. Plan the UI accordingly: client-side search over decrypted local history is the usual answer. History from before that date is stored under `alg: 'none'` and still opens.
- Other people's keys are pinned on first sight (`lib/session/keyPins.ts`). `state/ChatProvider.tsx` is the only place that turns a registry key into one the app seals to or opens with, and `CallProvider` takes its peer keys from it through `resolvePeerKey`. Don't read `publicKey` off a friend or participant DTO anywhere else, and never seal your own copy to what the server says your key is: the controller uses the unlocked identity for that.

## Real-time and offline behavior

- Messages sent while offline should queue locally and flush on reconnect, not get silently dropped. The queue is `lib/transport/outbox.ts`, backed by the same secure store that holds the wrapped key. An in-memory-only queue would keep that promise just until the tab closed.
- The UI must say when it is not connected and how much is waiting. Silence is the one answer a messenger cannot give.
- On reconnect, pull any backlog from the server (ciphertext) and decrypt client-side before rendering.

## Testing

- There is no fixture render of the chat any more. `VITE_BACKEND=mock` short-circuits auth but does not draw a fake conversation: the UI has a real server now, and a parallel fixture render would mean making every change twice, which is what "don't fork UI code" in the root `AGENTS.md` is about.
- Component tests run under jsdom and never touch libsodium (`vite.config.ts` says why). The controller, sealer and pin suites run in node with keys generated in the test, never from a fixture.
- Still to add: a test that specifically asserts the app never sends a request containing the raw private key.
