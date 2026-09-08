# STATUS: where this project actually is

Last updated **2026-09-08**, after three passes over the chat UI and one over
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
phone, both connected and carried audio. The fifth pass is
appearance: five palettes in either light or dark, an activity bar that docks
to any of the four edges and a close button that follows you down a settings
section. The sixth is the vault, stage 1 of
[`vault-plan.md`](vault-plan.md): a private space behind a passkey, which is
the first feature in the app whose contents are genuinely encrypted rather than
waiting on phase 2. The seventh is making the app yours: a banner and a real
description on your profile, people pinned to the top of the conversation
list, a palette you write from two colours and a wallpaper behind everything.
The eighth was a desktop shell that opened the deployed site in a window.
The ninth, also on 2026-09-08, replaced it: people will use the desktop more
than the site, so `desktop/` is now a real app. It bundles the client, keeps
its session across restarts, has a tray, native notifications, an unread
badge, a taskbar flash for calls, one instance, start-with-computer and
signed auto-updates announced by a banner in the app, and the client gained
the platform adapter all of that goes through. It compiles and builds on
Windows; the workflow has not run yet and needs one secret first. What is
left is parked on purpose rather than forgotten: the account endpoints
behind settings and the backup cron on the box.

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
(`client/`, `server/`, `packages/crypto/`) plus `desktop/`, a Tauri app that
is a Rust crate rather than a workspace member and bundles the client built
in desktop mode. **Accounts
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
| Settings, nine sections, opened from the gear or Ctrl+, | `client/src/screens/settings/` |
| Five palettes, each in light and dark, and a dockable activity bar | `client/src/styles/theme.css`, `client/src/styles/app.css` |
| A palette you write yourself, from two colours | `client/src/styles/theme.css`, `client/src/screens/settings/AppearanceSection.tsx` |
| A wallpaper behind the app, dimmed and blurred to taste | `client/src/styles/app.css`, `client/src/screens/settings/AppearanceSection.tsx` |
| A profile banner, and a description with room to write one | `client/src/screens/settings/ProfileSection.tsx` |
| Pinning people to the top of the conversation list | `client/src/lib/settings/pinned.ts`, `client/src/components/ConversationList.tsx` |
| An OS notification when a message lands and the window is not in front | `client/src/components/DesktopNotifier.tsx`, `client/src/lib/settings/desktopNotifications.ts` |
| A popup in the corner when one lands and the window *is* in front | `client/src/components/MessageToasts.tsx`, `client/src/lib/settings/messageToasts.ts` |
| The sender's avatar on a desktop notification, beside the app's own name and logo (installed builds only, uncompiled) | `client/src/lib/platform/notificationIcon.ts`, `desktop/src-tauri/src/commands.rs` |
| The vault: notes to yourself, sealed under a passkey, on this device | `client/src/lib/vault/`, `client/src/screens/VaultScreen.tsx` |
| Two languages, English and Dutch, with dates, times and numbers to match | `client/src/lib/i18n/`, `client/src/state/I18nProvider.tsx` |
| Alert sounds, synthesised rather than shipped, eight for a message and seven for a ring | `client/src/lib/media/sounds.ts` |
| A different sound per person, so you know who it is without looking | `client/src/lib/settings/notificationSounds.ts`, `client/src/screens/settings/NotificationsSection.tsx` |
| A ringtone on an incoming call, a chime on an arriving message | `client/src/components/CallRinger.tsx`, `client/src/components/MessageChime.tsx`, `client/src/state/useArrivingMessages.ts` |
| Positioning an avatar, a banner or a wallpaper instead of taking a centre crop | `client/src/lib/settings/avatarImage.ts`, `client/src/components/ImageCropper.tsx` |
| Profiles kept under a name and switched between | `client/src/lib/settings/savedProfiles.ts`, `client/src/screens/settings/ProfileSection.tsx` |
| A loading screen whose bar counts real boot steps, and a curtain over a lost connection | `client/src/components/LoadingScreen.tsx`, `client/src/components/ConnectionCurtain.tsx` |
| Sealing a document under a key you already hold, for the vault to build on | `packages/crypto/src/secret.ts` |
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
| Desktop app: the client bundled, session kept across restarts, tray, notifications, badge, call attention, single instance, autostart | `desktop/src-tauri/src/`, `client/src/lib/platform/` |
| Desktop auto-update: checked at start and every four hours, announced by a banner, installed on request, signed | `desktop/src-tauri/src/updater.rs`, `client/src/components/UpdateBanner.tsx` |
| Desktop settings section: version, check for updates, close to tray, start with the computer | `client/src/screens/settings/DesktopSection.tsx` |
| Bearer-mode session survives a restart | `client/src/lib/storage/refreshTokenStore.ts` |
| CORS admits the desktop origins, HTTP and socket | `server/src/lib/origins.ts` |
| Desktop installers for three OSes from one workflow, Windows build done locally | `.github/workflows/desktop.yml` |
| A hidden desktop window is kept awake, so close-to-tray keeps the socket up | `desktop/src-tauri/src/main.rs` (`BROWSER_ARGS`) |
| Live registration + verification email landing in an inbox | verified by hand 2026-09-07 |

616 tests pass: 41 crypto, 352 client, 223 server. `npm run
typecheck` and `npm run build` are clean across all workspaces, and `cargo
check` in `desktop/src-tauri/` is clean. That is the committed tree; on the
other maintainer's machine, as of the 2026-09-08 client pass, **`packages/crypto`
is mid-rewrite and does not currently compile**: `kdf.ts`, `messages.ts`,
`recovery.ts`, `wrap.ts` and their tests are untracked working-tree files that
import names `sodium.ts`, `keys.ts` and `encoding.ts` do not export yet, so
`npm run typecheck` fails at the root and 28 of its 78 tests fail. That is
work in progress rather than a regression, and nothing in `client/` or
`server/` depends on the half-written half of it.

**The UI has been driven by hand in a browser, and it works.** That is worth
stating separately from the tests. Adding a friend and exchanging messages were
walked through on 2026-09-06, and everything the 2026-09-07 passes added was
walked through the same day: the right-click menu, nicknames, the profile
panel, the five Friends tabs, unread badges clearing across two tabs and a
reset link followed out of the mailbox. The suites and the smoke scripts still
only cover the protocol. Nine of the 29 client suites render under jsdom now
(`ContextMenu`, `PasswordField`, `CallPanel`, `UserProfile`, `NotFoundScreen`,
`ResetPasswordScreen`, `VerifyEmailScreen`, `VaultScreen` and
`SettingsProvider`), which is a good deal more than the two this file used to
list. Five of them mount through the shared harness in `src/test/providers.tsx`
rather than standing a provider tree up each time. The gap that is left
is the chat surface itself: `client/src/state/ChatProvider.tsx`, `App.tsx`,
`MessageList` and the Friends screen have no test that renders them, so
anything you change there still wants a human to look at it again.

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

**Alert sounds and two smaller screens are built but not walked through.**
Added 2026-09-07, after the call work: every alert is synthesised from a short
score in `client/src/lib/media/sounds.ts` rather than shipped as an audio file,
eight for a message and seven for a ring, and Settings, Notifications picks
between them. A sound can also be set per person, which is the point of the
feature: a flatmate on Knock and a partner on Bell tells you whether to get up
without looking. `CallRinger` and `MessageChime` are watchers that read the
call phase and the message history rather than changes to the call engine, so
signalling knows nothing about audio it does not carry. The same pass added a
cropper that lets you position an avatar instead of accepting a centre crop
(`avatarImage.test.ts` covers the crop maths, the only part that can be wrong
without looking wrong) and a loading screen whose bar counts the two real boot
steps, with a curtain that covers the app after a connection has been bad for
1.8 seconds and fills to full when it comes back. Typecheck, the 216 tests and
`vite build` are clean. None of it has been driven by hand in a browser, and
the sounds in particular want a phone: see the iPhone gotcha below.

**Appearance grew a palette and a dockable bar, also not walked through.**
Added 2026-09-08. Light or dark and the colour set are now two separate
choices, so "Tide" plus "System" is a blue app that follows the OS between day
and night: `styles/theme.css` holds five palettes (Ember, Tide, Orchid, Rose,
Slate) written for both modes, and `SettingsProvider` writes `data-theme` and
`data-palette` onto `<html>` for the stylesheet to pick a block from. There is
no green palette on purpose, because `--sage` means encryption here and an
accent of the same green would blur the one signal the app cannot afford to
lose. The palette blocks are keyed on the attributes rather than on `:root`, so
the swatches in Settings paint themselves in the palette they are offering
instead of restating its colours in TypeScript. The activity bar (the old top
bar) docks to any edge from the same section: top and bottom are the bar
turned over, left and right make it a 132px rail, and under 821px a side rail
falls back to the bottom rather than eating a third of a phone screen. The
profile sheet and the call panel step around whichever edge it took. Two
things a settings blob can now carry that no stylesheet knows about, the
palette and the edge, go through `resolvePalette` and `resolveActivityBar`
first (`lib/settings/types.test.ts`). The other half of the pass is one line
of CSS worth knowing about: the close button in Settings is sticky, so it
follows you down a long section.

**The vault is built, stage 1, and not walked through either.** Added
2026-09-08, and it is the odd one out in this codebase: its contents are
*really* encrypted today. Phase 1 makes `encryptMessage` a no-op, but the
credential half of `packages/crypto` (Argon2id, `crypto_secretbox`) has always
been real, and the vault is built on that half rather than on the message path.
A random vault key is wrapped twice, under the passkey and under the account
password, which is the same trick already played on the private key with the
password and the recovery code: forgetting the passkey is survivable, and
changing it re-seals one 32 byte key rather than rewriting a single note.
`sealWithKey`/`openWithKey` in `packages/crypto/src/secret.ts` are the only
addition to the crypto surface, and they are `crypto_secretbox`, not a new
primitive. Everything lives in the existing `SecureStore`, namespaced by
account, so a shared browser profile keeps two people apart and signing out
does not take the vault with it. Stage 2, which makes it a real conversation of
one participant so it follows you to another device, needs `openDm` to stop
refusing a self pair, which is server work. Pictures are stage 3 and need blob
storage that does not exist anywhere yet.

**Profiles can be kept under a name and switched between.** Added 2026-09-08.
`settings.profile` is still the live one that the whole app renders, so nothing
downstream changed; `settings.profiles` is the shelf it came off. Editing the
live profile mirrors straight into the saved slot it belongs to, which is why
the screen has no save button and no unsaved-changes state: the only thing you
name is the profile itself. Having nothing saved stays a real state rather than
a first row, so the section behaves exactly as before until you use it.
Switching writes the old one back before loading the new one, deleting the
loaded profile leaves you looking exactly as you did, and the reducers doing
all of that are pure functions in `lib/settings/savedProfiles.ts`. The settings
store learned two things on the way: `patchSections`, so the live profile and
the shelf move in one commit rather than through a state where they disagree,
and an `Array.isArray` branch in `merge`, because `typeof []` is `'object'` and
a hand-edited settings file could otherwise put a plain object where the list
belongs. What is inside the list is checked by `resolveSavedProfiles`, on the
same principle as `resolvePalette`: fall back quietly, because a settings file
is the last thing that should stop the app from starting.

**The app speaks Dutch.** Added 2026-09-08, and it is the largest change this
client has had: every screen now reads its words from a catalogue. `lib/i18n`
is about 150 lines of our own rather than a dependency, because
`Intl.PluralRules`, `Intl.NumberFormat` and `Intl.DateTimeFormat` are already
in the browser and what was left is a lookup and a `{name}` substitution.
English lives in `lib/i18n/en.ts` as the source of truth, `Key` is derived from
it, and `t()` is typed against `Key`, so `tsc` refuses a key that does not
exist and refuses a translation that invents one. Three tests cover what the
type system cannot see: a missing translation (named, not counted), one that
dropped a placeholder, and a key nothing asks for any more, which found four
dead entries on its first run. Language is its own settings section, chosen
from names written in their own language, device-local like every other
preference, and it writes `lang` and `dir` onto `<html>` beside the theme
attributes. `dir` is always `ltr` today and is written anyway so that adding a
right to left language is a CSS problem rather than a plumbing one. Dates,
times and numbers go through the chosen locale, so picking Dutch does not leave
you reading `Sep 8` and `1,234`. Modules under `lib/` that produce prose (the
password rules, the passkey rules, the avatar errors, the sound names) return a
`Phrase` for the screen to translate rather than holding a `t` of their own,
and errors the app names itself carry one beside their English `message`, which
stays English so a stack trace stays readable. Two things stay English on
purpose: palette names, which are names the way a paint chart has names, and
sentences the server wrote, because the API answers with prose rather than
codes and there is nothing to look up. Where it does answer with a code, as the
friend-request endpoints do, the app decides what that means in words and
translates it.

**The alerts were never allowed to make a sound.** Found 2026-09-08, when the
preview button in Settings, Notifications turned out to be silent in a plain
browser as well as in the desktop app. The synthesis was never the problem: run
against a real Web Audio implementation, `ding` renders 1.15s at peak 0.26 and
the ring 3.39s at peak 0.32, with correct WAV headers. Three faults in the
delivery, all in `lib/media/sounds.ts`:

- `unlock()` documented itself as "call once from any early user gesture" and
  nothing did. Its only caller was the ring handler, which fires when a call
  arrives and is by definition not a gesture, so the autoplay policy could
  refuse the first alert of a session. `unlockOnFirstGesture()` now claims the
  right on the first click or key anywhere, and `main.tsx` calls it.
- `play()` awaited `applySink()` on the way to `audio.play()`. `setSinkId` is
  an output-device call that is absent on phones and flaky elsewhere, and one
  that never settled would have meant permanent silence rather than a wrong
  speaker. Routing now happens once when the element is made.
- Every failure was swallowed by a bare `catch {}`, which is why this cost an
  afternoon: no sound, no error, nothing in the console. It reports now.

**The second one was it, and it is fixed.** Walked through in a browser on
2026-09-08: the preview button in Settings, Notifications plays, where before
it was silent. That also identifies the cause, by elimination rather than by
guess. The preview button is a click, so the gesture fix cannot be what
repaired it; and `applySink` swallows its own errors, so a `setSinkId` that
*rejected* would have been caught and playback would have carried on. Only one
that never settles leaves the await hanging and the sound unplayed, which is
what was happening.

**The first one is still unproven**, because nothing has exercised it. It is
for the alert that arrives with no click of its own, which is to say the
message chime and the incoming call ring, and testing those needs two accounts
and a conversation rather than a button. `npm run account` in `server/` makes a
verified one in a second, which is the fiddly half of that (register, find the
right file in `.mail`, dig the token out) done for you. `sounds.test.ts` covers the gesture
wiring so it cannot quietly go missing again, but a passing unit test is not
the same as a chime heard across a room.

**A message that lands while you are looking now says so.** Added
2026-09-08, the third sibling on `useArrivingMessages` after the chime and the
OS notification, and the one that fills the hole the other two left. The chime
says something happened but not what or who; the notification says both, but
only fires when you cannot see the app. In between sat the ordinary case, you
at the keyboard reading one conversation while another moves, which had a
sound and nothing to look at.

The pairing is the design and it is exact: `toastable` requires that you can
see the app, `notifiable` requires that you cannot, so any one message raises a
toast or a notification, never both and never neither. That is asserted in
`messageToasts.test.ts` rather than trusted, because it is the kind of property
that survives every individual test and still breaks. The other gates are the
familiar ones, plus one of its own: nothing toasts for the conversation already
on screen, since you can watch it arrive.

Two settings rather than one. `toast` turns the cards on and defaults on;
`toastPreview` governs the text and also defaults on, which is the opposite of
the desktop `preview` default and deliberately a separate switch. They look
like the same question and are not: `preview` hands decrypted text to an OS
notification centre that may log it, mirror it to a phone or paint it on a lock
screen, while a toast is drawn inside a window you are already looking at and
goes nowhere. One switch for both would have made the safer default the enemy
of the useful one.

Not yet walked through: written, typechecked, 16 tests, and the client builds.

**A desktop notification can carry the sender's picture.** Added 2026-09-08,
after a walk-through showed the desktop path throwing the avatar away:
`invoke('notify', ...)` sent a title and a body, and the Rust command did not
take an icon at all. The browser had been passing one to the Notification API
the whole time, so this was the desktop half of a feature that already worked
in a tab.

Two conversions had to happen and they are split across the boundary on
purpose. The page re-encodes: `lib/settings/avatarImage.ts` prefers WebP, which
Windows toasts cannot draw, and a toast with an image it cannot decode simply
draws none rather than complaining. So everything becomes a 96px PNG on the
page side, which also keeps an image decoder out of the Rust process, leaving
it nothing harder than a base64 decode. The shell writes: a Windows toast takes
its image as a path and nothing else.

That write is the one place a command touches the file system on the page's
say, which the module comment used to promise it never did. Rewritten to say
what is true, and kept narrow: only a `data:image/png;base64,` string is
accepted, so no path and no URL can be smuggled through; the shell picks the
directory (its own cache) and the name (a hash of the bytes), so the page
controls neither; and the decoded size is capped so a page that has somehow
been replaced cannot fill a disk one notification at a time.

**Only an installed build shows the app's name and logo.** The notification
plugin sets the AppUserModel ID only when the executable is not running out of
`target/debug` or `target/release`, so `npm run dev` in `desktop/` gets a toast
attributed to something else. That is worth knowing before concluding the
change did nothing.

**Uncompiled.** Same Smart App Control wall as everything else in `desktop/`
from this machine. The client half typechecks and its tests pass; the Rust half
has been read and not built.

**There is a desktop build you can point at your own machine.** Added
2026-09-08, because the shipped app cannot be pointed anywhere: `VITE_API_URL`
is baked into the bundle and `CIPHER_DESKTOP_URL` is read by `option_env!`, so
an installed Cipher is production permanently and cannot see a local account.
That made the desktop shell untestable against anything you could set up
yourself, which is most of what testing is.

`npm run build:desktop-test` at the root builds it. Three things make it safe
to have beside the real one: its own product name and identifier, so it
installs as "Cipher Test" in its own directory rather than over Cipher; a CSP
that admits `localhost:3000` and its websocket, which the shipped one does not
and which would otherwise block every request the build makes; and an updater
endpoint pointed at nothing, so a test build can never offer itself as an
upgrade to the real app or be offered one.

The client half is verified: the bundle builds, `localhost:3000` is baked in
and `cipher.findiepman.dev` appears nowhere in it. The installer half has never
been produced, because Smart App Control blocks cargo on the machine this was
written on. Anyone with a working toolchain runs one command.

**The audio unlock had never once worked, in three separate ways.** Found
2026-09-08 by running the desktop build, where the message chime was silent
while the call ringtone was not and the settings preview button worked in both.
Three bugs stacked on each other, each one hiding the next:

1. `unlock()` called `element(false)`, which hands back a fresh `Audio()` with
   no source, and `play()` on a source-less element rejects with
   `NotSupportedError` rather than granting anything. Its whole job is to start
   a playback inside a real gesture so a later alert may sound, and it had been
   attempting one that could never start.
2. The fix for that used a `data:` URL. The desktop CSP is
   `media-src 'self' blob:`, so the browser refused it before it could play.
   Every real sound in `sounds.ts` already travels as a blob, which is why the
   ringtone worked; the silence now does too, so no CSP change is needed and
   the shipped app is unaffected.
3. The worst one. `unlock()` muted the **shared** one-shot element and unmuted
   it from a `.finally()`. A media load the CSP refuses can leave `play()`
   pending forever, and the element then stays muted for the rest of the
   session, so every later chime plays into silence. The ringtone is untouched
   because it plays through `looper`, a different element. "Messages silent,
   calls fine, no error" is close to unreadable backwards. The unlock uses its
   own throwaway element now and touches nothing the alerts rely on.

Why no browser showed any of this: Chromium lets an element play once the
document has been interacted with at all, so ordinary clicking carried the
broken unlock. A webview serving the app from its own scheme has no such
history and is the strict case.

**The diagnostics were themselves invisible.** The failure logs went through
`console.debug`, which Chrome files under Verbose and hides unless you tick it,
so a silent failure and no failure looked identical. Both are `console.warn`
now, and the unlock logs its own refusal, which it previously swallowed.

**Not confirmed fixed.** The build carrying the third fix was still compiling
when work stopped on 2026-09-08. Bugs 1 and 2 are confirmed gone: the CSP
violations that filled the console are absent from the last run. Whether the
chime actually sounds is the first thing to check next time.

**The test build can be inspected.** A `devtools` Cargo feature, off by
default, on for `npm run build:desktop-test`. Every desktop problem this
evening was diagnosed by reasoning rather than by reading an error, because a
release build has no console, and the two real bugs (an `http` updater endpoint
that panicked at startup, and this one) were both invisible until something
printed. A shipped Cipher still has no inspector.

**A hidden desktop window is kept awake.** The tray and close-to-tray came
from the other maintainer (see the desktop rows above); this is the half his
version did not carry. Close-to-tray leaves the app running with a hidden
window, and a hidden window is a background window: Chromium clamps its timers
and can freeze the renderer outright, which would leave the app resident and
deaf and defeat the point of staying in the tray. `BROWSER_ARGS` in
`desktop/src-tauri/src/main.rs` turns the three backgrounding behaviours off on
Windows. It repeats Tauri's own default switch on purpose, because
`additional_browser_args` replaces that default rather than adding to it.
Not yet proven: the flags are the kind of thing that only shows up after the
window has been hidden for ten minutes or more, so a quick test says nothing.

**Making the app yours: a banner, a description, pinned people and a theme you
write.** Added 2026-09-08, on top of the appearance pass, and it is one pass
over three unrelated-looking screens that turn out to share their plumbing.

The profile grew the half a card was missing. A banner sits across the top,
cropped at 640 by 200 and stored the way the avatar always was, and the line
about yourself became a paragraph: 190 characters in a textarea that keeps the
line breaks you typed, in its own group under the identity fields rather than
squeezed in as a third one-line input. The preview card shows both immediately,
which was already the whole idea of that screen.

What made that cheap is that the crop maths stopped assuming a square.
`coverSize`, `clampCrop` and `centredCrop` in `lib/settings/avatarImage.ts` now
take the frame's aspect and measure each axis against its own side, which is
exactly what the square case already did (`aspect = 1` reproduces the old
numbers, and the existing tests were left alone to prove it). `AvatarCropper`
became `ImageCropper`, takes the frame it will bake at and drops the squircle
mask for anything that is not an avatar. `components/settings/PictureField.tsx`
is the row all three pictures are picked through, because decoding a file can
fail four ways and the decoded bitmap outlives the render that made it, and
three copies of that would have been three chances to leak one.

Pinning is by **person**, not by conversation
([`lib/settings/pinned.ts`](client/src/lib/settings/pinned.ts)). The same
right-click menu is on a conversation row, a friends row, a message author and
the profile card, and only one of those four knows a conversation id. The
pinned section is ordered by when you pinned somebody rather than by who spoke
last, which is the entire point: the ordinary list reshuffles constantly, and a
shortcut that reshuffled with it would be the same list twice. It caps at
fifteen and refuses the sixteenth rather than evicting the oldest, and a pin
that no longer matches a conversation (you unfriended them) is simply not a
row. `ConversationList` already took sections, so it only learned to draw one
of them as a shelf.

The custom palette is two colours and no more: an accent and a tint.
`theme.css` mixes the other twenty tokens out of them with `color-mix`, so the
rule the whole look rests on (panels lighter than the ground in the dark,
darker than it in daylight) survives whatever anyone picks, and `--sage`,
`--red` and the presence colours are deliberately left out of the mixing
because they are meanings rather than decoration. The one token CSS cannot
work out is the text drawn *on* the accent, which has to flip between black
and white rather than being nudged, so `readableInk` does it in TypeScript
until `contrast-color()` ships. The wallpaper is two layers behind everything
at `z-index: -1` (the picture, then a scrim of the palette's own backdrop at
whatever dim was asked for) with the panels going slightly translucent, which
is the only reason it is visible at all: nothing in this layout is background,
every pixel belongs to a panel floating on the ground.

Three settings now reach a stylesheet rather than a React prop, and that is a
different kind of input from the rest of the blob: `resolveHex` accepts six hex
digits and nothing else, and `resolvePicture` accepts a base64 `data:` URL of a
kind a canvas produces and nothing else, because both end up inside a CSS
declaration and a settings file is the one input a user can hand-edit. There is
a real edge here that has not been hit yet: the whole settings blob is one
localStorage key, and a wallpaper is a couple of hundred kilobytes of base64,
so an origin already near its quota would fail to write *all* of settings, not
just the picture. `SettingsStore` swallows that and keeps going in memory, so
it would show as preferences that stop surviving a reload rather than as an
error.

Typecheck, the 313 client tests and `vite build` are clean. None of it has been
driven by hand in a browser: the wallpaper layering and the custom palette in
particular are CSS whose failure mode is "looks wrong", which no test here
catches.

**Desktop notifications, the half that does not need the server.** Added
2026-09-08. `Notification.requestPermission()` had been wired to a button for
a while and nothing ever constructed a `Notification`, so a message with the
app in the background was silent unless the tab could play audio. It is not any
more: `components/DesktopNotifier.tsx` raises one when a message lands while
the window is not in front.

The decision of whether an arrival is allowed out is
[`lib/settings/desktopNotifications.ts`](client/src/lib/settings/desktopNotifications.ts),
a pure function with a test per gate, because this is the boundary between
somebody's decrypted words and an operating system's notification centre and
"it looked right when I tried it" is not how you find out that a gate leaks.
Permission granted, the toggle on, you not already looking, not paused, not
your own message: five, and `preview` is a sixth over the body alone. The
person's name is not behind `preview`, which is deliberate and matches what
that setting says it does: a notification that cannot say who it is from is
one you have to open the app to act on.

Noticing the message is now shared. `state/useArrivingMessages.ts` came out of
`MessageChime`, because the chime and the notifier agree exactly about what an
arriving message is and disagree about everything after: a chime for a
conversation you are not reading is useful while you sit at the keyboard, and a
notification for the same message is not. Pulling it out fixed a bug in the
chime on the way. It used to prime once, on the first pass, and histories do
not all land at once (the conversation list arrives before any messages, and a
backlog is pulled when you first open one), so every one of those counted as an
arrival. Priming is per conversation now: the first time a conversation is seen
with anything in it is never an arrival. The cost is stated in that file, and
it is real: the very first message in a conversation this device has never seen
is silent, because from the outside it is indistinguishable from a backlog.
`chatStore` already tells `backlog` apart from live delivery, and that is where
this eventually belongs.

Three browser facts are handled in `lib/media/notifications.ts`, which is the
only thing that touches the Notification API. Chrome on Android throws
`Illegal constructor` on `new Notification` outright, because there they may
only come from a service worker, so this is a no-op on that browser rather than
an error. Every notification is raised `silent`, because the app plays its own
sound chosen per person and the OS would otherwise play a second one on top.
And they are tagged by conversation and taken back when the window comes
forward, because a notification sits in the Action Centre until it is
dismissed, so without that, coming back and reading everything leaves a pile of
toasts about messages you have already answered. A burst is capped at three:
the unread counts in the list were always going to tell you the real number.

Settings, Notifications grew a **Show one now** button, for the same reason:
this is the one alert in the app you cannot check by switching it on and
waiting, because it only appears when the window is in the background, which
the settings screen never is. Focus Assist, Do Not Disturb and a per-browser
notification setting are three separate places it can be silently off.

Typecheck, the 324 client tests and `vite build` are clean. Not walked through
by hand.

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
- **Sharing your profile with anyone else.** You have one now, under
  Settings, with a picture, a banner, an accent, a display name, a paragraph
  about yourself and any number of saved variants to switch between. All of it is
  device-local: `PATCH /account/me` does not exist, so nobody else sees a word
  of it. `UserProfile` still renders other people from what the server knows.
  Walked through on 2026-09-08 and it bites in one more place than expected:
  a desktop notification has an avatar slot and arrives empty, because the
  picture it would draw is the *sender's* and this device has never been told
  it. The plumbing for that slot is built and works, proven with the "Show one
  now" button in Settings, which sends your own picture and draws it. So the
  notification is one synced field away from being complete, and nothing more
  is needed on the client.
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
- **Friend requests do not arrive live.** Found by hand on 2026-09-08, and
  worth stating because the capability table above reads as though they do.
  Nothing in `server/src/modules/friends/` or `server/src/realtime/` emits a
  socket event when a request is sent, accepted or declined, and the client's
  socket listens only for `message:new`, `typing`, `presence`, `read` and the
  `call:*` family. `reloadFriends()` in `ChatProvider` runs on mount and after
  an action you took yourself, so a request that lands while the other side is
  simply sitting there open is invisible until the page is reloaded. Messages
  are pushed, so the asymmetry is surprising rather than obviously absent: the
  first thing two new accounts do is send a request, and it looks broken. The
  fix is one emit per transition on the server and one listener that calls
  `reloadFriends`, but the server half is the other maintainer's.

- **Notifications with the app closed.** The half that works while the app is
  open in a background tab or behind another window is built (see above). The
  half that survives quitting the browser, or a phone with the site not open,
  is not, and it is the one piece of client work here that cannot be finished
  alone: it needs a service worker and `PushManager.subscribe()` on this side,
  and on the server a VAPID keypair, a `PushSubscription` table, endpoints to
  register and drop one, and a call to `web-push` in the message path when the
  recipient has no live socket. **The payload must not carry message content**:
  it travels through Google's or Apple's push service, so the push is a
  contentless wake-up and the client fetches and decrypts, which is also what
  the `preview` setting already promises. On iOS this needs the site added to
  the home screen (16.4+). The desktop shell narrows this a little: closing its
  window now hides it rather than quitting, so notifications and ringing carry
  on there. Actually quitting it still stops both, and the browser and the
  phone are untouched by that.
- **Screen sharing.** Deliberately out of scope for now
  ([`voice-plan.md`](voice-plan.md), *Explicitly out of scope*): it needs
  `getDisplayMedia` and a second track lifecycle on a peer connection that is
  audio only today. A picker for whole screen against one window was built
  against a throwaway call UI on 2026-09-07 and then dropped rather than
  bolted onto the real engine; the browser cannot list windows itself, so
  what such a picker steers is `displaySurface` and `monitorTypeSurfaces` on
  the `getDisplayMedia` call.
- **Per person sounds beyond this device.** The map lives in the settings
  blob in `localStorage`, so the ringtone you gave someone does not follow
  you to another browser. It is a preference and the server deliberately
  holds none, which is decision 11; a device that has never been told simply
  uses the defaults.
- **Phase 2 encryption.** See `packages/crypto/AGENTS.md`.
- **The desktop app has never been through its own pipeline.** The Tauri
  app in `desktop/` compiles, and `npm run build` there produced a signed
  NSIS installer on the Windows dev machine on 2026-09-08, and the release
  binary launched and drew the sign-in screen from its bundled pages.
  Signing in from the desktop against the deployed server, the tray, the
  notifications, the badge and the update banner have not been walked
  through by hand yet; their logic is tested, their wiring is not.
  Everything past that is unrun: the
  GitHub Actions workflow has not been dispatched, the
  `TAURI_SIGNING_PRIVATE_KEY` secret is not added (the private key is in
  `~/.tauri/cipher.key` on the machine that generated it and nowhere else),
  no macOS or Linux build exists, no release exists and so the updater has
  never had a `latest.json` to read. **There are no code-signing
  certificates** either, so the installers trip Gatekeeper and SmartScreen;
  `desktop/README.md` says what that means on each OS.
- **No OS keychain on desktop.** The device key sits in the WebView's
  IndexedDB exactly as it does in a browser, and so does the refresh token,
  in the clear: bearer mode has no cookie jar, and a session that died with
  the process would be a sign-in per launch. `desktop/AGENTS.md` says why
  the keychain waits for the multi-device design rather than being bolted
  on. Two smaller desktop gaps: clicking a native notification does not
  open the conversation (no desktop platform reports the click to the
  plugin), and the verification and reset emails still open the website,
  so registering from the desktop means one trip through a browser.
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
29. **The desktop app bundles the client; it is not a window on the site.**
    Decided on 2026-09-08, reversing the day-old shell that loaded the
    deployed site. People will use the desktop more than the web, and a
    window on a website is not an app: it has no origin of its own, nothing
    native the page can call, and nothing to show when the site is down.
    The price is that a client change reaches desktop users only through a
    release, which is why the workflow makes one a dispatch and a button
    and why the version has to be bumped for a client-only change. The API
    URL is compiled into the page (`client/.env.desktop`), not read at run
    time, so a shipped binary cannot be pointed at another origin and
    thereby hand that origin the session and device key in its IndexedDB.
    Every native feature goes through `client/src/lib/platform/`, one
    interface with a web and a desktop implementation; the page holds
    `core:default` and `opener:default` and reaches everything else through
    the shell's own commands, which check their arguments.
30. **A desktop release is a published GitHub release, and only a manual
    dispatch makes one.** A push touching `desktop/`, `client/` or
    `packages/` builds and keeps artifacts; `workflow_dispatch` creates a
    *draft* release with `latest.json`, and publishing the draft is the act
    of shipping an update to every installed copy. The updater reads
    `releases/latest/download/latest.json`, which is GitHub's newest
    published non-prerelease release of the whole repository. That is right
    while desktop releases are the only kind; if another kind ever appears,
    move to a fixed tag (`desktop/UPDATES.md` has the recipe, and the whole
    release procedure).
31. **The desktop uses bearer auth, and the refresh token is stored.** The
    page's origin is the shell's (`http://tauri.localhost` on Windows,
    `tauri://localhost` elsewhere) and the API's is the site's, so the
    WebView would never attach the API's `SameSite=Lax` cookies and
    loosening them for the web's sake was not on. Bearer mode already
    existed; what was missing was a session that outlived the process, so
    `ApiClient` writes the refresh token to the secure store in bearer mode
    and reads it back at start. The socket asks for a fresh access token on
    every reconnect rather than the one it was created with. The server side
    of the same decision is `lib/origins.ts`: the desktop origins on the
    CORS allowlist, HTTP and socket alike, which grants them nothing a
    cookie-less bearer caller did not already have.
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

The server suite runs against `TEST_DATABASE_URL`, which is a **separate
database** from the one `npm run dev:server` uses. Create it once and give it
the schema, or every server test fails with `relation "AuditLog" does not
exist`, which names a missing table rather than the missing migration that
caused it:

```bash
cd server
DATABASE_URL="$TEST_DATABASE_URL" npx prisma migrate deploy
```

```bash
npm test               # all workspaces
npm run typecheck
npm run build
cd server && npm run smoke             # account lifecycle over real HTTP
cd server && npm run smoke:messaging   # two accounts, a DM, over HTTP + sockets
```

The desktop app is separate from the workspace (a Rust crate plus the Tauri
CLI, needs rustup). Its `npm run dev` starts Vite itself, in desktop mode,
so do not also run `npm run dev` at the root:

```bash
cd desktop && npm install
npm run dev            # Vite in desktop-dev mode, then a debug build on it
npm run build          # builds the client in desktop mode, then the installer;
                       # needs the signing key, see desktop/README.md
```

`VITE_BACKEND=mock` still short-circuits auth, but it no longer renders a chat:
the fixtures it used to draw are gone, because the chat UI now has a real
server to talk to and maintaining a second render of it would mean making every
UI change twice.

---

## Gotchas that have already cost time

### Web Audio is silent on an iPhone with the side switch on

An `AudioContext` plays through the ringer channel on iOS, which the hardware
silent switch mutes, and no amount of `resume()` changes that. An `<audio>`
element plays through the media channel and is not affected. So the sounds are
rendered offline into a WAV and handed to an element rather than played live:
see `previewRing` and the note at the top of `client/src/lib/media/sounds.ts`.
The same rewrite fixes a second bug, that `resume()` is asynchronous and notes
scheduled immediately after it can be dropped while the context is still
suspended.


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
- **`tauri build` needs the updater signing key, and an empty password set
  explicitly.** `createUpdaterArtifacts` is on in
  `desktop/src-tauri/tauri.conf.json`, so a local build needs the key's
  content in `TAURI_SIGNING_PRIVATE_KEY` or it errors after bundling. With
  the key present but `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` unset, the CLI
  prompts for a password and, in a shell with no stdin, hangs silently
  forever; export it as an empty string. `desktop/README.md` has the exact
  lines. `cargo check` in `src-tauri/` needs nothing and is the fast way to
  see if it compiles.
  Also, `generate_context!` expands to code that wants `serde` and
  `serde_json` in the app crate even though `main.rs` never names them;
  removing those two "unused" dependencies breaks the build.
- **The desktop build of the client is `vite build --mode desktop`, and the
  mode is what makes it desktop.** `client/.env.desktop` sets the API URL,
  bearer auth and `VITE_PLATFORM`; a plain `npm run build` in `client/`
  produces the web build, which inside the shell would try to talk to
  itself. `desktop/`'s `beforeBuildCommand` runs the right one. Running
  Vite at the root while `npm run dev` in `desktop/` is up starts a second
  server on :5173 and the shell opens whichever answered first.
- **The desktop's CSP lives in `tauri.conf.json`, not in the Caddyfile.**
  A new host the client has to reach goes in both `connect-src` lists, and
  only the desktop one needs the API host at all, because only the desktop
  is cross-origin.
- **The production env file must be named `deploy/.env`.** Compose reads that
  name automatically for both `${...}` substitution and the server's
  environment. Any other name needs `--env-file` on every command, and
  forgetting it silently substitutes empty strings rather than failing.

---

## Reasonable next steps

**Where 2026-09-08 stopped, pick this up first.** The desktop test build
(`npm run build:desktop-test`, installs as "Cipher Test" beside the real app)
was rebuilding with the third unlock fix and had not been installed. So:
install it, sign in as a local account, minimise it and have a message sent
from `localhost:5173`. If the chime sounds, the audio work is done and the
commit can say so. If it does not, the console now says why in plain sight:
`[sounds] could not play` or `[sounds] unlock refused`, at warning level, and
devtools are compiled into that build (F12). Run `npm run dev:server` first or
the app cannot sign in at all.

Two things known to be unfinished and deliberately left: a desktop
notification arrives with no avatar, because the picture it wants belongs to
the sender and profiles are device-local (see *Sharing your profile*), and
friend requests do not arrive live.

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
5. **Ship the first desktop build.** Add `TAURI_SIGNING_PRIVATE_KEY` to the
   repository's Actions secrets (the content of `~/.tauri/cipher.key`),
   dispatch the `desktop` workflow, and see whether the macOS and Linux jobs
   pass on their first run, since only Windows has been built so far. Then
   install the result on a clean machine per `desktop/AGENTS.md` before
   publishing the draft. Code-signing certificates are a separate, paid
   decision and are not needed for this step. After that, releasing is the
   normal way a client change reaches desktop users (decision 29), so it
   should become routine rather than an event.
6. **Fold the four credential audit actions into `lib/audit.ts`.** Small and
   nagging: `recordCredentialAudit` in `modules/auth/service.ts` names
   `auth.reset_requested`, `auth.reset_completed`, `auth.password_changed` and
   `auth.recovery_code_rotated` locally and widens the type at one call site,
   because `audit.ts` was being edited by somebody else at the time. Add them
   to the `AuditAction` union and delete the helper.
7. **A `cipher://` deep link for the email flows.** Today the verification
   and reset links open the website. A custom scheme registered by the
   desktop app (Tauri's deep-link plugin) plus a second link in the emails
   would keep someone who registered from the desktop inside it.

Do not start with group encryption, see `packages/crypto/AGENTS.md`.
