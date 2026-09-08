import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRoot } from './AppRoot';
import { UpdateBanner } from './components/UpdateBanner';
import { DesktopPrefsSync } from './state/DesktopPrefsSync';
import { PlatformProvider } from './state/PlatformProvider';
import { SessionProvider } from './state/SessionProvider';
import { SettingsProvider } from './state/SettingsProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
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
    </SettingsProvider>
  </StrictMode>,
);
