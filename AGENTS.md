# AGENTS.md: private messenger

This file gives AI coding agents (Claude, Codex, Cursor, etc.) the context they need to work on this repo without breaking the architecture. Both maintainers use AI assistants heavily, so keeping this file accurate matters more than usual: it's the thing keeping two independently-prompted agents from drifting apart.

Subdirectories have their own more specific AGENTS.md: `client/AGENTS.md`, `server/AGENTS.md`, `packages/crypto/AGENTS.md`, `desktop/AGENTS.md`. Read the one for the area you're touching in addition to this one.

**Read [`STATUS.md`](STATUS.md) next.** This file is the rules, which change rarely; STATUS.md is the current state: what works, what is missing, which decisions are load-bearing, and the gotchas that have already cost someone an afternoon. It is the fastest way to be useful here without reading the whole codebase. If you change what is true in it, update it in the same commit.

## What this project is

A Discord-like chat app (DMs today, servers/channels later) where message content is end-to-end encrypted: encrypted on the sender's device, stored as ciphertext, decrypted only on the recipient's device. The backend and database must never see plaintext message content once phase 2 lands (see below).

## Repo layout

- `client/`: the React app. This is the one UI codebase, built once and served two ways: as the web app, and wrapped by the desktop shell. Do not fork UI code between web and desktop; platform differences belong behind a small adapter, not a duplicated component tree.
- `desktop/`: the Tauri (or Electron) shell that wraps `client/`'s build output into a desktop app. Contains only packaging/native-integration code, not app logic.
- `server/`: Node backend, HTTP API, Socket.io real-time layer, Postgres access via Prisma.
- `packages/crypto/`: the shared encryption module. Both `client/` and (for validation only, never decryption) `server/` may depend on it. This is the only place that should ever call libsodium directly.

## Build order: phase 1 (plaintext) → phase 2 (encrypted)

We are deliberately building this in two phases. Check which phase the repo is in (there should be a note in this file or in `packages/crypto/AGENTS.md` saying so) before assuming encryption is live.

- **Phase 1**: full app working end to end with plaintext messages, so the chat pipeline (auth, sockets, reconnect, channels/DMs, desktop packaging) gets debugged without a crypto layer in the way. Even in phase 1, every message read/write must go through `packages/crypto`'s `encryptMessage()` / `decryptMessage()` functions, which are no-ops for now. Do not bypass them "temporarily": that is the seam phase 2 plugs into.
- **Phase 2**: real keypair generation, a public-key registry on the server, and real libsodium calls inside those same two functions. DMs first, group encryption after. See `packages/crypto/AGENTS.md` for the actual crypto design.

Do not skip ahead to group encryption or multi-device support before 1:1 DMs are solid in phase 2. Both are known sources of complexity that stall projects like this one.

## Cross-cutting rules for any agent working in this repo

- TypeScript everywhere, strict mode on. No `any` used to paper over a type you haven't figured out yet.
- The server is never allowed to receive, log, or store plaintext message content, a user's private key, or anything else that would let it read messages. If a change requires the server to see plaintext, stop and flag it instead of implementing it, because it likely means the design needs to change, not the server.
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
