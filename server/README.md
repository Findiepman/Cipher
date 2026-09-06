# server

Node/Fastify backend for the messenger. This directory currently covers
**accounts and auth only** — see [`../backend-plan.md`](../backend-plan.md) for
the full plan and which steps are done.

Read [`AGENTS.md`](AGENTS.md) before changing anything here.

## Running it

```bash
npm install                   # from the repo root: this is an npm workspace
cp .env.example .env          # then set JWT_SECRET
npm run db:migrate            # creates the schema
npm run dev
```

The API listens on `http://localhost:3000`.

Generate a real signing secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### Postgres

This machine runs **Postgres 17 installed natively** (via
`winget install PostgreSQL.PostgreSQL.17`), because Docker needs hardware
virtualization and SVM Mode is currently disabled in the BIOS. Two databases
exist, both owned by a `messenger` role with password `messenger`:

| Database | Used by |
|---|---|
| `messenger` | `npm run dev` |
| `messenger_test` | `npm test` — **truncated between every test** |

`docker-compose.yml` is still in the repo and describes the same setup. It will
work as-is the day SVM Mode gets switched on (Advanced → CPU Configuration in
the BIOS), and `npm run infra:up` will bring up Postgres plus Mailpit. Nothing
in the app code cares which of the two you use — only `DATABASE_URL` changes.

### Email in development

`MAIL_TRANSPORT=console` (the default in `.env.example`) prints each message to
the server log instead of sending it, so the verification link is right there
in the terminal — no mail server needed.

Set `MAIL_TRANSPORT=smtp` to exercise the real send path. Pointed at the
Mailpit container it delivers to http://localhost:8025; pointed at a real
provider it sends for real. `console` is rejected outright when
`NODE_ENV=production`, so live signups can never silently fail to send.

## Trying it without a frontend

```bash
npm run dev      # in one terminal
npm run smoke    # in another
```

`npm run smoke` drives a whole account lifecycle against the running server
over real HTTP — the same calls the client will make — and prints a pass/fail
line per step:

```
ok    register                               202 If that email address can be registered...
ok    verification email received            token YpH21vFfm40o...
ok    login blocked before verifying         401 email_not_verified
ok    verify email                           200
ok    login                                  200 user 557f3247-...
ok    refresh rotates the token              200
ok    replaying old refresh token is refused 401 refresh_token_reused
```

It needs `MAIL_TRANSPORT=file` (the default in `.env.example`), because the
verification token exists **only** in the email — the database stores a hash of
it, so there is no way to recover it from Postgres. Messages land in `.mail/`,
which the script reads and then cleans up (`SMOKE_KEEP_MAIL=1` keeps them).

Each run leaves its account behind so you can log in as it. Clear them out
with:

```sql
DELETE FROM "User" WHERE email LIKE 'smoke-%@example.test';
```

One run spends **6 of the 10** requests `/auth/*` allows per 15 minutes per IP,
so two back-to-back runs will trip the limiter. The script says so plainly if
it happens; restarting `npm run dev` resets the counter.

## Tests

```bash
npm test
```

34 integration tests against a real Postgres — they use `TEST_DATABASE_URL`
(`messenger_test`) and truncate every table between cases. `tests/setup.ts`
refuses to run if that URL doesn't name a test database, so a mistyped env var
can't wipe your dev data.

Apply migrations to it after any schema change:

```bash
DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy
```

Email is the exception to "real dependencies" — tests swap in an in-memory
mailer and read the verification token out of the message body, so they
exercise the same path a real user would without needing SMTP.

Rate limiting is **off** in tests, because a whole suite from one IP looks like
one very busy attacker. One test (`rate limiting`) builds its own app with the
limiter on, so the safeguard itself stays covered — if you add tests that need
it, use `createTestApp({ rateLimits: true })`.

## Endpoints so far

Note the methods: everything except the three `GET`s is `POST`, so typing one
of these into a browser address bar will **not** reach it. You'll get a `405`
naming the method it does accept.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/` | — | Index — lists these endpoints |
| `GET` | `/health` | — | Liveness |
| `GET` | `/health/ready` | — | Liveness + database reachable |
| `POST` | `/auth/register` | — | Create an account, send a verification link |
| `POST` | `/auth/verify-email` | — | Consume a verification token |
| `POST` | `/auth/resend-verification` | — | Send a fresh verification link |
| `POST` | `/auth/login` | — | Sign in, issue access + refresh tokens |
| `POST` | `/auth/refresh` | refresh token | Rotate the session |
| `POST` | `/auth/logout` | refresh token | Revoke this session |
| `POST` | `/auth/logout-all` | access token | Revoke every session for the user |
| `GET` | `/account/me` | access token | The signed-in user |

### Errors

Every failure comes back in the same shape, so the client can branch on `code`
rather than on a message string:

```json
{ "error": { "code": "invalid_credentials", "message": "Incorrect username or password." } }
```

Validation failures add a `details` array of `{ field, message }`.

## Notes for whoever builds the client

**Two ways to hold a session.** Login and refresh set httpOnly cookies *and*
return the tokens in the body. The web app should ignore the body tokens and
let the browser carry the cookies (send `credentials: "include"`); the desktop
shell should read the body tokens and send `Authorization: Bearer`. Don't mix
the two in one client.

**Refresh tokens rotate, and replay is fatal.** Every call to `/auth/refresh`
invalidates the token you presented and returns a new one. If a spent token is
ever presented again, *every* session for that user is revoked and they have to
sign in again — that is the intended response to a stolen token, not a bug. So
the client must never fire two refreshes concurrently: serialise them behind a
single in-flight promise, or a page that makes several parallel API calls on
load will log the user out of everything.

**Registration deliberately tells you nothing.** `/auth/register` returns the
same `202` whether or not the address was already taken, so the form cannot be
used to find out who has an account here. "That email is already in use" is not
available to the UI by design — if the address does exist, its owner gets an
email about the attempt instead.

Same rule for `/auth/resend-verification`. Login is the one exception: once the
correct password has been supplied, the caller has proven they own the account,
so `email_not_verified` and `account_disabled` are reported honestly.

**Lockout is invisible.** After several failed attempts the account locks for a
while, and during that window even the correct password returns
`invalid_credentials`. There is no distinct "locked" code, for the same
enumeration reason.

## Known gaps

- **No CSRF token yet.** Cookie auth currently rests on `SameSite=Lax` alone.
  The double-submit token is step 6; until it lands, prefer Bearer auth for
  anything sensitive.
- **`npm audit` reports 4 high advisories, and they cannot be fixed by
  changing versions. Do not run `npm audit fix --force` here.** All four are in
  `mysql2` and `deepmerge-ts`, reached via `prisma` — which `@prisma/client`
  depends on at runtime, so they are in the production tree, not dev-only.

  They are still unreachable: booting the app and running queries loads **zero**
  files from either package (only `pg`). `mysql2` is the MySQL driver, and this
  project uses the Postgres adapter, so that code path never executes.
  `deepmerge-ts` merges `prisma.config.ts` — our own file, on our own machine,
  with no attacker input.

  `npm audit fix --force` downgrades the `prisma` CLI to 6.x while
  `@prisma/client` stays on 7.x. The v6 CLI cannot read a v7 schema (it
  requires `url` in the datasource block, which v7 forbids), so `migrate`,
  `generate` and `validate` all break. It does not even resolve the advisory:
  the vulnerable range is `6.13.0-dev.1 - 8.1.0-dev.4`, so escaping it means
  going back to 6.12.0, which predates the config format this project uses.
  Re-check when Prisma ships a release that bumps these transitives.
- Every authenticated request does one extra database read to confirm the
  session behind the JWT is still live. That is what makes logout and
  force-logout take effect immediately instead of at token expiry; if it ever
  shows up in profiling, cache it with a short TTL rather than removing it.
