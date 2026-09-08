import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRoot } from './AppRoot';
import { I18nProvider } from './state/I18nProvider';
import { SessionProvider } from './state/SessionProvider';
import { SettingsProvider } from './state/SettingsProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* I18n sits directly under Settings, which holds the choice, and above
        everything else, because the sign in screen has words on it too. */}
    <SettingsProvider>
      <I18nProvider>
        <SessionProvider>
          <AppRoot />
        </SessionProvider>
      </I18nProvider>
    </SettingsProvider>
  </StrictMode>,
);
