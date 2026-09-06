# STATUS — where this project actually is

Last updated **2026-09-06**, after the frontend and backend branches were merged
and connected.

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
key. **Messaging does not exist yet**: no message or channel tables, no socket
layer, and the chat UI behind the login screen is still fixtures. **Encryption
is deliberately phase 1**, meaning `encryptMessage`/`decryptMessage` are
base64 no-ops.

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

130 tests pass: 28 crypto, 63 client, 39 server. `npm run typecheck` and
`npm run build` are clean across all workspaces.

The end-to-end proof is `cd server && npm run smoke`: it drives the real HTTP
API using the same `@cipher/crypto` calls the browser makes, and asserts the
private key it generated comes back out of the server's blob unchanged.

## What is not built

- **Messaging.** No `Message`/`Channel` tables, no Socket.io layer, no message
  API. `client/src/App.tsx` renders `client/src/data/mockData.ts` — the
  conversations with nova, ren and kestrel are fixtures. `chatController.ts`,
  `chatStore.ts` and `outbox.ts` are written and tested but no screen uses them.
- **Most account endpoints.** `client/src/lib/api/endpoints.ts` calls a full
  API; the server implements a slice of it. Everything below 404s today:
  `POST /auth/forgot-password`, `/auth/reset-password`,
  `/auth/reset-password/context`, `PATCH /account/me`,
  `/account/change-password`, `/account/change-email[/confirm]`,
  `GET|DELETE /account/sessions[/:id]`, `/account/recovery-code`,
  `DELETE /account`, all of `/keys/*`, all of `/admin/*`.
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
7. **`@cipher/crypto` resolves to TypeScript source** (`exports` → `./src/index.ts`),
   the "internal packages" pattern. No build step; Vite and Vitest transpile it.

## Deviations from `backend-plan.md`

That document is still the plan. These four details are out of date in it:

| Plan says | Reality |
|---|---|
| `User.passwordHash` | `User.authVerifier` — argon2id of the *authHash*, not of a password |
| A separate `RecoveryCode` table | `User.recoveryCodeHash`, a single column. v1 has one live code at a time |
| `POST /auth/resend-verify` | `POST /auth/resend-verification` |
| "Minimum 12 chars, weak-password rejection" under Auth mechanics | Client-side only now — see decision 2 |

Step 1 is done. Step 5 (device registry) is half done: the `Device` table and
the login-time hand-back exist, the `/keys/*` endpoints do not.

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

```bash
npm test               # all workspaces
npm run typecheck
npm run build
cd server && npm run smoke     # end-to-end account lifecycle over real HTTP
```

Set `VITE_BACKEND=mock` in `client/.env` to work on the chat UI with no server;
nothing signs in in that mode.

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
- **Accounts created before 2026-09-06 cannot sign in.** Their stored hash came
  from a different input and they have no `Device` row. Re-register.
- **Docker is unavailable on the dev machine** (SVM disabled in BIOS), so
  Postgres runs natively and Mailpit is not an option. See `server/README.md`.

---

## Reasonable next steps

Pick one; they are roughly independent.

1. **Messaging (the biggest gap).** Message/channel tables, a Socket.io layer,
   and wiring `chatController`/`outbox` into the UI in place of `mockData.ts`.
   The client plumbing is already written and tested, so this is mostly server
   work plus replacing `App.tsx`'s fixture state. Start at
   `client/src/state/chatController.ts` to see the contract it expects.
2. **`backend-plan.md` step 2** — password reset, change password, recovery-code
   rotation. `authService.ts` already implements the client side of all three,
   including the `/auth/reset-password/context` endpoint that the plan does not
   list and that the reset-with-recovery-code flow cannot work without.
3. **Step 5, the rest of it** — `/keys/*`, so one user can look up another's
   public key. This is a prerequisite for real DMs and therefore for phase 2.
4. **Step 6 hardening** — CSRF tokens, which the client is already written for.

Phase 2 encryption should wait until DMs work end to end in phase 1, per
`AGENTS.md`. Do not start with group encryption.
