/**
 * The HTTP side of calls: one endpoint, handing the client the `iceServers`
 * array it gives to RTCPeerConnection. Everything else about a call happens
 * over the socket (realtime/calls.ts).
 *
 * Adding a route here means adding `/calls` to the `@api` matcher in
 * deploy/Caddyfile, or it 404s in production and works in development.
 */
import type { FastifyPluginAsync } from 'fastify';
import type { IceProvider } from './ice.js';

export interface CallsRouteOptions {
  ice: IceProvider;
}

export const callsRoutes: FastifyPluginAsync<CallsRouteOptions> = async (fastify, options) => {
  fastify.addHook('preHandler', fastify.requireAuth);

  fastify.get('/ice', async () => options.ice.iceServers());
};
