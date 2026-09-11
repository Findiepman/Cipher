# private messenger

A Discord-like chat app where message content is end-to-end encrypted: sealed on
the sender's device, stored as ciphertext, opened only on the recipient's.

One npm workspace, four packages:

| Path | What it is |
|---|---|
| `client/` | The React + Vite app. One UI codebase, built twice: as the web app and again in desktop mode for the desktop app. |
| `server/` | Fastify API, Socket.io, Postgres via Prisma. Accounts and auth ([`backend-plan.md`](backend-plan.md)) plus friends and DMs ([`messaging-plan.md`](messaging-plan.md)). |
| `packages/crypto/` | `@cipher/crypto`. The only place in the repo that calls libsodium. |
| `desktop/` | The Tauri desktop app: `client/` bundled, plus a tray, notifications and signed auto-updates. See [`desktop/README.md`](desktop/README.md). |

Read [`AGENTS.md`](AGENTS.md) before changing anything, then
[`STATUS.md`](STATUS.md) for where the project actually is (what works, what is
missing and the decisions worth not undoing), then the `AGENTS.md` in the
directory you are working in. [`stack.md`](stack.md) records why the stack is
what it is, and [`DEPLOY.md`](DEPLOY.md) is the runbook for putting it on a
server.

## Getting it running

Install once from the repo root: the workspaces share a single lockfile, so
running `npm install` inside `client/` or `server/` is not what you want:

```bash
npm install
```

You need both halves running to sign in. Start the server first, because it needs
Postgres and a `.env`, both covered in [`server/README.md`](server/README.md):

```bash
npm run dev:server     # http://localhost:3000
npm run dev            # http://localhost:5173
```

Open http://localhost:5173 and create an account. With `MAIL_TRANSPORT=file`,
the verification email lands as a file in `server/.mail/`. Open the
`/verify-email?token=…` link inside it.

To work on the UI without a server at all, copy `client/.env.example` to
`client/.env` and set `VITE_BACKEND=mock`. That skips auth entirely and renders
the chat off local fixtures; nothing signs in.

## Checks

```bash
npm test               # every workspace
npm run typecheck      # every workspace
npm run build          # every workspace that has a build
```

The server suite needs a `messenger_test` database; the client and crypto suites
need nothing.

## Where the encryption is at

**Phase 2, since 2026-09-11.** Every direct message and every call's session
description is sealed with libsodium's `crypto_box` (X25519 and
XSalsa20-Poly1305) to the other person's key, one copy per participant, the
sender included. The server stores and relays ciphertext it cannot open, and
the conversation is bound into the box so a body cannot be moved to another.
Other people's keys are pinned the first time they are seen; a different key
for the same person stops the conversation until you accept it. Messages from
before that date were stored base64-encoded under `alg: 'none'` and still open.

Key custody was real from the start: the account keypair is generated on the
device, the private half is wrapped under Argon2id before it is stored, and
neither it nor the password nor the recovery code is ever sent to the server.
See [`packages/crypto/AGENTS.md`](packages/crypto/AGENTS.md) for the design and
[`client/AGENTS.md`](client/AGENTS.md) for the rules around the key on the
device. Group chats and servers, when they come, will not be end-to-end
encrypted by decision: see [`AGENTS.md`](AGENTS.md).

## Signing in

The client and server speak one protocol, and the password is not part of it.

1. **Create account.** A keypair is generated on the device. The password is
   stretched into an `authHash` (which goes to the server) and, separately, into
   a key that wraps the private key (which does not). The wrapped key is
   uploaded twice: once under the password, once under a recovery code shown
   on screen exactly once.
2. **Verify email.** The link is `/verify-email?token=…`. Running locally with
   `MAIL_TRANSPORT=file`, the email is a file in `server/.mail/`.
3. **Sign in.** The server compares the `authHash` and hands back the wrapped
   key, which is opened locally with the password.
4. **Unlock.** The private key lives in memory, never on the server, so there
   is a state where you are signed in but *locked* and cannot read anything.
   That screen is the visible form of "the server cannot read your messages".
   A reload does not normally land there: the key is also sealed under a
   non-extractable key held by this browser profile, so it can be reopened
   without the password for 30 days of use. **Lock** destroys that and brings
   the prompt back.

What the server stores: an argon2id hash of the `authHash`, the SHA-256 of the
recovery code, a public key, and two opaque blobs it cannot open. What it never
receives: the password, the recovery code, or the private key.

One consequence worth knowing: **password strength is enforced client-side
only**, in `client/src/lib/session/passwordPolicy.ts`. The server cannot judge a
password it never sees, so a hostile client can register a weak one.

### Checking it end to end

With Postgres up and the server running:

```bash
cd server && npm run smoke
```

That drives register → verify → login → refresh → reuse-detection over real
HTTP, using the same `@cipher/crypto` calls the browser makes, and asserts the
private key it generated comes back out of the server's blob unchanged.

## Deploying it

[`DEPLOY.md`](DEPLOY.md) is the runbook: Docker Compose on an Ubuntu box,
Caddy serving the client and proxying the API on one hostname, a Cloudflare
Tunnel for ingress, Resend for SMTP, and nightly `pg_dump`.

```bash
cp deploy/.env.example deploy/.env    # fill it in
./deploy/deploy.sh
```

**Mail is a hard prerequisite, not polish.** Verification is required before
login, so if mail does not send, nobody can create an account, including you.
`cd server && npm run mail:test -- you@example.com` proves the relay works
before anything depends on it.

## Still to build

- **Group servers and channels.** DMs only. The message tables are generic
  enough for groups, but the key model is not chosen, see
  `packages/crypto/AGENTS.md`.
- **Message editing, deletion, read receipts, attachments, search.** None of
  it, and nothing is ever marked read.
- **Account flows the client already implements but the server does not**:
  password reset, the recovery-code reset path, email change, the session list,
  recovery-code rotation, account deletion, and the admin API.
  `client/src/lib/api/endpoints.ts` calls all of them; they 404 today.
- **CSRF.** The client sends `x-csrf-token` from a `csrf_token` cookie in cookie
  mode; the server never sets one, so the header is simply absent. Cross-site
  POSTs are currently blocked by same-origin serving plus `SameSite=Lax` and a
  CORS allowlist rather than by a token.
- **An out-of-band key verification screen.** Keys are pinned on first sight; comparing fingerprints in person is the step after that.
