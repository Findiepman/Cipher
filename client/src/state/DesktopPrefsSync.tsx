/**
 * Pushes the desktop preferences from settings into the shell.
 *
 * The shell needs "close to tray" at the moment the window is closed, which
 * is a Rust event the page never sees, so the page tells the shell the
 * current value whenever it changes and once at start. Renders nothing, and
 * does nothing at all on the web, where `prefs` is null.
 */
import { useEffect } from 'react';
import { usePlatform } from './PlatformProvider';
import { useSettings } from './SettingsProvider';

export function DesktopPrefsSync() {
  const platform = usePlatform();
  const { settings } = useSettings();
  const { closeToTray } = settings.desktop;

  useEffect(() => {
    void platform.prefs?.setCloseToTray(closeToTray).catch(() => {
      // The shell is the fallback here: it defaults to keeping the app
      // running, which is the safer of the two behaviours to land on.
    });
  }, [platform, closeToTray]);

  return null;
}
