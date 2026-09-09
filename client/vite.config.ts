import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Where the Fastify server in `server/` listens in development. */
const API = { target: 'http://127.0.0.1:3000', changeOrigin: false } as const;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    /**
     * Vite refuses requests whose Host it does not recognise, which is what
     * stops a stranger pointing their own domain at your dev server. A quick
     * Cloudflare tunnel hands out a fresh `*.trycloudflare.com` name each run,
     * so the wildcard is the only workable form: naming one would mean editing
     * this file every time the tunnel restarts.
     *
     * Only that suffix, and only in development. It is how a real phone gets
     * an HTTPS origin, which service workers and the Notification API both
     * require and a plain LAN address can never be.
     */
    allowedHosts: ['.trycloudflare.com'],
    /**
     * The same split Caddy does in production (`deploy/Caddyfile`, the `@api`
     * matcher), so a phone can reach the whole app through one origin.
     *
     * Without this a phone loading the dev server would resolve
     * `VITE_API_URL=http://localhost:3000` against *itself* and find nothing.
     * With it, the API is same-origin: set `VITE_API_URL=` empty (see
     * `.env.phone`) and there is no CORS, no second tunnel, and cookies stay
     * first-party, exactly as the deployed site behaves.
     *
     * Keep this list and the Caddyfile's in step. A path missing here falls
     * through to index.html and arrives as HTML where JSON was expected.
     */
    proxy: {
      '/auth': API,
      '/account': API,
      '/users': API,
      '/friends': API,
      '/keys': API,
      '/conversations': API,
      '/calls': API,
      '/health': API,
      // The socket needs the upgrade, which the others do not.
      '/socket.io': { ...API, ws: true },
    },
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
