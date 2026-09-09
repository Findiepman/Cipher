# settings-plan.md

The settings screen exists. This was the plan for the half of it that did not
work yet. As of 2026-09-09 the server half is built: profile sharing, the
sessions list and its revocation, the email change, and account deletion. The
section-by-section notes below are kept as the record of what was decided and
what the traps were; the table says what is now real.

Read [`STATUS.md`](STATUS.md) first for where the project is; this file is only
about settings. It follows the same convention as
[`backend-plan.md`](backend-plan.md) and [`messaging-plan.md`](messaging-plan.md):
a plan that gets edited as it is executed, not a record of what was decided.

---

## The situation in one paragraph

`client/src/screens/settings/` renders seven sections and every control in them
is wired to something. For three sections that something is local and they work
end to end. For the other four it is an endpoint, and **four of those endpoints
do not exist**, so those controls fail with a 404 rather than doing nothing
visible. This is the inverse of the usual problem in this repo: the UI is ahead
of the server, not behind it. Closing the gap is mostly server work against
tables that already have the columns.

## Section by section, what is real

| Section | State | What it needs |
|---|---|---|
| Language | **Works.** English and Nederlands, or follow the browser. Dates, times and numbers follow it too. Device-local, and the server is never told. See [i18n-plan.md](i18n-plan.md). | Nothing |
| Appearance | **Works.** Theme, palette, activity bar placement, density, motion, message scale, all local. | Nothing |
| Voice & video | **Works**, but only since the `Permissions-Policy` fix of 2026-09-07: the deployed header forbade the microphone outright, so the meter and the preview did nothing in production. | Nothing until there are calls to configure, which is [`voice-plan.md`](voice-plan.md) |
| Notifications | **Works.** Permission prompt, previews off by default. | Nothing |
| Profile | **Works, and now shared.** Display name, avatar, banner, accent, presence, about, saved under names you choose (`lib/settings/savedProfiles.ts`, max 10). The shared half goes to the account through `PATCH /account/me`, debounced, and friends read it off the friend list and `GET /users/:id/profile`. | Nothing; the card could preload the banner |
| My account | **Done.** `change-password`, `change-email[/context/confirm]` and `DELETE /account` all work. | Nothing |
| Devices & keys | **Done.** Security number and recovery-code rotation work locally; `GET|DELETE /account/sessions[/:id]` list and revoke, by family, dropping the socket. | Nothing |
| Vault | **Works, on this device.** Change the passkey (costs the account password), or forget the vault. Stage 1 of [`vault-plan.md`](vault-plan.md). | `POST /conversations/vault` before it follows you anywhere else |
| Privacy | **Two of the toggles now bite.** Read receipts is enforced on the server, typing indicators by the sender simply not emitting, and the reach control is now "who can send a friend request" with three policies the server checks. The link-previews row is gone: no feature fetched one, so a toggle for it was a promise about nothing. | Nothing |

## The work, in the order worth doing it

### 1. Sessions: `GET /account/sessions`, `DELETE /account/sessions/:id`

Do this first. It is the smallest, it is the only per-session revocation that
will ever exist short of rotating `JWT_SECRET` and signing out every account on
the box, and the UI for it is already written and already listing.

The `Session` table has everything the list needs: `deviceLabel`, `ip`,
`userAgent`, `createdAt`, `lastUsedAt`, `expiresAt`, `revokedAt`. Return the
caller's non-revoked, unexpired rows newest first, and mark which one is the
caller's own so the UI can label it and refuse to revoke it by accident.

Two things to get right:

- **Revoking must kill the socket too.** A socket outlives its access token and
  is re-checked on a sweep, so a revoked session keeps receiving for up to a
  minute (`realtime/index.ts`). That is the existing, accepted window for
  logout; it is a worse answer for "I do not recognise this device". Revoking a
  session should push the disconnect rather than wait for the sweep.
- **Never return the token hash**, and revoke the whole `familyId`, not the one
  row. A refresh token that has already been rotated is a different row in the
  same family, and leaving it alive means the session comes straight back.

### 2. `PATCH /account/me`

Display name and avatar are local today, which is defensible for a while, but
username is not: it is the handle other people find you by, and it is currently
unchangeable.

- Username changes go through `newUsernameSchema`, so the word filter and the
  format rule both apply. Do not reuse the bare `usernameSchema`.
- The unique index on `username` is case-sensitive while friend lookup is not
  (`STATUS.md`, gotchas). Changing username is the first operation that makes
  the collision reachable on purpose rather than by accident, so this is the
  moment to decide: either store a lowercased column with a unique index, or
  reject a change that differs from an existing handle only by case.
- Rate-limit it. A handle that can be changed freely can be cycled to squat.
- Avatars need a decision before an endpoint: storing images means the server
  holds user content it cannot verify, and `avatarImage.ts` already strips EXIF
  client-side. Serving them means a URL that leaks who looked. It is reasonable
  to ship `PATCH /account/me` for the text fields and leave avatars local.

### 3. `POST /account/change-email` and `/change-email/confirm`

The model is already shaped for it: `EmailToken` has an `EMAIL_CHANGE` purpose
and a `newEmail` column that exists for exactly this and is otherwise unused.

The flow is: re-authenticate with `currentAuthHash` (the same re-auth
`change-password` does, and for the same reason), send a confirmation link to
the **new** address, then move `User.email` only when that link is opened.

The trap is specific to this app and worth stating plainly: **the auth salt is
derived from the email address.** Changing the email changes the salt, which
changes `authHash`, which means the stored `authVerifier` no longer matches
anything the client can compute. So a confirmed email change is also a password
re-derivation, and blob_A has to be re-wrapped or the account is locked out of
its own key. Either take the new `authHash` and the re-wrapped blob at confirm
time, or do not ship this. Half of it is worse than none of it.

### 4. `DELETE /account`

Last, because it is the one that cannot be undone and the least urgent.

- Re-authenticate, and require the account's own username typed back. The UI
  already does the second part.
- Decide what "delete" means for messages. `User` cascades to `Message` and
  `MessageEnvelope`, so a naive delete removes the other side's copy of a
  conversation they were part of. That is probably wrong: unfriending
  deliberately leaves history readable (decision 8), and deleting an account is
  not a request to reach into someone else's history. `UserStatus.DELETED` and
  the `deletedAt` column exist and suggest the intended answer is a soft delete
  that frees the handle and email, revokes every session and leaves the
  envelopes alone.

### 5. Privacy, which is a design question before it is code

The section stores toggles nothing reads. Each one needs a decision first, and
two of them may not be answerable in an app like this:

- *Who can send you a friend request* is enforceable server-side today and is
  the one worth doing.
- *Read receipts off* is enforceable, since read state is already a server call.
- *Hide online status* is enforceable in `realtime/index.ts`, though presence is
  per-process and wrong the day there are two boxes.
- Anything phrased as "who can see X" about message content is not enforceable
  and should not be offered: the server cannot see message content, so it cannot
  gate it. A toggle that merely asks other clients nicely is a promise this
  app should not make.

## Not in scope, and why

- **A settings route.** Settings is state, not an address: `Ctrl+,` and the gear
  open it, and nothing links to it. Giving it a URL means a router, and the
  404's `KNOWN_PATHS` is the honest version of "no router yet" until then.
- **Multi-device.** Devices & keys lists sessions, not devices, and says so.
  There is one device per account by design (`STATUS.md`, decision 4).
- **Admin.** All of `/admin/*` is unimplemented and no settings section asks
  for it.

## Related, and unresolved

`client/index.html` names Outfit and IBM Plex Mono in `theme.css` and loads
neither, so every screen including settings has been rendering in the fallback
stack. The `frontend` branch fixed this with a Google Fonts `<link>`, which was
not merged: a request to `googleapis.com` on every page load tells Google who
opened a private messenger. Self-hosting the two families under `client/public`
gets the typography with no third party in the path, and is a small job nobody
has picked up.
