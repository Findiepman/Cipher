# Cipher desktop

The desktop app. The web client from `client/` is built in desktop mode and
bundled into a Tauri shell, which adds the things a browser tab cannot do:
a window of its own that remembers where it was, a tray icon so the app keeps
running when the window is closed, native notifications and an unread badge
on the icon, a flash of the taskbar when a call comes in, one instance at a
time, starting with your computer, and signed auto-updates. There is no app
logic in here and there must not be any (see [`AGENTS.md`](AGENTS.md)).

The app talks to the deployed server at <https://cipher.findiepman.dev>. It
is not a window on the website: the pages are inside the binary and a
client change reaches desktop users through a release, see *Releasing*.

```
desktop/
  package.json            only the Tauri CLI, run through npm scripts
  src-tauri/
    Cargo.toml            the Rust crate and its plugins
    build.rs              the Tauri build script
    Info.plist            macOS: why the app wants the microphone
    src/main.rs           the window, the close-to-tray rule, plugin wiring
    src/commands.rs       what the page can ask for, one command each
    src/tray.rs           the tray icon and its two-item menu
    src/updater.rs        the update check, the download and the restart
    tauri.conf.json       product name, version, CSP, bundle targets, updater key
    capabilities/         the ACL: core plus the opener, nothing else
    icons/                generated from client/public/logo.png, see below
```

The page side of every native feature is `client/src/lib/platform/`: an
interface (`types.ts`), a browser implementation and a desktop one that
calls the commands in `commands.rs` and `updater.rs`. That is the whole
seam. A screen in `client/` calls `usePlatform()` and never finds out which
one answered.

## Running it in development

You need Rust (<https://rustup.rs>) and Node 20+. On Linux you also need
WebKitGTK and friends; the apt line in
[`.github/workflows/desktop.yml`](../.github/workflows/desktop.yml) is the
list. Windows 11 ships WebView2 already. macOS needs the Xcode command line
tools.

```bash
npm install            # at the repo root, once
npm run dev:server     # at the repo root, :3000
cd desktop
npm install
npm run dev            # starts Vite in desktop mode, then a debug build on it
```

`npm run dev` here runs `vite --mode desktop-dev` at the root for you
(`beforeDevCommand` in `tauri.conf.json`), so do not also start `npm run dev`
at the root: two Vite servers would fight over :5173. The desktop-dev mode
is bearer auth, the desktop adapter and the local API, so the window behaves
like the shipped app rather than like a browser tab. The first build
compiles Tauri from source and takes several minutes; after that it is
incremental. Right-click, Inspect opens the devtools in a debug build.

A debug build never checks for updates. The Settings, Desktop section says
so.

## Which server the app talks to

Compiled into the page, not read from a file, so a shipped binary cannot be
pointed somewhere else by editing something next to it:

| Build | API |
|---|---|
| `npm run dev` (debug, `client/.env.desktop-dev`) | `http://localhost:3000` |
| `npm run build` (release, `client/.env.desktop`) | `https://cipher.findiepman.dev` |

An environment variable wins over the file, so a staging build is
`VITE_API_URL=https://staging.example.test npm run build`. Two things go
with that: the CSP in `tauri.conf.json` names the production host in
`connect-src` and needs the staging one too, and the server's CORS
allowlist (`server/src/lib/origins.ts`) has to admit the desktop origins,
which the deployed one does.

Navigation is pinned to the app's own origin: a link to anywhere else opens
in the system browser instead of replacing the app, because a window with
no back button must not wander. Links with `target="_blank"` do the same
through the opener plugin.

## What the shell does, and where

| Feature | Shell side | Page side |
|---|---|---|
| Window size and position remembered | `tauri-plugin-window-state`, `main.rs` | |
| Close keeps the app in the tray (a setting; always on macOS) | `main.rs`, `set_close_to_tray` | Settings, Desktop |
| Tray icon: open, quit | `tray.rs` | |
| One instance; a second launch focuses the first | `tauri-plugin-single-instance` | |
| Start with the computer, minimized to the tray | `tauri-plugin-autostart`, `--minimized` | Settings, Desktop |
| Native notifications for messages and calls | `notify` | `ChatProvider`, `CallProvider`, `lib/platform/notifications.ts` |
| Unread count on the icon (a dot on Windows) and in the title | `set_badge` | `ChatProvider` |
| Taskbar flash or dock bounce on an incoming call | `request_attention` | `CallProvider` |
| Update found, announced, installed on request | `updater.rs` | `UpdateBanner`, Settings, Desktop |
| Session survives a restart | | `lib/storage/refreshTokenStore.ts` |
| "Cipher desktop on Windows" in the session list | | `describeDevice()` |

## Building installers locally

```bash
cd desktop
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/cipher.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
npm run build
```

This builds the client in desktop mode first (`npm run build:desktop-client`
at the root, from `beforeBuildCommand`), then the shell. Output lands in
`src-tauri/target/release/bundle/`, the installer next to its `.sig`. The
signing key is required, not optional: `createUpdaterArtifacts` is on, so
the CLI stops after bundling and reports an error without something to sign
the update package with. Two traps, both met on 2026-09-07:

- Set the password variable, even though the key has none. If it is absent
  the CLI prompts for one, and in a shell with no stdin that prompt hangs
  forever with no output.
- Pass the key's *content*, as above. `TAURI_SIGNING_PRIVATE_KEY_PATH` also
  works but the path must be one the Windows process can open, so from Git
  Bash `~/.tauri/cipher.key` (which is really `/c/Users/...`) is not found
  and the CLI reports "no private key".

Only the platform you are on gets built; the workflow described in
`UPDATES.md` is how the other two happen.

## Releasing, and why every client change needs one

[`UPDATES.md`](UPDATES.md) is the whole story: how the updater works, the
one-time secret setup, the release checklist, how to try an update without
publishing one, what to do when it fails and how to rotate the key. The
short version: bump `version` in `src-tauri/tauri.conf.json`, push, dispatch
the `desktop` workflow, publish the draft release it makes. Installed apps
offer the update within a few hours, and at their next start.

Because the pages are inside the binary, a fix under `client/` reaches the
web the moment `deploy.sh` runs and reaches desktop users only when a release
is published. That is the trade the desktop app makes for being an app
rather than a window: it works the same whether the site is up or not, its
own origin holds its own storage, and nothing it runs was fetched at start.
Release often; the workflow makes it one dispatch and one button.

The private key is in `~/.tauri/cipher.key` on the machine that generated it
and belongs in the `TAURI_SIGNING_PRIVATE_KEY` Actions secret, which **is
not added yet**. Never commit it.

## Code signing: not set up

Be clear about this when handing an installer to somebody. Update signing
above is Tauri's own check and says nothing to the operating system. OS code
signing needs certificates this project does not have:

- **macOS**: no Apple Developer ID certificate and no notarisation. A
  downloaded `.dmg` is quarantined and Gatekeeper reports the app as damaged
  or from an unidentified developer. Right-click, Open works on some
  versions; otherwise `xattr -dr com.apple.quarantine /Applications/Cipher.app`
  after copying it. Fixing this properly means an Apple Developer account
  (paid), a Developer ID Application certificate, and the
  `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`,
  `APPLE_PASSWORD` and `APPLE_TEAM_ID` secrets the Tauri docs describe.
- **Windows**: no Authenticode certificate. SmartScreen warns on the NSIS
  installer ("Windows protected your PC"); More info, Run anyway gets past
  it. Fixing it means a code-signing certificate (an EV one for a warning-free
  first run) and `bundle.windows.certificateThumbprint` plus the signing
  secrets.
- **Linux**: nothing expected; AppImages are not signed as a matter of
  course.

## Where the private key and the session live on desktop

The account key is where it is in the browser: unwrapped by the client's
own code, with the device-key copy in the WebView's IndexedDB for the app's
origin (STATUS.md decision 5). That IndexedDB is inside the app's own
profile directory, separate from any browser: WebView2 keeps it under
`%LOCALAPPDATA%\dev.findiepman.cipher`, WebKit under the app's container on
macOS and `~/.local/share/dev.findiepman.cipher` on Linux.

The session is the one thing the desktop stores that the browser does not
have to: the refresh token, in that same IndexedDB, in the clear. A browser
keeps its equivalent in the cookie jar, which on Windows is encrypted to the
user account and here is not. `client/src/lib/storage/refreshTokenStore.ts`
says this out loud. The OS keychain is the improvement, and `AGENTS.md`
says why it is not bolted on now.

## What is still manual or unfinished

- The GitHub secret is not added, and the workflow has never run. The first
  dispatch is the first real test of the macOS and Linux builds; the Windows
  build has been done locally.
- No code signing certificates (above).
- Nobody has smoke-tested a packaged build on a clean machine yet, which
  `AGENTS.md` asks for before calling a release done.
- No OS keychain. The refresh token and the device key are in the WebView's
  storage, as above.
- Clicking a native notification does not open the conversation. The
  notification plugin reports clicks on no desktop platform, so the window
  has to be brought forward by hand; the web build does jump to it.
- The verification and reset emails link to the website, and that is where
  they are handled. Registering from the desktop means opening the email
  link in a browser, then signing in on the desktop. A `cipher://` deep link
  would fold that back into the app and is not built.

## Icons

`src-tauri/icons/` is generated, not drawn: `npm run icons` regenerates the
whole set from `client/public/logo.png`, which STATUS.md decision 12 names as
the one copy of the mark. The source is 195 pixels square, so the larger
sizes are upscaled; replace the PNG with a bigger one and rerun the script
and every icon improves at once. Do not edit files in `icons/` by hand.
