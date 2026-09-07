import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRoot } from './AppRoot';
import { SessionProvider } from './state/SessionProvider';
import { SettingsProvider } from './state/SettingsProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <SessionProvider>
        <AppRoot />
      </SessionProvider>
    </SettingsProvider>
  </StrictMode>,
);
