import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRoot } from './AppRoot';
import { UpdateBanner } from './components/UpdateBanner';
import { unlockOnFirstGesture } from './lib/media/sounds';
import { DesktopPrefsSync } from './state/DesktopPrefsSync';
import { I18nProvider } from './state/I18nProvider';
import { PlatformProvider } from './state/PlatformProvider';
import { SessionProvider } from './state/SessionProvider';
import { SettingsProvider } from './state/SettingsProvider';

// Browsers refuse to play audio until the page has been interacted with, and
// the alerts that matter (a message landing, a call ringing) arrive with no
// gesture of their own. Claiming the right here, on the first click or key
// anywhere, is what lets them make a sound later.
unlockOnFirstGesture();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* I18n sits directly under Settings, which holds the choice, and above
        everything else, because the sign in screen has words on it too. The
        platform sits under both: the update banner has words and the desktop
        preferences it pushes to the shell come from settings. */}
    <SettingsProvider>
      <I18nProvider>
        <PlatformProvider>
          <DesktopPrefsSync />
          <SessionProvider>
            <div className="root-column">
              <UpdateBanner />
              <div className="root-column__body">
                <AppRoot />
              </div>
            </div>
          </SessionProvider>
        </PlatformProvider>
      </I18nProvider>
    </SettingsProvider>
  </StrictMode>,
);
