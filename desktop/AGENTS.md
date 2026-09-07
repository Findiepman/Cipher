# AGENTS.md: desktop shell

Read the root `AGENTS.md` first. This directory is the native desktop wrapper (Tauri, or Electron if that's the choice made) around the `client/` build output. It should stay thin.

## What belongs here

- App packaging/build config (Tauri's `tauri.conf.json` and Rust shell, or Electron's main process).
- Native integrations that `client/` reaches through an adapter interface: OS keychain access for storing the private key, native notifications, tray icon, auto-update, window management.
- Nothing about chat logic, message rendering, or app state, that all lives in `client/`. If you find yourself writing a component or a socket handler in here, it's in the wrong place.

## Secure storage of the private key

This is the one piece of desktop-specific code that matters most for the security story of the whole app:

- Store the user's private key via the OS-native secure storage: Tauri's keyring/stronghold plugin, or Electron's `safeStorage` API, not a plain file on disk, even in a "hidden" app-data folder.
- The key should never be written to disk unencrypted, and never included in crash reports, log files, or auto-update diagnostics.
- If Tauri/Electron is not yet decided, note the choice here once it is, and keep this section in sync with whichever secure-storage API is actually in use.

## Packaging

- Build the desktop app from `client/`'s production build output, don't maintain a separate dev-mode-only code path that diverges from what actually ships.
- Auto-update, if/when added, should verify update package signatures. Don't wire up an update mechanism that would let a compromised update server push arbitrary code with access to the stored private key.

## Testing

- Smoke-test that the packaged app actually launches and can reach the backend on a clean machine/VM before treating a release build as done, packaging issues (missing native deps, path assumptions) tend not to show up in the dev environment.
