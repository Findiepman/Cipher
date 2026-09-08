/**
 * The CORS allowlist. The web app is same-origin in production and never
 * needs it; the desktop app is cross-origin by construction and cannot work
 * without it. Both facts are cheap to pin down and expensive to discover
 * from an installed app that signs in and then sees every request fail.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DESKTOP_ORIGINS } from '../src/lib/origins.js';
import { createTestApp } from './helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  ({ app } = await createTestApp());
});

afterAll(async () => {
  await app.close();
});

function preflight(origin: string) {
  return app.inject({
    method: 'OPTIONS',
    url: '/auth/login',
    headers: {
      origin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type,authorization',
    },
  });
}

describe('CORS', () => {
  it.each(DESKTOP_ORIGINS)('lets the desktop app at %s through', async (origin) => {
    const response = await preflight(origin);
    expect(response.statusCode).toBeLessThan(300);
    expect(response.headers['access-control-allow-origin']).toBe(origin);
    // The desktop authenticates with a header, so the preflight has to
    // admit one, or the browser never sends the real request.
    expect(String(response.headers['access-control-allow-headers'])).toMatch(/authorization/i);
  });

  it('lets the configured app origin through', async () => {
    const origin = process.env.APP_URL ?? 'http://localhost:5173';
    const response = await preflight(origin);
    expect(response.headers['access-control-allow-origin']).toBe(origin);
  });

  it('answers any other origin with no allow header at all', async () => {
    const response = await preflight('https://evil.example');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
