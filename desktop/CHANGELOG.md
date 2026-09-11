# Changelog

What changed for people using the desktop app, one section per version,
newest first. This file is read by machines as well as people:

- The `desktop` workflow takes the section whose heading matches the version
  in `src-tauri/tauri.conf.json` and makes it the body of the GitHub release.
- The app quotes that body in the update banner and under Settings, Desktop,
  beside "a newer version is ready". So write it for the person about to
  press "Restart to update", not for a developer: what is different for them,
  in a few lines, with no file names.
- `release.sh` and `release.ps1` refuse to start when there is no section for
  the version being released, and the workflow fails the same way. A bump
  without an entry does not ship.

The heading is `## <version> (<date>)`, and the version has to match the
bumped one exactly. Everything under it until the next `## ` heading is the
release body. The house style applies: no em dashes, no Oxford commas.

## 1.0.2 (2026-09-11)

Messages are now really encrypted. Every message and every call is sealed on
your device with the other person's key, and the server stores and relays
something it cannot read. Messages from before this update stay readable.

If somebody's security key ever changes, the conversation pauses with a
notice until you say it is fine. That usually means they reset their password
or moved to a new device.

This update is needed to read messages sent from newer versions: until you
install it, those arrive as "could not be opened".

## 1.0.1 (2026-09-09)

The first release with a working updater. Installers for Windows, macOS and
Linux, with signed updates announced by a banner in the app.
