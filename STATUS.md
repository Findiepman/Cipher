# STATUS — where this project actually is

Last updated **2026-09-06**, after DM messaging and the friend graph landed and
were confirmed working by hand in the browser.

This file is the "get up to speed without reading everything" document. It says
what works, what does not, and which decisions are load-bearing. Keep it
current: if you change what is true here, edit this file in the same commit.

**Read in this order:** [`AGENTS.md`](AGENTS.md) (the rules — non-negotiable) →
this file (the state) → the `AGENTS.md` in whichever directory you are touching.
[`stack.md`](stack.md) explains why the stack is what it is;
[`backend-plan.md`](backend-plan.md) is the account/auth plan, still broadly
accurate but see *Deviations* below.

---

## In one paragraph

An end-to-end-encrypted chat app, npm workspace, three live packages
(`client/`, `server/`, `packages/crypto/`) plus an empty `desktop/`. **Accounts
and auth work end to end** — register, verify by email, sign in, unlock, lock,
sign out — with real key custody: the account keypair is generated on the
device and the server never receives a password, a recovery code, or a private
key. **DM messaging works end to end too**: add a friend by exact username,
they accept, you get a conversation with live delivery over Socket.io, an
offline queue, and a backlog on reconnect. **Encryption is still deliberately
phase 1**, meaning `encryptMessage`/`decryptMessage` are base64 no-ops — so the
server can currently read message bodies. Group servers/channels do not exist;
DMs only.

Two independent numbering schemes are in play and they are unrelated: *phase
1/2* is the messaging-encryption axis (`AGENTS.md`), *steps 0–6* are the
account-work axis (`backend-plan.md`).

---

## What works, verified

| Capability | Where |
|---|---|
| Register → recovery code → verify email → sign in | `client/src/screens/`, `server/src/modules/auth/` |
| Unlock / lock / sign out, session restored across reloads | `client/src/state/SessionProvider.tsx` |
| Keypair generation, Argon2id key wrapping, recovery codes, fingerprints | `packages/crypto/src/` |
| Refresh-token rotation with reuse detection | `server/src/modules/auth/sessions.ts` |
| Account lockout, generic responses that resist enumeration | `server/src/modules/auth/service.ts` |
| Friend requests by exact username, accept/decline, unfriend, block | `server/src/modules/friends/` |
| Public-key registry, gated on friendship | `server/src/modules/keys/routes.ts` |
| DM conversations, message history, cursor paging | `server/src/modules/conversations/` |
| Live delivery, presence, typing, over Socket.io | `server/src/realtime/index.ts` |
| Optimistic send, offline queue, reconnect backlog | `client/src/state/`, `client/src/lib/transport/` |
| The chat UI itself: friends screen, DM list, composer | `client/src/App.tsx`, `client/src/screens/FriendsScreen.tsx` |

195 tests pass: 28 crypto, 77 client, 90 server. `npm run typecheck` and
`npm run build` are clean across all workspaces.

**Adding a friend and exchanging messages were driven by hand in the browser on
2026-09-06 and work.** That is worth stating separately from the tests: the
suites and the smoke scripts cover the protocol, but nothing automated has ever
clicked the actual UI, so the manual pass is the only evidence the React layer
behaves. Anything you change in `client/src/state/ChatProvider.tsx` or the
screens still needs a human to look at it.

Two end-to-end proofs, both against a running server over real HTTP:

- `cd server && npm run smoke` — the account lifecycle. Asserts the private key
  it generated comes back out of the server's blob unchanged.
- `cd server && npm run smoke:messaging` — two accounts befriend each other,
  open a DM, send over a websocket, receive live, and page the backlog. Its
  last assertion is the one the envelope model exists for: **the sender can
  read their own message back off the server.**

## What is not built

- **Group servers and channels.** DMs only. The message tables are generic
  enough for groups (a `Conversation` with N participants), but the key model
  is not chosen — see `packages/crypto/AGENTS.md`. The UI's server rail is
  gone; there is a Direct view and a Friends view.
- **Message editing, deletion, read receipts, attachments, search.** None of
  it. `ConversationParticipant.lastReadMessageId` exists in the schema and is
  never written, so nothing is ever marked read and the conversation list has
  no unread state.
- **Hosting.** It runs on localhost only. `messaging-plan.md` stage 8 covers
  the Ubuntu mini PC: Dockerfiles, Caddy, a Cloudflare Tunnel, a deploy script
  and backups. **Real SMTP is the blocker there, not polish** — verification is
  required before login, so until mail sends, nobody can create an account on
  the box, including you. A residential IP cannot deliver mail directly.
- **Most account endpoints.** `client/src/lib/api/endpoints.ts` calls a full
  API; the server implements a slice of it. Everything below 404s today:
  `POST /auth/forgot-password`, `/auth/reset-password`,
  `/auth/reset-password/context`, `PATCH /account/me`,
  `/account/change-password`, `/account/change-email[/confirm]`,
  `GET|DELETE /account/sessions[/:id]`, `/account/recovery-code`,
  `DELETE /account`, all of `/admin/*`. (`/keys/user/:userId` now exists;
  `POST /keys/device` and `DELETE /keys/device/:id` do not.)
  The client half of most of these already exists in `authService.ts`.
- **CSRF.** The client sends `x-csrf-token` from a `csrf_token` cookie; the
  server never sets one, so the header is simply absent. Cross-site POSTs are
  currently blocked by `SameSite=Lax` plus a CORS allowlist, not by a token.
  This is `backend-plan.md` step 6.
- **Phase 2 encryption.** See `packages/crypto/AGENTS.md`.
- **`desktop/`.** Nothing but an `AGENTS.md`.

---

## Decisions that are load-bearing

Do not undo these casually. Each is here because the obvious alternative is
worse for this specific app.

1. **The server never receives a password.** The client derives
   `authHash = argon2id(password, salt from email, "auth")` and sends only that;
   the server hashes it again into `User.authVerifier`. There is no `password`
   field on any endpoint and there must not be one. This is what
   `backend-plan.md`'s "E2EE contract" always specified.
2. **Therefore the server cannot check password strength**, because a weak and a
   strong password produce indistinguishable base64. The rule lives in
   `client/src/lib/session/passwordPolicy.ts` and is *advisory only* — a hostile
   client can ignore it. This is a genuine weakening accepted knowingly; don't
   "fix" it by asking for the password.
3. **Login is by email, never username.** The auth salt derives from the email,
   so a client holding only a handle cannot compute an authHash — and accepting
   one would mean telling an anonymous caller which address is behind a username.
4. **One device per account.** `Device` holds the keypair; login returns the
   caller's own device inline so the key can be unwrapped without a second round
   trip. Multi-device is deliberately deferred (`packages/crypto/AGENTS.md`) —
   it changes the key model significantly.
5. **`packages/crypto` is the only caller of libsodium.** `server/` depends on
   it as a **devDependency only**, used by `scripts/smoke.ts`, which acts as a
   client. Server runtime code must never import it for anything that decrypts.
6. **Phase 1 message envelope is `{ v: 1, alg: 'none', nonce: null, body }`**
   with a base64 body. Readers dispatch on `alg`, so phase 2 messages can
   coexist with phase 1 ones during a rollout. The client's tests construct this
   envelope by hand — change one side and you must change the other.
7. **A message is a header plus one sealed envelope per participant**, the
   author included (`Message` + `MessageEnvelope`). `crypto_box` seals to
   exactly one recipient, so a message sealed for the person you are talking to
   cannot be opened by you — without a self-addressed copy, a sender on a fresh
   device would find their own history unreadable. Phase 1 puts the same
   `alg: 'none'` blob in every envelope, so this costs a row per participant
   today and saves a migration later. The server validates that the recipient
   set equals the participant set and hands each caller only their own copy.
8. **Friendship is the authorization gate** for the key registry and for
   opening a conversation. Unfriending stops new messages but leaves the
   history readable — it withdraws the ability to add to a conversation, not a
   request to destroy what was said.
9. **`POST /friends/requests` answers honestly whether a username exists**,
   which is the one place this codebase does. A friend request that cannot say
   "no such user" is unusable, and a username is a handle people hand out where
   an email address is not. It is narrowed instead: exact match only, and a
   per-*account* hourly budget (20, counted from the audit log so failures
   count too) rather than a per-IP one.
10. **Message order is an autoincrement `seq`, not `sentAt`.** Several sends
    land in the same millisecond and a timestamp cannot break that tie. Cursors
    are message ids, because the server cannot say what is new in a
    conversation it cannot read.
11. **The app mark is one file and one component.** `client/public/logo.png`
    backs the favicon, the apple-touch icon, the manifest and every in-app use
    via `components/BrandMark.tsx`. Don't add a second copy of the logo or
    inline an `<img src="/logo.png">` — the point is that swapping the file
    changes it everywhere. The old `KeyholeIcon` glyph was deleted for the same
    reason.
12. **`@cipher/crypto` resolves to TypeScript source** (`exports` → `./src/index.ts`),
   the "internal packages" pattern. No build step; Vite and Vitest transpile it.

## Deviations from `backend-plan.md`

That document is still the plan. These four details are out of date in it:

| Plan says | Reality |
|---|---|
| `User.passwordHash` | `User.authVerifier` — argon2id of the *authHash*, not of a password |
| A separate `RecoveryCode` table | `User.recoveryCodeHash`, a single column. v1 has one live code at a time |
| `POST /auth/resend-verify` | `POST /auth/resend-verification` |
| "Minimum 12 chars, weak-password rejection" under Auth mechanics | Client-side only now — see decision 2 |

Step 1 is done. Step 5 (device registry) is mostly done: the `Device` table,
the login-time hand-back and `GET /keys/user/:userId` exist; device
registration and revocation endpoints do not (there is one device per account,
created at signup).

[`messaging-plan.md`](messaging-plan.md) is the plan for the messaging half.
Stages 0–7 of it are done; stage 8 (self-hosting) is not.

---

## Running it

```bash
npm install            # from the repo root; one lockfile, three workspaces
npm run dev:server     # :3000 — needs Postgres + server/.env
npm run dev            # :5173
```

Then create an account at http://localhost:5173. **The verification link is
printed in the server console**, because `MAIL_TRANSPORT=file` writes emails to
`server/.mail/` instead of sending them.

To try messaging you need two accounts, and both have to be verified. Sign in
as one, add the other by its exact username under **Friends**, accept from the
other side, then **Message** them. A second browser profile (or a private
window) is the easiest way to hold both sessions at once — the identity key
lives in IndexedDB per origin, so two normal tabs share one account.

```bash
npm test               # all workspaces
npm run typecheck
npm run build
cd server && npm run smoke             # account lifecycle over real HTTP
cd server && npm run smoke:messaging   # two accounts, a DM, over HTTP + sockets
```

`VITE_BACKEND=mock` still short-circuits auth, but it no longer renders a chat:
the fixtures it used to draw are gone, because the chat UI now has a real
server to talk to and maintaining a second render of it would mean making every
UI change twice.

---

## Gotchas that have already cost time

- **libsodium must be the `-sumo` build.** The base build of
  `libsodium-wrappers` 0.8.x has no `crypto_pwhash`, which the key wrapping
  needs. Also: 0.7.16's ESM entry is broken upstream (imports a file it does not
  ship). Pinned to `libsodium-wrappers-sumo@^0.8.4`.
- **jsdom is opted into per test file**, via `// @vitest-environment jsdom` on
  line 1 — see `client/src/screens/VerifyEmailScreen.test.tsx`. Setting it
  globally breaks every crypto suite: libsodium checks arguments with
  `instanceof Uint8Array` and jsdom's typed arrays come from another realm, so
  calls throw `unsupported input type for message`.
- **Component tests must render inside `<StrictMode>`.** A real bug shipped
  where a `cancelled` flag paired with a StrictMode ref guard silently discarded
  a completed request. It passed under a single effect pass.
- **`/auth/*` allows 10 requests per 15 minutes per IP.** One `npm run smoke`
  run uses most of that. Restart the server to reset the in-memory counter.
- **Only the newest verification email works.** Issuing a token deletes the
  previous one, so older files in `server/.mail/` are dead links.
- **Two databases need migrating**: `messenger` and `messenger_test`. The test
  one is not migrated by `prisma migrate dev` — run
  `DATABASE_URL=…messenger_test npx prisma migrate deploy` as well, or the whole
  server suite fails on a missing table.
- **`prisma migrate dev` cannot run non-interactively here.** Use
  `--create-only`, hand-edit the SQL, then `migrate deploy`.
- **`prisma migrate dev --create-only` timestamps in UTC**, which on this
  machine is behind local time — so a fresh migration can sort *before* one
  already applied. Check the directory name against the existing ones and
  rename it if it does not sort last.
- **The username unique index is case-sensitive, but friend lookup is not.**
  Registration would let `nova` and `Nova` both exist; if they ever did, one of
  them would be unreachable by handle. Not worth a migration until someone
  actually collides, but that is the reason.
- **Presence is per-process**, held in a `Map` in `realtime/index.ts`. Correct
  on one box, wrong the day there are two.
- **A socket outlives its 15-minute access token.** The session behind it is
  re-checked before every send and on a 60s sweep, so a revoked session can
  keep *receiving* for up to a minute. That window is the price of not
  coupling the auth routes to the socket layer.
- **Accounts created before 2026-09-06 cannot sign in.** Their stored hash came
  from a different input and they have no `Device` row. Re-register.
- **Docker is unavailable on the dev machine** (SVM disabled in BIOS), so
  Postgres runs natively and Mailpit is not an option. See `server/README.md`.

---

## Reasonable next steps

Pick one; they are roughly independent.

1. **Self-hosting** — `messaging-plan.md` stage 8. Dockerfiles, Caddy, a
   Cloudflare Tunnel, a deploy script, nightly `pg_dump`. **Real SMTP is a
   blocker, not polish**: verification is required before login, so if mail
   does not send, nobody can create an account.
2. **Phase 2 encryption.** DMs now work end to end in phase 1, which
   `AGENTS.md` names as the precondition. The registry and the envelope model
   are already in place, so this is `encryptMessage`/`decryptMessage` plus the
   line in `packages/crypto/AGENTS.md` — no schema change, no data migration.
3. **`backend-plan.md` step 2** — password reset, change password, recovery-code
   rotation. `authService.ts` already implements the client side of all three,
   including the `/auth/reset-password/context` endpoint that the plan does not
   list and that the reset-with-recovery-code flow cannot work without.
4. **Step 6 hardening** — CSRF tokens, which the client is already written
   for. This matters more now than it did: the app has state-changing endpoints
   worth forging against.

Do not start with group encryption — see `packages/crypto/AGENTS.md`.
