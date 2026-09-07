import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings/types';
import type { VoiceSettings } from '../settings/types';
import type { AudioOutput, InputChain, LevelMeter, MicrophoneOptions } from '../media/devices';
import { CallEngine } from './engine';
import {
  SignalRefusedError,
  type CallMedia,
  type CallSealer,
  type CallSignalEventName,
  type CallSignalEvents,
  type CallSignalling,
  type CallSnapshot,
  type IceCandidate,
  type PeerConnectionLike,
  type SessionDescription,
} from './types';

/* --------------------------------------------------------------- fakes --- */

class FakeSignalling implements CallSignalling {
  readonly offers: Parameters<CallSignalling['offer']>[0][] = [];
  readonly answers: Parameters<CallSignalling['answer']>[0][] = [];
  readonly descriptions: Parameters<CallSignalling['description']>[0][] = [];
  readonly candidates: Parameters<CallSignalling['candidate']>[0][] = [];
  readonly hangups: string[] = [];
  readonly rejects: string[] = [];
  /** Set to make the next offer fail the way the server would refuse it. */
  refuseOfferWith: SignalRefusedError | null = null;
  refuseAnswerWith: SignalRefusedError | null = null;

  private readonly handlers = new Map<string, Set<(payload: never) => void>>();

  async offer(payload: Parameters<CallSignalling['offer']>[0]): Promise<void> {
    this.offers.push(payload);
    if (this.refuseOfferWith) throw this.refuseOfferWith;
  }

  async answer(payload: Parameters<CallSignalling['answer']>[0]): Promise<void> {
    this.answers.push(payload);
    if (this.refuseAnswerWith) throw this.refuseAnswerWith;
  }

  description(payload: Parameters<CallSignalling['description']>[0]): void {
    this.descriptions.push(payload);
  }

  candidate(payload: Parameters<CallSignalling['candidate']>[0]): void {
    this.candidates.push(payload);
  }

  hangup(callId: string): void {
    this.hangups.push(callId);
  }

  reject(callId: string): void {
    this.rejects.push(callId);
  }

  on<E extends CallSignalEventName>(
    event: E,
    handler: (payload: CallSignalEvents[E]) => void,
  ): () => void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler as (payload: never) => void);
    this.handlers.set(event, set);
    return () => {
      set.delete(handler as (payload: never) => void);
    };
  }

  /** What the server would push. */
  fire<E extends CallSignalEventName>(event: E, payload: CallSignalEvents[E]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      (handler as (value: CallSignalEvents[E]) => void)(payload);
    }
  }
}

/**
 * Enough of RTCPeerConnection to drive the engine: the signalling state
 * machine, negotiationneeded after addTrack in a stable state (the browser's
 * rule), and hooks to fire the events a real connection would.
 */
class FakePeerConnection implements PeerConnectionLike {
  signalingState: RTCSignalingState = 'stable';
  connectionState: RTCPeerConnectionState = 'new';
  iceConnectionState: RTCIceConnectionState = 'new';
  localDescription: RTCSessionDescription | null = null;

  onnegotiationneeded: PeerConnectionLike['onnegotiationneeded'] = null;
  onicecandidate: PeerConnectionLike['onicecandidate'] = null;
  ontrack: PeerConnectionLike['ontrack'] = null;
  onconnectionstatechange: PeerConnectionLike['onconnectionstatechange'] = null;
  oniceconnectionstatechange: PeerConnectionLike['oniceconnectionstatechange'] = null;

  readonly tracks: MediaStreamTrack[] = [];
  readonly remoteDescriptions: RTCSessionDescriptionInit[] = [];
  readonly remoteCandidates: (RTCIceCandidateInit | undefined)[] = [];
  readonly config: RTCConfiguration;
  restarts = 0;
  closed = false;
  private counter = 0;

  constructor(config: RTCConfiguration) {
    this.config = config;
  }

  addTrack(track: MediaStreamTrack): RTCRtpSender {
    this.tracks.push(track);
    if (this.signalingState === 'stable') {
      queueMicrotask(() => this.onnegotiationneeded?.call(this as never, new Event('negotiationneeded')));
    }
    return {} as RTCRtpSender;
  }

  async setLocalDescription(description?: RTCLocalSessionDescriptionInit): Promise<void> {
    let type: RTCSdpType;
    if (description?.type) {
      type = description.type;
    } else if (this.signalingState === 'have-remote-offer') {
      type = 'answer';
    } else {
      type = 'offer';
    }
    this.counter += 1;
    this.localDescription = {
      type,
      sdp: `${type}-${this.counter}`,
      toJSON: () => ({ type, sdp: `${type}-${this.counter}` }),
    } as RTCSessionDescription;
    this.signalingState = type === 'offer' ? 'have-local-offer' : 'stable';
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescriptions.push(description);
    this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
  }

  async addIceCandidate(candidate?: RTCIceCandidateInit | null): Promise<void> {
    this.remoteCandidates.push(candidate ?? undefined);
  }

  restartIce(): void {
    this.restarts += 1;
  }

  close(): void {
    this.closed = true;
    this.connectionState = 'closed';
  }

  /* The browser's side of things. */

  setConnection(state: RTCPeerConnectionState): void {
    this.connectionState = state;
    this.onconnectionstatechange?.call(this as never, new Event('connectionstatechange'));
  }

  setIce(state: RTCIceConnectionState): void {
    this.iceConnectionState = state;
    this.oniceconnectionstatechange?.call(this as never, new Event('iceconnectionstatechange'));
  }

  gather(candidate: RTCIceCandidateInit | null): void {
    const event = {
      candidate: candidate ? { ...candidate, toJSON: () => candidate } : null,
    } as unknown as RTCPeerConnectionIceEvent;
    this.onicecandidate?.call(this as never, event);
  }

  receiveTrack(stream: MediaStream): void {
    const event = { track: {}, streams: [stream] } as unknown as RTCTrackEvent;
    this.ontrack?.call(this as never, event);
  }
}

interface FakeTrack {
  enabled: boolean;
  stopped: boolean;
  stop(): void;
}

function fakeStream(): MediaStream & { track: FakeTrack } {
  const track: FakeTrack = {
    enabled: true,
    stopped: false,
    stop() {
      this.stopped = true;
    },
  };
  return {
    track,
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream & { track: FakeTrack };
}

class FakeMedia implements CallMedia {
  /** Null makes the microphone refuse. */
  microphone: (MediaStream & { track: FakeTrack }) | null = fakeStream();
  level = 100;
  readonly opened: MicrophoneOptions[] = [];
  chain: (InputChain & { gain: number; stopped: boolean; track: FakeTrack }) | null = null;
  output: (AudioOutput & { attached: MediaStream[]; sink: string | null; volume: number; stopped: boolean }) | null =
    null;
  meterStopped = false;

  async openMicrophone(options: MicrophoneOptions): Promise<MediaStream | null> {
    this.opened.push(options);
    return this.microphone;
  }

  createInputChain(source: MediaStream, gain: number): InputChain {
    const track: FakeTrack = {
      enabled: true,
      stopped: false,
      stop() {
        this.stopped = true;
      },
    };
    const chain = {
      track: track as unknown as MediaStreamTrack,
      stream: source,
      gain,
      stopped: false,
      setGain(value: number) {
        chain.gain = value;
      },
      stop() {
        chain.stopped = true;
        track.stop();
      },
    };
    this.chain = chain as unknown as typeof this.chain;
    return chain as unknown as InputChain;
  }

  createLevelMeter(): LevelMeter {
    return {
      read: () => this.level,
      stop: () => {
        this.meterStopped = true;
      },
    };
  }

  createAudioOutput(): AudioOutput {
    const output = {
      attached: [] as MediaStream[],
      sink: null as string | null,
      volume: 1,
      stopped: false,
      attach(stream: MediaStream) {
        output.attached.push(stream);
      },
      async setSink(id: string | null) {
        output.sink = id;
      },
      setVolume(volume: number) {
        output.volume = volume;
      },
      stop() {
        output.stopped = true;
      },
    };
    this.output = output;
    return output;
  }
}

/**
 * Seals by wrapping, so a test can both recognise a sealed description and
 * read what was inside it. A description that cannot be opened is one that
 * was never sealed by this.
 */
const fakeSealer: CallSealer = {
  async seal(description, peerId) {
    return `sealed:${peerId}:${JSON.stringify(description)}`;
  },
  async open(sealed) {
    // The wrapper names who it was sealed *for*; opening only checks that it
    // was sealed at all, since the other side's fake sealed it for us.
    const match = /^sealed:[^:]*:(.*)$/s.exec(sealed);
    if (!match) throw new Error('cannot open');
    return JSON.parse(match[1]) as SessionDescription;
  },
};

/** What the fake sealer produces for a description sealed for `peerId`. */
function sealedFor(peerId: string, description: SessionDescription): string {
  return `sealed:${peerId}:${JSON.stringify(description)}`;
}

/* -------------------------------------------------------------- harness --- */

const ICE = { iceServers: [{ urls: ['stun:stun.example:3478'] }], relay: true };

interface Harness {
  engine: CallEngine;
  signalling: FakeSignalling;
  media: FakeMedia;
  pcs: FakePeerConnection[];
  snapshots: CallSnapshot[];
  last(): CallSnapshot;
  pc(): FakePeerConnection;
}

function harness(
  overrides: {
    selfId?: string;
    settings?: Partial<VoiceSettings>;
    getIceServers?: () => Promise<typeof ICE>;
    sealer?: CallSealer;
  } = {},
): Harness {
  const signalling = new FakeSignalling();
  const media = new FakeMedia();
  const pcs: FakePeerConnection[] = [];
  const snapshots: CallSnapshot[] = [];

  const engine = new CallEngine({
    signalling,
    media,
    sealer: overrides.sealer ?? fakeSealer,
    selfId: overrides.selfId ?? 'me',
    settings: { ...DEFAULT_SETTINGS.voice, ...overrides.settings },
    getIceServers: overrides.getIceServers ?? (async () => ICE),
    createPeerConnection: (config) => {
      const pc = new FakePeerConnection(config);
      pcs.push(pc);
      return pc;
    },
    newCallId: () => 'call-1',
    endedLingerMs: 50,
  });
  engine.subscribe((snapshot) => snapshots.push(snapshot));

  return {
    engine,
    signalling,
    media,
    pcs,
    snapshots,
    last: () => engine.current,
    pc: () => {
      if (pcs.length === 0) throw new Error('no peer connection yet');
      return pcs[pcs.length - 1];
    },
  };
}

/** Lets queued microtasks (negotiationneeded, awaited acks) run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

const OFFER: SessionDescription = { type: 'offer', sdp: 'their-offer' };
const ME = 'me';

/// Their answer, as it arrives: sealed by them for us. The fake sealer opens
/// with our own id as the peer, so that is what the wrapper carries.
function fromThem(description: SessionDescription): string {
  return sealedFor(ME, description);
}

async function ring(h: Harness): Promise<void> {
  h.signalling.fire('offer', {
    callId: 'call-in',
    conversationId: 'conv-1',
    fromUserId: 'them',
    sdp: fromThem(OFFER),
  });
  await settle();
}

/* ---------------------------------------------------------------- tests --- */

describe('an outgoing call', () => {
  it('opens the microphone, fetches ICE and sends the offer as the ring', async () => {
    const h = harness();

    await h.engine.call('conv-1', 'them');
    await settle();

    expect(h.last()).toMatchObject({
      phase: 'calling',
      callId: 'call-1',
      conversationId: 'conv-1',
      peerId: 'them',
      direction: 'outgoing',
      relay: true,
    });
    expect(h.media.opened).toHaveLength(1);
    expect(h.pc().config.iceServers).toEqual(ICE.iceServers);
    expect(h.pc().tracks).toHaveLength(1);
    expect(h.signalling.offers).toEqual([
      {
        callId: 'call-1',
        conversationId: 'conv-1',
        toUserId: 'them',
        // Sealed for them, through the same seam a message goes through.
        sdp: sealedFor('them', { type: 'offer', sdp: 'offer-1' }),
      },
    ]);
  });

  it('applies the answer, then reports connected when ICE finds a path', async () => {
    const h = harness();
    await h.engine.call('conv-1', 'them');
    await settle();

    h.signalling.fire('answer', {
      callId: 'call-1',
      sdp: fromThem({ type: 'answer', sdp: 'their-answer' }),
    });
    await settle();

    expect(h.pc().remoteDescriptions).toEqual([{ type: 'answer', sdp: 'their-answer' }]);
    expect(h.last().phase).toBe('connecting');

    h.pc().setConnection('connected');
    expect(h.last().phase).toBe('connected');
    expect(h.last().connectedAt).toEqual(expect.any(Number));
  });

  it('ends with busy when the server says they are in another call', async () => {
    const h = harness();
    h.signalling.refuseOfferWith = new SignalRefusedError('busy', 'They are in another call.');

    await h.engine.call('conv-1', 'them');
    await settle();

    expect(h.last()).toMatchObject({
      phase: 'ended',
      endReason: 'busy',
      endMessage: 'They are in another call.',
      peerId: 'them',
    });
    expect(h.media.chain?.stopped).toBe(true);
    expect(h.pc().closed).toBe(true);
  });

  it('names any other refusal and carries the server message', async () => {
    const h = harness();
    h.signalling.refuseOfferWith = new SignalRefusedError('not_friends', 'You are not friends.');

    await h.engine.call('conv-1', 'them');
    await settle();

    expect(h.last()).toMatchObject({ phase: 'ended', endReason: 'refused', endMessage: 'You are not friends.' });
  });

  it('ends without ringing anyone when the microphone cannot be opened', async () => {
    const h = harness();
    h.media.microphone = null;

    await h.engine.call('conv-1', 'them');
    await settle();

    expect(h.last()).toMatchObject({ phase: 'ended', endReason: 'no_microphone' });
    expect(h.signalling.offers).toEqual([]);
    expect(h.pcs).toEqual([]);
  });

  it('falls back to STUN when the ICE endpoint cannot be reached', async () => {
    const h = harness({
      getIceServers: async () => {
        throw new Error('offline');
      },
    });

    await h.engine.call('conv-1', 'them');
    await settle();

    expect(h.last().phase).toBe('calling');
    expect(h.last().relay).toBe(false);
    expect(h.pc().config.iceServers).toEqual([{ urls: ['stun:stun.cloudflare.com:3478'] }]);
  });

  it('ends as unreadable when their answer cannot be opened, and tells the server', async () => {
    const h = harness();
    await h.engine.call('conv-1', 'them');
    await settle();

    h.signalling.fire('answer', { callId: 'call-1', sdp: 'not-for-us' });
    await settle();

    expect(h.last()).toMatchObject({ phase: 'ended', endReason: 'unreadable' });
    expect(h.signalling.hangups).toEqual(['call-1']);
    expect(h.pc().remoteDescriptions).toEqual([]);
  });

  it('ends as unreadable when it holds no key to seal for them', async () => {
    const h = harness({
      sealer: {
        seal: async () => {
          throw new Error('no key');
        },
        open: fakeSealer.open,
      },
    });

    await h.engine.call('conv-1', 'them');
    await settle();

    expect(h.last()).toMatchObject({ phase: 'ended', endReason: 'unreadable' });
    expect(h.signalling.offers).toEqual([]);
  });

  it('is cancelled by hanging up before anyone answers', async () => {
    const h = harness();
    await h.engine.call('conv-1', 'them');
    await settle();

    h.engine.hangUp();

    expect(h.signalling.hangups).toEqual(['call-1']);
    expect(h.last()).toMatchObject({ phase: 'ended', endReason: 'hangup' });
  });

  it('ends as rejected, no answer or disconnected on the server word', async () => {
    for (const reason of ['rejected', 'no_answer', 'disconnected'] as const) {
      const h = harness();
      await h.engine.call('conv-1', 'them');
      await settle();

      h.signalling.fire('ended', { callId: 'call-1', reason });

      expect(h.last()).toMatchObject({ phase: 'ended', endReason: reason });
      expect(h.pc().closed).toBe(true);
    }
  });

  it('ignores an ended for some other call', async () => {
    const h = harness();
    await h.engine.call('conv-1', 'them');
    await settle();

    h.signalling.fire('ended', { callId: 'somebody-elses', reason: 'hangup' });

    expect(h.last().phase).toBe('calling');
  });

  it('goes back to idle once the ended notice has lingered', async () => {
    const h = harness();
    await h.engine.call('conv-1', 'them');
    await settle();
    h.engine.hangUp();

    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(h.last().phase).toBe('idle');
  });

  it('refuses to start a second call while one is in progress', async () => {
    const h = harness();
    await h.engine.call('conv-1', 'them');
    await settle();

    await h.engine.call('conv-2', 'someone-else');
    await settle();

    expect(h.signalling.offers).toHaveLength(1);
    expect(h.last().peerId).toBe('them');
  });
});

describe('an incoming call', () => {
  it('rings with who and where', async () => {
    const h = harness();

    await ring(h);

    expect(h.last()).toMatchObject({
      phase: 'ringing',
      callId: 'call-in',
      conversationId: 'conv-1',
      peerId: 'them',
      direction: 'incoming',
    });
    expect(h.media.opened).toEqual([]);
  });

  it('declines an offer it cannot open, without ringing', async () => {
    const h = harness();

    h.signalling.fire('offer', {
      callId: 'call-in',
      conversationId: 'conv-1',
      fromUserId: 'them',
      sdp: 'sealed-for-somebody-else',
    });
    await settle();

    expect(h.last().phase).toBe('idle');
    expect(h.signalling.rejects).toEqual(['call-in']);
  });

  it('buffers candidates that arrive before it is answered, then applies them', async () => {
    const h = harness();
    await ring(h);
    const early: IceCandidate = { candidate: 'candidate:early', sdpMid: '0', sdpMLineIndex: 0 };
    h.signalling.fire('candidate', { callId: 'call-in', candidate: early });

    await h.engine.accept();
    await settle();

    expect(h.pc().remoteDescriptions).toEqual([OFFER]);
    expect(h.pc().remoteCandidates).toEqual([early]);
  });

  it('answers with the offer applied first and the microphone attached', async () => {
    const h = harness();
    await ring(h);

    await h.engine.accept();
    await settle();

    expect(h.last().phase).toBe('connecting');
    expect(h.media.opened).toHaveLength(1);
    expect(h.pc().tracks).toHaveLength(1);
    expect(h.signalling.answers).toEqual([
      { callId: 'call-in', sdp: sealedFor('them', { type: 'answer', sdp: 'answer-1' }) },
    ]);
    // The answer is the only description that went out. Attaching a track in
    // have-remote-offer state must not have produced an offer.
    expect(h.signalling.offers).toEqual([]);
    expect(h.signalling.descriptions).toEqual([]);
  });

  it('declines with a reject and goes quiet', async () => {
    const h = harness();
    await ring(h);

    h.engine.decline();

    expect(h.signalling.rejects).toEqual(['call-in']);
    expect(h.last().phase).toBe('idle');
  });

  it('treats hang up while ringing as declining', async () => {
    const h = harness();
    await ring(h);

    h.engine.hangUp();

    expect(h.signalling.rejects).toEqual(['call-in']);
    expect(h.signalling.hangups).toEqual([]);
  });

  it('stops ringing silently when another tab answers', async () => {
    const h = harness();
    await ring(h);

    h.signalling.fire('claimed', { callId: 'call-in' });

    expect(h.last().phase).toBe('idle');
    expect(h.signalling.rejects).toEqual([]);
  });

  it('reports a caller who gave up as a missed call', async () => {
    const h = harness();
    await ring(h);

    h.signalling.fire('ended', { callId: 'call-in', reason: 'hangup' });

    expect(h.last()).toMatchObject({ phase: 'ended', endReason: 'missed', peerId: 'them' });
  });

  it('declines on their behalf when accepting finds no microphone', async () => {
    const h = harness();
    h.media.microphone = null;
    await ring(h);

    await h.engine.accept();

    expect(h.signalling.rejects).toEqual(['call-in']);
    expect(h.last()).toMatchObject({ phase: 'ended', endReason: 'no_microphone' });
  });

  it('does not ring while already in a call', async () => {
    const h = harness();
    await h.engine.call('conv-1', 'them');
    await settle();

    h.signalling.fire('offer', {
      callId: 'call-2',
      conversationId: 'conv-2',
      fromUserId: 'other',
      sdp: sealedFor(ME, OFFER),
    });
    await settle();

    expect(h.last().callId).toBe('call-1');
  });
});

describe('the connection', () => {
  it('sends its candidates out under the call id, the end marker included', async () => {
    const h = harness();
    await h.engine.call('conv-1', 'them');
    await settle();

    const candidate = { candidate: 'candidate:mine', sdpMid: '0', sdpMLineIndex: 0 };
    h.pc().gather(candidate);
    h.pc().gather(null);

    expect(h.signalling.candidates).toEqual([
      { callId: 'call-1', candidate },
      { callId: 'call-1', candidate: null },
    ]);
  });

  it('plays the remote track through the output', async () => {
    const h = harness();
    await h.engine.call('conv-1', 'them');
    await settle();

    const theirs = fakeStream();
    h.pc().receiveTrack(theirs);

    expect(h.media.output?.attached).toEqual([theirs]);
  });

  it('hangs up and reports failure when the connection fails', async () => {
    const h = harness();
    await h.engine.call('conv-1', 'them');
    await settle();

    h.pc().setConnection('failed');

    expect(h.signalling.hangups).toEqual(['call-1']);
    expect(h.last()).toMatchObject({ phase: 'ended', endReason: 'failed' });
  });

  it('asks for an ICE restart when ICE fails', async () => {
    const h = harness();
    await h.engine.call('conv-1', 'them');
    await settle();

    h.pc().setIce('failed');

    expect(h.pc().restarts).toBe(1);
  });

  it('ends as disconnected when the signalling socket drops', async () => {
    const h = harness();
    await h.engine.call('conv-1', 'them');
    await settle();

    h.signalling.fire('offline', undefined);

    expect(h.last()).toMatchObject({ phase: 'ended', endReason: 'disconnected' });
  });

  it('sends a renegotiation as a description once the call exists', async () => {
    const h = harness();
    await h.engine.call('conv-1', 'them');
    await settle();
    h.signalling.fire('answer', { callId: 'call-1', sdp: fromThem({ type: 'answer', sdp: 'a' }) });
    await settle();

    // The browser decides it needs to renegotiate, an ICE restart say.
    h.pc().onnegotiationneeded?.call(h.pc() as never, new Event('negotiationneeded'));
    await settle();

    expect(h.signalling.offers).toHaveLength(1);
    expect(h.signalling.descriptions).toEqual([
      { callId: 'call-1', sdp: sealedFor('them', { type: 'offer', sdp: 'offer-2' }) },
    ]);
  });
});

describe('perfect negotiation', () => {
  it('has the impolite side ignore an offer that collides with its own', async () => {
    // 'z' > 'a', so we are impolite.
    const h = harness({ selfId: 'z' });
    await h.engine.call('conv-1', 'a');
    await settle();
    h.signalling.fire('answer', {
      callId: 'call-1',
      sdp: sealedFor('z', { type: 'answer', sdp: 'a' }),
    });
    await settle();

    // We have an offer out (have-local-offer) when theirs arrives.
    await h.pc().setLocalDescription();
    h.signalling.fire('description', {
      callId: 'call-1',
      sdp: sealedFor('z', { type: 'offer', sdp: 'theirs' }),
    });
    await settle();

    expect(h.pc().remoteDescriptions.map((d) => d.sdp)).not.toContain('theirs');
    expect(h.signalling.descriptions).toEqual([]);
  });

  it('has the polite side roll back and answer the colliding offer', async () => {
    // 'a' < 'z', so we are polite.
    const h = harness({ selfId: 'a' });
    await h.engine.call('conv-1', 'z');
    await settle();
    h.signalling.fire('answer', {
      callId: 'call-1',
      sdp: sealedFor('a', { type: 'answer', sdp: 'a' }),
    });
    await settle();

    await h.pc().setLocalDescription();
    h.signalling.fire('description', {
      callId: 'call-1',
      sdp: sealedFor('a', { type: 'offer', sdp: 'theirs' }),
    });
    await settle();

    expect(h.pc().remoteDescriptions.map((d) => d.sdp)).toContain('theirs');
    expect(h.signalling.descriptions).toEqual([
      { callId: 'call-1', sdp: expect.stringMatching(/^sealed:z:.*"type":"answer"/) },
    ]);
  });
});

describe('the microphone gate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function connectedCall(overrides: Partial<VoiceSettings> = {}): Promise<Harness> {
    const h = harness({ settings: overrides });
    const started = h.engine.call('conv-1', 'them');
    await vi.advanceTimersByTimeAsync(0);
    await started;
    return h;
  }

  it('transmits when the room is louder than the threshold, and not when it is quieter', async () => {
    const h = await connectedCall({ inputMode: 'voice-activity', sensitivity: 35 });
    h.media.level = 80;
    await vi.advanceTimersByTimeAsync(100);
    expect(h.media.chain?.track.enabled).toBe(true);
    expect(h.last().transmitting).toBe(true);

    h.media.level = 0;
    // Still open through the hang time, so the end of a word is not clipped.
    await vi.advanceTimersByTimeAsync(200);
    expect(h.media.chain?.track.enabled).toBe(true);
    await vi.advanceTimersByTimeAsync(400);
    expect(h.media.chain?.track.enabled).toBe(false);
    expect(h.last().transmitting).toBe(false);
  });

  it('mute wins over everything', async () => {
    const h = await connectedCall({ inputMode: 'voice-activity', sensitivity: 0 });
    await vi.advanceTimersByTimeAsync(100);
    expect(h.media.chain?.track.enabled).toBe(true);

    h.engine.setMuted(true);
    expect(h.media.chain?.track.enabled).toBe(false);
    expect(h.last()).toMatchObject({ muted: true, transmitting: false });

    h.engine.toggleMuted();
    await vi.advanceTimersByTimeAsync(100);
    expect(h.media.chain?.track.enabled).toBe(true);
  });

  it('push to talk only transmits while held', async () => {
    const h = await connectedCall({ inputMode: 'push-to-talk' });
    h.media.level = 100;
    await vi.advanceTimersByTimeAsync(100);
    expect(h.media.chain?.track.enabled).toBe(false);

    h.engine.setTalking(true);
    expect(h.media.chain?.track.enabled).toBe(true);
    expect(h.last().transmitting).toBe(true);

    h.engine.setTalking(false);
    expect(h.media.chain?.track.enabled).toBe(false);
  });

  it('follows the settings that change mid-call', async () => {
    const h = await connectedCall({ inputVolume: 100, outputVolume: 100 });
    expect(h.media.chain?.gain).toBe(1);

    h.engine.applySettings({
      ...DEFAULT_SETTINGS.voice,
      inputVolume: 50,
      outputVolume: 25,
      outputDeviceId: 'speaker-2',
      inputMode: 'push-to-talk',
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(h.media.chain?.gain).toBe(0.5);
    expect(h.media.output?.volume).toBe(0.25);
    expect(h.media.output?.sink).toBe('speaker-2');
    // Now push to talk, and nothing is held.
    expect(h.media.chain?.track.enabled).toBe(false);
  });

  it('stops polling and releases the hardware when the call ends', async () => {
    const h = await connectedCall();
    h.engine.hangUp();

    expect(h.media.chain?.stopped).toBe(true);
    expect(h.media.meterStopped).toBe(true);
    expect(h.media.output?.stopped).toBe(true);
    expect(h.pc().closed).toBe(true);
  });
});
