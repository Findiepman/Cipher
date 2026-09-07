# AGENTS.md: desktop shell

Read the root `AGENTS.md` first. This directory is the native desktop wrapper around `client/`. **The choice is Tauri 2**, made on 2026-09-07, and [`README.md`](README.md) here is the runbook for running and building it, with [`UPDATES.md`](UPDATES.md) for releasing, the updater and the signing key. This file is the rules.

## What it is

One native window with no browser chrome that loads the deployed site. `src-tauri/src/main.rs` is the whole shell: it opens the window on the configured origin, keeps navigation on that origin (anything else goes to the system browser) and, in a release build, asks GitHub Releases whether a newer signed build exists. That is all it does, and it should stay that thin.

## What belongs here

- Packaging and build config: `src-tauri/tauri.conf.json`, `Cargo.toml`, the icons, the capability file and the workflow at `.github/workflows/desktop.yml` (the one file outside this directory that is part of the desktop shell; commits touching it count as desktop commits).
- Native integration that `client/` reaches through an adapter interface: auto-update (built), and in future OS keychain access, native notifications, a tray icon, window management. None of the future ones exist yet, and neither does the adapter interface on the client side.
- Nothing about chat logic, message rendering or app state. That all lives in `client/`. If you find yourself writing a component or a socket handler in here, it is in the wrong place. There is deliberately no JavaScript in this directory at all.

## The window shows the deployed site, not a bundled build

This is a decision, not an accident, and it inverts the older wording of this file ("build the desktop app from `client/`'s production build output"):

- The web app is deployed from `deploy/` on every push; the desktop shell is released rarely. Loading the site means a client fix reaches desktop users the moment it is deployed, with no desktop release. Bundling `client/dist` would put every UI change behind a Tauri release and a signed update.
- It keeps `client/` honestly one codebase. The desktop build is the same bytes the browser gets, served by the same Caddy, with the same cookies. `VITE_AUTH_MODE=bearer` was written for a shell without a cookie jar; this shell has one, so the desktop runs in cookie mode like the web and that env value is unused today.
- The cost is that the app is nothing without the network, which is true of the messenger anyway.

The URL is compiled in: the production URL in a release build, `localhost:5173` in a debug build, and `CIPHER_DESKTOP_URL` at build time to override. See README. Do not add a run-time config file for it; a binary that can be pointed at another origin by a file next to it is a binary whose IndexedDB (and so whose device key) can be handed to another origin.

## The page gets no IPC. Keep it that way

Tauri only exposes commands to `tauri://` content by default; a remote origin gets nothing unless a capability names it in a `remote` block. `capabilities/default.json` has no such block, so the site cannot call into Rust at all, which means a compromised or spoofed site gets exactly what it would get in a browser and no more. The updater and its dialog run entirely on the Rust side for this reason.

When a native feature is eventually needed (keychain, notifications), the way to do it is:

1. Define the adapter interface in `client/` first, with a web stub, per `client/AGENTS.md`.
2. Expose the smallest possible command set here, and grant it to the production origin only, in a `remote` block that lists that origin exactly. Never a wildcard.
3. Treat every argument that arrives from the page as hostile. It came over the network.

## Secure storage of the private key

The rule from the root `AGENTS.md` still holds: the key must never be written to disk unencrypted, never included in crash reports, logs or update diagnostics. What is true today:

- The shell has no key storage of its own. The web app running inside it stores the device-key copy in the WebView's IndexedDB for the site's origin, exactly as the browser does (STATUS.md decision 5: a non-extractable AES-GCM key sealing the private key, 30 idle days, destroyed by Lock). That data lives in the app's own profile directory, separate from any browser's.
- That is the same posture as the web app, no better and no worse. It does not defend against script running on the origin, and it does not use the OS keychain.
- OS keychain storage (Tauri's stronghold plugin, or the `keyring` crate) is the eventual improvement and it needs the adapter interface above first. It is not the first thing to do: the account keypair model is one device per account (decision 4) and the device-key design was chosen precisely so a reload never asks for the password. A keychain would replace the IndexedDB device key, not sit beside it, so it should be designed together with multi-device support rather than bolted on.
- Nothing in this shell logs anything about the page. Keep it so: no crash reporter, no analytics, no "send diagnostics" that could scoop up WebView storage.

## Auto-update

Built, with `tauri-plugin-updater`, signature verification on, the public key in `tauri.conf.json` and the private key in `~/.tauri/cipher.key` on the maintainer's machine and in the `TAURI_SIGNING_PRIVATE_KEY` GitHub Actions secret. **Never commit the private key.** The `.gitignore` here refuses `*.key` as a backstop, not as the rule.

- The manifest is `latest.json` on the newest published GitHub release; `tauri-action` writes it. Publishing a draft release is the act of shipping an update. UPDATES.md has the release checklist, the `releases/latest` caveat and the key rotation procedure.
- Do not add a second endpoint, a fallback without signature checking or `dangerousInsecureTransportProtocol`. An update mechanism that a compromised server could use to push arbitrary code with access to the stored key is the exact failure this rule exists to prevent.
- There are no OS code-signing certificates. README says plainly what that means on macOS and Windows. Do not paper over it in the docs or the release notes.

## Packaging

- Bundles: NSIS on Windows, `.app` + `.dmg` on macOS, AppImage + `.deb` on Linux. The `.deb` cannot auto-update; that is documented in UPDATES.md rather than fixed.
- The workflow triggers only on pushes to `main` touching `desktop/` or itself, and on manual dispatch. A push builds and keeps workflow artifacts; a dispatch creates the draft release. Keep it that way: the server deploys on every push and the desktop does not.
- Icons are generated from `client/public/logo.png` by `npm run icons`. Do not hand-edit `src-tauri/icons/`.

## Testing

- `cargo check` in `src-tauri/` is the fast check. `npm run build` here needs the signing key in `TAURI_SIGNING_PRIVATE_KEY` and an explicitly empty `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, because updater artifacts are on; README has the lines and the two traps.
- Smoke-test that the packaged app actually launches and reaches the site on a clean machine or VM before treating a release build as done. Packaging issues (missing native deps, path assumptions, the unsigned-app dialogs) do not show up in the dev environment. As of 2026-09-07 this has been done for the Windows build on the dev machine only.
- Before finishing, grep what you touched for the two dash characters and for serial commas, per the root `AGENTS.md`. This directory was written clean.
