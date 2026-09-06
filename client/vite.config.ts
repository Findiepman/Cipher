import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  test: {
    // No component tests yet — every suite here is plain logic (api client,
    // outbox, chat store, crypto call sites) and the browser globals those
    // touch are all feature-detected. Switch to 'jsdom' and add the dep when
    // the first component test lands.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
