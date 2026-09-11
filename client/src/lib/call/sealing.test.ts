import {
  BOX_ALG,
  encryptMessage,
  generateKeyPair,
  serializeCiphertext,
  type KeyPair,
} from '@cipher/crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCallSealer, UnknownPeerError } from './sealing';

let mine: KeyPair;
let theirs: KeyPair;

beforeAll(async () => {
  [mine, theirs] = await Promise.all([generateKeyPair(), generateKeyPair()]);
});

/// Our side of the call, with the peer's key known unless told otherwise.
function ours(peerKey: Uint8Array | null | undefined = undefined) {
  return createCallSealer({
    privateKey: mine.privateKey,
    publicKey: mine.publicKey,
    resolvePeerKey: async () => (peerKey === undefined ? theirs.publicKey : peerKey),
  });
}

/// Their side, which is what actually has to open what we sealed.
function peer() {
  return createCallSealer({
    privateKey: theirs.privateKey,
    publicKey: theirs.publicKey,
    resolvePeerKey: async () => mine.publicKey,
  });
}

describe('sealing a session description', () => {
  it('round-trips through the message envelope', async () => {
    const description = { type: 'offer' as const, sdp: 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n' };

    const sealed = await ours().seal(description, 'them');
    expect(sealed).not.toContain('v=0');
    // The same envelope messages use, so one change sealed both.
    expect(JSON.parse(sealed)).toMatchObject({ v: 1, alg: BOX_ALG });

    expect(await peer().open(sealed, 'us')).toEqual(description);
  });

  it('cannot be opened by anyone but the peer', async () => {
    const eve = await generateKeyPair();
    const sealed = await ours().seal({ type: 'offer', sdp: 'v=0' }, 'them');
    const eavesdropper = createCallSealer({
      privateKey: eve.privateKey,
      publicKey: eve.publicKey,
      resolvePeerKey: async () => mine.publicKey,
    });
    await expect(eavesdropper.open(sealed, 'us')).rejects.toThrow();
  });

  it('refuses a message body passed off as a description', async () => {
    // Same keys, different context: a sealed chat message must not be
    // accepted where an offer was expected, however well-formed its JSON.
    const lookalike = serializeCiphertext(
      await encryptMessage(
        JSON.stringify({ type: 'offer', sdp: 'v=0' }),
        theirs.publicKey,
        mine.privateKey,
        'conversation:anything',
      ),
    );
    await expect(peer().open(lookalike, 'us')).rejects.toThrow(/somewhere else/);
  });

  it('refuses a peer whose key it does not have', async () => {
    await expect(ours(null).seal({ type: 'offer' }, 'stranger')).rejects.toBeInstanceOf(
      UnknownPeerError,
    );
  });

  it('refuses an envelope that does not hold a description', async () => {
    // Sealed correctly, in the right context, by the right person, but what
    // is inside is not a description. What comes out of the box is still
    // untrusted input.
    const sealed = serializeCiphertext(
      await encryptMessage(
        JSON.stringify({ hello: 'world' }),
        theirs.publicKey,
        mine.privateKey,
        'call',
      ),
    );

    await expect(peer().open(sealed, 'us')).rejects.toThrow(/Not a session description/);
    await expect(peer().open('garbage', 'us')).rejects.toThrow();
  });
});
