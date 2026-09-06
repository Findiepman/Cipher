# private messenger

A Discord-like chat app where message content is end-to-end encrypted: sealed on
the sender's device, stored as ciphertext, opened only on the recipient's.

One npm workspace, four packages:

| Path | What it is |
|---|---|
| `client/` | The React + Vite app. One UI codebase, built twice: as the web app, and wrapped by the desktop shell. |
| `server/` | Fastify API, Postgres via Prisma. Accounts and auth so far — see [`backend-plan.md`](backend-plan.md). |
| `packages/crypto/` | `@cipher/crypto`. The only place in the repo that calls libsodium. |
| `desktop/` | The Tauri/Electron shell around `client/`'s build output. Not started. |

Read [`AGENTS.md`](AGENTS.md) before changing anything, then
[`STATUS.md`](STATUS.md) for where the project actually is — what works, what is
missing, and the decisions worth not undoing — then the `AGENTS.md` in the
directory you are working in. [`stack.md`](stack.md) records why the stack is
what it is.

## Getting it running

Install once from the repo root — the workspaces share a single lockfile, so
running `npm install` inside `client/` or `server/` is not what you want:

```bash
npm install
```

You need both halves running to sign in. Start the server first — it needs
Postgres and a `.env`, both covered in [`server/README.md`](server/README.md):

```bash
npm run dev:server     # http://localhost:3000
npm run dev            # http://localhost:5173
```

Open http://localhost:5173 and create an account. With `MAIL_TRANSPORT=file`,
the verification email lands as a file in `server/.mail/` — open the
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

**Phase 1.** `encryptMessage()` and `decryptMessage()` are deliberately no-ops
that base64 a body rather than sealing it, so the chat pipeline — auth, sockets,
reconnect, offline queueing, desktop packaging — gets debugged without a crypto
layer in the way. Every read and write already routes through those two
functions, which is the seam phase 2 plugs into. Nothing in `client/` changes
when it does.

Key custody, however, is real already: the account keypair is generated on the
device, the private half is wrapped under Argon2id before it is stored, and
neither it nor the password nor the recovery code is ever sent to the server.
See [`packages/crypto/AGENTS.md`](packages/crypto/AGENTS.md) for what phase 2
adds and [`client/AGENTS.md`](client/AGENTS.md) for the rules around the key on
the device.

## Signing in

The client and server speak one protocol, and the password is not part of it.

1. **Create account.** A keypair is generated on the device. The password is
   stretched into an `authHash` (which goes to the server) and, separately, into
   a key that wraps the private key (which does not). The wrapped key is
   uploaded twice — once under the password, once under a recovery code shown
   on screen exactly once.
2. **Verify email.** The link is `/verify-email?token=…`. Running locally with
   `MAIL_TRANSPORT=file`, the email is a file in `server/.mail/`.
3. **Sign in.** The server compares the `authHash` and hands back the wrapped
   key, which is opened locally with the password.
4. **Unlock.** After a reload you are signed in but *locked*: the private key
   lives in memory only, so it has to be re-derived from your password. That
   screen is the visible form of "the server cannot read your messages".

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

## Still to build

- **Account flows the client already implements but the server does not**:
  password reset, the recovery-code reset path, email change, the session list,
  recovery-code rotation, account deletion, the device key registry
  (`/keys/*`), and the admin API. `client/src/lib/api/endpoints.ts` calls all of
  them; they 404 today.
- **Messaging.** There are no message or channel tables yet, and no socket
  layer. The chat UI behind the login screen still renders `data/mockData.ts`.
- **CSRF.** The client sends `x-csrf-token` from a `csrf_token` cookie in cookie
  mode; the server never sets one, so the header is simply absent. Cross-site
  POSTs are currently blocked by `SameSite=Lax` plus a CORS allowlist rather
  than by a token.
- **Phase 2 encryption**, per `packages/crypto/AGENTS.md`.
