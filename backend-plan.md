# Backend plan — accounts & auth

Scope: everything account-related. Registration, email verification, login,
sessions, password reset, account management, admin panel, and the device /
public-key registry the messaging layer builds on.

Decided 2026-09-06. Follows the stack in [stack.md](stack.md).

## Locked decisions

| Question | Decision |
|---|---|
| Password reset vs. E2EE keys | **Recovery code.** Private key wrapped twice — once by password, once by a one-time recovery code. |
| Transactional email | **Mailpit** in docker-compose, behind a provider-agnostic mailer interface. Swap to a real provider via env. |
| Admin panel | **API + minimal server-rendered UI.** Replaceable with React later. |
| Multi-device | **Single device in v1.** Schema keeps a `Device` table so multi-device is additive. |

## Stack

Node 22, TypeScript, **Fastify 5**, **Prisma + Postgres**, **argon2id**,
**zod** for input validation, **vitest** for tests. Postgres and Mailpit run
locally via docker-compose.

## Layout

```
server/
  prisma/schema.prisma
  docker-compose.yml        # postgres + mailpit
  src/
    index.ts                # bootstrap
    env.ts                  # zod-validated config, fails fast on missing secrets
    db.ts                   # prisma client singleton
    plugins/                # auth guard, rate-limit, cors, security headers, errors
    modules/
      auth/                 # register, verify-email, login, refresh, logout, reset
      account/              # me, profile, change email/password, sessions, delete
      admin/                # listing, detail, disable, force-logout, audit log
      keys/                 # device + public-key registry
    lib/                    # hashing, token generation, mailer, audit logger
```

## Data model

| Table | Key fields |
|---|---|
| `User` | id (uuid), email (unique, citext), username (unique), passwordHash, role (`user`/`admin`), status (`active`/`disabled`/`deleted`), emailVerifiedAt, failedLoginCount, lockedUntil, lastLoginAt |
| `Session` | id, userId, refreshTokenHash, deviceLabel, ip, userAgent, expiresAt, revokedAt, replacedById |
| `EmailToken` | id, userId, purpose (`verify`/`reset`/`email_change`), tokenHash, expiresAt, usedAt |
| `Device` | id, userId, publicKey, wrappedPrivateKey, wrappedPrivateKeyRecovery, label, createdAt, revokedAt |
| `RecoveryCode` | id, userId, codeHash, createdAt, usedAt |
| `AuditLog` | id, actorUserId, targetUserId, action, ip, meta (jsonb), createdAt |

Tokens and recovery codes are **never stored in plaintext** — the DB holds a
SHA-256 hash; the raw value exists only in the email or in the user's hands.

## Auth mechanics

- **Passwords** — argon2id, not bcrypt (no 72-byte truncation, better GPU
  resistance). Minimum 12 chars, weak-password rejection, no forced rotation.
- **Sessions** — short-lived access JWT (15 min) plus an opaque 32-byte refresh
  token (30 days) stored hashed. Refresh rotates on every use with **reuse
  detection**: replaying a spent token revokes the entire session family.
- **Transport** — httpOnly + Secure + SameSite cookies for web,
  `Authorization: Bearer` fallback for the Tauri/Electron desktop build. CSRF
  token required on cookie-authenticated mutations.
- **Anti-abuse** — per-IP *and* per-account rate limits on login, register and
  reset; progressive lockout after repeated failures. Register and
  forgot-password always return a generic success, so neither can be used to
  enumerate accounts.

## The E2EE contract (client side — for the frontend)

The server must never be able to derive the key that wraps the private key.
The password is used for two different things, with different salts and
distinct domain separators:

```
authHash    = argon2id(password, salt_auth, "auth")       -> sent to server
wrapKey     = argon2id(password, salt_wrap, "keywrap")    -> NEVER leaves device
```

At signup, the client generates the identity keypair and wraps the private key
twice:

```
blob_A = wrap(privKey, kdf(password))
blob_B = wrap(privKey, kdf(recoveryCode))
```

Both blobs are opaque to the server; it stores and returns them without ever
being able to open either.

Password reset **with** the recovery code: the client unwraps `blob_B`,
re-wraps under the new password, uploads the new `blob_A`. Identity and message
history survive.

Password reset **without** the recovery code: a fresh keypair is generated, old
ciphertext stays on the server permanently unreadable, and contacts are shown a
"security number changed" warning.

The recovery code is shown exactly once, at signup, and only its hash is stored.

## Endpoints

```
POST /auth/register            POST /auth/login
POST /auth/verify-email        POST /auth/refresh
POST /auth/resend-verify       POST /auth/logout      POST /auth/logout-all
POST /auth/forgot-password     POST /auth/reset-password

GET|PATCH /account/me          POST /account/change-password
POST   /account/change-email   GET|DELETE /account/sessions[/:id]
POST   /account/recovery-code  # regenerate, invalidates the old one
DELETE /account                # soft delete + grace period

GET  /admin/users?q=&status=&page=      GET /admin/users/:id
POST /admin/users/:id/disable | enable | force-logout | resend-verify
GET  /admin/audit-log

POST /keys/device              GET /keys/user/:userId    DELETE /keys/device/:id
```

The admin panel **cannot read messages**. The server only ever holds ciphertext,
so there is nothing to expose — this is a property of the design, not a policy.

## Build order

0. Scaffold — env, docker-compose, Prisma, health check, error handling, tests
1. Register -> email verify -> login -> refresh / logout
2. Password reset + change password + recovery code
3. Account management — profile, change email, session list, delete account
4. Admin routes + audit log
5. Device / public-key registry (frontend integration point)
6. Hardening — rate limits, security headers, CORS lockdown, seed-admin script,
   test coverage
