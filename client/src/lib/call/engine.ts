/**
 * The call engine: one RTCPeerConnection, one microphone, one state machine.
 *
 * It owns everything between "press call" and "audio is flowing", and it is
 * written against interfaces (CallSignalling, CallMedia, PeerConnectionLike)
 * so the whole thing can be driven in a test with no server and no browser.
 * React binds to it through `subscribe`; nothing in here knows about React.
 *
 * Negotiation follows the "perfect negotiation" pattern from the WebRTC spec
 * rather than anything hand-rolled. Each side is polite or impolite, decided
 * from the two user ids, and a polite side that finds itself in a collision
 * rolls back while the impolite one ignores the incoming offer. Two people
 * pressing call at the same instant is handled a level up, by the server,
 * which lets exactly one ring survive; the pattern here covers everything
 * after that, renegotiation and ICE restarts included.
 *
 * Every session description goes out through `CallSealer`, the same envelope
 * seam a message body uses, and comes back in through it. In phase 1 that is
 * a base64 no-op; the engine does not know or care, which is the point.
 *
 * What the engine says about privacy: nothing. The audio is DTLS-SRTP between
 * two browsers and never touches the server, which is real end-to-end
 * encryption, and the signalling that sets it up is not yet bound to the
 * identity key (voice-plan.md, stage 6). Decision 21 in STATUS.md is that the
 * UI makes no encryption claims, so there is no flag here to draw one from.
 */
import type { VoiceSettings } from '../settings/types';
import type { AudioOutput, InputChain, LevelMeter } from '../media/devices';
import {
  IDLE_CALL,
  SignalRefusedError,
  type CallEndReason,
  type CallMedia,
  type CallSealer,
  type CallSignalling,
  type CallSnapshot,
  type IceCandidate,
  type IceConfig,
  type IncomingOffer,
  type PeerConnectionLike,
  type SealedDescription,
  type SessionDescription,
} from './types';

/** How long "call ended, because" stays on screen before the bar goes away. */
const ENDED_LINGER_MS = 4_000;

/** How often the voice gate looks at the meter. */
const GATE_POLL_MS = 50;

/**
 * How long the gate stays open after the level drops below the threshold. A
 * gate that shuts between two words clips the end of every sentence.
 */
const GATE_HANG_MS = 400;

/**
 * How long a connection may sit in `disconnected` before it is given up on.
 * ICE recovers from short blips on its own; this is for the ones it does not.
 */
const DISCONNECT_GRACE_MS = 15_000;

/** Used when the server cannot be asked. Enough for two browsers on one LAN. */
const FALLBACK_ICE: IceConfig = {
  iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }],
  relay: false,
};

export interface CallEngineOptions {
  signalling: CallSignalling;
  media: CallMedia;
  sealer: CallSealer;
  selfId: string;
  settings: VoiceSettings;
  /// Fetched per call, not per page: the credentials in it expire.
  getIceServers: () => Promise<IceConfig>;
  createPeerConnection?: (config: RTCConfiguration) => PeerConnectionLike;
  newCallId?: () => string;
  now?: () => number;
  endedLingerMs?: number;
}

type Listener = (snapshot: CallSnapshot) => void;

export class CallEngine {
  private snapshot: CallSnapshot = IDLE_CALL;
  private readonly listeners = new Set<Listener>();
  private readonly signalling: CallSignalling;
  private readonly media: CallMedia;
  private readonly sealer: CallSealer;
  private readonly selfId: string;
  private readonly getIceServers: () => Promise<IceConfig>;
  private readonly createPeerConnection: (config: RTCConfiguration) => PeerConnectionLike;
  private readonly newCallId: () => string;
  private readonly now: () => number;
  private readonly endedLingerMs: number;
  private settings: VoiceSettings;

  private pc: PeerConnectionLike | null = null;
  private chain: InputChain | null = null;
  private meter: LevelMeter | null = null;
  private output: AudioOutput | null = null;

  /// The offer that rang us, held until accept() has a connection to feed it to.
  private pendingOffer: SessionDescription | null = null;
  /// Candidates that arrived before there was a remote description to attach
  /// them to. The caller's trickle out while we are still deciding.
  private pendingCandidates: IceCandidate[] = [];
  private remoteDescriptionSet = false;
  /// Set once the first offer has gone out as `call:offer`. Everything after
  /// that is a renegotiation and travels as `call:description`.
  private offered = false;

  // Perfect negotiation state.
  private polite = false;
  private makingOffer = false;
  private ignoreOffer = false;

  private gateTimer: ReturnType<typeof setInterval> | null = null;
  private gateOpenUntil = 0;
  private lingerTimer: ReturnType<typeof setTimeout> | null = null;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly unsubscribers: (() => void)[] = [];

  constructor(options: CallEngineOptions) {
    this.signalling = options.signalling;
    this.media = options.media;
    this.sealer = options.sealer;
    this.selfId = options.selfId;
    this.settings = options.settings;
    this.getIceServers = options.getIceServers;
    this.createPeerConnection =
      options.createPeerConnection ?? ((config) => new RTCPeerConnection(config));
    this.newCallId = options.newCallId ?? (() => crypto.randomUUID());
    this.now = options.now ?? Date.now;
    this.endedLingerMs = options.endedLingerMs ?? ENDED_LINGER_MS;

    this.unsubscribers.push(
      this.signalling.on('offer', (offer) => void this.onOffer(offer)),
      this.signalling.on('answer', ({ callId, sdp }) => {
        if (callId === this.snapshot.callId) void this.onRemoteDescription(sdp);
      }),
      this.signalling.on('description', ({ callId, sdp }) => {
        if (callId === this.snapshot.callId) void this.onRemoteDescription(sdp);
      }),
      this.signalling.on('candidate', ({ callId, candidate }) => {
        if (callId === this.snapshot.callId) void this.onRemoteCandidate(candidate);
      }),
      this.signalling.on('claimed', ({ callId }) => {
        // Another tab of this account picked up. Nothing to say: it was never
        // this tab's call.
        if (callId === this.snapshot.callId && this.snapshot.phase === 'ringing') {
          this.reset();
        }
      }),
      this.signalling.on('ended', ({ callId, reason }) => {
        if (callId !== this.snapshot.callId) return;
        const missed = this.snapshot.phase === 'ringing' && reason === 'hangup';
        this.end(missed ? 'missed' : reason);
      }),
      this.signalling.on('offline', () => {
        // The server ends a call whose socket is gone, so this side must too,
        // or it keeps showing a call the other person has already been told
        // is over.
        if (this.inCall()) this.end('disconnected');
      }),
    );
  }

  get current(): CallSnapshot {
    return this.snapshot;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /* ------------------------------------------------------------- actions -- */

  /** Ring somebody. Resolves once the offer is on its way; the outcome is state. */
  async call(conversationId: string, peerId: string): Promise<void> {
    if (this.snapshot.phase !== 'idle') return;

    const callId = this.newCallId();
    this.polite = this.selfId < peerId;
    this.update({
      ...IDLE_CALL,
      phase: 'calling',
      callId,
      conversationId,
      peerId,
      direction: 'outgoing',
    });

    if (!(await this.openMedia())) return;
    // Nothing between openMedia resolving and here can have ended the call
    // except the user, whose hangup resets the snapshot.
    if (this.snapshot.callId !== callId) return;

    const pc = await this.openConnection();
    if (!pc || this.snapshot.callId !== callId) return;

    // Adding the track is what fires negotiationneeded, and that handler is
    // what sends the offer. Nothing here calls setLocalDescription directly:
    // doing both would produce two offers.
    pc.addTrack(this.chain!.track, this.chain!.stream);
  }

  /** Pick up the call that is ringing. */
  async accept(): Promise<void> {
    if (this.snapshot.phase !== 'ringing' || !this.pendingOffer) return;

    const { callId } = this.snapshot;
    const offer = this.pendingOffer;
    this.pendingOffer = null;
    this.polite = this.selfId < this.snapshot.peerId!;
    this.update({ ...this.snapshot, phase: 'connecting' });

    if (!(await this.openMedia())) {
      // Say no rather than leave them ringing into a microphone we do not have.
      if (callId) this.signalling.reject(callId);
      return;
    }
    if (this.snapshot.callId !== callId) return;

    const pc = await this.openConnection();
    if (!pc || this.snapshot.callId !== callId) return;

    try {
      await pc.setRemoteDescription(offer);
      this.remoteDescriptionSet = true;
      await this.flushCandidates();

      // In have-remote-offer state this attaches to the transceiver the offer
      // created rather than adding a second one, and it does not fire
      // negotiationneeded, so the answer below is the only description sent.
      pc.addTrack(this.chain!.track, this.chain!.stream);
      await pc.setLocalDescription();

      const sdp = await this.seal(pc.localDescription!);
      await this.signalling.answer({ callId: callId!, sdp });
    } catch (error) {
      if (this.snapshot.callId !== callId) return;
      if (error instanceof SignalRefusedError) {
        // The call was gone by the time we answered: they hung up as we
        // reached for the button. `ended` has usually already said so.
        this.end('hangup');
      } else {
        this.end('failed');
      }
    }
  }

  /** Turn down the call that is ringing. */
  decline(): void {
    if (this.snapshot.phase !== 'ringing') return;
    if (this.snapshot.callId) this.signalling.reject(this.snapshot.callId);
    this.reset();
  }

  /** Leave the call, or stop ringing them. */
  hangUp(): void {
    if (this.snapshot.phase === 'ringing') return this.decline();
    if (!this.inCall()) return;
    if (this.snapshot.callId) this.signalling.hangup(this.snapshot.callId);
    this.end('hangup');
  }

  setMuted(muted: boolean): void {
    if (this.snapshot.muted === muted) return;
    this.update({ ...this.snapshot, muted });
    this.applyGate();
  }

  toggleMuted(): void {
    this.setMuted(!this.snapshot.muted);
  }

  /** Push to talk: the key or button went down or came up. */
  setTalking(talking: boolean): void {
    if (this.snapshot.talking === talking) return;
    this.update({ ...this.snapshot, talking });
    this.applyGate();
  }

  /**
   * Settings changed. Volume, mode and sensitivity take effect on the live
   * call; a different microphone or speaker takes effect on the next one.
   * Swapping a capture device under a live connection is its own project.
   */
  applySettings(settings: VoiceSettings): void {
    const previous = this.settings;
    this.settings = settings;
    this.chain?.setGain(settings.inputVolume / 100);
    this.output?.setVolume(settings.outputVolume / 100);
    if (settings.outputDeviceId !== previous.outputDeviceId) {
      void this.output?.setSink(settings.outputDeviceId);
    }
    this.applyGate();
  }

  /** Take the "call ended" notice down early. */
  dismiss(): void {
    if (this.snapshot.phase === 'ended') this.reset();
  }

  /** Tear down everything. For unmount; a live call is hung up. */
  destroy(): void {
    if (this.inCall()) this.hangUp();
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    this.reset();
  }

  /* --------------------------------------------------------- signalling -- */

  private async onOffer(offer: IncomingOffer): Promise<void> {
    // The server refuses to ring somebody who is already in a call, so this
    // only happens if two offers cross a reconnect. The one we are in wins.
    if (this.snapshot.phase !== 'idle') return;

    let description: SessionDescription;
    try {
      description = await this.sealer.open(offer.sdp, offer.fromUserId);
    } catch {
      // An envelope we cannot open, or a caller whose key we do not hold. Say
      // no rather than ring for a call that could never connect.
      this.signalling.reject(offer.callId);
      return;
    }
    // Something may have started ringing or calling while the envelope opened.
    if (this.snapshot.phase !== 'idle') return;

    this.pendingOffer = description;
    this.pendingCandidates = [];
    this.update({
      ...IDLE_CALL,
      phase: 'ringing',
      callId: offer.callId,
      conversationId: offer.conversationId,
      peerId: offer.fromUserId,
      direction: 'incoming',
    });
  }

  /// The perfect negotiation receive path, verbatim from the pattern: detect a
  /// collision, let the polite side roll back through setRemoteDescription,
  /// answer any offer that survives.
  private async onRemoteDescription(sealed: SealedDescription): Promise<void> {
    const pc = this.pc;
    if (!pc || !this.snapshot.peerId) return;

    let sdp: SessionDescription;
    try {
      sdp = await this.sealer.open(sealed, this.snapshot.peerId);
    } catch {
      // The other side sent something this side cannot open. The call cannot
      // proceed, and the server should know we are gone.
      if (this.pc !== pc) return;
      if (this.snapshot.callId) this.signalling.hangup(this.snapshot.callId);
      this.end('unreadable');
      return;
    }
    if (this.pc !== pc) return;

    const collision =
      sdp.type === 'offer' && (this.makingOffer || pc.signalingState !== 'stable');
    this.ignoreOffer = !this.polite && collision;
    if (this.ignoreOffer) return;

    try {
      await pc.setRemoteDescription(sdp);
      this.remoteDescriptionSet = true;
      await this.flushCandidates();

      if (sdp.type === 'offer') {
        await pc.setLocalDescription();
        const answer = await this.seal(pc.localDescription!);
        if (this.pc === pc && this.snapshot.callId) {
          this.signalling.description({ callId: this.snapshot.callId, sdp: answer });
        }
      } else if (this.snapshot.phase === 'calling') {
        // Their answer is in. ICE is now looking for a path.
        this.update({ ...this.snapshot, phase: 'connecting' });
      }
    } catch {
      this.failAndHangUp();
    }
  }

  private async onRemoteCandidate(candidate: IceCandidate): Promise<void> {
    if (!this.pc || !this.remoteDescriptionSet) {
      this.pendingCandidates.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(candidate ?? undefined);
    } catch {
      // A candidate for an offer we ignored is expected to fail, and a
      // malformed one is ICE's problem to work around, which it does. Neither
      // is a reason to end the call.
    }
  }

  private async flushCandidates(): Promise<void> {
    const queued = this.pendingCandidates.splice(0);
    for (const candidate of queued) await this.onRemoteCandidate(candidate);
  }

  /* ------------------------------------------------------ media and ICE -- */

  private async openMedia(): Promise<boolean> {
    const source = await this.media.openMicrophone({
      deviceId: this.settings.inputDeviceId,
      echoCancellation: this.settings.echoCancellation,
      noiseSuppression: this.settings.noiseSuppression,
      autoGainControl: this.settings.autoGainControl,
    });
    if (!source) {
      this.end('no_microphone');
      return false;
    }
    // The user may have hung up while the permission prompt was open.
    if (!this.inCall()) {
      source.getTracks().forEach((track) => track.stop());
      return false;
    }

    this.chain = this.media.createInputChain(source, this.settings.inputVolume / 100);
    // The gate listens to the raw microphone, before the gain, so the
    // sensitivity slider means the same thing it does on the settings screen.
    this.meter = this.media.createLevelMeter(source);
    this.output = this.media.createAudioOutput();
    this.output.setVolume(this.settings.outputVolume / 100);
    void this.output.setSink(this.settings.outputDeviceId);

    this.startGate();
    return true;
  }

  private async openConnection(): Promise<PeerConnectionLike | null> {
    let ice: IceConfig;
    try {
      ice = await this.getIceServers();
    } catch {
      // Offline, or the server is down. The socket is up (we got this far),
      // so try STUN alone rather than refuse.
      ice = FALLBACK_ICE;
    }
    if (!this.inCall()) return null;
    this.update({ ...this.snapshot, relay: ice.relay });

    const pc = this.createPeerConnection({ iceServers: ice.iceServers });
    this.pc = pc;
    this.remoteDescriptionSet = false;
    this.offered = false;
    this.makingOffer = false;
    this.ignoreOffer = false;

    pc.onnegotiationneeded = () => void this.negotiate(pc);

    pc.onicecandidate = (event) => {
      const callId = this.snapshot.callId;
      if (!callId || this.pc !== pc) return;
      this.signalling.candidate({
        callId,
        candidate: event.candidate ? event.candidate.toJSON() : null,
      });
    };

    pc.ontrack = (event) => {
      if (this.pc !== pc) return;
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      this.output?.attach(stream);
    };

    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      switch (pc.connectionState) {
        case 'connected':
          this.clearDisconnectTimer();
          if (this.snapshot.phase !== 'connected') {
            this.update({ ...this.snapshot, phase: 'connected', connectedAt: this.now() });
          }
          break;
        case 'disconnected':
          // ICE recovers from short blips on its own. Give it a while.
          if (!this.disconnectTimer) {
            this.disconnectTimer = setTimeout(() => this.failAndHangUp(), DISCONNECT_GRACE_MS);
          }
          break;
        case 'failed':
          this.failAndHangUp();
          break;
        default:
          break;
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (this.pc !== pc) return;
      // The pattern's one line for ICE failure: ask for a restart, which
      // fires negotiationneeded and goes out as a renegotiation.
      if (pc.iceConnectionState === 'failed') pc.restartIce();
    };

    return pc;
  }

  /// The perfect negotiation send path. The very first offer of an outgoing
  /// call is the ring itself and carries who is being called; everything
  /// after is a renegotiation on a call both sides already know.
  private async negotiate(pc: PeerConnectionLike): Promise<void> {
    const { callId, conversationId, peerId } = this.snapshot;
    if (!callId || this.pc !== pc) return;

    try {
      this.makingOffer = true;
      await pc.setLocalDescription();
      const sdp = await this.seal(pc.localDescription!);
      if (this.pc !== pc) return;

      if (this.offered || this.snapshot.direction === 'incoming') {
        this.signalling.description({ callId, sdp });
        return;
      }

      this.offered = true;
      await this.signalling.offer({
        callId,
        conversationId: conversationId!,
        toUserId: peerId!,
        sdp,
      });
    } catch (error) {
      if (this.snapshot.callId !== callId) return;
      if (error instanceof SignalRefusedError) {
        this.end(refusalReason(error.code), error.message);
      } else if (error instanceof SealError) {
        this.end('unreadable');
      } else {
        this.end('failed');
      }
    } finally {
      this.makingOffer = false;
    }
  }

  /// Our own description, sealed for the other side. A failure here is theirs
  /// to blame only in the sense that we hold no key for them.
  private async seal(description: RTCSessionDescription): Promise<SealedDescription> {
    try {
      return await this.sealer.seal(toInit(description), this.snapshot.peerId!);
    } catch (error) {
      throw new SealError(error);
    }
  }

  /* --------------------------------------------------------------- gate -- */

  private startGate(): void {
    this.stopGate();
    this.gateTimer = setInterval(() => this.applyGate(), GATE_POLL_MS);
    this.applyGate();
  }

  private stopGate(): void {
    if (this.gateTimer) clearInterval(this.gateTimer);
    this.gateTimer = null;
    this.gateOpenUntil = 0;
  }

  /// Mute, push to talk and the voice gate all end in one place: the outgoing
  /// track's `enabled` flag. Off means the other side hears silence.
  private applyGate(): void {
    const track = this.chain?.track;
    if (!track) return;

    let open: boolean;
    if (this.snapshot.muted) {
      open = false;
    } else if (this.settings.inputMode === 'push-to-talk') {
      open = this.snapshot.talking;
    } else {
      const level = this.meter?.read() ?? 100;
      const now = this.now();
      if (level >= this.settings.sensitivity) this.gateOpenUntil = now + GATE_HANG_MS;
      open = now < this.gateOpenUntil;
    }

    track.enabled = open;
    if (this.snapshot.transmitting !== open) {
      this.update({ ...this.snapshot, transmitting: open });
    }
  }

  /* -------------------------------------------------------------- state -- */

  private inCall(): boolean {
    const { phase } = this.snapshot;
    return phase === 'calling' || phase === 'connecting' || phase === 'connected';
  }

  /// The connection died. Tell the server so the other side hears it too.
  private failAndHangUp(): void {
    if (!this.inCall()) return;
    if (this.snapshot.callId) this.signalling.hangup(this.snapshot.callId);
    this.end('failed');
  }

  private end(reason: CallEndReason, message: string | null = null): void {
    const { callId, conversationId, peerId, direction } = this.snapshot;
    this.teardown();
    this.update({
      ...IDLE_CALL,
      phase: 'ended',
      callId,
      conversationId,
      peerId,
      direction,
      endReason: reason,
      endMessage: message,
    });
    this.lingerTimer = setTimeout(() => this.reset(), this.endedLingerMs);
  }

  private reset(): void {
    this.teardown();
    if (this.lingerTimer) clearTimeout(this.lingerTimer);
    this.lingerTimer = null;
    this.update(IDLE_CALL);
  }

  private teardown(): void {
    this.stopGate();
    this.clearDisconnectTimer();
    if (this.pc) {
      // Detach first: closing fires state changes nobody should act on.
      this.pc.onnegotiationneeded = null;
      this.pc.onicecandidate = null;
      this.pc.ontrack = null;
      this.pc.onconnectionstatechange = null;
      this.pc.oniceconnectionstatechange = null;
      this.pc.close();
    }
    this.pc = null;
    this.chain?.stop();
    this.chain = null;
    this.meter?.stop();
    this.meter = null;
    this.output?.stop();
    this.output = null;
    this.pendingOffer = null;
    this.pendingCandidates = [];
    this.remoteDescriptionSet = false;
    this.offered = false;
    this.makingOffer = false;
    this.ignoreOffer = false;
  }

  private clearDisconnectTimer(): void {
    if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
    this.disconnectTimer = null;
  }

  private update(snapshot: CallSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
}

/// Marks a failure as the sealer's, so negotiate() can name it.
class SealError extends Error {
  constructor(cause: unknown) {
    super('Could not seal the description.', { cause });
    this.name = 'SealError';
  }
}

/// The server's refusal codes, in the engine's words.
function refusalReason(code: string): CallEndReason {
  switch (code) {
    case 'busy':
      return 'busy';
    case 'in_call':
      return 'in_call';
    default:
      return 'refused';
  }
}

/// An RTCSessionDescription has a toJSON, but sending the object itself sends
/// the class instance, and a fake in a test has neither. Copy the two fields.
function toInit(description: RTCSessionDescription | RTCSessionDescriptionInit): SessionDescription {
  return { type: description.type as RTCSdpType, sdp: description.sdp ?? undefined };
}
