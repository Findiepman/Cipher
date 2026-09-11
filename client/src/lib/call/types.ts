/**
 * The vocabulary of a voice call, shared by the engine, the signalling channel
 * and the UI.
 *
 * Two boundaries meet here. `CallSignalling` is the socket: the offer, the
 * answer, the trickle of candidates, the words that end a call. `CallMedia` is
 * the hardware: microphone in, speaker out. The engine sits between them and
 * owns the RTCPeerConnection. Both are interfaces so the engine can be driven
 * in a test with neither a server nor a browser, and so the desktop shell can
 * replace the media half without touching the engine (client/AGENTS.md).
 */
import type {
  AudioOutput,
  InputChain,
  LevelMeter,
  MicrophoneOptions,
} from '../media/devices';

/* ---------------------------------------------------------- signalling --- */

/// An RTCSessionDescriptionInit, as the browser hands it over. Never sent as
/// it is: see SealedDescription.
export interface SessionDescription {
  type: RTCSdpType;
  sdp?: string;
}

/**
 * A session description sealed in the message envelope, as it goes over the
 * wire. The SDP carries the DTLS fingerprint the whole call's security hangs
 * on, so it travels through the same seam a message body does (lib/call/
 * sealing.ts): a real `crypto_box` to the peer's key since phase 2, with no
 * change to the engine or the server for it.
 */
export type SealedDescription = string;

/// Seals and opens descriptions for the engine. The one caller of the crypto
/// seam in lib/call, and injected so the engine's tests need no keys.
export interface CallSealer {
  seal(description: SessionDescription, peerId: string): Promise<SealedDescription>;
  /// Rejects when the envelope cannot be opened or does not hold a description.
  open(sealed: SealedDescription, peerId: string): Promise<SessionDescription>;
}

/// An RTCIceCandidateInit, or the browser's null end-of-candidates marker.
export type IceCandidate = RTCIceCandidateInit | null;

/// Why the server said a call ended. The client adds its own reasons on top
/// (`CallEndReason`) for things the server never hears about.
export type ServerEndReason = 'hangup' | 'rejected' | 'no_answer' | 'disconnected';

export interface IncomingOffer {
  callId: string;
  conversationId: string;
  fromUserId: string;
  sdp: SealedDescription;
}

export interface CallSignalEvents {
  offer: IncomingOffer;
  answer: { callId: string; sdp: SealedDescription };
  description: { callId: string; sdp: SealedDescription };
  candidate: { callId: string; candidate: IceCandidate };
  /// Another tab of this same account answered. Stop ringing.
  claimed: { callId: string };
  ended: { callId: string; reason: ServerEndReason };
  /// The socket carrying all of the above went away. The server ends any call
  /// this socket was a party to when that happens, so the engine has to agree.
  offline: undefined;
}

export type CallSignalEventName = keyof CallSignalEvents;

/// The server refused a frame on purpose: busy, not friends, malformed. Carries
/// the code the server used so the engine can name the reason.
export class SignalRefusedError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SignalRefusedError';
  }
}

export interface CallSignalling {
  /// Rejects with SignalRefusedError when the server refuses, or a plain Error
  /// when there is no socket or no ack.
  offer(payload: {
    callId: string;
    conversationId: string;
    toUserId: string;
    sdp: SealedDescription;
  }): Promise<void>;
  answer(payload: { callId: string; sdp: SealedDescription }): Promise<void>;
  /// Fire and forget, like typing: the other side either gets it or the call
  /// fails on its own.
  description(payload: { callId: string; sdp: SealedDescription }): void;
  candidate(payload: { callId: string; candidate: IceCandidate }): void;
  hangup(callId: string): void;
  reject(callId: string): void;
  on<E extends CallSignalEventName>(
    event: E,
    handler: (payload: CallSignalEvents[E]) => void,
  ): () => void;
}

/* --------------------------------------------------------------- media --- */

/// The slice of lib/media/devices the engine uses. An interface so a test can
/// hand in fakes, and so the seam the desktop shell replaces is named.
export interface CallMedia {
  openMicrophone(options: MicrophoneOptions): Promise<MediaStream | null>;
  createInputChain(source: MediaStream, gain: number): InputChain;
  createLevelMeter(stream: MediaStream): LevelMeter;
  createAudioOutput(): AudioOutput;
}

/// The slice of RTCPeerConnection the engine touches. Structural, so the real
/// one satisfies it unchanged and a test can substitute a fake.
export interface PeerConnectionLike {
  readonly signalingState: RTCSignalingState;
  readonly connectionState: RTCPeerConnectionState;
  readonly iceConnectionState: RTCIceConnectionState;
  readonly localDescription: RTCSessionDescription | null;
  onnegotiationneeded: ((this: RTCPeerConnection, ev: Event) => unknown) | null;
  onicecandidate: ((this: RTCPeerConnection, ev: RTCPeerConnectionIceEvent) => unknown) | null;
  ontrack: ((this: RTCPeerConnection, ev: RTCTrackEvent) => unknown) | null;
  onconnectionstatechange: ((this: RTCPeerConnection, ev: Event) => unknown) | null;
  oniceconnectionstatechange: ((this: RTCPeerConnection, ev: Event) => unknown) | null;
  addTrack(track: MediaStreamTrack, ...streams: MediaStream[]): RTCRtpSender;
  setLocalDescription(description?: RTCLocalSessionDescriptionInit): Promise<void>;
  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void>;
  addIceCandidate(candidate?: RTCIceCandidateInit | null): Promise<void>;
  restartIce(): void;
  close(): void;
}

export interface IceConfig {
  iceServers: RTCIceServer[];
  /// Whether a TURN relay is among them. False means STUN only, and a call
  /// across two NATs will not connect; the UI says so when it fails.
  relay: boolean;
}

/* --------------------------------------------------------------- state --- */

/**
 *   idle        nothing happening
 *   calling     we rang them and are waiting for an answer
 *   ringing     they rang us and we have not answered
 *   connecting  answered, ICE still finding a path
 *   connected   audio is flowing
 *   ended       over, lingering long enough to say why
 */
export type CallPhase = 'idle' | 'calling' | 'ringing' | 'connecting' | 'connected' | 'ended';

export type CallEndReason =
  | ServerEndReason
  /// They rang and hung up before we answered.
  | 'missed'
  /// They are in another call.
  | 'busy'
  /// We are, in another tab.
  | 'in_call'
  /// The server refused for some other reason; `endMessage` says what.
  | 'refused'
  /// The microphone could not be opened.
  | 'no_microphone'
  /// Their description could not be opened, or we hold no key for them.
  | 'unreadable'
  /// ICE never found a path, or the connection died and did not come back.
  | 'failed';

export interface CallSnapshot {
  phase: CallPhase;
  callId: string | null;
  conversationId: string | null;
  peerId: string | null;
  direction: 'outgoing' | 'incoming' | null;
  /// When audio started flowing, for the elapsed-time display.
  connectedAt: number | null;
  muted: boolean;
  /// Push to talk: the key or button is held right now.
  talking: boolean;
  /// Whether anything is actually leaving the microphone: mute, the voice gate
  /// and push to talk all fold into this one flag.
  transmitting: boolean;
  /// Whether a relay was on offer for this call. Null until ICE was fetched.
  relay: boolean | null;
  endReason: CallEndReason | null;
  endMessage: string | null;
}

export const IDLE_CALL: CallSnapshot = {
  phase: 'idle',
  callId: null,
  conversationId: null,
  peerId: null,
  direction: null,
  connectedAt: null,
  muted: false,
  talking: false,
  transmitting: false,
  relay: null,
  endReason: null,
  endMessage: null,
};
