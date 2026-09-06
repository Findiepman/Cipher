# Messaging plan — DMs, friends, and self-hosting

Scope: the messaging half of the app, the friend graph it needs, and getting it
onto a machine you own. Decided 2026-09-06, after `STATUS.md` listed messaging
as the biggest remaining gap.

> **Status: stages 0–7 are done.** DMs work end to end, proved by
> `cd server && npm run smoke:messaging`. Stage 8 (self-hosting) is not started.
> `STATUS.md` is the authority on what is true; this file is the plan.

Follows [`AGENTS.md`](AGENTS.md) and [`stack.md`](stack.md).
[`backend-plan.md`](backend-plan.md) covers accounts; this covers everything
after sign-in.

## Locked decisions

| Question | Decision |
|---|---|
| How you add someone | **Exact username + friend request.** No partial search, no email lookup, hard rate limit. |
| v1 scope | **DMs only.** The fake servers come out of the UI; the rail stays so groups can be added later. |
| Encryption | **Stay phase 1** (`alg: 'none'`) for this pass. The schema is built so the phase 2 flip is a crypto change, not a migration. |
| Real-time | **Socket.io**, per `stack.md`. Reconnect and acks come for free and the `Transport` interface already assumes them. |
| Hosting | **Ubuntu mini PC at home**, one origin, Cloudflare Tunnel for ingress. |

### The one consequence of staying on phase 1

`encryptMessage()` is a base64 no-op, so the server stores readable message
bodies. On a machine in your house that you are the only admin of, that is your
own data on your own disk — but it stops being true the moment someone else has
a login or the DB is backed up somewhere shared. The envelope model below exists
so switching it on later is contained to `packages/crypto` plus the two client
call sites, with no schema change and no data migration.

---

## The design decision that shapes everything: envelopes

`crypto_box` seals to exactly one recipient. That means when phase 2 lands, a
message sealed for the person you are talking to **cannot be opened by you** —
so a sender who signs in on a fresh device loses their own history.

The fix is to store one sealed copy per participant, including the sender. So a
message is a header plus N envelopes, not a header plus a body:

```
Message        id, conversationId, authorId, clientId, sentAt, seq
MessageEnvelope  messageId, recipientUserId, ciphertext
```

In phase 1 both envelopes carry the same `{v:1, alg:'none', body}` blob, so this
costs one extra row per message today and saves a migration later. It is also
the shape groups would need, whichever key model gets picked.

The server never reads `ciphertext`. It counts envelopes and checks the
recipient set matches the participants — that is all.

---

## Data model

New tables. Nothing existing changes.

```prisma
enum FriendshipStatus { PENDING ACCEPTED BLOCKED }

/// One row per pair, not per direction. userAId/userBId are stored in
/// canonical (sorted) order with a unique index, so A→B and B→A cannot both
/// exist as separate pending requests.
model Friendship {
  id            String            @id @default(uuid()) @db.Uuid
  userAId       String            @db.Uuid
  userBId       String            @db.Uuid
  /// Which of the two sent it. Needed to render "incoming" vs "outgoing".
  requestedById String            @db.Uuid
  /// Set only when status is BLOCKED; a block is one-sided and must remember
  /// whose it was, or unblocking would let either party clear it.
  blockedById   String?           @db.Uuid
  status        FriendshipStatus  @default(PENDING)
  createdAt     DateTime          @default(now())
  respondedAt   DateTime?

  @@unique([userAId, userBId])
  @@index([userBId, status])
}

/// Generic on purpose. v1 only ever creates two-participant rows, and dmKey
/// enforces that opening a DM twice returns the same conversation.
model Conversation {
  id        String   @id @default(uuid()) @db.Uuid
  /// "<smaller uuid>:<larger uuid>" for a DM, null for a future group.
  dmKey     String?  @unique
  createdAt DateTime @default(now())
}

model ConversationParticipant {
  conversationId    String    @db.Uuid
  userId            String    @db.Uuid
  lastReadMessageId String?   @db.Uuid
  joinedAt          DateTime  @default(now())

  @@id([conversationId, userId])
  @@index([userId])
}

model Message {
  id             String   @id @default(uuid()) @db.Uuid
  conversationId String   @db.Uuid
  authorId       String   @db.Uuid
  /// The sender's own id, echoed back. Makes a retried send idempotent.
  clientId       String
  sentAt         DateTime @default(now())
  /// Monotonic, so a cursor is "everything after this" rather than a timestamp
  /// comparison that ties on same-millisecond sends.
  seq            BigInt   @default(autoincrement())

  @@unique([conversationId, clientId])
  @@index([conversationId, seq])
}

model MessageEnvelope {
  messageId       String @db.Uuid
  recipientUserId String @db.Uuid
  /// Serialized Ciphertext. Opaque here, forever.
  ciphertext      String

  @@id([messageId, recipientUserId])
  @@index([recipientUserId])
}
```

`prisma migrate dev` cannot run non-interactively on this machine
(`STATUS.md`), so: `--create-only`, hand-check the SQL, `migrate deploy`. And
run it against **both** `messenger` and `messenger_test`, or the whole server
suite fails on a missing table.

---

## HTTP API

```
GET    /friends                       accepted friends, with presence
GET    /friends/requests              incoming + outgoing, pending
POST   /friends/requests              { username } — exact match
POST   /friends/requests/:id/accept
POST   /friends/requests/:id/decline
DELETE /friends/:userId               unfriend
POST   /friends/:userId/block
DELETE /friends/:userId/block

GET    /keys/user/:userId             public key. Friends (or self) only.

GET    /conversations                 list, with the other participant + last message
POST   /conversations/dm              { userId } — get-or-create, friends only
GET    /conversations/:id/messages    ?after=<messageId>&limit=  — the backlog
POST   /conversations/:id/messages    HTTP send, for when the socket is down
```

`/keys/user/:userId` is `backend-plan.md` step 5, scoped to what DMs need. It
returns `publicKey` and never a wrapped blob — the type in
`client/src/lib/api/types.ts` (`PublicDeviceDto`) already cannot express one.

### The enumeration trade-off, stated plainly

Everywhere else in this codebase a lookup returns a generic response so it
cannot be used to find out who has an account here. `POST /friends/requests`
breaks that: it has to say "no such user" or it is unusable.

That is a deliberate, narrow exception. A username is a handle people hand out;
an email address is not, which is why the auth design protects one and not the
other. Mitigations: exact match only (no prefix, no fuzzy), and a tight
per-account rate limit (~20/hour) rather than the per-IP one — a scraper with
one account gets 20 guesses an hour, not 20 per address they rent.

---

## Real-time

Socket.io attached to the existing Fastify HTTP server (`fastify.server`), same
process, same origin.

- **Auth**: the access JWT out of the cookie, then the same session-still-live
  check `plugins/auth.ts` does. Factor that check out so the socket handshake
  and `requireAuth` cannot drift apart.
- **Rooms**: one per userId. Delivery = emit to each participant's room, which
  covers the sender's other tabs for free.
- **Client → server**: `message:send` (with ack), `typing`.
- **Server → client**: `message:new`, `friend:request`, `friend:accepted`,
  `presence`.
- **Presence**: derived from live socket connections, visible to friends only.
  In-memory is fine for one box; it becomes wrong the day there are two.

Send path: validate the sender is a participant → validate the envelope
recipient set equals the participant set → write header + envelopes in one
transaction → ack `{ id, sentAt }` → emit to the other room. A duplicate
`clientId` returns the existing message instead of erroring, so a retry across a
flaky reconnect is one message.

---

## Client changes

**Contract first** (`lib/transport/types.ts`): `OutgoingMessage` grows
`envelopes: { recipientUserId, ciphertext }[]` in place of the single
`ciphertext`. `IncomingMessage` keeps one `ciphertext` — the one addressed to
you. This ripples into `outbox.ts` (it just carries the payload),
`chatController.send()`, `mockTransport.ts`, and their tests. Doing it before
anything else keeps it to one pass.

Then:

- `lib/transport/socketTransport.ts` — implements `Transport` over socket.io;
  backlog goes over HTTP. Map socket.io's connect/disconnect/reconnect onto
  `ConnectionState`.
- `lib/api/friends.ts`, `lib/api/conversations.ts` — typed wrappers in the
  existing `createXApi(client)` factory style.
- **Persist the outbox.** It defaults to `MemoryOutboxStorage` today, so a
  reload drops the queue — which defeats the point of having one. Back it with
  `secureStore`.
- `state/ChatProvider.tsx` — owns the `ChatController`, feeds it the identity
  from `keyManager` on unlock, drops it on lock. `chatController` and
  `chatStore` are already written and tested; nothing renders them yet.
- Friends UI: friends list, add-by-username, incoming/outgoing requests.
- `App.tsx`: fixtures out, real conversations in. `mockData.ts` survives only
  behind `VITE_BACKEND=mock`, which is the design-work escape hatch.
- The server rail renders `@me` only. Cipher HQ and The Lab go.

The fingerprint the UI already shows per user becomes real: `keyFingerprint()`
over the public key from `/keys/user/:userId`. It is meaningless until phase 2,
so it should be labelled as unverified rather than implying a check happened.

---

## Testing

Server, against real Postgres like the existing suite:

- friends: request, accept, decline, duplicate, self-request, request to someone
  who blocked you, unfriend, reciprocal-request auto-accept
- keys: a non-friend gets 403; the response never contains a wrapped blob
- conversations: `POST /conversations/dm` twice returns the same id; a non-friend
  cannot open one
- messages: idempotent on `clientId`; envelope set must match participants; a
  non-participant reading returns 403; cursor paging is correct across a
  same-millisecond pair
- socket: handshake rejects a missing/expired/revoked session

Client: `socketTransport` against a real socket.io server in-process; controller
and outbox tests updated for envelopes; friends screens.

`scripts/smoke.ts` grows a second account: register A and B, befriend, A sends,
assert B's backlog contains it and A's copy is there too. That is the
end-to-end proof, same as the account one.

---

## Hosting: Ubuntu mini PC

**Ingress — Cloudflare Tunnel, not port forwarding.** No inbound ports open, no
static IP, no dynamic DNS, works behind CGNAT, TLS terminated for you. A home
connection has none of the things a plain public IP setup assumes. If you have a
real public IP *and* router access and would rather not depend on Cloudflare,
the alternative is 80/443 forwarded to Caddy for automatic Let's Encrypt — say
so and I'll write that instead.

**One origin.** Caddy serves the client's static build and proxies `/api/*` and
`/socket.io/*` to Fastify on the same hostname. This is worth doing for a
specific reason: cookies stay first-party, CORS disappears, and `SameSite=Lax`
actually protects something. CSRF tokens are still unbuilt (`backend-plan.md`
step 6), so same-origin is currently carrying that weight.

**Runtime — Docker Compose**: `postgres:17`, the server, Caddy, and the
`cloudflared` tunnel. Docker works fine on Ubuntu; the BIOS problem is a
dev-machine constraint, not a server one. Postgres binds to the compose network
only, never `0.0.0.0`.

To build:

- `server/Dockerfile` (multi-stage; `prisma generate` at build, `migrate deploy`
  on start), `client/Dockerfile` or a build step that Caddy serves
- `docker-compose.prod.yml`, `Caddyfile`, `.env.production.example`
- `deploy.sh` — pull, build, migrate, restart. A script, not CI, until there is
  a reason for more.
- nightly `pg_dump` on a cron with retention, written somewhere that is not the
  same disk

**Production env**: `NODE_ENV=production`, `COOKIE_SECURE=true`,
`APP_URL=https://your-host`, a real `JWT_SECRET`, `MAIL_TRANSPORT=smtp`. The env
schema already refuses to boot if the first two are wrong, which is the point.

**Mail is a hard blocker, not a polish item.** Verification is required before
login, so if mail does not send, nobody can create an account — including you.
A residential IP cannot deliver mail directly (port 25 blocked, no reputation),
so this needs a transactional provider's SMTP relay. Resend, Mailgun, Brevo and
Postmark all have free tiers that cover this. Credentials go in
`.env.production`.

**Box hardening**: SSH keys only (`PasswordAuthentication no`), ufw denying
inbound except SSH from the LAN, `unattended-upgrades`, fail2ban. With a tunnel
there is nothing else to expose.

---

## Order of work

Each stage is one or two commits, scoped to one workspace where possible.

| # | Stage | Why here |
|---|---|---|
| 0 ✅ | Transport contract: envelopes | Touches both sides; doing it first stops a second rewrite |
| 1 ✅ | Prisma schema + migrations (both DBs) | Everything server-side blocks on it |
| 2 ✅ | Friends API + `/keys/user/:id` + tests | The graph gates conversations |
| 3 ✅ | Conversations + messages HTTP + tests | Works fully without a socket |
| 4 ✅ | Socket.io layer + tests | Now it is real-time |
| 5 ✅ | Client: socketTransport, API wrappers, outbox persistence | Plumbing, no UI yet |
| 6 ✅ | Client: ChatProvider, friends screens, de-mock `App.tsx` | The visible payoff |
| 7 ✅ | Two-account smoke test + docs (`STATUS.md`, both `AGENTS.md`, `server/README.md`) | Keeps the handoff docs true |
| 8 ⬜ | Hosting: Docker, Caddy, tunnel, deploy script, backups | Ship it |

Stages 2–4 are server-only and 5–6 are client-only, so they can be split between
two people if you want.

## What I need from you

- **A hostname.** A domain you own, or a Cloudflare Tunnel `*.trycloudflare.com`
  for now.
- **An SMTP provider + credentials**, per the blocker above.
- Whether the mini PC has a public IP and router access, if you would rather
  have Caddy + Let's Encrypt than a tunnel.

None of these block stages 0–7. They are only needed at stage 8.
