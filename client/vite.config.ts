import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  test: {
    // Node by default; component suites opt into jsdom with a
    // `// @vitest-environment jsdom` line of their own.
    //
    // Not jsdom everywhere: libsodium type-checks its arguments with
    // `instanceof Uint8Array`, and under jsdom the typed arrays the test realm
    // hands it are not the ones it recognises, so every crypto call throws
    // "unsupported input type for message". Scoping the DOM to the files that
    // need one avoids that entirely, and keeps the logic suites fast.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
