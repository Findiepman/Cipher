import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRoot } from './AppRoot';
import { UpdateBanner } from './components/UpdateBanner';
import { DesktopPrefsSync } from './state/DesktopPrefsSync';
import { I18nProvider } from './state/I18nProvider';
import { PlatformProvider } from './state/PlatformProvider';
import { SessionProvider } from './state/SessionProvider';
import { SettingsProvider } from './state/SettingsProvider';

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
