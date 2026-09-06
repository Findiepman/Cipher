import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    // These are integration tests against a real Postgres. They share one
    // database, so they must not run concurrently.
    fileParallelism: false,
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
