/**
 * Every word the app says, in English.
 *
 * This is the source of truth, not a translation of one. `Key` is derived from
 * it, `t()` is typed against `Key`, and every other catalogue is a
 * `Partial<Record<Key, Message>>`, so `tsc` refuses a key that does not exist
 * here and refuses a translation that invents one. That check is what made
 * moving four hundred strings out of the components a survivable exercise.
 *
 * Conventions, so the file stays navigable:
 *
 *   - Keys are `area.thing`, grouped by the screen they belong to, in the
 *     order a person meets them.
 *   - `{name}` placeholders are substituted by `t(key, { name })`. A `count`
 *     placeholder also picks the plural form.
 *   - Anything a person wrote (messages, nicknames, profile text, vault notes)
 *     is never in here. It is shown as it was written.
 *
 * The house style still applies: no em dashes, no Oxford commas, and no
 * claiming more about encryption than the app can back. See i18n-plan.md for
 * why the security words in particular need care in translation.
 */
import type { Message } from './translate';

export const en = {
  /* --- shared ----------------------------------------------------------- */

  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.close': 'Close',
  'common.remove': 'Remove',
  'common.delete': 'Delete',
  'common.wrong': 'Something went wrong.',
  'common.unknown': 'unknown',
  'common.today': 'today',
  'common.yesterday': 'yesterday',

  /* --- the settings shell ----------------------------------------------- */

  'settings.nav': 'Settings sections',
  'settings.back': 'Settings',
  'settings.close': 'Close settings',
  'settings.lock': 'Lock',
  'settings.signOut': 'Sign out',
  'settings.group.you': 'you',
  'settings.group.app': 'app',

  'settings.section.account': 'My account',
  'settings.lede.account':
    'Your credentials, and the two of them that can only be changed from a device holding your key.',
  'settings.section.profile': 'Profile',
  'settings.lede.profile': 'The pictures, the name and what you say about yourself.',
  'settings.section.privacy': 'Privacy',
  'settings.lede.privacy':
    'What people can tell about you once the messages themselves are sealed.',
  'settings.section.devices': 'Devices & keys',
  'settings.lede.devices':
    'Your security number, your recovery code and everywhere you are signed in.',
  'settings.section.vault': 'Vault',
  'settings.lede.vault':
    'The passkey that opens your own space, and the one way to get rid of it.',
  'settings.section.language': 'Language',
  'settings.lede.language': 'Which language the app speaks to you in.',
  'settings.section.appearance': 'Appearance',
  'settings.lede.appearance':
    'How the app looks and how much room it gives a conversation.',
  'settings.section.voice': 'Voice & video',
  'settings.lede.voice':
    'Which hardware a call would use, and a way to check it works before one starts.',
  'settings.section.notifications': 'Notifications',
  'settings.lede.notifications':
    'What interrupts you, and how much of a message it is allowed to show.',
  'settings.section.desktop': 'Desktop',
  'settings.lede.desktop':
    'The app around the app: updates, the tray and starting with your computer.',

  /* --- language --------------------------------------------------------- */

  'language.group': 'language',
  'language.pick': 'Language',
  'language.pickHint':
    'Dates and times change with it. What people have written to you does not: their words are shown as they wrote them.',
  'language.system': 'Match my browser',
  'language.systemHint': 'Currently {name}.',
  'language.note':
    'Your language stays on this device, like every other preference here. The server is not told which one you picked, for the same reason it is not told anything else about you.',

  /* --- privacy ---------------------------------------------------------- */

  'privacy.group.reveal': 'what you reveal',
  'privacy.readReceipts': 'Read receipts',
  'privacy.readReceiptsHint':
    'Lets the other person see when you have opened their message. Off, the server stops telling them; your own devices still keep the count in step.',
  'privacy.typing': 'Typing indicators',
  'privacy.typingHint':
    'Shows the other person that you are writing something, including the drafts you delete. Off, this device simply never says so.',
  'privacy.group.reach': 'who can reach you',
  'privacy.requestsFrom': 'Friend requests from',
  'privacy.requestsHint':
    'Messages already only come from friends. This is about who gets to ask. Anyone outside the choice is told you do not exist.',
  'privacy.requests.everyone': 'Anyone',
  'privacy.requests.friendsOfFriends': 'Friends of friends',
  'privacy.requests.nobody': 'No one',
  'privacy.note':
    'None of this changes what the server can read of your messages, which is nothing. Two of these choices are kept on the server, because it is the server that would otherwise pass on a read or let a request through.',

  /* --- the vault -------------------------------------------------------- */

  'vault.kind.digits': 'Digits',
  'vault.kind.digitsHint': 'A PIN. Quick to type, and the shorter of the two.',
  'vault.kind.mixed': 'Letters and digits',
  'vault.kind.mixedHint': 'Longer to type, and far harder to guess.',

  'vault.problem.minDigits': 'Use at least {min} digits.',
  'vault.problem.minChars': 'Use at least {min} characters.',
  'vault.problem.maxDigits': 'Use at most {max} digits.',
  'vault.problem.maxChars': 'Use at most {max} characters.',
  'vault.problem.digitsOnly': 'Digits only, no letters.',
  'vault.problem.alnumOnly': 'Letters and digits only.',
  'vault.problem.repeated': 'That is a single repeated character.',
  'vault.problem.sequence': 'That is a straight run of characters.',

  'vault.combos.none': 'none yet',
  'vault.combos.thousand': 'about {count} thousand combinations',
  'vault.combos.million': 'about {count} million combinations',
  'vault.combos.billion': 'about {count} billion combinations',
  'vault.combos.beyond': 'more combinations than anyone will get through',

  'vault.title': 'Vault',
  'vault.field.passkey': 'Passkey',
  'vault.field.passkeyAgain': 'Passkey again',
  'vault.field.password': 'Your account password',

  'vault.setup.title': 'Make a vault',
  'vault.setup.lede':
    'Somewhere to keep your own things. Sealed with a key that only your passkey opens, so it stays shut even while you are signed in.',
  'vault.setup.kind': 'Passkey type',
  'vault.setup.note':
    'Taken once, now, so that forgetting the passkey is survivable: the same vault key is sealed a second time under your password, and neither seal opens the other. Nothing here is sent to the server.',
  'vault.setup.mismatch': 'The two passkeys do not match.',
  'vault.setup.sealing': 'Sealing\u2026',
  'vault.setup.go': 'Make the vault',

  'vault.unlock.lede': 'Locked. {kind}, as you set it.',
  'vault.unlock.forgotLede':
    'Your account password opens it too. You can set a new passkey afterwards in Settings.',
  'vault.unlock.opening': 'Opening\u2026',
  'vault.unlock.go': 'Open',
  'vault.unlock.forgot': 'I have forgotten the passkey',
  'vault.unlock.usePasskey': 'Use the passkey instead',

  'vault.open.empty': 'Empty. Anything you write here stays on this device.',
  'vault.open.count': {
    one: '{count} note, on this device',
    other: '{count} notes, on this device',
  },
  'vault.open.lock': 'Lock',
  'vault.open.blank':
    'Notes to yourself, a number you keep forgetting, the thing you did not want in a chat. Pictures come later.',
  'vault.open.deleteNote': 'Delete this note',
  'vault.open.composer': 'keep something',

  'vault.error.noVault': 'There is no vault on this device yet.',
  'vault.error.wrongSecret': 'Could not unlock this key with the secret provided.',
  'vault.error.wrongPassword': 'That is not your account password.',
  'vault.error.generic': 'That did not work. Try again.',

  'vault.settings.absent': 'No vault on this device',
  'vault.settings.absentHint':
    'Open Vault in the activity bar to make one. It takes a passkey and your account password, once.',
  'vault.settings.group': 'passkey',
  'vault.settings.shape': 'Shape',
  'vault.settings.shapeHint':
    'Digits are quicker to type. Letters and digits are far harder to guess, and the difference is not small.',
  'vault.settings.newPasskey': 'New passkey',
  'vault.settings.change': 'Change the passkey',
  'vault.settings.changing': 'Changing\u2026',
  'vault.settings.changed': 'changed',
  'vault.settings.note':
    'Changing the passkey re-seals the vault key, not the notes. Nothing in the vault is rewritten, and nothing about it reaches the server.',
  'vault.settings.dangerGroup': 'danger',
  'vault.settings.forget': 'Forget the vault',
  'vault.settings.forgetHint': 'Deletes the vault and everything in it from this device.',
  'vault.settings.forgetCount': {
    one: 'That is {count} note.',
    other: 'That is {count} notes.',
  },
  'vault.settings.forgetEmpty': 'It is currently empty.',
  'vault.settings.forgetShut':
    'Whatever is in it goes with it, and it is shut, so this cannot say how much.',
  'vault.settings.forgetFinal': 'There is no copy anywhere else, so this cannot be undone.',
  'vault.settings.deleteIt': 'Delete it',
  'vault.settings.keepIt': 'Keep it',

  /* --- appearance ------------------------------------------------------- */

  'appearance.group.theme': 'theme',
  'appearance.group.themeHint':
    'Light or dark is one choice and the colours are another, so every palette works in both. Green is missing on purpose: it means encrypted here, and nothing else gets to use it.',
  'appearance.mode': 'Mode',
  'appearance.modeHint': 'Applies immediately, everywhere.',
  'appearance.modeFollowing': 'Following this device, which is currently {mode}.',
  'appearance.theme.dark': 'Dark',
  'appearance.theme.light': 'Light',
  'appearance.theme.system': 'System',
  'appearance.palette': 'Palette',
  'appearance.paletteHint':
    'Each one is a full set of colours, not a tint on the same app.',
  'appearance.custom': 'Custom',
  'appearance.customAccent': 'Your accent',
  'appearance.customAccentHint':
    'Buttons, links and your own messages. The text drawn on top of it turns black or white to stay readable, whichever colour you pick.',
  'appearance.customTint': 'Your tint',
  'appearance.customTintHint':
    'The hue the greys lean towards: the backdrop, the panels and the lines between them. Two colours rather than twenty, because the rest are mixed from these so panels stay lighter than the ground in the dark and darker than it in daylight.',

  'appearance.group.wallpaper': 'wallpaper',
  'appearance.group.wallpaperHint':
    'A picture behind the app, with the panels going slightly see-through so it shows. Stored on this device at 1600 by 900 and never sent anywhere.',
  'appearance.wallpaper': 'Picture',
  'appearance.wallpaperHint': 'Scaled to cover the window, whatever shape it is.',
  'appearance.dim': 'Dim',
  'appearance.dimHint': 'How much of the theme sits between the picture and the app.',
  'appearance.blur': 'Blur',
  'appearance.blurHint':
    'A busy photo behind text is a photo you cannot read text on. This is the fix.',

  'appearance.group.layout': 'layout',
  'appearance.bar': 'Activity bar',
  'appearance.barHint':
    'Which edge Direct and Friends sit on. A window too narrow for a rail beside the conversation puts a side bar along the bottom until there is room for it again.',
  'appearance.bar.top': 'Top',
  'appearance.bar.left': 'Left',
  'appearance.bar.right': 'Right',
  'appearance.bar.bottom': 'Bottom',

  'appearance.group.messages': 'messages',
  'appearance.spacing': 'Spacing',
  'appearance.spacingHint': 'How much room a conversation gives each turn.',
  'appearance.density.cozy': 'Cozy',
  'appearance.density.compact': 'Compact',
  'appearance.textSize': 'Text size',
  'appearance.textSizeHint': 'Message text only. The rest of the app stays put.',
  'appearance.previewIn': 'Did the new key land on your side?',
  'appearance.previewOut': 'Same number as yours. We are good.',

  'appearance.group.motion': 'motion',
  'appearance.reduceMotion': 'Reduce motion',
  'appearance.reduceMotionHint': 'Cuts transitions and animations across the app.',

  'appearance.group.advanced': 'advanced',
  'appearance.ciphertext': 'Show ciphertext',
  'appearance.ciphertextHint':
    'Prints the sealed bytes under every message, as the server stores them. Useful for seeing that encryption is really happening; noisy for actually reading anything.',
  'appearance.note':
    'Appearance is stored on this device. Signing in somewhere else starts from the defaults there.',

  /* --- presence --------------------------------------------------------- */

  'presence.online': 'Online',
  'presence.idle': 'Idle',
  'presence.dnd': 'Do not disturb',
  'presence.offline': 'Offline',
  'presence.invisible': 'Invisible',

  /* --- your profile ----------------------------------------------------- */

  'profile.group.picture': 'picture',
  'profile.avatar': 'Avatar',
  'profile.avatarHint':
    'You pick the square; it is scaled to 128px. Everything the file carried (including where a phone photo was taken) is dropped in the process.',
  'profile.banner': 'Banner',
  'profile.bannerHint':
    'The band across the top of your card. Wide and short, so a photo of a face is rarely the right one.',
  'profile.upload': 'Upload',
  'profile.replace': 'Replace',
  'profile.badImage': 'That image could not be used.',
  'profile.accent': 'Accent',
  'profile.accentAuto': 'Auto, a colour picked from your account',
  'profile.accentHint': 'Used behind your name and wherever your picture does not fit.',
  'profile.accentHintNoPic': 'The tile you get until you upload a picture.',

  'profile.group.identity': 'identity',
  'profile.displayName': 'Display name',
  'profile.displayNameHint':
    'What people see instead of your username. Leave it empty to use your username.',
  'profile.presence': 'Presence',
  'profile.presenceHint': 'What your contacts are told you are up to.',
  'profile.group.about': 'about you',
  'profile.aboutHint':
    'A few lines about yourself, in your own words. Line breaks are kept exactly as you type them.',
  'profile.about': 'About',
  'profile.aboutPlaceholder':
    'What you are into, where you are, when you are usually around. Anything you would want somebody to know before they message you.',
  'profile.note':
    'Your name, picture, banner, accent, presence and about text are kept on the server in the clear and shown to your friends only. Everything else in settings, the saved profiles included, stays on this device.',
  'profile.reset': 'Reset profile',

  'profile.group.profiles': 'profiles',
  'profile.saved': 'Saved profiles',
  'profile.new': 'New',
  'profile.name': 'Name',
  'profile.nameHint':
    'Only you ever see this. Everything else on this page belongs to the profile it is under, and is saved as you type.',
  'profile.nameFor': 'Name for this profile',
  'profile.duplicate': 'Duplicate',
  'profile.copyOf': '{name} copy',
  'profile.deleteNote':
    'Forgetting a saved profile does not change how you look now. The one you are wearing stays exactly as it is, it just stops belonging to a name.',
  'profile.keepThis': 'Keep this one',
  'profile.keepThisHint':
    'Save how you look right now under a name. Then make another, and switch between them whenever you feel like it.',
  'profile.notSaved': 'Not saved',
  'profile.notSavedHint':
    'You are not wearing any of the saved profiles. Save this look too, or pick one above.',
  'profile.limit': 'That is all {max} of them. Delete one to make another.',
  'profile.limitShort': '{max} is the limit.',

  /* --- somebody's profile card ------------------------------------------ */

  'userProfile.close': 'Close profile',
  'userProfile.status': 'Status',
  'userProfile.nickname': 'Nickname',
  'userProfile.onlyYou': 'only you see this',
  'userProfile.friendsSince': 'Friends since',
  'userProfile.message': 'Message',
  'userProfile.addNickname': 'Add nickname',
  'userProfile.changeNickname': 'Change nickname',
  'userProfile.unfriend': 'Remove friend',
  'userProfile.block': 'Block',

  /* --- password rules --------------------------------------------------- */

  'password.problem.short': 'Use at least {min} characters.',
  'password.problem.common': 'That is based on a very common password.',
  'password.problem.repeated': 'That is a single repeated character.',
  'password.problem.sequence': 'That is a keyboard or alphabet sequence.',
  'password.problem.email': 'Do not use your email in your password.',
  'password.problem.username': 'Do not use your username in your password.',

  /* --- the account ------------------------------------------------------ */

  'account.signedOut':
    'You are not signed in to a server, so there is no account to change. Everything else in settings still works: it all belongs to this device.',
  'account.group': 'account',
  'account.username': 'Username',
  'account.usernameHint': 'How you are addressed. Visible to anyone you talk to.',
  'account.email': 'Email',
  'account.emailHint':
    'Used to sign in, and to reach you if you ever lose your password.',
  'account.unverifiedHint': 'Not verified yet.',
  'account.unverified': 'unverified',
  'account.since': 'Member since',
  'account.lastLogin': 'Last sign-in',

  'account.group.username': 'change username',
  'account.newUsername': 'New username',
  'account.usernameDone': 'Username updated.',
  'account.saving': 'Saving\u2026',

  'account.group.email': 'change email',
  'account.group.emailHint':
    'Your sign-in key is derived from your address, so changing it re-derives that too. Your messages are unaffected: they are wrapped under a key that does not depend on your email.',
  'account.newEmail': 'New email',
  'account.emailSent': 'Check the new address for a confirmation link.',
  'account.sending': 'Sending\u2026',
  'account.sendConfirmation': 'Send confirmation',

  'account.group.password': 'change password',
  'account.group.passwordHint':
    'Your password never leaves this device. It re-wraps your private key here, and only the wrapped result is uploaded. Your recovery code keeps working.',
  'account.password': 'Password',
  'account.currentPassword': 'Current password',
  'account.newPassword': 'New password',
  'account.confirmPassword': 'Confirm new password',
  'account.mismatch': 'Those do not match.',
  'account.changePassword': 'Change password',
  'account.changing': 'Changing\u2026',
  'account.passwordDone': 'Password changed.',

  'account.delete': 'Delete this account',
  'account.deleteHint':
    'Your messages are encrypted to a key only you hold. Deleting the account destroys that key, so nothing that was ever sent to you can be read again, by you or by anyone. There is no way back.',
  'account.deleteButton': 'Delete account',
  'account.typeToConfirm': 'Type {email} to confirm',
  'account.deleteForever': 'Delete permanently',
  'account.deleting': 'Deleting\u2026',
  'account.deleteDone': 'Account deleted.',

  /* --- devices and keys ------------------------------------------------- */

  'devices.group.number': 'security number',
  'devices.noKey': 'No key on this device yet, so there is no number to compare.',
  'devices.deviceLocked': 'This device is locked. Unlock it to see your security number.',
  'devices.needAccount':
    'Sessions and the recovery code live on the server, so they need a signed-in account.',
  'devices.gate': 'Hidden until you confirm it is you',
  'devices.gateWhy':
    'Your security number and your recovery code are both behind this. You unlocked this device a while ago; this asks again before putting either of them on screen.',
  'devices.gateHint':
    'Checked on this device against your own stored key. Nothing is sent anywhere, and your password is not stored by this screen.',
  'devices.wrongPassword': 'That is not your password.',
  'devices.checking': 'Checking\u2026',
  'devices.reveal': 'Reveal',
  'devices.numberHint':
    'Read it to each other out loud, or compare it in person. If two devices show the same number, nobody is sitting in the middle of your conversation. If it ever changes without an explanation, stop and ask why before you send anything.',
  'devices.noFingerprint': 'This device is not holding a key to fingerprint.',
  'devices.keyState': 'Key state',
  'devices.state.unlocked': 'Unlocked. Messages can be read on this device',
  'devices.state.locked': 'Locked. The key is here but the password is not',
  'devices.state.empty': 'No key on this device',
  'devices.hide': 'Hide again',

  'devices.group.recovery': 'recovery code',
  'devices.newCode':
    'This is your new code. The old one stopped working the moment this one was made, and this is the only time it will be shown.',
  'devices.savedIt': 'I have saved it',
  'devices.recoveryHint':
    'The one thing that can open your messages without your password. Regenerating mints a new code and retires the old one; your messages and your security number are untouched.',
  'devices.recoveryNote':
    'Your existing code cannot be shown again. Only its hash is on the server, and the copy of your key it guards is locked with the code itself, so there is nothing here that could be decoded back into it. If you have lost it, make a new one.',
  'devices.generateNew': 'Generate a new code',
  'devices.recoveryPasswordHint':
    'Needed to unwrap the key before it can be re-wrapped under the new code.',
  'devices.generate': 'Generate',
  'devices.generating': 'Generating\u2026',
  'devices.recoveryDone': 'New recovery code created.',

  'devices.group.sessions': 'signed in',
  'devices.sessionsHint':
    'Signing a session out ends its access to the server. It does not reach into that device and delete anything already decrypted there.',
  'devices.loading': 'Loading\u2026',
  'devices.noSessions': 'No other sessions.',
  'devices.unknownDevice': 'Unknown device',
  'devices.thisDevice': 'this device',
  'devices.since': 'since {day}',
  'devices.signingOut': 'Signing out\u2026',
  'devices.refresh': 'Refresh',
  'devices.signOutEverywhere': 'Sign out everywhere',

  /* --- sound names ------------------------------------------------------ */

  'sound.ding': 'Ding',
  'sound.orb': 'Orb',
  'sound.bell': 'Bell',
  'sound.blip': 'Blip',
  'sound.knock': 'Knock',
  'sound.glass': 'Glass',
  'sound.hush': 'Hush',
  'sound.chirp': 'Chirp',
  'sound.arpeggio': 'Arpeggio',
  'sound.villageBells': 'Village bells',
  'sound.hollow': 'Hollow',
  'sound.clock': 'Clock',
  'sound.ripple': 'Ripple',
  'sound.door': 'Door',
  'sound.fanfare': 'Fanfare',
  'sound.ringback': 'Ringback',
  'sound.connected': 'Connected',
  'sound.hungUp': 'Hung up',

  /* --- notifications ---------------------------------------------------- */

  'notify.group.pause': 'pause',
  'notify.pause': 'Pause notifications',
  'notify.pauseHint': 'Nothing will sound or pop up while paused. Messages still arrive.',
  'notify.paused': 'Paused {when}.',
  'notify.untilYouSay': 'until you turn it back on',
  'notify.untilTime': 'until {time}',
  'notify.resume': 'Resume',
  'notify.mute.30m': '30 minutes',
  'notify.mute.2h': '2 hours',
  'notify.mute.tomorrow': 'Until tomorrow',
  'notify.mute.forever': 'Until I turn it back on',

  'notify.group.desktop': 'desktop',
  'notify.unsupported': 'This build cannot show desktop notifications.',
  'notify.denied':
    'Notifications are blocked for this app in your browser or system settings. That has to be changed there, because this screen cannot override it.',
  'notify.desktop': 'Desktop notifications',
  'notify.desktopHint':
    'A popup when a message arrives while the app is in the background.',
  'notify.allow': 'Allow',
  'notify.preview': 'Show message text in notifications',
  'notify.previewHint':
    "Off, a notification says only that someone messaged you. On, it includes what they said, which hands decrypted text to the operating system's notification centre, where it may be logged, mirrored to another device or shown on a locked screen.",
  'notify.previewWarn':
    "Message text will leave the app's control every time a notification is shown.",
  'notify.toast':
    'Show a popup in the app',
  'notify.toastHint':
    'A card in the corner when a message lands in a conversation you are not reading. The exact opposite of a desktop notification: this one appears only while you can see the app, that one only while you cannot, so a message raises one or the other and never both.',
  'notify.toastPreview':
    'Show message text in popups',
  'notify.toastPreviewHint':
    'Separate from the setting above, because the risk is not the same. A popup is drawn inside a window you are already looking at and goes nowhere else, so it starts on. Turn it off if people read over your shoulder.',
  'notify.toastDismiss':
    'Dismiss',
  'notify.test': 'Try one',
  'notify.testHint':
    'Notifications only appear while this window is in the background, so this is the one alert you cannot check by switching it on and waiting.',
  'notify.testSend': 'Show one now',
  'notify.testTitle': 'Cipher',
  'notify.testBody': 'Notifications are working. This is what one looks like.',
  'notify.mentionedYou': 'Mentioned you',

  'notify.group.sounds': 'sounds',
  'notify.newMessage': 'New message',
  'notify.soundOnMessage': 'Sound on new message',
  'notify.messageSound': 'Message sound',
  'notify.messageSoundHint':
    'Every sound is synthesised, so none of them cost the app a download.',
  'notify.ringtone': 'Call ringtone',
  'notify.ringtoneHint': 'Plays until you answer, so pick one you can stand hearing twice.',
  'notify.mentions': 'Mentions',
  'notify.mentionsHint': 'Kept separate so you can go quiet without going deaf.',
  'notify.soundOnMention': 'Sound on mention',
  'notify.sent': 'Message sent',
  'notify.soundOnSend': 'Sound on message sent',
  'notify.play': 'Play {what}',

  'notify.group.perPerson': 'per person',
  'notify.perPersonEmpty':
    'Add someone under Friends and they show up here, with their own message sound and ringtone.',
  'notify.perPersonLede':
    'Give the people you hear from most their own sound. Anyone left on "Same for everyone" uses the two settings above.',
  'notify.sameForEveryone': 'Same for everyone',
  'notify.messageSoundFor': 'Message sound for {name}',
  'notify.ringtoneFor': 'Ringtone for {name}',
  'notify.defaultMessageSound': 'the default message sound',
  'notify.defaultRingtone': 'the default ringtone',

  'notify.group.badges': 'badges',
  'notify.badge': 'Unread count',
  'notify.badgeHint': 'The number on the app icon and in the tab title.',

  'notify.callTitle': 'Incoming call',
  'notify.callFrom': '{name} is calling.',
  'notify.callSomeone': 'Someone is calling you.',

  /* --- the desktop app -------------------------------------------------- */

  'desktop.notDesktop':
    'This build is not running inside the desktop app, so there is nothing here to set.',
  'desktop.group.app': 'this app',
  'desktop.version': 'Version',
  'desktop.versionHint': 'The installed desktop app. The chat itself ships inside it.',
  'desktop.updates': 'Updates',
  'desktop.updatesHint':
    'Checked when the app starts and every few hours after that. An update is only ever installed when you say so.',
  'desktop.installVersion': 'Install {version} and restart',
  'desktop.checkNow': 'Check now',
  'desktop.checking': 'Checking…',
  'desktop.upToDate': 'You have the latest version.',
  'desktop.devBuild': 'This is a development build. It never checks for updates.',
  'desktop.checkFailed': 'Could not check: {message}',
  'desktop.ready': 'Cipher {version} is ready.',
  'desktop.noRestart':
    'The update was installed but the app did not restart. Start it again by hand.',
  'desktop.group.window': 'window',
  'desktop.closeToTray': 'Keep running when the window is closed',
  'desktop.closeToTrayHint':
    'The app stays in the tray, so messages and calls still reach you. Off, closing the window quits. Quit from the tray menu either way.',
  'desktop.autostart': 'Start when you sign in to your computer',
  'desktop.autostartHint':
    'Opens in the tray without showing the window, so you are reachable before you have thought about it.',

  'update.ready': 'Cipher {version} is ready to install.',
  'update.failed': 'Could not update: {message}',
  'update.restart': 'Restart to update',
  'update.later': 'Later',
  'update.downloading': 'Downloading…',
  'update.downloadingPercent': 'Downloading… {percent}%',
  'update.downloadingBytes': 'Downloading… {amount}',
  'update.installing': 'Verifying and installing…',

  /* --- voice and video -------------------------------------------------- */

  'voice.unsupported':
    'This build has no access to media devices, so there is nothing to configure here.',
  'voice.unnamed':
    'Your browser hides device names until you allow access once. Until then the lists below are unnamed.',
  'voice.allowMic': 'Allow microphone',
  'voice.allowCamera': 'Allow camera',
  'voice.systemDefault': 'System default',

  'voice.group.voice': 'voice',
  'voice.input': 'Input device',
  'voice.inputHint': 'Which microphone calls use.',
  'voice.inputVolume': 'Input volume',
  'voice.output': 'Output device',
  'voice.outputHint': 'Where call audio is played.',
  'voice.outputFixed':
    'This browser always plays through the system default, so there is nothing to pick.',
  'voice.outputVolume': 'Output volume',

  'voice.group.mode': 'input mode',
  'voice.whenOpen': 'When your mic is open',
  'voice.mode.activity': 'Voice activity',
  'voice.mode.push': 'Push to talk',
  'voice.sensitivity': 'Sensitivity',
  'voice.sensitivityHint':
    'How loud you have to be before you are transmitted. Watch the meter below and set it just above your room.',
  'voice.testMic': 'Test microphone',
  'voice.stopTest': 'Stop test',
  'voice.saySomething': 'Say something, the bar should move.',
  'voice.wouldBeHeard': 'You would be heard.',
  'voice.belowThreshold': 'Below the threshold, nothing would be sent.',
  'voice.micFailed': 'That microphone could not be opened.',

  'voice.group.processing': 'processing',
  'voice.processingHint':
    "Handled by the browser's audio stack. Turn them off if you are using an interface that already does its own.",
  'voice.echo': 'Echo cancellation',
  'voice.noise': 'Noise suppression',
  'voice.gain': 'Automatic gain control',

  'voice.group.video': 'video',
  'voice.camera': 'Camera',
  'voice.mirror': 'Mirror my camera',
  'voice.mirrorHint': 'Only changes your own preview, not what others see.',
  'voice.cameraOff': 'Camera off',
  'voice.previewCamera': 'Preview camera',
  'voice.stopPreview': 'Stop preview',
  'voice.cameraFailed': 'That camera could not be opened.',
  'voice.note':
    'Voice calls use the microphone, the speaker and the input mode chosen here. Volume, mode and sensitivity change a call that is already under way; a different microphone or speaker takes effect on the next one. The camera is stored for later: calls are voice only for now.',

  /* --- sign in and create account --------------------------------------- */

  'auth.signIn': 'Sign in',
  'auth.signingIn': 'Signing in\u2026',
  'auth.welcomeBack': 'Welcome back.',
  'auth.email': 'Email',
  'auth.password': 'Password',
  'auth.username': 'Username',
  'auth.usernameHint': 'Letters, numbers and single . _ - between them.',
  'auth.resent': 'Sent. Check your inbox for a new link.',
  'auth.resend': 'Resend the verification email',
  'auth.forgot': 'Forgot your password?',
  'auth.noAccount': 'No account yet?',
  'auth.createOne': 'Create one',
  'auth.haveAccount': 'Already have an account?',

  'auth.create': 'Create an account',
  'auth.createLede': 'Pick a handle people can find you by, and a password.',
  'auth.createButton': 'Create account',
  'auth.settingUp': 'Setting things up\u2026',
  'auth.passwordWarn':
    'There is no password reset that keeps your messages. Choose something you will still have in a year.',

  'auth.recovery.title': 'Save your recovery code',
  'auth.recovery.lede':
    'This is shown once, and it is the only way back into your messages if you forget your password. Nobody can send it to you later.',
  'auth.recovery.write':
    'Write it down somewhere physical, or put it in a password manager.',
  'auth.recovery.withoutIt':
    'Without it, a forgotten password means losing every message you have ever received.',
  'auth.recovery.confirm':
    'I have saved this code somewhere I will still have it later.',
  'auth.continue': 'Continue',

  'auth.forgotTitle': 'Forgot your password',
  'auth.forgotLede':
    'Give us the address on the account and we will send a link to set a new password.',
  'auth.sendLink': 'Send the link',
  'auth.checkEmail': 'Check your email',
  'auth.resetSent':
    'If there is an account for {email}, a link to set a new password is on its way. It works once and expires in an hour.',
  'auth.resetHaveCode':
    'Have your recovery code ready. It is the only thing that can carry your existing messages over to the new password, and nobody here can send it to you.',
  'auth.verifySent':
    'We have sent a verification link. Open it, then come back and sign in.',
  'auth.checkSpam': 'Not there within a minute? Check your spam folder, it usually is at first.',
  'auth.backToSignIn': 'Back to sign in',

  /* --- resetting a password --------------------------------------------- */

  'reset.checking': 'Checking your link\u2026',
  'reset.oneMoment': 'One moment.',
  'reset.badLink': 'That link did not work',
  'reset.badLinkLede':
    'Reset links work once and expire an hour after they are sent, and asking for a new one retires the old one. Start again from the sign-in screen and use the most recent email.',
  'reset.goToSignIn': 'Go to sign in',
  'reset.newCodeTitle': 'Your new recovery code',
  'reset.newCodeLede':
    'The old code was spent by the reset, so here is the one that replaces it. Like the last one, this is the only time it will be shown.',
  'reset.continueToSignIn': 'Continue to sign in',

  'reset.title': 'Set a new password',
  'reset.forEmail': 'For {email}.',
  'reset.recoveryCode': 'Recovery code',
  'reset.recoveryCodeHint':
    'The code you were shown when you created the account. Dashes and capitals do not matter.',
  'reset.discardLead': 'You are about to start over with a new key.',
  'reset.discardWarn':
    'Every message already in this account stays sealed to the old one, so it can never be read again, by you or by anyone.',
  'reset.discardKeeps':
    'You keep the account, the username and your friends, and new messages work normally from here.',
  'reset.discardConfirm':
    'I understand my existing messages will be permanently unreadable.',
  'reset.setPassword': 'Set new password',
  'reset.settingUp': 'Setting it up\u2026',
  'reset.noCode': 'I do not have my recovery code',
  'reset.foundCode': 'I found my recovery code after all',

  /* --- the conversation surface ----------------------------------------- */

  'chat.views': 'Views',
  'chat.direct': 'Direct',
  'chat.friends': 'Friends',
  'chat.connecting': 'connecting\u2026',
  'chat.offlineQueue': 'offline, messages will queue',
  'chat.notConnected': 'not connected',

  'chat.upload': 'Upload a file',
  'chat.emoji': 'Pick an emoji',
  'chat.send': 'Send',
  'chat.typing': {
    one: '{names} is typing\u2026',
    other: '{names} are typing\u2026',
  },
  'chat.queuedHint':
    'Queued on this device. They go out as soon as there is a connection.',

  'chat.loading': 'loading\u2026',
  'chat.unread': {
    one: '{count} unread',
    other: '{count} unread',
  },
  'chat.daysAgo': '{count}d',

  'chat.bot': 'bot',
  'chat.edited': 'edited',
  'chat.lockedFailed': 'This message could not be opened.',
  'chat.lockedHere': 'This message cannot be read here.',
  'chat.intro': 'This is the beginning of your conversation with {name}.',

  'chat.newMessage': 'New message',
  'chat.sectionPinned': 'pinned',
  'chat.sectionDirect': 'direct',
  'chat.loadFailed': 'Could not load your conversations',
  'chat.loadingTitle': 'Loading\u2026',
  'chat.loadingBody': 'Fetching your conversations.',
  'chat.noneTitle': 'No conversations yet',
  'chat.noneBody': 'Add someone under Friends, then start a conversation with them.',
  'chat.you': 'you',
  'chat.composerTo': 'message {name}',
  'chat.queued': {
    one: '{count} waiting to send',
    other: '{count} waiting to send',
  },

  'chat.profile': 'Profile',
  'chat.showProfile': 'Show profile',
  'chat.hideProfile': 'Hide profile',
  'chat.code': 'code',
  'chat.copyCode': 'Copy code',
  'chat.copied': 'Copied',
  'chat.copyFailed': 'Could not copy',
  'call.call': 'Call',
  'call.callName': 'Call {name}',
  'call.inACall': 'In a call',
  'call.alreadyIn': 'Already in a call',

  /* --- acting on a person ----------------------------------------------- */

  'person.actionsFor': 'Actions for {name}',
  'person.viewProfile': 'View profile',
  'person.removeNickname': 'Remove nickname',
  'person.pin': 'Pin to the top',
  'person.unpin': 'Unpin',
  'person.pinFull': 'Pinned is full ({max})',
  'person.failed': 'That did not work.',
  'person.failedTitle': 'That did not work',
  'person.unfriendTitle': 'Remove {name}?',
  'person.unfriendBody':
    'You will stop being able to send each other anything new. What you have already said stays where it is, and either of you can ask again later.',
  'person.blockTitle': 'Block {name}?',
  'person.blockBody':
    'They will not be able to reach you or add you again, and they are not told. This also ends your friendship. You can undo it from Friends, under Blocked.',
  'person.nicknameFor': 'Nickname for {name}',
  'person.nicknameBody':
    'Only you see this. It replaces their username everywhere in your app, and they are never told about it.',
  'person.useUsername': 'Use their username',

  /* --- friends ---------------------------------------------------------- */

  'friends.tab.all': 'All friends',
  'friends.tab.add': 'Add friend',
  'friends.tab.sent': 'Sent',
  'friends.tab.received': 'Received',
  'friends.tab.blocked': 'Blocked',
  'friends.section.friends': 'friends',
  'friends.section.sent': 'sent',
  'friends.section.received': 'received',
  'friends.section.blocked': 'blocked',

  'friends.noneTitle': 'No friends yet',
  'friends.noneBody':
    'Add someone by the exact username they gave you, under Add friend.',
  'friends.more': 'More',
  'friends.moreFor': 'More actions for {name}',

  'friends.addSomeone': 'add someone',
  'friends.addLede':
    'You need their exact username. There is no directory to browse, which is deliberate: it would be a list of everyone with an account here.',
  'friends.addPlaceholder': 'their exact username',
  'friends.sendRequest': 'Send request',

  'friends.sentNone': 'Nothing waiting',
  'friends.sentNoneBody': 'Requests you send show up here until they answer.',
  'friends.waitingFor': 'waiting for them',
  'friends.recvNone': 'Nothing to answer',
  'friends.recvNoneBody': 'Requests other people send you land here.',
  'friends.wantsToTalk': 'wants to talk to you',
  'friends.accept': 'Accept',
  'friends.decline': 'Decline',

  'friends.blockedNone': 'Nobody blocked',
  'friends.blockedNoneBody':
    'Blocking someone ends the friendship and stops them reaching you. They are never told.',
  'friends.blockedOn': 'blocked {day}',
  'friends.unblock': 'Unblock',
  'friends.unblocked':
    '{name} is unblocked. You are strangers again, so either of you can send a friend request.',
  'friends.addBack': 'Add them back',

  'friends.outcome.accepted':
    'You and {name} are now friends, because they had already asked.',
  'friends.outcome.already': 'You are already friends with {name}.',
  'friends.outcome.sent': 'Request sent to {name}.',
  'friends.error.generic': 'Could not send that request.',
  'friends.error.notFound':
    'No account with that username. Check the spelling, it has to be exact.',
  'friends.error.self': 'That is you.',
  'friends.error.blocked':
    'You have blocked this user. Unblock them first, under Blocked.',
  'friends.error.rateLimited': 'Too many requests for now. Try again in an hour.',
  'friends.error.invalid': 'That does not look like a username.',

  /* --- calls ------------------------------------------------------------ */

  'call.someone': 'Someone',
  'call.unknown': 'Unknown',
  'call.isCalling': 'is calling',
  'call.isCallingYou': '{name} is calling',
  'call.calling': 'calling\u2026',
  'call.dismiss': 'Dismiss',
  'call.holdToTalk': 'Hold to talk',
  'call.talking': 'Talking',
  'call.holdHint': 'Hold to talk, or hold Ctrl+Space',
  'call.toEarpiece': 'Switch to earpiece',
  'call.toSpeaker': 'Switch to speaker',
  'call.mute': 'Mute',
  'call.unmute': 'Unmute',
  'call.cancel': 'Cancel call',
  'call.hangUp': 'Hang up',

  'call.end.hangup': 'Call ended',
  'call.end.rejected': '{name} declined',
  'call.end.noAnswer': 'No answer',
  'call.end.missed': 'Missed call from {name}',
  'call.end.disconnected': 'Connection lost',
  'call.end.busy': '{name} is in another call',
  'call.end.inCall': 'You are already in a call in another tab',
  'call.end.noMicrophone':
    'Your microphone could not be opened. Check the browser permission and the input device in settings.',
  'call.end.unreadable': 'The call could not be set up with this person.',
  'call.end.failed': 'The connection failed.',
  'call.end.noRelay':
    'Could not connect. This server has no relay, so calls only work when both sides can reach each other directly.',
  'call.end.refused': 'The call could not be placed.',
  'call.end.passthrough': '{message}',

  /* --- the shell -------------------------------------------------------- */

  'strip.signedInAs': 'Signed in as',
  'strip.thisAccount': 'this account',
  'load.backOnline': 'Back online',
  'load.backOnlineDetail': 'Anything that was waiting is on its way.',

  'load.title.boot': 'Starting up',
  'load.title.slow': 'Reconnecting',
  'load.title.offline': 'No connection',
  'load.detail.boot': 'Unlocking this device\u2019s keys.',
  'load.detail.slow':
    'The connection dropped. Nothing you have written is lost, it will send itself.',
  'load.detail.offline':
    'Waiting for a network. Anything you write now is queued on this device.',
  'load.boot.keys': 'Opening this device\u2019s key store.',
  'load.boot.session': 'Checking whether you are still signed in.',
  'load.boot.ready': 'Ready.',
  'load.didYouKnow': 'did you know',
  'load.tip.privateKey':
    'Your private key is generated on this device and never sent to the server.',
  'load.tip.perDevice':
    'Messages are sealed once per device, including your own, so your history follows you.',
  'load.tip.ciphertext':
    'The server stores ciphertext. It cannot search your messages, and neither can we.',
  'load.tip.lostKey':
    'Lose your password and your key, and the history goes with them. That is the trade.',
  'load.tip.queued':
    'A message written offline is queued here, not dropped, and sent when you reconnect.',
  'load.tip.securityNumber':
    'Check a contact\u2019s security number out of band before you trust the padlock.',

  /* --- unlocking, verifying, and a dead address ------------------------- */

  'unlock.title': 'Unlock your messages',
  'unlock.lede':
    'Signed in as {account}. Enter your password to pick up where you left off.',
  'unlock.go': 'Unlock',
  'unlock.unlocking': 'Unlocking\u2026',
  'unlock.signOutInstead': 'Sign out instead',

  'verify.working': 'Verifying\u2026',
  'verify.done': 'Email verified',
  'verify.doneLede': 'Your address is confirmed. You can sign in now.',
  'verify.failedLede':
    'Most likely it has already been used. Verification links work once and then expire, so if you have opened this one before, your address is verified and you can just sign in. Otherwise ask for a new link from the sign-in screen; links also expire after 24 hours.',

  /* --- the email change link --------------------------------------------- */

  'changeEmail.title': 'Confirm your new email',
  'changeEmail.lede':
    'This link moves your account to {email}. Your sign-in key is derived from your address, so it is re-derived now, on this device. Your messages are unaffected.',
  'changeEmail.checking': 'Checking your link…',
  'changeEmail.confirm': 'Move to the new address',
  'changeEmail.confirming': 'Moving…',
  'changeEmail.done': 'Email changed',
  'changeEmail.doneLede': 'Sign in with {email} from now on.',
  'changeEmail.signedOut':
    'Sign in first, then open this link again. It only works for the account that asked for it.',
  'changeEmail.badLinkLede':
    'Either it has already been used, it expired (links last an hour) or it belongs to another account.',
  'changeEmail.back': 'Back to the app',

  'notFound.title': 'This page doesn\u2019t exist',
  'notFound.lede':
    'Cipher has nothing at this address. It was probably mistyped, or it pointed at something that has since moved.',
  'notFound.home': 'Back to your messages',
  'notFound.back': 'Go back',
  'notFound.foot': 'Nothing was lost. Your conversations are still where you left them.',

  /* --- pictures and fields ---------------------------------------------- */

  'avatar.notAnImage': 'That file is not an image.',
  'avatar.tooBig': 'That image is larger than 8 MB. Try a smaller one.',
  'avatar.unsupported': 'This browser cannot read images here.',
  'avatar.unreadable': 'That image could not be read.',
  'avatar.notResized': 'That image could not be resized.',

  'crop.title': 'Position your picture',
  'crop.body':
    'Drag to move it, pinch or scroll to zoom. Only the square you keep is saved. The rest of the file never leaves this dialog.',
  'crop.bannerTitle': 'Position your banner',
  'crop.bannerBody':
    'Drag to move it, pinch or scroll to zoom. The band you keep is what your card shows, and the rest of the file never leaves this dialog.',
  'crop.wallpaperTitle': 'Position your wallpaper',
  'crop.wallpaperBody':
    'Drag to move it, pinch or scroll to zoom. It is saved at 1600 by 900 and stretched to cover whatever shape your window is.',
  'crop.position': 'Picture position. Arrow keys move the picture.',
  'crop.zoom': 'Zoom',
  'crop.recentre': 'Recentre',

  'field.showPassword': 'Show password',
  'field.hidePassword': 'Hide password',

  /* --- failures the app itself names ------------------------------------ */

  'error.deviceLocked':
    'This device is locked. Enter your password to unlock your messages.',
  'error.identityUnavailable':
    'Signed in, but this account\u2019s encryption key could not be unlocked.',
  'error.wrongRecoveryCode': 'That recovery code does not match this account.',
  'error.network': 'Could not reach the server',
  'error.timeout': 'The server took too long to respond',
  'error.rejected': 'The server rejected that request',
  'error.unauthorized': 'You are not signed in',
  'error.forbidden': 'You do not have access to that',
  'error.notFound': 'Not found',
  'error.rateLimited': 'Too many attempts. Try again later.',
  'error.server': 'Something went wrong on the server',
  'error.requestFailed': 'The request failed',
} satisfies Record<string, Message>;

export type Key = keyof typeof en;
