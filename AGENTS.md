# AGENTS.md: private messenger

This file gives AI coding agents (Claude, Codex, Cursor, etc.) the context they need to work on this repo without breaking the architecture. Both maintainers use AI assistants heavily, so keeping this file accurate matters more than usual: it's the thing keeping two independently-prompted agents from drifting apart.

Subdirectories have their own more specific AGENTS.md: `client/AGENTS.md`, `server/AGENTS.md`, `packages/crypto/AGENTS.md`, `desktop/AGENTS.md`. Read the one for the area you're touching in addition to this one.

**Read [`STATUS.md`](STATUS.md) next.** This file is the rules, which change rarely; STATUS.md is the current state: what works, what is missing, which decisions are load-bearing, and the gotchas that have already cost someone an afternoon. It is the fastest way to be useful here without reading the whole codebase. If you change what is true in it, update it in the same commit.

## What this project is

A Discord-like chat app (DMs today, servers/channels later) where direct messages are end-to-end encrypted: encrypted on the sender's device, stored as ciphertext, decrypted only on the recipient's device. The backend and database never see plaintext DM content. Servers and channels, when they come, are deliberately **not** end-to-end encrypted (see *Groups and servers* below).

## Repo layout

- `client/`: the React app. This is the one UI codebase, built twice from the same source: as the web app, and again in desktop mode (`.env.desktop`) for the desktop app. Do not fork UI code between web and desktop; platform differences belong behind the adapter in `client/src/lib/platform/`, not a duplicated component tree.
- `desktop/`: the Tauri app that bundles `client/`'s desktop build and adds what a browser cannot: a tray, notifications, a badge, auto-update. Contains only packaging/native-integration code, not app logic. Every client change reaches desktop users through a release from here, so releasing is routine, not an event.
- `server/`: Node backend, HTTP API, Socket.io real-time layer, Postgres access via Prisma.
- `packages/crypto/`: the shared encryption module. Both `client/` and (for validation only, never decryption) `server/` may depend on it. This is the only place that should ever call libsodium directly.

## Build order: phase 1 (plaintext) → phase 2 (encrypted)

This was deliberately built in two phases, and **phase 2 landed on 2026-09-11**. `packages/crypto/AGENTS.md` carries the current-phase line.

- **Phase 1** (done): full app working end to end with plaintext messages, so the chat pipeline (auth, sockets, reconnect, DMs, desktop packaging) got debugged without a crypto layer in the way. Even then, every message read/write went through `packages/crypto`'s `encryptMessage()` / `decryptMessage()`, which were no-ops. That seam is what phase 2 plugged into, and it is still the only path: do not add a second one around it.
- **Phase 2** (current): real libsodium `crypto_box` inside those same two functions, to the recipient's registry key, with the conversation bound into the box and other people's keys pinned on first sight. Messages written under phase 1 (`alg: 'none'`) still open. See `packages/crypto/AGENTS.md` for the design as built.

Multi-device support is still deferred: it changes the key model significantly and is a known source of complexity that stalls projects like this one.

## Groups and servers are not end-to-end encrypted

Decided 2026-09-11, before any group code exists, so that nobody builds a group key model. Group chats, servers and channels will be ordinary server-side chat: the server can read them, and moderation is possible. Two reasons, both the maintainers' own:

- The private product is the DM. Taking responsibility for the security of a server's members against each other and against the operator is not a job this app wants.
- Spaces that nobody can read are where the worst material ends up, and the maintainers do not want to run unmoderatable rooms.

Consequences for anyone working here: do not evaluate MLS, Megolm or a fan-out scheme for groups; do not extend the envelope model past DMs; when groups arrive, start from the conversation tables and a plaintext body column for group messages, kept clearly apart from the sealed DM path. The hard rule below about the server never seeing plaintext applies to direct messages.

## Cross-cutting rules for any agent working in this repo

- TypeScript everywhere, strict mode on. No `any` used to paper over a type you haven't figured out yet.
- The server is never allowed to receive, log, or store plaintext direct-message content, a user's private key, or anything else that would let it read DMs. If a change requires the server to see DM plaintext, stop and flag it instead of implementing it, because it likely means the design needs to change, not the server. (Group and server messages are the documented exception, see above.)
- Don't add a new crypto primitive or hand-roll encryption anywhere outside `packages/crypto`. If something doesn't fit `crypto_box`, raise it rather than working around it locally.
- Prefer boring, mainstream libraries over clever or obscure ones. Both maintainers are relying on AI assistance, and AI-generated code quality tracks how well-documented and widely-used a library is.
- Keep commits scoped to one of `client/`, `server/`, `packages/crypto/` or `desktop/` where possible; cross-cutting changes should say so explicitly in the commit message.

## Writing style: no em dashes, no Oxford commas

This applies to everything in the repo, not just to text a user reads: UI copy,
code comments, JSDoc, commit messages and these markdown files. Both maintainers
read an em dash and a serial comma as tells that a paragraph was generated
rather than written, and this is a product whose whole pitch is that you can
trust it.

- Never write `—` or `–`. Use a comma, a colon, parentheses or a second
  sentence. If a sentence genuinely needs a dash to work, it needs rewriting.
- In a list of three or more, no comma before the final `and` or `or`:
  "letters, numbers and separators", never "letters, numbers, and separators".
  A comma joining two independent clauses is a different mark and stays.
- Before finishing an edit, grep the files you touched for both characters.
  `client/`, `STATUS.md` and every `AGENTS.md` were swept clean on 2026-09-07.
  `server/`, `packages/crypto/` and the plan documents have not been.

## The look of the app

`client/src/styles/theme.css` is the whole palette and it is called Ember. If
you are adding UI, read the comment at the top of that file first. Two rules
that are easy to break by accident: nothing is flush against anything else
(panels float on a darker backdrop), and `--ember` is the only interactive
colour. Do not introduce a colour that is not a token in that file.
