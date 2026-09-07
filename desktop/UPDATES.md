# Desktop auto-update: how it works and how to ship one

Everything about getting a new version of the desktop shell onto machines
that already have it installed. [`README.md`](README.md) covers running and
building; this file covers releasing. Read it once before the first release
and skim *Checklist* every time after that.

## The short version

1. Bump `version` in `src-tauri/tauri.conf.json` (and match it in
   `src-tauri/Cargo.toml` and `package.json`). Commit and push.
2. GitHub, Actions, `desktop`, Run workflow.
3. When it finishes, open Releases, find the draft `desktop-v<version>`,
   check it, Publish.
4. Every installed copy offers the update the next time it starts.

Before the very first release there is one-time setup: the signing key has to
be a repository secret. See *One-time setup*.

## How it works

The shell uses `tauri-plugin-updater`, driven from Rust in
`src-tauri/src/main.rs` (the `offer_update` function). On every start of a
**release** build:

1. It fetches the manifest at
   `https://github.com/Findiepman/Cipher/releases/latest/download/latest.json`.
   GitHub redirects that to the `latest.json` asset of the newest published,
   non-prerelease, non-draft release of the repository.
2. It compares the manifest's `version` to its own (semver). Only a strictly
   newer version counts; a downgrade is never offered.
3. If there is one, a native dialog says "Cipher X is available (you have Y).
   Install it and restart now?" with *Install and restart* and *Not now*.
   *Not now* means nothing happens until the next start, which asks again.
4. On accept it downloads the package for its platform from the URL in the
   manifest, checks the minisign signature in the manifest against the public
   key compiled into the binary (`plugins.updater.pubkey` in
   `tauri.conf.json`) and only then installs:
   - **Windows**: runs the new NSIS installer in passive mode (a progress bar,
     no questions). The app exits while it runs and comes back after.
   - **macOS**: replaces `Cipher.app` in place and restarts.
   - **Linux**: overwrites the running AppImage and restarts. This needs the
     AppImage to be somewhere the user can write, which it normally is.

A package whose signature does not verify is never written to disk. A failed
check (offline, no release yet, GitHub down) is logged to stderr and
otherwise ignored, so an update problem can never keep the app from opening.

A **debug** build (`npm run dev`) never checks. There is nothing installed for
it to replace.

## What is in a release

The workflow attaches these to the draft (names for version 0.1.0; the
architecture suffix varies):

| Asset | What it is |
|---|---|
| `Cipher_0.1.0_x64-setup.exe` | Windows installer. People download this. It is also the update package. |
| `Cipher_0.1.0_x64-setup.exe.sig` | Its signature. |
| `Cipher_0.1.0_aarch64.dmg`, `Cipher_0.1.0_x64.dmg` | macOS disk images. People download these. |
| `Cipher_aarch64.app.tar.gz`, `Cipher_x64.app.tar.gz` and `.sig` | The macOS update packages. Nobody downloads these by hand. |
| `Cipher_0.1.0_amd64.AppImage` and `.sig` | Linux. Both the download and the update package. |
| `Cipher_0.1.0_amd64.deb` | Linux, for people who prefer a package. **It does not auto-update.** |
| `latest.json` | The manifest. The updater reads this and nothing else. |

`latest.json` looks like this. `tauri-action` writes it and merges the four
platform jobs into one file, so you never edit it by hand:

```json
{
  "version": "0.1.1",
  "notes": "Installers for Windows, macOS and Linux. ...",
  "pub_date": "2026-09-08T10:12:00.000Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6...",
      "url": "https://github.com/Findiepman/Cipher/releases/download/desktop-v0.1.1/Cipher_0.1.1_x64-setup.exe"
    },
    "darwin-aarch64": { "signature": "...", "url": ".../Cipher_aarch64.app.tar.gz" },
    "darwin-x86_64":  { "signature": "...", "url": ".../Cipher_x64.app.tar.gz" },
    "linux-x86_64":   { "signature": "...", "url": ".../Cipher_0.1.1_amd64.AppImage" }
  }
}
```

The `.deb` gap: the updater has no Linux install path except the AppImage,
so someone on the `.deb` who accepts the dialog gets a failed install. That is
documented rather than fixed. If it ever matters, the fix is an apt
repository, not the updater.

## One-time setup

The updater is only as trustworthy as the private key, so this is the part
to do carefully.

**Where the key is.** It was generated on 2026-09-07 with
`tauri signer generate`, without a password. The private key is in
`~/.tauri/cipher.key` on the machine that generated it. The public half,
`~/.tauri/cipher.key.pub`, is already in `tauri.conf.json`.

**Add it to GitHub.** Repository, Settings, Secrets and variables, Actions,
New repository secret:

| Name | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | The entire content of `~/.tauri/cipher.key`, one line, exactly as in the file. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Leave it out, or add it with an empty value. The workflow passes it either way. |

To copy the content without opening the file in an editor:

```bash
cat ~/.tauri/cipher.key | clip.exe    # Git Bash on Windows
cat ~/.tauri/cipher.key | pbcopy      # macOS
```

```powershell
Get-Content "$HOME\.tauri\cipher.key" -Raw | Set-Clipboard
```

Not from WSL: its home directory is a different place with no `.tauri` in
it, and Ubuntu's command-not-found helper answers `clip` with "install
geomview", a 3D viewer whose `clip` cuts meshes and copies nothing.

**Keep a second copy.** If that machine dies, so does the ability to ship
updates. Put the file in a password manager. Do not put it in the repository,
in `deploy/.env`, in a chat, or in a file next to the project. `desktop/.gitignore`
refuses `*.key` as a backstop, not as the rule.

**Check the workflow can create releases.** Settings, Actions, General,
Workflow permissions: "Read and write permissions". The workflow also
declares `contents: write` for itself, but the repository setting can
override that downwards.

## Checklist for a release

1. **Bump the version.** `src-tauri/tauri.conf.json` is the one Tauri reads.
   Change `src-tauri/Cargo.toml` and `package.json` to the same number so
   nobody is confused later. Semver: `0.1.0` to `0.1.1` for a fix, `0.2.0`
   for a feature. The updater only offers a strictly greater version, so a
   release with the same number as the last one updates nobody.
2. **Commit and push to `main`.** That push builds all four jobs and keeps
   the installers as workflow artifacts for seven days (Actions, the run,
   Artifacts). No release is made. If a job fails here, fix it before going
   on; dispatching would fail the same way.
3. **Dispatch.** Actions, `desktop`, Run workflow, branch `main`. This builds
   again and creates a draft release `desktop-v<version>` with everything in
   the table above.
4. **Look at the draft.** Releases, the draft. Seven assets plus
   `latest.json` for a full release (Windows, two macOS dmg, two macOS
   tarballs with sigs, AppImage with sig, deb). Open `latest.json` and check
   all four `platforms` keys are there: a platform job that failed is simply
   missing from the manifest, and installed copies on that platform quietly
   see no update. Edit the release notes if you
   want; the body is what people read on the Releases page.
5. **Publish.** From this moment the endpoint answers with this version and
   every installed copy is offered it at its next start. Nothing is offered
   before this button, so a bad draft can simply be deleted.
6. **Try it.** Start an installed older build and accept the dialog. That is
   the whole test.

The first release updates nobody, because nobody has an older version
installed. From the second onwards each one is an update.

## Trying the update flow before there is a real release

You do not need to publish anything to see the dialog work. The endpoint is
compiled in, but the Tauri CLI can overlay config for one build:

1. Install the current release build (`npm run build`, run the
   `Cipher_0.1.0_x64-setup.exe` under `src-tauri/target/release/bundle/nsis/`).
2. Bump `version` to `0.1.1` in `tauri.conf.json` and build again. Keep the
   new installer and its `.sig`.
3. Write a `latest.json` by hand in the shape above, with `version`
   `0.1.1`, the `signature` being the content of the new `.sig` file, and
   `url` pointing at a local static server, say
   `http://localhost:8000/Cipher_0.1.1_x64-setup.exe`. Serve that directory
   (`python -m http.server 8000` in it).
4. Build the **0.1.0** app once more with the endpoint overridden and plain
   `http` allowed, which only a test build should ever do:

   ```bash
   npm run tauri build -- --config '{"version":"0.1.0","plugins":{"updater":{"endpoints":["http://localhost:8000/latest.json"],"dangerousInsecureTransportProtocol":true}}}'
   ```

   Install and start it. It should offer 0.1.1, download from your local
   server, verify, install and restart as 0.1.1.
5. Throw that test build away. `dangerousInsecureTransportProtocol` must
   never be in `tauri.conf.json` itself; the whole point of the signature
   check is defeated if a network attacker can also hand out the manifest,
   and the config file is what CI builds from.

## If something goes wrong

**The workflow fails at the build step with "no private key".** The
`TAURI_SIGNING_PRIVATE_KEY` secret is missing or empty. See *One-time setup*.

**The workflow hangs at the build step with no output.** The key is present
but the password variable is not being passed, so the CLI is waiting at a
prompt nobody can answer. The workflow does pass it; if you changed that
line, put it back.

**Installed apps never show the dialog.** In order of likelihood:

- The release is still a draft, or is marked pre-release. `releases/latest`
  ignores both. Open the endpoint URL in a browser: if it does not download a
  `latest.json`, the updater cannot either.
- The manifest version is not greater than the installed one. Compare the
  `version` in `latest.json` with the installed version (Windows: Settings,
  Apps; macOS: Get Info on the app).
- The installed copy is a debug build. Only release builds check.
- Some other kind of release became "latest". The endpoint means the newest
  published release of the *whole repository*. If server releases ever start
  being made on GitHub, move the updater to a fixed tag: change the endpoint
  in `tauri.conf.json` to
  `https://github.com/Findiepman/Cipher/releases/download/desktop-latest/latest.json`
  and have the workflow move the `desktop-latest` tag to each new desktop
  release. That is a small change, and it only matters once the problem
  exists.

**The dialog appears but the install fails.**

- On Linux, the person is on the `.deb`. Expected; they need the AppImage.
- On Windows, the running app could not be replaced. Retry; if it keeps
  failing, the NSIS installer from the Releases page installs over the old
  version by hand.
- "signature verification failed" or similar: the package was signed with a
  key other than the one in `tauri.conf.json`. Either the secret was changed
  (see *Rotating the key*) or the release was built with a different key. Do
  not work around this by turning off verification; a wrong signature is the
  updater doing its job.

**Where the errors go.** A failed check is written to stderr, which a
windowed release build on Windows does not show anywhere. That is deliberate
(a messenger must open even when GitHub is down), so diagnosis is by
checking the endpoint in a browser and comparing versions, as above, rather
than by reading a log.

## Rotating the key

If the private key is **lost**: generate a new pair
(`npm run tauri signer generate -- -w ~/.tauri/cipher.key`), put the new
`.pub` content in `tauri.conf.json`, replace the GitHub secret, release.
Installed copies trust the old key, so they will refuse this release with a
signature error and each person installs it once by hand from the Releases
page. After that the new key carries on as normal.

If the private key is **leaked**: do the same, but quickly. This time give
the new key a password (the CLI asks for one unless `--ci` is passed) and put
that in `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Until the new release is
installed, whoever holds the old key can sign a package that installed
copies would accept, so also delete the published release the leaked key
signed and publish the new one as soon as it builds. There is no revocation
mechanism beyond that; the plugin trusts exactly one key.

## What update signing is not

It proves the package came from whoever holds `cipher.key`. It says nothing
to Windows or macOS, which have their own idea of a signed program and
warn about this one (SmartScreen, Gatekeeper). That is the code-signing
certificate question in `README.md`, a separate and paid decision. It does
not affect whether auto-update works.
