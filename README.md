# Cipher

A private messenger. Direct messages are sealed on your device with the other
person's key, and the server stores and relays something it cannot read.
Voice calls run browser to browser. There is a web app at
<https://cipher.findiepman.dev>, a desktop app for Windows, macOS and Linux,
and it works on a phone.

## What it does

### Messaging

- Direct messages with live delivery, typing indicators and presence.
- Messages typed with no connection queue on the device and go out when it is
  back. Anything missed while away is pulled on reconnect.
- Unread counts that clear when you actually look at the conversation, and
  "seen" on your own messages when the other person has read receipts on.
- Links you can click, inline code, and code blocks with a copy button and
  colouring. Spoilers.
- Pin people to the top of the list. Mute a conversation.
- Friends by exact username: send, accept, decline or take back a request,
  unfriend, block and unblock. Give a friend a nickname only you see.
- A profile your friends can see: picture, banner, display name, accent colour
  and a paragraph about you. Keep several under a name and switch between them.

### Voice calls

- Ring, answer, decline, busy, hang up. Every open tab rings; the one that
  answers takes the call.
- Mute, a voice gate that opens on speech, and push to talk (Ctrl+Space).
- Audio goes directly between the two browsers, relayed through TURN only when
  the networks need it. Eight ringtones, and earpiece or loudspeaker on a phone.

### Encryption

- Every message and every call's setup is sealed on the sender's device with
  the recipient's key, one copy per participant. The server never holds a
  readable message or a private key.
- Keys are pinned the first time they are seen. If somebody's key ever changes,
  the conversation pauses with a notice until you say it is fine.
- Your private key is generated on your device and never leaves it. The
  password never leaves it either: the server only ever sees a hash derived
  from it.
- Losing your password does not lose your account. A recovery code, shown once
  at sign-up, rebuilds it with your identity and history intact. Without the
  code you can still reset, knowingly starting a fresh identity.
- Lock the app and the key is gone from memory until you unlock. A plain
  reload stays unlocked for up to 30 days of use.

### The vault

A private space behind a passkey, for notes to yourself: a number you keep
forgetting, the thing you did not want in a chat. Sealed under a key only your
device holds, and separate from your account password on purpose, so a screen
someone finds unlocked is still not an open vault.

### Notifications

- A system notification when a message lands and the window is not in front,
  a popup in the corner when it is, and an unread count on the icon and in
  the title.
- Eight synthesised message sounds and seven ringtones, none of them shipped
  as files, and a different sound per person so you know who it is without
  looking.
- Choose whether a notification shows the message text.

### Looks and language

- Five palettes, each in light and dark, or write your own from two colours.
- A wallpaper behind everything, dimmed and blurred to taste.
- The activity bar docks to any edge. Compact or comfortable spacing.
- English and Dutch, with dates, times and numbers to match.
- Every setting follows your account to the next device you sign in on.

### The desktop app

- Windows, macOS and Linux. The same app as the web, in a window of its own.
- A tray icon, native notifications, an unread badge, a taskbar flash for an
  incoming call, close to tray, start with the computer, one instance.
- Signed auto-updates: a banner appears in the app with what changed, and one
  button installs it.

## What it does not do

- **Group chats and servers.** Not yet, and when they come they will not be
  end-to-end encrypted, by decision: the private product is the DM, and the
  maintainers do not want to run rooms nobody can moderate.
- **Attachments, editing, deleting, search.** Not yet.
- **Notifications with the app fully closed.** The app has to be open, in a
  tab or behind another window. On a phone that means the browser has to be
  open too.
- **Video and screen sharing.** Voice only for now.
- **Call history.** A missed call is a short notice, then nothing.
- **More than one device per key.** Your key lives on the device you signed up
  on; another device gets in through the wrapped copy the server holds, not
  through a second key.
- **Code-signed installers.** The desktop installers trip Gatekeeper and
  SmartScreen until certificates are bought.

## For developers

Read [`AGENTS.md`](AGENTS.md) for the rules, then [`STATUS.md`](STATUS.md)
for where the project actually is: what works, what is missing and the
decisions worth not undoing. [`server/README.md`](server/README.md) covers
running it locally, [`DEPLOY.md`](DEPLOY.md) is the runbook for the box,
[`desktop/README.md`](desktop/README.md) and [`desktop/UPDATES.md`](desktop/UPDATES.md)
cover building and releasing the desktop app, and
[`packages/crypto/AGENTS.md`](packages/crypto/AGENTS.md) is the encryption
design.

One npm workspace: `client/` (React, built for web and desktop), `server/`
(Fastify, Socket.io, Postgres), `packages/crypto/` (the only caller of
libsodium) and `desktop/` (Tauri).
