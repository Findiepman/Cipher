# voice-plan.md

Voice calls, one to one. This is the plan for building them.

Read [`STATUS.md`](STATUS.md) first for where the project is; this file is only
about calls. It follows the same convention as
[`backend-plan.md`](backend-plan.md), [`messaging-plan.md`](messaging-plan.md)
and [`settings-plan.md`](settings-plan.md): a plan that gets edited as it is
executed, not a record of what was decided.

**Where it stands, 2026-09-07:** stages 0 to 4 are built, covered by tests
(42 server, 45 client) and walked through for real on the live site: a call
between two browsers, and one from a phone, both connected with audio a little
below Discord's. Where the code differs from the plan below, the plan has been
edited to say what was built and why. Stages 5 and 6 are untouched.

One thing the phone taught: WebRTC plays through the loudspeaker, and the web
has almost no say in it. `setSinkId` does not exist on iOS Safari at all, and
on Android only Chrome lists "Earpiece" and "Speakerphone" as outputs a page
may choose between. The call bar therefore shows an earpiece toggle only on a
phone whose browser names both, and nothing anywhere else, because a switch
that does nothing is worse than none.

---

## The shape of it in one paragraph

Voice only, no video. Peer to peer, no SFU. Signalling rides the Socket.io
layer that already exists, because call setup is the same shape as `typing` and
`read` and the authorization it needs is already written. STUN and TURN come
from Cloudflare rather than from a box we run, because the mini PC has no
inbound UDP and is not going to get any. The consequence worth understanding
before anything else: **the media never touches our server**. It is DTLS-SRTP
between two browsers, which is real end-to-end encryption, and it is the one
part of this app that is not waiting on phase 2.

## Decisions, settled up front

| Question | Answer | Why |
|---|---|---|
| Voice, or voice and video | **Voice only** | Video roughly doubles the UI surface and the failure modes. The camera controls in settings stay where they are, storing a choice for whenever it lands. |
| Peer to peer, or an SFU | **Peer to peer** | Two participants. An SFU buys nothing at N=2 and adds a machine that can hear the call. |
| Whose TURN | **Cloudflare Realtime** | The tunnel carries no UDP, so a coturn on the box is impossible without publishing a port, which breaks the property `docker-compose.prod.yml` is built around. |
| Persisted call records | **Not in the first pass**, see stage 5 | Everything before stage 5 is a feature with no schema change. That is worth keeping true for as long as it can be. |

## The encryption story, stated honestly

The media is encrypted end to end today, genuinely, with no work from us:
DTLS-SRTP is what WebRTC does and there is no phase 1 stub in the path. So
**voice will be more private than text is**, which inverts the usual assumption
in this repo and should not be quietly enjoyed without also writing down the
hole.

The hole is the signalling. Our server relays the SDP, and the SDP carries each
side's DTLS certificate fingerprint. A hostile or compromised server could
substitute its own fingerprints and sit in the middle of the call, and neither
browser would notice, because the fingerprint check only proves the media
matches what the signalling channel said. That is the standard WebRTC threat
model (RFC 8827) and it is not specific to us.

The fix fits this codebase unusually well and is deliberately deferred: there is
already an account keypair per user and a public-key registry gated on
friendship (`GET /keys/user/:userId`), so the fingerprint can be bound to the
identity key that friendship already vouches for. That is phase 2 work, listed
as stage 6. Until then:

- Route the SDP through the same envelope seam messages use, so phase 2 lights
  up calls and messages in one change rather than two. **Done:** every session
  description goes through `encryptMessage`/`decryptMessage` in
  `client/src/lib/call/sealing.ts` before it touches the socket, sealed to the
  peer's registry key, and the server relays an opaque string it is not
  allowed to read (`schemas.ts` refuses anything that is not one). ICE
  candidates are not sealed: they are addresses, not identity, and a relay
  sees them regardless.
- **Say nothing about it in the UI.** Decision 21 in `STATUS.md` is that this
  app makes no encryption claims, and "your call is encrypted" would be exactly
  the badge that decision exists to prevent, right down to being true in the
  part people do not check and false in the part they do.

---

## Stage 0: the header that currently forbids the microphone

Do this first, and separately, because it repairs something already shipped.

`deploy/Caddyfile` sends `Permissions-Policy: camera=(), microphone=()`. An
empty allowlist is not "same origin only", it is **off everywhere including
this origin**, so `getUserMedia` rejects with `NotAllowedError` at
cipher.findiepman.dev. The mic test and camera preview in
`screens/settings/VoiceVideoSection.tsx` therefore do not work in production and
never have. It passes a click-through because the Vite dev server sends no such
header, so this is only reproducible against the deployed site.

Change it to `camera=(self), microphone=(self)`. Keep `geolocation=()` and
`interest-cohort=()` empty, since nothing wants them. Then load settings on the
live site and run the mic test before writing any call code, because every stage
below assumes a microphone can be opened.

## Stage 1: signalling. Done.

`server/src/modules/calls/` holds the registry (`registry.ts`), the frame
schemas and the ICE route; the socket handlers are `server/src/realtime/calls.ts`,
attached from `realtime/index.ts` on every authenticated socket. Tests are
`server/tests/calls.test.ts`.

Events, client to server. Every one takes an optional ack answered with
`{ ok: true }` or `{ error: { code, message } }`, the envelope `message:send`
already uses:

```
call:offer        { callId, conversationId, toUserId, sdp }
call:answer       { callId, sdp }
call:description  { callId, sdp }        renegotiation, connected calls only
call:candidate    { callId, candidate }
call:hangup       { callId }             caller cancelling a ring, or either side leaving
call:reject       { callId }             the callee declining a ring
```

Server to client, each to a user's room so every tab hears it:

```
call:offer        { callId, conversationId, fromUserId, sdp }    to the callee
call:answer       { callId, sdp }                                to the caller
call:claimed      { callId }             to the callee's own room: the tabs that did not answer stop ringing
call:description  { callId, sdp }        to the other side
call:candidate    { callId, candidate }  to the other side
call:ended        { callId, reason }     to both sides: hangup | rejected | no_answer | disconnected
```

Three things differ from the first draft of this section, on purpose:

- **A refused offer rides the ack, and nothing is broadcast.** Busy, not
  friends, not a participant, malformed: the caller hears the code
  (`busy`, `in_call`, `not_friends`, `conversation_not_found`,
  `validation_failed`) in the ack and no call is ever registered. The plan
  said `call:reject { reason: 'busy' }`; an ack is the same information with
  no extra event and no state to clean up.
- **One terminal event.** Whatever ends a call that existed, both sides get
  `call:ended` with a reason. Declining is `call:reject` in and `rejected`
  out. The client works out "missed call" for itself from being in the
  ringing state when `hangup` arrived.
- **`call:description` exists** because perfect negotiation needs a channel
  for descriptions after the call is connected: an ICE restart on a network
  change produces a new offer, and without a relay for it a call would drop
  whenever somebody's wifi changed. It is refused while ringing.

Server-held state per call, in a `Map` keyed by `callId`: caller, callee,
conversation, `ringing` or `connected`, and **the socket id that owns each
side**. That last part is what makes "a caller who disconnects ends the call"
work with one account in several tabs: every tab of the callee rings, but only
the socket that answered is a party, so closing one of the others does nothing
and closing the one in the call ends it. Ended calls are deleted, not marked.
It is per-process, exactly like presence: correct on one box, wrong the day
there are two, and both break together.

Rules the state buys, all tested:

- A second offer to somebody in a call, ringing or connected, is refused with
  `busy`. An offer from somebody who is themselves in a call, from any tab, is
  refused with `in_call`. Glare (both press call at once) therefore resolves
  itself: whichever offer the server sees first is the call, the other is
  refused because its sender is by then already being rung.
- A ring expires after thirty seconds with `no_answer`.
- A party's socket going away ends the call with `disconnected`, in any state.
- Only the callee can answer or decline, only while ringing. Everything else
  that names a call the caller is not in gets `call_not_found`, never a 403,
  for the same reason conversations do it.

Authorization is the machinery that exists: `requireParticipant`, then
`requireFriendship`, so a call to somebody who has unfriended you fails the
way a message does. The session is re-checked before an offer and an answer,
as `message:send` does. Candidates and hangups are not re-checked: they are
gated on call membership that was established under a live session, and the
sweep catches a revoked one within a minute, which is the window messages
already accept.

## Stage 2: ICE credentials. Done.

`GET /calls/ice`, authenticated, returning `{ iceServers, ttlSeconds, relay }`.
`relay: false` means STUN only, either because no TURN key is configured or
because Cloudflare could not be reached, in which case the server logs a
warning and falls back rather than refusing: a call that could have gone direct
still can. The client shows a different failure message when a call fails with
no relay on offer. `/calls` is in the Caddyfile matcher and both env examples
and `DEPLOY.md` carry the two variables. `env.ts` refuses to boot with only
one of them set.

Cloudflare mints short-lived credentials from a long-lived key:

```
POST https://rtc.live.cloudflare.com/v1/turn/keys/$TURN_KEY_ID/credentials/generate-ice-servers
Authorization: Bearer $TURN_KEY_API_TOKEN
Content-Type: application/json

{"ttl": 3600}
```

It answers with a ready-made `iceServers` array covering `stun.cloudflare.com`
and TURN over UDP, TCP and TLS. Pass it through rather than reassembling it.
The TLS-on-443 entry is the one that matters on hostile networks, since it is
indistinguishable from ordinary HTTPS.

Non-negotiable: **`TURN_KEY_ID` and `TURN_KEY_API_TOKEN` live in `deploy/.env`
and are never sent to the client.** The whole point of the generate call is that
the client gets a credential that expires; shipping the key itself would hand
every visitor an unlimited TURN account. Use a one hour TTL and fetch on call
start, not at page load, so a long-lived tab does not hold a dead credential.

Two things that will bite otherwise:

- **Add `/calls` and `/calls/*` to the `@api` matcher in `deploy/Caddyfile` in
  the same commit.** A missing prefix there 404s in production while working
  perfectly in development, which is already a recorded gotcha.
- Cloudflare's TURN drops packets past roughly 5 new IPs/sec or 5 to 10 kpps
  per allocation. A 1:1 voice call is nowhere near either. Do not let that
  reassurance survive into a future group-call design unread.

Cost: relayed voice is roughly 40 MB per hour of call, against a 1,000 GB free
tier, and only the minority of calls that cannot go direct get relayed at all.
This is effectively free and should not be re-litigated at this scale.

## Stage 3: the call engine. Done.

`client/src/lib/call/engine.ts`, tested in `engine.test.ts` against a fake
peer connection, fake signalling and fake media. It is written against three
interfaces in `types.ts`: `CallSignalling` (implemented over the socket in
`lib/transport/socketTransport.ts` as `transport.calls`), `CallMedia`
(implemented by `lib/media/devices.ts`, which is where the desktop shell
substitutes) and `PeerConnectionLike` (the slice of RTCPeerConnection it uses).

What it does beyond the plan below:

- **Input volume is a Web Audio gain node** between the microphone and the
  track that is sent, because WebRTC has no gain on a track. Always built,
  even at 100%, so the slider mid-call changes a number rather than swapping a
  track under a live connection.
- **Push to talk is Ctrl+Space, held**, or the "Hold to talk" button in the
  call panel. Plain Space would activate a focused button, and the hang-up
  button is exactly the button that must not be pressed by accident.
- **Changing microphone or speaker mid-call applies to the next call**, not
  the current one. Volume, mode and sensitivity apply immediately. Swapping a
  capture device under a live connection is its own project.
- **A socket disconnect ends the call on this side too**, because the server
  has ended it and told the other side. The media would have survived a brief
  blip; consistency was chosen over that. See *Traps*.
- The gate measures the raw microphone, before the gain, so the sensitivity
  slider means the same thing it does on the settings screen.
- **Descriptions are sealed** (`sealing.ts`) before they leave and opened when
  they arrive. An offer that cannot be opened, or a caller whose key we do not
  hold, is declined without ringing; an answer that cannot be opened ends the
  call as `unreadable` and tells the server. The engine is handed a `CallSealer`
  and never touches the crypto module itself.

Use the **perfect negotiation** pattern. Two people pressing call at the same
instant is glare, and perfect negotiation resolves it with a polite and impolite
role decided from the two user ids, rather than a tiebreak we invent and get
wrong. Do not hand-roll this.

Wire it to the settings that are already stored and currently read by nobody:
`inputDeviceId`, `inputVolume`, `echoCancellation`, `noiseSuppression`,
`autoGainControl`, `inputMode` and `sensitivity`. Push to talk and the voice
gate both act on the outgoing track's `enabled` flag, which is also what mute
is. `outputDeviceId` needs `setSinkId`, which `canChooseOutput()` already probes
for.

Opus is the default audio codec everywhere and needs no configuration. Resist
touching the SDP to tune it.

## Stage 4: the UI. Done.

Ember palette, `--ember` as the only interactive colour, nothing flush against
anything else. Hanging up is ember, not red: red is a message that would not
decrypt, and ending a call is not a failure. Three pieces:

- An incoming call toast: who, accept, decline. Top right.
- An in-call bar: who, elapsed time, mute with a "you are being heard" dot,
  hang up, and the hold-to-talk button in that mode. Bottom right. When a call
  ends it lingers four seconds to say why, then goes.
- Call state in the DM header: a phone button, or an "In a call" pill when the
  call belongs to this conversation, or a disabled button when it belongs to
  another.

The toast and the bar are one component, `components/CallPanel.tsx`, and it
**floats** rather than sitting in the layout, because the settings screen is a
fixed full-window layer and a call does not stop being a call when you open
settings. `state/CallProvider.tsx` owns the engine and mounts inside
`ChatProvider`, whose socket the signalling rides.

The wrinkle to design for from the start: **one account, several tabs.** The
identity key lives in IndexedDB per origin, so two tabs are one account, and a
room broadcast rings all of them. First to answer wins and the others must
silence themselves, which needs a `call:claimed` echo to the answering user's
own room. This is the same reason `read` includes the reader in its broadcast.

## Stage 5: call records. Not started.

The first thing here that touches the schema, which is why it is last. A missed
call that leaves no trace is a bad messenger, so this should happen, just not
before voice works at all.

Decide then, not now, between a `Message` variant carrying a call summary and a
separate `Call` table. The former puts it in the timeline for free and abuses a
model whose every row is currently a sealed envelope; the latter is cleaner and
needs its own merge into the message list. Lean towards the separate table.

## Stage 6. Not started.

- Video. The settings are already there.
- Binding the DTLS fingerprint to the identity key, with phase 2.

---

## Not in scope, and why

- **Group calls.** DMs only, and N>2 means an SFU, which means a box that can
  hear the call, which means SFrame and `RTCRtpScriptTransform` to claw the
  privacy back. All three are cross-browser now, so this is possible, it is just
  a different project. Do not let a "quick mesh for three people" land instead:
  a mesh is N squared connections and it falls over at four.
- **Screen sharing.** `getDisplayMedia`, and a whole second track lifecycle.
- **Recording.** Nothing about this app should grow a recorder.
- **Calling somebody who is not a friend.** Friendship is the authorization gate
  for conversations and it is the gate for calls.

## Traps, written down in advance

- **`Permissions-Policy` is production only.** Stage 0. Anything media-related
  that works in dev proves nothing about the deployed site.
- **CSP does not gate WebRTC.** `connect-src 'self'` does not restrict
  `RTCPeerConnection`; ICE, STUN and TURN bypass CSP in every shipping browser.
  So no CSP change is needed for calls to work, and the strict CSP in the
  Caddyfile is not protecting this path. Both halves of that are worth knowing.
- **The tunnel carries no UDP.** This is why TURN is Cloudflare's. If anyone
  ever proposes self-hosting coturn "to avoid the dependency", it needs an
  inbound public UDP port on the mini PC, which is the one thing the deployment
  is designed not to have.
- **A socket outlives its access token.** Re-check the session before relaying
  signalling, as `message:send` does.
- **Presence and call state are both per-process.** Correct on one box, wrong on
  two. Consistent with what is already there, and both break together.
- **A socket disconnect ends the call, on both sides, even though the media
  would have survived it.** The server cannot tell a closed tab from a
  fifteen-second wifi blip, and a call it never learns the end of leaves both
  people "busy" until the process restarts. So it ends the call the moment the
  socket goes, and the client agrees when its own socket drops. The cost is a
  dropped call on a flaky connection where the audio itself would have carried
  on. A grace period keyed on the same user reconnecting would fix it and is
  the first thing to add if this bites.
- **Every test here runs against fakes or a loopback socket.** The server
  suite relays hand-written SDP strings; the engine suite drives a fake
  RTCPeerConnection that fires `negotiationneeded` on the browser's rule. The
  first real call, on the live site on 2026-09-07, is what proved two Chromes
  agree; anything that changes negotiation wants that walk-through again.
- **A phone plays calls through the loudspeaker, and only Android Chrome lets
  a page change that.** The earpiece toggle is a label match on the output
  device list ("Earpiece", "Speakerphone") behind `setSinkId`, and it is hidden
  when there is nothing to match. iOS Safari has no `setSinkId`, so an iPhone
  keeps the loudspeaker until Apple ships one.
- **The desktop shell may not be able to do this.** `desktop/` is empty, but when
  it lands, WebRTC support depends on the webview: WebView2 on Windows is
  Chromium and fine, WKWebView on macOS is limited and WebKitGTK on Linux
  denies media permission by default unless the shell handles the permission
  signal. Calls may be web-first for a while. This is not a reason to change
  anything now, only a reason not to promise it.
