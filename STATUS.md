# STATUS: where this project actually is

Last updated **2026-09-07**, after two passes over the chat UI and one over
the account layer. The first UI pass brought nicknames, right-click actions on
a person, a password reveal on the auth screens and the removal of every
encryption badge. The second added the profile panel, rebuilt the Friends
screen as five tabs and finished the blocking story: a blocked list,
unblocking, re-adding afterwards, and taking back a request you sent. The
third pass is not UI at all: unread counts and read receipts, password reset
with the whole of `backend-plan.md` step 2 and CSRF, which is step 6. Three
of the four items this file listed as next steps are now done. All of it has
since been walked through by hand in a browser and works. The fourth pass is
voice calls, stages 1 to 4 of [`voice-plan.md`](voice-plan.md): signalling,
TURN credentials, a call engine and the UI for it, tested and then walked
through for real: a call between two browsers on the live site, and one on a
phone, both connected and carried audio. What is left is parked on purpose rather
than forgotten: the account endpoints behind settings and the backup cron on
the box.

This file is the "get up to speed without reading everything" document. It says
what works, what does not, and which decisions are load-bearing. Keep it
current: if you change what is true here, edit this file in the same commit.

**Read in this order:** [`AGENTS.md`](AGENTS.md) (the rules, non-negotiable) →
this file (the state) → the `AGENTS.md` in whichever directory you are touching.
[`stack.md`](stack.md) explains why the stack is what it is;
[`backend-plan.md`](backend-plan.md) is the account/auth plan, still broadly
accurate but see *Deviations* below.

---

## In one paragraph

An end-to-end-encrypted chat app, npm workspace, three live packages
(`client/`, `server/`, `packages/crypto/`) plus an empty `desktop/`. **Accounts
and auth work end to end**: register, verify by email, sign in, unlock, lock,
sign out, with real key custody: the account keypair is generated on the
device and the server never receives a password, a recovery code, or a private
key. **DM messaging works end to end too**: add a friend by exact username,
they accept, you get a conversation with live delivery over Socket.io, an
offline queue, a backlog on reconnect and unread counts that clear when you
actually look at the conversation. **Losing a password is no longer losing the
account**: a reset link plus the recovery code rebuilds it with the identity
intact, and the alternative branch discards the identity knowingly rather than
by accident. **Encryption is still deliberately
phase 1**, meaning `encryptMessage`/`decryptMessage` are base64 no-ops, so the
server can currently read message bodies. The UI no longer says anything about
this either way: the SEALED pill, the key fingerprints and the ciphertext
toggle were all removed on 2026-09-07, because a badge claiming a property the
code does not have yet is worse than no badge. Group servers/channels do not
exist; DMs only. **It is deployed and reachable** at
<https://cipher.findiepman.dev>, on Docker Compose on the Ubuntu mini PC, one
origin behind a Cloudflare Tunnel, mail through Resend. Registration,
verification-by-email and messaging have all been driven by hand against the
live box.

Two independent numbering schemes are in play and they are unrelated: *phase
1/2* is the messaging-encryption axis (`AGENTS.md`), *steps 0 to 6* are the
account-work axis (`backend-plan.md`).

---

## What works, verified

| Capability | Where |
|---|---|
| Register → recovery code → verify email → sign in | `client/src/screens/`, `server/src/modules/auth/` |
| Unlock / lock / sign out, session restored across reloads | `client/src/state/SessionProvider.tsx` |
| A reload staying unlocked, without the password, for 30 idle days | `client/src/lib/session/keyManager.ts`, `packages/crypto/src/deviceKey.ts` |
| Keypair generation, Argon2id key wrapping, recovery codes, fingerprints | `packages/crypto/src/` |
| Refresh-token rotation with reuse detection | `server/src/modules/auth/sessions.ts` |
| Account lockout, generic responses that resist enumeration | `server/src/modules/auth/service.ts` |
| Friend requests by exact username, accept/decline, unfriend, block | `server/src/modules/friends/` |
| Nicknames: your own private label for a friend | `server/src/modules/friends/service.ts`, `client/src/components/PersonMenu.tsx` |
| Right-click a person for profile / message / nickname / unfriend / block | `client/src/components/PersonMenu.tsx` |
| The profile card, beside a conversation | `client/src/components/UserProfile.tsx` |
| Friends screen as five tabs: all, add, sent, received, blocked | `client/src/screens/FriendsScreen.tsx` |
| Blocked list, unblock, and re-adding afterwards | `server/src/modules/friends/service.ts` |
| Cancelling a request you sent | `POST /friends/requests/:id/cancel` |
| Username word filter on registration | `server/src/lib/usernameFilter.ts` |
| Password reveal toggle on sign in, create account and unlock | `client/src/components/PasswordField.tsx` |
| Public-key registry, gated on friendship | `server/src/modules/keys/routes.ts` |
| DM conversations, message history, cursor paging | `server/src/modules/conversations/` |
| Live delivery, presence, typing, over Socket.io | `server/src/realtime/index.ts` |
| Unread counts and read receipts, over the socket or HTTP | `server/src/modules/conversations/service.ts`, `client/src/state/chatStore.ts` |
| Settings, seven sections, opened from the gear or Ctrl+, | `client/src/screens/settings/` |
| A 404 for any address outside a known set | `client/src/screens/NotFoundScreen.tsx` |
| Password reset by email: keep the identity, or discard it | `server/src/modules/auth/service.ts`, `client/src/screens/ResetPasswordScreen.tsx` |
| Change password, rotate the recovery code | `server/src/modules/account/credentials.ts` |
| CSRF double submit on every state-changing request | `server/src/plugins/csrf.ts` |
| Optimistic send, offline queue, reconnect backlog | `client/src/state/`, `client/src/lib/transport/` |
| The chat UI itself: friends screen, DM list, composer | `client/src/App.tsx`, `client/src/screens/FriendsScreen.tsx` |
| Transactional email, text + HTML, over a real relay | `server/src/lib/mailer.ts` |
| Voice calls: ring, answer, decline, busy, hangup, expiry, relayed over the socket | `server/src/realtime/calls.ts`, `server/src/modules/calls/` |
| Short-lived TURN credentials from Cloudflare, STUN only without a key | `GET /calls/ice`, `server/src/modules/calls/ice.ts` |
| The call engine: perfect negotiation, mute, voice gate, push to talk | `client/src/lib/call/engine.ts` |
| Incoming call toast, in-call bar, call state in the DM header | `client/src/components/CallPanel.tsx`, `client/src/state/CallProvider.tsx` |
| Same-origin client build (blank `VITE_API_URL`) | `client/src/lib/config.ts` |
| Deployed: 4 containers, no host ports, Cloudflare Tunnel | `deploy/` |
| Live registration + verification email landing in an inbox | verified by hand 2026-09-07 |

458 tests pass: 34 crypto, 206 client, 218 server. `npm run typecheck` and
`npm run build` are clean across all workspaces.

**The UI has been driven by hand in a browser, and it works.** That is worth
stating separately from the tests. Adding a friend and exchanging messages were
walked through on 2026-09-06, and everything the 2026-09-07 passes added was
walked through the same day: the right-click menu, nicknames, the profile
panel, the five Friends tabs, unread badges clearing across two tabs and a
reset link followed out of the mailbox. The suites and the smoke scripts still
only cover the protocol, and the only component tests are for the two pieces
most likely to break silently (`components/ContextMenu.test.tsx`,
`components/PasswordField.test.tsx`), so anything you change in
`client/src/state/ChatProvider.tsx` or the screens wants a human to look at it
again.

**Voice calls have been placed for real.** The signalling has 42 server tests
over a real socket and the engine has 36 over a fake RTCPeerConnection, and on
2026-09-07 a call was walked through on the live site between two browsers and
again from a phone: both connected, both carried audio, with quality reported
as a little below Discord's. Two things a phone showed: WebRTC plays through
the loudspeaker by default, and no phone browser lets a page pick the
earpiece except Chrome on Android, so the earpiece toggle in the call bar
appears only where that works. The profile button also did nothing on a phone,
because the profile column was simply hidden below 1100px; it opens as a sheet
there now.

**Settings is a screen in front of endpoints that do not exist.** Seven
sections render and three of them work end to end (Appearance, Voice & video,
Notifications, all of which are local). Of the rest, `change-password` and
`recovery-code` are real; **`PATCH /account/me`, `POST /account/change-email`,
`GET|DELETE /account/sessions` and `DELETE /account` are not implemented**, so
those controls call endpoints that 404. That is a known state and it is being
left for later on purpose, not an oversight. See *Reasonable next steps*.

Every endpoint behind the 2026-09-07 work is covered too (`nicknames.test.ts`,
`blocking.test.ts`, `readState.test.ts`, `passwordReset.test.ts`,
`csrf.test.ts`).

**The device-key unlock has been confirmed in a real browser.** Its unit tests
run against in-memory stores, so what they proved was the logic, not that
Chrome would structured-clone a non-extractable key into IndexedDB. It does: a
reload of a signed-in tab comes back authenticated without asking for the
password. `IndexedDbDeviceKeyStore` still falls back to the prompt if a browser
ever refuses, so that path is the untested one now.

Two end-to-end proofs, both against a running server over real HTTP:

- `cd server && npm run smoke`: the account lifecycle. Asserts the private key
  it generated comes back out of the server's blob unchanged.
- `cd server && npm run smoke:messaging`: two accounts befriend each other,
  open a DM, send over a websocket, receive live, and page the backlog. Its
  last assertion is the one the envelope model exists for: **the sender can
  read their own message back off the server.**

## What is not built

- **Group servers and channels.** DMs only. The message tables are generic
  enough for groups (a `Conversation` with N participants), but the key model
  is not chosen, see `packages/crypto/AGENTS.md`. The UI's server rail is
  gone; there is a Direct view and a Friends view.
- **A profile for yourself.** `UserProfile` renders other people. Your own
  account has no card, no avatar upload and no status line; the account strip
  is still the whole of it.
- **Blocking somebody you have never met.** The API takes any user id, but the
  only way into the UI is a right-click on a person already on screen, and a
  stranger is not on screen. In practice you unfriend or decline instead.
- **Message editing, deletion, attachments, search.** None of it. Read
  receipts have landed, so `lastReadMessageId` is written now and the DM list
  carries unread counts, but a message once sent cannot be changed or taken
  back by either side.
- **No notification email when credentials change.** A password change or a
  recovery-code rotation is silent, so the legitimate owner of an account
  learns about a hostile one only by being signed out. `app.ts` registers
  `accountRoutes` without a mailer, which is the only reason: pass one in and
  `modules/account/credentials.ts` has the hooks.
- **Backups are not scheduled.** `deploy/backup.sh` and `restore.sh` exist and
  `deploy.sh` calls the former before every deploy, but **no cron entry is
  installed on the box**, so nothing runs nightly. Until it is, the only dumps
  that exist are the ones a deploy happened to write, they sit on the same disk
  as the volume they protect, and every run prunes anything older than 14 days.
  One bad disk still loses everything. The tooling is ready and untried:
  `deploy/setup-backups.sh <dir>` does the whole thing in one command, and
  `./restore.sh --rehearse <dump>` reads a dump back into a scratch database
  without touching the live one. Both are unrun against the box. `DEPLOY.md` §6.
- **Registration is open to anyone who finds the URL.** There is no invite
  system, the hostname is public DNS, and the repository is public. Email
  verification and the rate limits are the only friction. `DEPLOY.md`
  → *Restricting who can register* has the Cloudflare Access recipe if that
  should change.
- **The account endpoints the settings screen is already written against.**
  That screen now exists, which inverts the old problem: the UI is ahead of
  the server rather than behind it. `POST /account/change-password` and
  `POST /account/recovery-code` work and are wired. Still 404 today:
  `PATCH /account/me`, `/account/change-email[/confirm]`,
  `GET|DELETE /account/sessions[/:id]`, `DELETE /account`, all of `/admin/*`.
  (`POST /keys/device` and `DELETE /keys/device/:id` do not exist either.) The
  client half of each already exists in `authService.ts` and is bound to a
  button, so four controls in settings call an endpoint that is not there. The
  sessions pair matters most: it is the only per-session revocation there will
  ever be short of rotating `JWT_SECRET` and signing out every account on the
  box.
- **Call records, video, and binding the call to the identity key.** Voice
  calls work but leave no trace: a missed call is a four-second notice and then
  nothing, because nothing about a call touches the schema yet
  ([`voice-plan.md`](voice-plan.md) stage 5). Video is deferred with the
  camera settings already stored (stage 6). And the DTLS fingerprint in the
  SDP is not yet bound to the account keypair, so a hostile server could sit
  in the middle of a call's setup; that is the standard WebRTC threat model
  and it is phase 2 work (stage 6 too). The UI says nothing about any of this,
  per decision 21.
- **A TURN key on the box.** `TURN_KEY_ID` and `TURN_KEY_API_TOKEN` are not
  yet in `deploy/.env`, so the deployed server hands out STUN only and a call
  between two home networks will not connect. `DEPLOY.md` → *Voice calls* has
  the two steps.
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
   `client/src/lib/session/passwordPolicy.ts` and is *advisory only*, and a hostile
   client can ignore it. This is a genuine weakening accepted knowingly; don't
   "fix" it by asking for the password.
3. **Login is by email, never username.** The auth salt derives from the email,
   so a client holding only a handle cannot compute an authHash, and accepting
   one would mean telling an anonymous caller which address is behind a username.
4. **One device per account.** `Device` holds the keypair; login returns the
   caller's own device inline so the key can be unwrapped without a second round
   trip. Multi-device is deliberately deferred (`packages/crypto/AGENTS.md`), because
   it changes the key model significantly.
5. **A reload does not ask for the password, a device key does.** Every unlock
   also seals the private key under an AES-GCM key created with
   `extractable: false` and kept in IndexedDB (blob_C,
   `packages/crypto/src/deviceKey.ts`), so `KeyManager.restore()` reopens it and
   a reload lands on `authenticated` rather than `locked`. The record expires 30
   idle days after its last use, and **Lock** destroys both the record and the
   key, which is the only thing keeping Lock meaningful. Two things this must
   not become: an extractable key (blob_C would then be a raw private key in
   IndexedDB wearing a costume), or a `SecureStore` entry (that interface is
   strings, and being unserializable is the property being bought). It does not
   defend against script running on the origin, which can use the key without
   ever reading it. It was still worth it: a password prompt on every reload
   pushes people towards short passwords.
6. **`packages/crypto` is the only caller of libsodium.** `server/` depends on
   it as a **devDependency only**, used by `scripts/smoke.ts`, which acts as a
   client. Server runtime code must never import it for anything that decrypts.
7. **Phase 1 message envelope is `{ v: 1, alg: 'none', nonce: null, body }`**
   with a base64 body. Readers dispatch on `alg`, so phase 2 messages can
   coexist with phase 1 ones during a rollout. The client's tests construct this
   envelope by hand, so change one side and you must change the other.
8. **A message is a header plus one sealed envelope per participant**, the
   author included (`Message` + `MessageEnvelope`). `crypto_box` seals to
   exactly one recipient, so a message sealed for the person you are talking to
   cannot be opened by you. Without a self-addressed copy, a sender on a fresh
   device would find their own history unreadable. Phase 1 puts the same
   `alg: 'none'` blob in every envelope, so this costs a row per participant
   today and saves a migration later. The server validates that the recipient
   set equals the participant set and hands each caller only their own copy.
9. **Friendship is the authorization gate** for the key registry and for
   opening a conversation. Unfriending stops new messages but leaves the
   history readable: it withdraws the ability to add to a conversation, not a
   request to destroy what was said.
10. **`POST /friends/requests` answers honestly whether a username exists**,
   which is the one place this codebase does. A friend request that cannot say
   "no such user" is unusable, and a username is a handle people hand out where
   an email address is not. It is narrowed instead: exact match only, and a
   per-*account* hourly budget (20, counted from the audit log so failures
   count too) rather than a per-IP one.
11. **Message order is an autoincrement `seq`, not `sentAt`.** Several sends
    land in the same millisecond and a timestamp cannot break that tie. Cursors
    are message ids, because the server cannot say what is new in a
    conversation it cannot read.
12. **The app mark is one file and one component.** `client/public/logo.png`
    backs the favicon, the apple-touch icon, the manifest and every in-app use
    via `components/BrandMark.tsx`. Don't add a second copy of the logo or
    inline an `<img src="/logo.png">`. The point is that swapping the file
    changes it everywhere. The old `KeyholeIcon` glyph was deleted for the same
    reason.
13. **`@cipher/crypto` resolves to TypeScript source** (`exports` → `./src/index.ts`),
   the "internal packages" pattern. No build step; Vite and Vitest transpile it.
14. **A nickname is stored on the server, in the clear.** `ContactNickname` is
    one directional row per (owner, subject) pair, and only the owner ever
    reads it. Storing it on the device instead would have told the server
    nothing, and that option was considered and rejected: a nickname that
    disappears when you clear site data is not a nickname. The cost is real and
    worth stating plainly, so it is stated in the schema comment too. It does
    not touch the rule in `server/AGENTS.md`, which is about message bodies.
15. **The username filter lives only on the server.** A copy in the client
    would give instant feedback and would also ship the blocklist to every
    visitor, which is both a document nobody wants to read and a map of exactly
    what to work around. The client renders the field-level message the server
    sends back instead, which is why `ErrorNote` in `AuthScreen.tsx` now
    unpacks `error.details`.
16. **Two lists in the filter, and the second one is the important one.**
    `SUBSTRING_TERMS` matches anywhere; `WHOLE_TERMS` matches only when the
    entire handle reduces to it, because every entry there lives inside an
    innocent word ("therapist", "torpedo", "pakistani", "raccoon", "mustard").
    Moving a term between the lists is how this feature starts refusing real
    people, so `tests/usernameFilter.test.ts` asserts those words specifically.
17. **A blocked list answers "who have I blocked" and nothing else.** There is
    no endpoint for "who has blocked me" and there should not be: that list is
    useful to exactly one person, and it is the one working around it.
    `listBlocked` filters on `blockedById`, not on the status alone, so a row
    where the other party did the blocking is invisible.
18. **Cancelling and declining are different endpoints on purpose.**
    `respondToRequest` refuses the requester, because the person who asked
    cannot also answer; without that, someone could accept a friendship
    one-sidedly. Withdrawing is a separate act available only to the asker, so
    it is `POST /friends/requests/:id/cancel`. Each side sees the other's move
    as a 404 rather than a 403, because a 403 would confirm that a given id is
    a live request between two other people.
19. **Unblocking deletes the row rather than restoring what was there.**
    Afterwards the two of you are strangers, not friends again, and either can
    send a request. Restoring a friendship somebody had already ended by
    blocking would be the wrong default, and the Blocked tab says so in words
    when a block is lifted.
20. **The profile panel is two pieces of state, not one id.** `hidden` is a
    preference that survives changing conversation; `pinnedUserId` is an
    override from "view profile" that does not. One id cannot express both: the
    panel would reopen every time you switched DM, or a pinned profile would be
    silently replaced on the next render.
21. **The UI makes no claim about encryption.** No SEALED pill, no key
    fingerprint beside a name, no "the server only ever held the blob". If
    phase 2 lands and someone wants to surface it again, it should be one
    considered screen (an out-of-band verification flow), not a badge on every
    row.
22. **Read marking only ever moves forward, and counts come from `seq`.**
    `markRead` leaves the stored position alone when handed an older marker,
    and `readUpTo` in `chatStore` only ever lowers a count. Two tabs race
    constantly and a late retry is normal, so without both rules a message
    somebody has already seen comes back unread. Counting from `seq` rather
    than `sentAt` is decision 11 applied: several sends land in the same
    millisecond. A message id from another conversation is a 404 rather than a
    no-op, because `seq` is global and a borrowed id would silently mark an
    arbitrary slice of this conversation read.
23. **The CSRF cookie is deliberately not `httpOnly`, and a request with no
    cookies at all skips the check.** The first is what double submit means: a
    cookie the page cannot read is a cookie it cannot echo into a header. The
    second is the load-bearing one. Under `SameSite=Lax` a cross-site POST
    carries no cookies, so a request arriving without them has no ambient
    authority to spend, and a bearer caller had to hold its own credential.
    That is also what lets the test suites, the desktop shell and the smoke
    scripts keep working untouched. If `SameSite` is ever loosened, re-read
    this: the skip is safe only because Lax makes it unreachable from a
    cross-site form.
25. **A refused call rides the ack; a call that existed ends with one event.**
    Busy, not friends, malformed: the caller hears the code in the ack to
    `call:offer` and nothing is broadcast, because no call was registered.
    Everything that ends a call that did exist is `call:ended` with a reason,
    to every tab on both sides. Two shapes rather than a refusal event per
    cause, so the client has one place to learn that a call is over.
26. **Each side of a call is owned by a socket, not a user.** One account in
    several tabs is normal here (the key is in IndexedDB per origin), so every
    tab of the callee rings, and `call:claimed` to the callee's own room is
    what silences the ones that did not answer. Only the socket that answered
    is a party. Closing one of the others does nothing; closing the one in the
    call ends it for both, with `disconnected`. Without this, either a caller
    closing their tab leaves a phone ringing, or a callee closing a spare tab
    hangs up a call it was never in.
27. **The server ends a call the moment a party's socket is gone, and the
    client agrees when its own socket drops.** The media is peer to peer and
    would survive a short blip; the call state would not, and two people left
    "busy" forever is worse than a dropped call. A grace period is the fix if
    it bites, see `voice-plan.md` → *Traps*.
28. **A session description travels in the message envelope.** The SDP
    carries the DTLS fingerprint the call's security rests on, so the client
    seals it with `encryptMessage` to the peer's registry key
    (`client/src/lib/call/sealing.ts`) and the server relays a string it may
    not read. In phase 1 that is a base64 no-op and protects nothing, which
    the plan says out loud; the point is that phase 2 makes the server unable
    to rewrite an offer in the same commit it becomes unable to read a
    message. `sealing.ts` is therefore the second and last caller of the
    crypto seam in the frontend, beside `chatController.ts`. ICE candidates are
    not sealed: they are addresses, and a relay sees them regardless.
24. **The reset context endpoint is a POST, and it does not spend the token.**
    A GET would put a live credential in a query string, which is the part of
    a request that reliably reaches access logs and browser history. Not
    spending the token is what lets a mistyped recovery code be retried, and
    it costs nothing to hand the wrapped key out: blob_B is sealed under a
    recovery code the server has never seen. So what an attacker holding the
    inbox gets is the account, not the messages, and their only path to the
    identity is offline work against that blob. This is the argument for the
    recovery code staying a key rather than becoming a PIN.

## Deviations from `backend-plan.md`

That document is still the plan. These five details are out of date in it:

| Plan says | Reality |
|---|---|
| `User.passwordHash` | `User.authVerifier`, argon2id of the *authHash*, not of a password |
| A separate `RecoveryCode` table | `User.recoveryCodeHash`, a single column. v1 has one live code at a time |
| `POST /auth/resend-verify` | `POST /auth/resend-verification` |
| "Minimum 12 chars, weak-password rejection" under Auth mechanics | Client-side only now, see decision 2 |
| Step 2 lists two reset endpoints | There are three. `POST /auth/reset-password/context` is not in the plan and the recovery-code flow cannot work without it, see decision 24 |

Step 1 is done. Step 5 (device registry) is mostly done: the `Device` table,
the login-time hand-back and `GET /keys/user/:userId` exist; device
registration and revocation endpoints do not (there is one device per account,
created at signup).

[`messaging-plan.md`](messaging-plan.md) is the plan for the messaging half.
Stages 0 to 7 of it are done; stage 8 (self-hosting) is not.

---

## Where it runs

Live at <https://cipher.findiepman.dev>, on the Ubuntu mini PC (`fin-server`).
[`DEPLOY.md`](DEPLOY.md) is the runbook; this is just the shape of it.

Four containers under the compose project `cipher`, and **no published host
ports at all**: `cloudflared` dials out, so there is no inbound firewall rule
and nothing collides with the other services on that box. Caddy serves the
built client and proxies the API prefixes and `/socket.io` to Fastify on one
hostname, which is what keeps the auth cookies first-party.

```bash
cd ~/cipher && ./deploy/deploy.sh          # pull, build, migrate, restart
docker compose -f deploy/docker-compose.prod.yml logs -f server
```

Secrets live only in `deploy/.env` on the box (gitignored, and no `.env` has
ever been committed, and the repository is public). Migrations are applied by the
server container's entrypoint, not by `deploy.sh`, so the schema is always
applied by the exact image about to serve it.

**Rotating `JWT_SECRET` signs everyone out.** That is the only way to revoke
every session at once; there is no admin UI.

## Running it

```bash
npm install            # from the repo root; one lockfile, three workspaces
npm run dev:server     # :3000, needs Postgres + server/.env
npm run dev            # :5173
```

Then create an account at http://localhost:5173. **The verification link is
printed in the server console**, because `MAIL_TRANSPORT=file` writes emails to
`server/.mail/` instead of sending them.

To try messaging you need two accounts, and both have to be verified. Sign in
as one, add the other by its exact username under **Friends**, accept from the
other side, then **Message** them. A second browser profile (or a private
window) is the easiest way to hold both sessions at once: the identity key
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
  line 1, see `client/src/screens/VerifyEmailScreen.test.tsx`. Setting it
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
  one is not migrated by `prisma migrate dev`, so run
  `DATABASE_URL=…messenger_test npx prisma migrate deploy` as well, or the whole
  server suite fails on a missing table.
- **`prisma migrate dev` cannot run non-interactively here.** Use
  `--create-only`, hand-edit the SQL, then `migrate deploy`.
- **`prisma migrate dev --create-only` timestamps in UTC**, which on this
  machine is behind local time, so a fresh migration can sort *before* one
  already applied. Check the directory name against the existing ones and
  rename it if it does not sort last.
- **The username unique index is case-sensitive, but friend lookup is not.**
  Registration would let `nova` and `Nova` both exist; if they ever did, one of
  them would be unreachable by handle. Not worth a migration until someone
  actually collides, but that is the reason.
- **The `cipher` IndexedDB is at version 2, and only `lib/storage/idb.ts` may
  open it.** `indexedDB.open` takes a version per database, not per store, so a
  second module opening `cipher` at a different version deadlocks: the
  connection held at the older version blocks the upgrade the newer one waits
  on, and neither call ever settles. Add a store by bumping `DB_VERSION` there
  and creating it in the one upgrade handler.
- **Presence is per-process**, held in a `Map` in `realtime/index.ts`. Correct
  on one box, wrong the day there are two.
- **Random test handles can trip the word filter.** `tests/helpers.ts` builds
  usernames from random hex, the filter maps digits onto letters (4 to a, 6 and
  9 to g, 0 to o), and the reachable alphabet can spell a real blocked term by
  accident roughly once every twenty full runs. `newUser` screens its own
  handle and regenerates rather than leaving that to chance. `scripts/smoke.ts`
  does not; if it ever fails at registration with "not available", rerun it.
- **A menu that dismisses on capture-phase `pointerdown` eats its own clicks.**
  React attaches handlers at the root in the bubble phase, so a window capture
  listener fires first and unmounts the menu before any item's `onClick` runs.
  `ContextMenu.tsx` checks `menuRef.current.contains(event.target)` instead of
  relying on `stopPropagation`, which cannot work across those two systems.
  `ContextMenu.test.tsx` fires `pointerDown` *and* `click`, because firing only
  `click` passes against the broken version.
- **A socket outlives its 15-minute access token.** The session behind it is
  re-checked before every send and on a 60s sweep, so a revoked session can
  keep *receiving* for up to a minute. That window is the price of not
  coupling the auth routes to the socket layer.
- **Accounts created before 2026-09-06 cannot sign in.** Their stored hash came
  from a different input and they have no `Device` row. Re-register.
- **Docker is unavailable on the dev machine** (SVM disabled in BIOS), so
  Postgres runs natively and Mailpit is not an option. See `server/README.md`.
- **The production client build is same-origin, and that is a blank
  `VITE_API_URL`, not an unset one.** Blank means "use relative paths"; unset
  falls back to `http://localhost:3000` and the deployed app would quietly talk
  to the user's own machine. `client/Dockerfile` sets it; don't "tidy" it away.
- **`prisma` is a runtime dependency of `server/`, not a dev one.** The
  container runs `prisma migrate deploy` on start, so it has to survive
  `npm prune --omit=dev`. Moving it back breaks the image and only at boot.
- **Caddy proxies the API at its real prefixes**, listed one by one in
  `deploy/Caddyfile`. Adding a server module means adding it there too, or it
  404s in production while working perfectly in development. The API is not
  under `/api` because the refresh cookie is scoped to `Path=/auth`.
- **`prisma generate` needs `tsconfig.json` present, or it emits `.ts` import
  specifiers.** The prisma-client generator reads tsconfig to decide how to
  write relative imports. Without one it writes `from './enums.ts'`, `tsc`
  copies that specifier through untouched, and `node dist/index.js` dies with
  ERR_MODULE_NOT_FOUND, *after* migrations have applied. It is invisible in
  development because `tsx` and vitest both resolve `.ts` happily; only the
  compiled output cares. `server/Dockerfile` therefore regenerates after
  copying the full source, and asserts `dist/` contains no `.ts` specifiers.
- **`npm run build` passing does not mean the server runs.** Nothing in the
  test suite or the build ever executed `node dist/index.js` until the first
  deploy, which is how the above shipped. If you change module resolution,
  the generator, or the build, run the compiled entrypoint once.
- **The lockfile is Windows-only, and Docker builds on Linux.** `npm ci`
  installs exactly what `package-lock.json` lists, and a lockfile generated on
  Windows records only `win32` builds of every native package (npm/cli#4828).
  Three packages are affected: rollup and esbuild (vite fails loudly at build
  time) and **`@node-rs/argon2`, which fails at run time and not immediately**
  The image builds, the server starts, `/health/ready` passes because it only
  touches the database, and the first symptom is that nobody can register or
  log in. Both Dockerfiles install the right binary explicitly, deriving the
  version from the installed parent and the platform from `uname -m`. If you
  add another native dependency, it needs the same treatment. In `server/`
  that step must come **after** `npm prune`, which deletes anything missing
  from `package.json`.
- **A cookie-bearing POST to an unrouted path now returns 403, not 405.**
  Fastify runs `onRequest` hooks for the not-found handler too, so the CSRF
  check fires before `app.ts`'s handler can produce its friendly "use POST
  instead" message. Kept that way deliberately, since rejecting leaks less
  about which routes exist, and the 405 nicety mainly served address-bar GETs,
  which are a safe method and unaffected. If you ever want it back it is one
  condition on whether a route matched.
- **`POST /conversations/:id/read` does not broadcast, only the socket does.**
  The HTTP route has no handle on the socket layer without an `announceRead?`
  option threaded through `app.ts` and `index.ts` the way `deliver` already is.
  It self-corrects, because a client with no socket has no live tab to notify
  and reloads the list soon enough, but two tabs where one is on the HTTP
  fallback will disagree for a while.
- **The server suite TRUNCATEs every table between cases and shares one
  database**, with `fileParallelism: false`. So two test runs at once corrupt
  each other, which matters the moment more than one person or agent is
  working in the same checkout. `tests/setup.ts` honours `TEST_DATABASE_URL`
  and refuses any name that does not identify itself as a test database, so
  the fix is a database each: create one, `prisma migrate deploy` against it
  and pass it per run.
- **An empty `Permissions-Policy` allowlist is off for your own origin too.**
  `deploy/Caddyfile` shipped `camera=(), microphone=()`, which is not "same
  origin only" but "nowhere at all", so `getUserMedia` rejected with
  `NotAllowedError` and the mic test and camera preview in settings never
  worked on the deployed site. Fixed to `(self)` on 2026-09-07. The reason it
  survived a click-through is that the Vite dev server sends no
  `Permissions-Policy` at all, so media behaves differently in development
  than in production and only the deployed site can prove it.
- **CSP does not restrict WebRTC.** `connect-src 'self'` in the Caddyfile does
  not apply to `RTCPeerConnection`: ICE, STUN and TURN bypass CSP in every
  shipping browser. Nothing needs changing for calls to work, and nothing in
  that header is protecting the media path either.
- **The callee must not call `setLocalDescription` for its answer before the
  track is attached, and must not attach the track before the remote offer is
  set.** In `have-remote-offer` state, `addTrack` reuses the transceiver the
  offer created and does not fire `negotiationneeded`; in `stable` state it
  creates a new one and does, which sends a second offer and produces glare
  against the very call being answered. `engine.ts` orders it remote offer,
  track, local answer, and the engine test asserts exactly one description
  leaves the callee.
- **Cloudflare returns `iceServers` as one object, not an array.** All the
  URLs under a single username and credential. The browser wants an array, so
  `ice.ts` wraps it and accepts both shapes in case that changes.
- **An input volume slider is a Web Audio graph, not a track property.**
  WebRTC has no gain on a `MediaStreamTrack`. The engine always routes the mic
  through a `GainNode`, even at 100%, so moving the slider mid-call does not
  mean replacing the track under the connection. If audio is ever silent on a
  call with the mic test working, check the `AudioContext` is not suspended.
- **The production env file must be named `deploy/.env`.** Compose reads that
  name automatically for both `${...}` substitution and the server's
  environment. Any other name needs `--env-file` on every command, and
  forgetting it silently substitutes empty strings rather than failing.

---

## Reasonable next steps

Pick one; they are roughly independent. The first two are deliberately parked:
they are known, planned and not being done yet.

1. **Finish the account endpoints behind settings.** [`settings-plan.md`](settings-plan.md)
   is the plan for this, section by section, with the traps written down.
   The short version: in this order, because
   each is worth something on its own: `GET|DELETE /account/sessions[/:id]`
   (Devices & keys already lists them and the `Session` table already has
   `deviceLabel`, `ip`, `userAgent` and `lastUsedAt`), then `PATCH /account/me`
   (username changes have to run the word filter, so reuse
   `newUsernameSchema`), then `POST /account/change-email[/confirm]` (the
   `EmailToken` model already has `EMAIL_CHANGE` and a `newEmail` column for
   exactly this), then `DELETE /account`. Until they land, four controls in
   settings call endpoints that 404.
2. **Run `deploy/setup-backups.sh` on the box.** One command, and it is the
   last unfinished piece of the deployment: it checks the target disk, takes a
   dump, rehearses restoring it, and installs the cron entry only if all three
   worked. Parked for now, but note what parking it costs: it is the only
   outstanding item where the price of leaving it is losing everything.
3. **Call records.** Calls work; a missed one leaves no trace. Stage 5 of
   [`voice-plan.md`](voice-plan.md) is the first thing in it that touches the
   schema, and the plan leans towards a separate `Call` table over a message
   variant. Check the TURN key is in `deploy/.env` on the box first if calls
   across two networks ever fail (`DEPLOY.md` → *Voice calls*).
4. **Phase 2 encryption.** DMs now work end to end in phase 1, which
   `AGENTS.md` names as the precondition. The registry and the envelope model
   are already in place, so this is `encryptMessage`/`decryptMessage` plus the
   line in `packages/crypto/AGENTS.md`: no schema change, no data migration.
5. **Fold the four credential audit actions into `lib/audit.ts`.** Small and
   nagging: `recordCredentialAudit` in `modules/auth/service.ts` names
   `auth.reset_requested`, `auth.reset_completed`, `auth.password_changed` and
   `auth.recovery_code_rotated` locally and widens the type at one call site,
   because `audit.ts` was being edited by somebody else at the time. Add them
   to the `AuditAction` union and delete the helper.

Do not start with group encryption, see `packages/crypto/AGENTS.md`.
