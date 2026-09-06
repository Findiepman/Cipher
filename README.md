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

Read [`AGENTS.md`](AGENTS.md) before changing anything, then the one in the
directory you are working in. [`stack.md`](stack.md) records why the stack is
what it is.

## Getting it running

Install once from the repo root — the workspaces share a single lockfile, so
running `npm install` inside `client/` or `server/` is not what you want:

```bash
npm install
```

Then the client alone, which needs no backend at all:

```bash
npm run dev            # http://localhost:5173, VITE_BACKEND=mock by default
```

The client talks to local fixtures until you tell it otherwise. To point it at
the real API, copy `client/.env.example` to `client/.env`, set
`VITE_BACKEND=http`, and start the server as described in
[`server/README.md`](server/README.md) — it needs Postgres and a `.env` of its
own.

```bash
npm run dev:server     # http://localhost:3000
```

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

## Known gap: the client and server do not speak the same protocol yet

`client/` and `server/` were built in parallel against different assumptions and
have not been reconciled. Two things to settle before `VITE_BACKEND=http` can
work end to end:

- **Auth model.** The client never sends a password: it derives an `authHash`
  locally and uploads that plus two wrapped copies of the private key. The
  server's `/auth/register` and `/auth/login` currently take a plaintext
  password and hash it themselves, and store no key material.
- **Surface.** The client calls password reset, email change, session listing,
  recovery-code rotation, a device key registry and an admin API. The server
  implements register, verify-email, resend-verification, login, refresh,
  logout, logout-all and `/account/me`.

Neither side is wrong; they are two halves of a decision nobody has made yet.
