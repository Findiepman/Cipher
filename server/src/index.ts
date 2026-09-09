import { buildApp } from './app.js';
import { prisma } from './db.js';
import { env } from './env.js';
import { attachRealtime, type Realtime } from './realtime/index.js';

// The HTTP routes need the socket layer (to deliver a message, to broadcast a
// presence change, to drop a revoked session), and the socket layer needs the
// HTTP server that carries the routes, so one of the two has to be bound
// late. A closure over this is the smaller of the two knots: the alternative
// is the socket layer owning route registration.
let realtime: Realtime | null = null;

const app = await buildApp({
  deliver: (message) => realtime?.deliver(message),
  presenceChanged: (userId) => realtime?.presenceChanged(userId),
  disconnectSessions: (sessionIds) => realtime?.disconnectSessions(sessionIds),
});

realtime = attachRealtime(app);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await realtime?.close();
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
} catch (error) {
  app.log.error({ err: error }, 'failed to start');
  process.exit(1);
}
