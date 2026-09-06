import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRoot } from './AppRoot';
import { SessionProvider } from './state/SessionProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionProvider>
      <AppRoot />
    </SessionProvider>
  </StrictMode>,
);
