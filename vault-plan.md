# vault-plan.md

A private space in the app that only you can open: notes to yourself, kept
behind a passkey that is not your account password.

Read [`STATUS.md`](STATUS.md) first for where the project is; this file is only
about the vault. It follows the same convention as
[`backend-plan.md`](backend-plan.md), [`messaging-plan.md`](messaging-plan.md),
[`settings-plan.md`](settings-plan.md) and [`voice-plan.md`](voice-plan.md): a
plan that gets edited as it is executed, not a record of what was decided.

**Where it stands, 2026-09-08:** stage 1 is being built. Stages 2 and 3 are
untouched and stage 2 needs work in `server/`, which is the other maintainer's
half.

---

## The shape of it in one paragraph

A third place to be, beside Direct and Friends, that looks like a conversation
with yourself. You write into it the way you write a message, and what you
wrote is sealed under a key that only your passkey opens. The passkey is not
the account password: it is a second, shorter secret whose whole job is that
an unlocked screen is not an open vault. Losing it is survivable, because the
same vault key is wrapped a second time under your account password, which is
exactly the trick the recovery code already plays on your private key. Stage 1
keeps everything on this device. Stage 2 puts it on the wire as a conversation
with one participant, so it follows you to another browser.

## Decisions, settled up front

| Question | Answer | Why |
|---|---|---|
| Where it lives in the UI | A third pill in the activity bar, beside Direct and Friends | It behaves like a chat, and the composer, the message list and the history rendering already exist. A hidden gesture would be a feature nobody finds. |
| Device only, or synced | **Device only in stage 1** | Syncing needs a conversation with one participant and `openDm` refuses that today (`cannot_dm_self`). That is server work, so it is its own stage rather than a blocker. |
| Passkey, or reuse the account password | **A separate passkey** | The point is a second gate. Reusing the password would mean anyone at your unlocked screen is already inside. |
| What the passkey actually does | Wraps a random 32 byte vault key with Argon2id, under its own domain label | A UI check that hides a tab is theatre: the data would still be readable by anything that can read the store. |
| Forgot it, or want to change it | The account password opens a **second wrap of the same vault key** | Identical in shape to blob_A and blob_B in `packages/crypto`. No new primitive, no new failure mode, and the entries never have to be re-encrypted. |
| Digits, or letters and digits | **Your choice**, with different minimum lengths | Six digits is a million guesses. Eight letters and digits is around forty bits. The UI has to say which one you picked, not pretend they are the same. |
| Attachments | **Stage 3** | There is no blob storage anywhere in this app yet. Avatars are data URLs in `localStorage`, which is not a foundation to put photographs on. |
| Does signing out destroy it | **No** | `keyManager.forget()` removes its own keys rather than clearing the store, so the vault survives under its own key, namespaced by user id. It is sealed under the passkey either way. |

## The encryption story, stated honestly

**The vault is really encrypted today, and messages are not.** Phase 1 makes
`encryptMessage()` a no-op, but the credential half of `packages/crypto`
(Argon2id, `crypto_secretbox`) is real and always has been. The vault uses that
half, so it gets genuine encryption now, the way voice already does over
DTLS-SRTP. This is worth saying out loud because it inverts the usual
assumption in this repo.

That does not make the vault stronger than your passkey.

- A six digit passkey is a million possibilities. Argon2id at interactive cost
  turns an offline guessing run against a stolen blob from instant into slow,
  not into impossible. If the threat you have in mind is someone who takes the
  laptop, pick letters and digits.
- What a short passkey does buy is the realistic threat: your session is open,
  someone else picks up the machine, and the vault is still shut.
- The vault key never leaves this device in stage 1, and in stage 2 it still
  never leaves: what goes on the wire is the sealed entry, sealed *again* by
  the message pipeline on its way out.

**The rule this does not break.** Root `AGENTS.md` says every message read and
write goes through `encryptMessage()`/`decryptMessage()` and that the seam must
not be bypassed. Stage 1 does not touch that seam at all, because a local vault
entry is not a message on a wire. When stage 2 makes entries into real
messages, they go through that seam like everything else, with the vault
sealing *inside* the body:

```
envelope body = encryptMessage(sealWithKey(entry, vaultKey), ...)
```

Both properties hold at once: the pipeline is used as the rules require, and
the content is genuinely sealed even while the outer layer is still a no-op.

## Stage 1: the vault on this device

1. **`packages/crypto`.** Two additions, no new primitives:
   - `DOMAIN.vault` and `DOMAIN.vaultReset`, two more frozen labels beside
     `keywrap`, `recovery` and `device`. The labels are what stop the passkey
     wrap and the password wrap from opening each other.
   - `sealWithKey(plaintext, key)` and `openWithKey(sealed, key)`, a
     `crypto_secretbox` round trip over a 32 byte key, with the nonce stored
     beside the body in the same self-describing shape `WrappedKey` uses. This
     is the one thing the package cannot already do: it can wrap a key under a
     *secret*, and the vault also needs to seal a *document* under a key.
2. **The store.** `client/src/lib/vault/`: a vault key generated once, wrapped
   twice (passkey, account password), and a sealed document of entries. All of
   it goes through the existing `SecureStore`, under keys namespaced by user id,
   so nothing new is needed in IndexedDB.
3. **State.** A `VaultProvider` holding the unwrapped vault key in memory only.
   Locking the app drops it, the same way locking drops the private key.
4. **UI.** A Vault pill in the activity bar; a lock screen when it is shut; the
   existing message list and composer when it is open; a setup flow the first
   time that takes the passkey twice and the account password once.
5. **Settings.** A Vault section: change the passkey (with the current passkey
   or the account password), and forget the vault on this device, which says
   plainly that the entries go with it.
6. **Tests.** The wrapping round trip, the wrong passkey, the reset path, the
   passkey policy and the entry document surviving a save and load.

## Stage 2: make it follow you

Needs `server/`, so it needs the other maintainer.

- A conversation with exactly one participant. `openDm` throws
  `cannot_dm_self` today and `areFriends` returns false for a self pair, so
  this is a new kind rather than a relaxed check: `POST /conversations/vault`,
  idempotent, one participant, no friendship gate.
- Everything else is already built. The envelope model seals a copy per
  participant *including the sender*, so a conversation of one is the
  degenerate case of something that already works, not a new path.
- The client then stores entries as messages rather than as a local document,
  with the vault seal inside the body as described above.

## Stage 3: pictures

The one with real weight, and the reason it is last.

- Needs blob storage: an upload endpoint, a size limit, a retention rule and a
  decision about where bytes live on the box.
- Needs sealing binary rather than text, which `sealWithKey` already does, plus
  a thumbnail path that does not decrypt the whole file to draw a preview.
- Needs a quota, because "keep your own stuff" is exactly the feature that
  fills a disk.

## Later, maybe

- An auto-lock timer, so the vault shuts on its own after some idle minutes.
- A wrong-passkey delay, which matters much more for six digits than for eight
  characters.
- Export, which is the honest answer to "what if I stop using this app".
