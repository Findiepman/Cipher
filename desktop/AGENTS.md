# AGENTS.md: desktop app

Read the root `AGENTS.md` first. This directory is the native desktop app around `client/`. **The choice is Tauri 2**, made on 2026-09-07, and [`README.md`](README.md) here is the runbook for running and building it, with [`UPDATES.md`](UPDATES.md) for releasing, the updater and the signing key. This file is the rules.

## What it is

The web client, built in desktop mode (`client/.env.desktop`) and bundled into a Tauri shell. The shell is four small Rust files: `main.rs` opens the window and decides what closing it means, `commands.rs` is the list of things the page may ask for, `tray.rs` is the tray, `updater.rs` checks for and installs updates. The page reaches all of it through one interface, `client/src/lib/platform/`, and nothing else. Keep the shell that thin: it should be possible to read all of it in one sitting.

## What belongs here

- Packaging and build config: `src-tauri/tauri.conf.json`, `Cargo.toml`, the icons, the capability file, `Info.plist` and the workflow at `.github/workflows/desktop.yml` (the one file outside this directory that is part of the desktop app; commits touching it count as desktop commits).
- Native integration the page reaches through the platform adapter: the tray, notifications, the badge, attention, autostart, close-to-tray, the updater, opening links outside. Each is a command in `commands.rs` or `updater.rs` and a method on `Platform` in `client/src/lib/platform/types.ts`.
- Nothing about chat logic, message rendering or app state. That all lives in `client/`. If you find yourself writing a component or a socket handler in here, it is in the wrong place. There is deliberately no JavaScript in this directory at all: the page side of every feature is in `client/`, where the web build can give it a browser behaviour.

## The app bundles the client; it is not a window on the website

This is a decision, made on 2026-09-08, and it reverses the one before it (a shell that loaded the deployed site):

- People use the desktop app more than the site, so the desktop has to be a real app: its own origin and storage, native features the page can call, working the same whether the site is up or not, and nothing running in it that was fetched at start. A window on a website is none of those.
- The cost is that a change under `client/` reaches desktop users only through a release. The workflow makes a release one dispatch and one button, and installed apps pick it up within hours. Release often rather than rarely.
- It keeps `client/` honestly one codebase. The desktop build is the same source as the web build with three env values changed (`VITE_API_URL`, `VITE_AUTH_MODE=bearer`, `VITE_PLATFORM=desktop`). Do not fork UI between the two; a difference belongs behind `usePlatform()` or `isDesktop`, and there should be very few of them.
- The API URL is compiled into the page, not read at run time, for the same reason the old shell compiled it in: a binary that can be pointed at another origin by a file next to it is a binary whose stored session and device key can be handed to that origin.

## Adding a native feature

The order matters and it is the one `client/AGENTS.md` describes:

1. Add the method to `Platform` in `client/src/lib/platform/types.ts`, with a comment saying what it is for.
2. Give it a browser behaviour in `web.ts`. "Do nothing" is a valid behaviour; a thrown error is not.
3. Add the command here, in `commands.rs` (or a new file if it is a whole subsystem, as the updater is), and call it from `desktop.ts`.
4. Treat every argument that arrives from the page as hostile even though the page is bundled: check URLs, bound counts, never take a path. `open_external` is the model.
5. Prefer a command over granting the page a plugin. The page holds `core:default` and `opener:default` (`capabilities/default.json`) and nothing else; notifications, autostart and the updater are reached through commands so the shell decides what the page can do with them. Never add a `remote` block: the page is local, and no remote origin has business in this process.

## Secure storage

The rule from the root `AGENTS.md` still holds: the private key must never be written to disk unencrypted, never included in crash reports, logs or update diagnostics. What is true today:

- The shell has no key storage of its own. The web app running inside it stores the device-key copy in the WebView's IndexedDB for the app's origin, exactly as the browser does (STATUS.md decision 5: a non-extractable AES-GCM key sealing the private key, 30 idle days, destroyed by Lock). That data lives in the app's own profile directory, separate from any browser's.
- The session is also in that IndexedDB: the refresh token, in the clear, because bearer mode has no cookie jar to keep it in and a session that dies with the process is a sign-in per launch (`client/src/lib/storage/refreshTokenStore.ts`). It is the one raw credential in `SecureStore`, and it is documented as such there and in README.
- OS keychain storage (the `keyring` crate, or Tauri's stronghold plugin) is the improvement for both. It is not bolted on now because a keychain should replace the IndexedDB device key rather than sit beside it, and that design belongs with multi-device support (STATUS.md decision 4). When it happens, it goes through the adapter like everything else, with `window.cipherNative.secureStorage` in `secureStore.ts` as the seam that already exists for it.
- Nothing in this shell logs anything about the page. `notify` hands text to the OS notification centre and that is the only place page content ever leaves the WebView; the page decides what may be in it (`client/src/lib/settings/desktopNotifications.ts`, which gates every message notification, and `components/DesktopNotifier.tsx`, which raises them through the adapter). Keep it so: no crash reporter, no analytics, no "send diagnostics" that could scoop up WebView storage.

## Auto-update

Built, with `tauri-plugin-updater`, signature verification on, the public key in `tauri.conf.json` and the private key in `~/.tauri/cipher.key` on the maintainer's machine and in the `TAURI_SIGNING_PRIVATE_KEY` GitHub Actions secret. **Never commit the private key.** The `.gitignore` here refuses `*.key` as a backstop, not as the rule.

- The shell checks eight seconds after start and every four hours, holds what it finds and tells the page (`update:available`). The page shows a banner and a button in Settings, Desktop. Nothing downloads until that button. Keep the consent on the page side and the download on this side.
- The manifest is `latest.json` on the newest published GitHub release; `tauri-action` writes it. Publishing a draft release is the act of shipping an update. UPDATES.md has the release checklist, the `releases/latest` caveat and the key rotation procedure.
- Do not add a second endpoint, a fallback without signature checking or `dangerousInsecureTransportProtocol`. An update mechanism that a compromised server could use to push arbitrary code with access to the stored key is the exact failure this rule exists to prevent.
- There are no OS code-signing certificates. README says plainly what that means on macOS and Windows. Do not paper over it in the docs or the release notes.

## Packaging

- Bundles: NSIS on Windows, `.app` + `.dmg` on macOS, AppImage + `.deb` on Linux. The `.deb` cannot auto-update; that is documented in UPDATES.md rather than fixed.
- The workflow triggers on pushes to `main` touching `desktop/`, `client/`, `packages/`, the root manifests or itself, and on manual dispatch. A push builds and keeps workflow artifacts; a dispatch creates the draft release. Keep it that way: the server deploys on every push and the desktop does not.
- The client build in CI needs the workspace installed from the root and the rollup and esbuild binaries for the builder added by hand, because the lockfile was written on Windows. The workflow explains the step; `client/Dockerfile` has the same one.
- Icons are generated from `client/public/logo.png` by `npm run icons`. Do not hand-edit `src-tauri/icons/`.
- The CSP in `tauri.conf.json` is the desktop's equivalent of the one in `deploy/Caddyfile`, with the API host in `connect-src` because the desktop is cross-origin. Keep the two in step when one changes.

## Testing

- `npm run check` here is `cargo check`, the fast check. `npm run build` needs the signing key in `TAURI_SIGNING_PRIVATE_KEY` and an explicitly empty `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, because updater artifacts are on; README has the lines and the two traps.
- The page side has tests: `client/src/lib/settings/desktopNotifications.test.ts` for what gets a notification, `client/src/lib/api/session.test.ts` for the session surviving a restart, and the socket handshake test in `socketTransport.test.ts`. The Rust side has none; it is thin enough that `cargo check` plus a launch is the test.
- Smoke-test that the packaged app actually launches, signs in and reconnects on a clean machine or VM before treating a release build as done. Packaging issues (missing native deps, path assumptions, the unsigned-app dialogs) do not show up in the dev environment. As of 2026-09-08 this has been done for the Windows build on the dev machine only.
- Before finishing, grep what you touched for the two dash characters and for serial commas, per the root `AGENTS.md`. This directory was written clean.
