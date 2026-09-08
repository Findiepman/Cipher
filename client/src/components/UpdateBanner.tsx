/**
 * "A newer Cipher is ready": one line across the top, on every screen.
 *
 * The desktop shell checks for updates on its own and tells the page; this
 * is where the page says so. It sits above the session states rather than
 * inside the chat, because an update matters as much on the sign-in screen
 * as anywhere, and it never installs anything on its own: the one button is
 * the whole consent. "Later" puts it away until the next version turns up,
 * and the shell asks again on the next start regardless.
 *
 * Renders nothing on the web, where there is no updater and the page is
 * always the newest one.
 */
import { useEffect, useState } from 'react';
import type { UpdateInfo, UpdateProgress } from '../lib/platform';
import { describeProgress } from '../lib/platform/progress';
import { useT } from '../state/I18nProvider';
import { usePlatform } from '../state/PlatformProvider';
import '../styles/update-banner.css';

export function UpdateBanner() {
  const platform = usePlatform();
  const t = useT();
  const updates = platform.updates;
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!updates) return;
    let live = true;
    void updates.pending().then((pending) => {
      if (live && pending) setUpdate(pending);
    });
    const stopAvailable = updates.onAvailable((found) => {
      if (live) setUpdate(found);
    });
    const stopProgress = updates.onProgress((next) => {
      if (live) setProgress(next);
    });
    return () => {
      live = false;
      stopAvailable();
      stopProgress();
    };
  }, [updates]);

  if (!updates || !update || dismissed === update.version) return null;

  async function install() {
    if (!updates) return;
    setInstalling(true);
    setError(null);
    try {
      await updates.install();
      // Resolving at all means the restart did not happen.
      setError(t('desktop.noRestart'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setInstalling(false);
    }
  }

  return (
    <div className="update-banner" role="status">
      <span className="update-banner__text">
        {error
          ? t('update.failed', { message: error })
          : installing
            ? describeProgress(progress, t)
            : t('update.ready', { version: update.version })}
      </span>
      {!installing && (
        <span className="update-banner__actions">
          <button type="button" className="update-banner__install" onClick={() => void install()}>
            {t('update.restart')}
          </button>
          <button
            type="button"
            className="update-banner__later"
            onClick={() => setDismissed(update.version)}
          >
            {t('update.later')}
          </button>
        </span>
      )}
    </div>
  );
}
