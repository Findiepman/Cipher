# Cipher desktop

A Tauri shell: one native window, no address bar and no tabs, showing the
deployed web app at <https://cipher.findiepman.dev>. There is no app logic in
here and there must not be any (see [`AGENTS.md`](AGENTS.md)). What the shell
adds over a browser tab is a window and taskbar entry of its own, and signed
auto-updates.

```
desktop/
  package.json            only the Tauri CLI, run through npm scripts
  src-tauri/
    Cargo.toml            the Rust crate
    build.rs              tells cargo the URL env var is a build input
    src/main.rs           the whole shell: window, navigation guard, updater
    tauri.conf.json       product name, version, bundle targets, updater key
    capabilities/         the ACL, which grants the page nothing (on purpose)
    icons/                generated from client/public/logo.png, see below
```

## Running it in development

You need Rust (<https://rustup.rs>) and Node 20+. On Linux you also need
WebKitGTK and friends; the apt line in
[`.github/workflows/desktop.yml`](../.github/workflows/desktop.yml) is the
list. Windows 11 ships WebView2 already. macOS needs the Xcode command line
tools.

```bash
npm run dev:server     # at the repo root, :3000
npm run dev            # at the repo root, Vite on :5173
cd desktop
npm install
npm run dev            # a debug build, pointed at http://localhost:5173
```

The first build compiles Tauri from source and takes several minutes; after
that it is incremental. Right-click, Inspect opens the devtools in a debug
build.

## Which site the window shows

The URL is compiled in, not read from a file at run time, so a shipped binary
cannot be pointed somewhere else by editing something next to it.

| Build | Default |
|---|---|
| `npm run dev` (debug) | `http://localhost:5173` |
| `npm run build` (release) | `https://cipher.findiepman.dev` |

`CIPHER_DESKTOP_URL` in the environment at build time overrides either:

```bash
CIPHER_DESKTOP_URL=https://staging.example.test npm run dev      # bash
$env:CIPHER_DESKTOP_URL = 'https://staging.example.test'; npm run dev   # PowerShell
```

`build.rs` declares the variable as a build input, so changing it and
rebuilding really does produce a new binary. Navigation is pinned to that
origin: a link to anywhere else opens in the system browser instead of
replacing the app, because a window with no back button must not wander.

## Building installers locally

```bash
cd desktop
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/cipher.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
npm run build
```

Output lands in `src-tauri/target/release/bundle/`, the installer next to its
`.sig`. The signing key is required, not optional: `createUpdaterArtifacts`
is on, so the CLI stops after bundling and reports an error without something
to sign the update package with. Two traps, both met on 2026-09-07:

- Set the password variable, even though the key has none. If it is absent
  the CLI prompts for one, and in a shell with no stdin that prompt hangs
  forever with no output.
- Pass the key's *content*, as above. `TAURI_SIGNING_PRIVATE_KEY_PATH` also
  works but the path must be one the Windows process can open, so from Git
  Bash `~/.tauri/cipher.key` (which is really `/c/Users/...`) is not found
  and the CLI reports "no private key".

Only the platform you are on gets built; the workflow below is how the other
two happen.

## Auto-update

`tauri-plugin-updater`, driven from Rust in `main.rs`. A release build asks
the endpoint once at start-up, and if a newer version exists it shows a native
dialog. Accepting downloads the package, verifies its minisign signature
against the public key in `tauri.conf.json`, installs it and restarts. A
package that does not verify is never written, which is what the
"auto-update must verify update package signatures" rule in `AGENTS.md`
asks for. A debug build never checks.

The endpoint is GitHub Releases:

```
https://github.com/Findiepman/Cipher/releases/latest/download/latest.json
```

GitHub Releases fits cleanly: the repository is public, the build workflow
already has a token that can create releases, and `tauri-action` writes and
merges `latest.json` across the platform jobs by itself. The one thing to
know: `releases/latest` means the newest **published, non-prerelease** release
of the whole repository, whatever it was for. Today the only releases are
desktop ones, so that is right. If the repository ever starts publishing other
kinds of release (server tags, say), switch the endpoint to a fixed tag such as
`releases/download/desktop-latest/latest.json` and have the workflow move that
tag, or host the JSON as a static file behind the site. Both are small
changes; neither is worth doing before the problem exists.

Update packages per platform: the NSIS installer on Windows, the `.app`
tarball on macOS and the AppImage on Linux. **The `.deb` does not
auto-update**; the plugin has no Linux path for it. Someone who installs the
`.deb` sees the dialog and the install fails, so they need the AppImage or
their package manager. That is a known gap, not a bug to file.

## Releasing

Versions live in `src-tauri/tauri.conf.json`. Keep `src-tauri/Cargo.toml` and
`package.json` at the same number so nobody is confused, but the config file
is the one Tauri reads.

1. Bump `version` in `src-tauri/tauri.conf.json` (and the other two), commit,
   push to `main`. That push builds all three platforms and leaves the
   installers as workflow artifacts; it creates no release.
2. Actions, `desktop`, Run workflow. This builds again and creates a **draft**
   release `desktop-v<version>` with the installers, the `.sig` files and
   `latest.json` attached.
3. Look at the draft. Publish it. From that moment every installed release
   build offers the update at its next start.

Nothing reaches an installed app until step 3, so a bad build can simply be
deleted as a draft.

## The signing key

The keypair was generated on 2026-09-07 with `tauri signer generate`, with
**no password**. The private key is protected by where it lives, not by a
passphrase:

- `~/.tauri/cipher.key` on the maintainer's machine that generated it.
- The GitHub Actions secret `TAURI_SIGNING_PRIVATE_KEY`, whose value is the
  entire content of that file. `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` can be
  left unset or empty. **Adding these secrets is still to do**; the workflow
  will fail at the build step until they exist.
- Nowhere else. Never in the repository (`.gitignore` here refuses `*.key`),
  never in a `.env` file, never in a chat.

The public half, `~/.tauri/cipher.key.pub`, is the `pubkey` string in
`tauri.conf.json` and is safe to publish.

If the private key is lost, generate a new pair, put the new public key in
`tauri.conf.json` and ship. Apps already installed will refuse every update
signed with the new key, since they trust the old one, so each person
installs that one release by hand. If the private key is *leaked*, do the
same thing quickly and revoke the GitHub secret. Set a password on the
new key at that point.

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

## Where the private key lives on desktop

The same place as in the browser. The shell shows the web app, so the account
key is unwrapped by the web app's own code and its device-key copy sits in
the WebView's IndexedDB for the site's origin (STATUS.md decision 5). That
IndexedDB is inside the app's own profile directory, separate from any
browser: WebView2 keeps it under `%LOCALAPPDATA%\dev.findiepman.cipher`,
WebKit under the app's container on macOS and `~/.local/share/dev.findiepman.cipher`
on Linux. There is no OS keychain integration yet; see `AGENTS.md` for what
that would take and why it is not the first thing to do.

## What is still manual or unfinished

- The GitHub secrets are not added, and the workflow has never run. The first
  dispatch is the first real test of the macOS and Linux builds; the Windows
  build has been done locally.
- No code signing certificates (above).
- Nobody has smoke-tested a packaged build on a clean machine yet, which
  `AGENTS.md` asks for before calling a release done.
- No tray icon, no native notifications, no OS keychain. Each of those needs
  the adapter interface `client/AGENTS.md` describes before it can be built,
  and none exists yet.

## Icons

`src-tauri/icons/` is generated, not drawn: `npm run icons` regenerates the
whole set from `client/public/logo.png`, which STATUS.md decision 12 names as
the one copy of the mark. The source is 195 pixels square, so the larger
sizes are upscaled; replace the PNG with a bigger one and rerun the script
and every icon improves at once. Do not edit files in `icons/` by hand.
