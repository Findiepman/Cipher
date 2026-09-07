import { describe, expect, it } from 'vitest';
import { createCallSealer, UnknownPeerError } from './sealing';

const mine = new Uint8Array(32).fill(1);
const theirs = new Uint8Array(32).fill(2);

function sealer(peerKey: Uint8Array | null = theirs) {
  return createCallSealer({
    privateKey: mine,
    publicKey: mine,
    resolvePeerKey: async () => peerKey,
  });
}

describe('sealing a session description', () => {
  it('round-trips through the message envelope', async () => {
    const description = { type: 'offer' as const, sdp: 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n' };

    const sealed = await sealer().seal(description, 'them');
    expect(sealed).not.toContain('v=0');
    // The same envelope messages use, so phase 2 changes both at once.
    expect(JSON.parse(sealed)).toMatchObject({ v: 1, alg: 'none' });

    expect(await sealer().open(sealed, 'them')).toEqual(description);
  });

  it('refuses a peer whose key it does not have', async () => {
    await expect(sealer(null).seal({ type: 'offer' }, 'stranger')).rejects.toBeInstanceOf(
      UnknownPeerError,
    );
  });

  it('refuses an envelope that does not hold a description', async () => {
    const notADescription = await sealer().seal({ type: 'offer' } as never, 'them');
    const tampered = notADescription.replace(
      JSON.parse(notADescription).body,
      Buffer.from(JSON.stringify({ hello: 'world' })).toString('base64'),
    );

    await expect(sealer().open(tampered, 'them')).rejects.toThrow(/Not a session description/);
    await expect(sealer().open('garbage', 'them')).rejects.toThrow();
  });
});
