/**
 * Short-lived STUN and TURN credentials, minted by Cloudflare.
 *
 * The mini PC sits behind a Cloudflare Tunnel that carries no inbound UDP, so
 * a TURN server on the box is impossible without publishing a port, which is
 * the one thing the deployment is built not to do. Cloudflare Realtime issues
 * a credential that expires from a long-lived key that does not, and the key
 * stays here: `TURN_KEY_ID` and `TURN_KEY_API_TOKEN` are read from the
 * environment and never leave the process. Shipping the key itself would hand
 * every visitor an unlimited TURN account.
 *
 * Without a key configured (development, or a box that has not set one up)
 * the answer is STUN only. Two browsers that can reach each other directly
 * still connect; two that cannot will fail to, and the client says so rather
 * than pretending.
 */
import type { FastifyBaseLogger } from 'fastify';

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface IceServers {
  iceServers: IceServer[];
  /// How long the credentials in it are good for. The client fetches on call
  /// start, not page load, so a long-lived tab never holds a dead one.
  ttlSeconds: number;
  /// Whether a relay is on offer at all. False means STUN only.
  relay: boolean;
}

export interface IceProvider {
  iceServers(): Promise<IceServers>;
}

export interface IceProviderOptions {
  keyId?: string;
  apiToken?: string;
  ttlSeconds?: number;
  fetchImpl?: typeof fetch;
  log?: Pick<FastifyBaseLogger, 'warn'>;
}

const DEFAULT_TTL_SECONDS = 3600;
const STUN_ONLY: IceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478'] }];

export function createIceProvider(options: IceProviderOptions = {}): IceProvider {
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const configured = Boolean(options.keyId && options.apiToken);

  return {
    async iceServers(): Promise<IceServers> {
      if (!configured) {
        return { iceServers: STUN_ONLY, ttlSeconds, relay: false };
      }

      try {
        const response = await fetchImpl(
          `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(options.keyId!)}/credentials/generate-ice-servers`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${options.apiToken}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ ttl: ttlSeconds }),
          },
        );

        if (!response.ok) {
          throw new Error(`Cloudflare answered ${response.status}`);
        }

        const body = (await response.json()) as { iceServers?: IceServer | IceServer[] };
        const servers = normalise(body.iceServers);
        if (servers.length === 0) throw new Error('Cloudflare returned no ICE servers');

        return { iceServers: servers, ttlSeconds, relay: true };
      } catch (error) {
        // A relay that cannot be minted must not stop a call that could have
        // gone direct. Fall back to STUN and say so in the log, once per call.
        options.log?.warn({ err: error }, 'TURN credentials unavailable, falling back to STUN');
        return { iceServers: STUN_ONLY, ttlSeconds, relay: false };
      }
    },
  };
}

/// Cloudflare documents `iceServers` as one object carrying every URL under a
/// single username and credential, where the browser wants an array. Both
/// shapes are accepted so a change on their side does not become an outage on
/// ours. Nothing else about the response is touched: passing it through is
/// the point of letting them mint it.
function normalise(value: IceServer | IceServer[] | undefined): IceServer[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}
