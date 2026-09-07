/**
 * The React binding for voice calls.
 *
 * It owns one CallEngine per signed-in identity and hands the UI a snapshot
 * plus the handful of verbs a call has. The engine itself knows nothing about
 * React and is tested on its own (lib/call/engine.test.ts); this file is the
 * wiring: the socket's signalling half from ChatProvider, the hardware from
 * lib/media/devices, the voice settings from SettingsProvider, and the ICE
 * endpoint from the API.
 *
 * Also here: the push-to-talk key. Ctrl+Space, held. Chosen because it types
 * nothing into a focused field and does not activate a focused button, which
 * plain Space would, and the hang-up button is exactly the kind of button that
 * must not be pressed by accident while talking.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { fromBase64 } from '@cipher/crypto';
import { callsApi } from '../lib/api';
import { CallEngine } from '../lib/call/engine';
import { createCallSealer } from '../lib/call/sealing';
import { IDLE_CALL, type CallMedia, type CallSnapshot } from '../lib/call/types';
import { keyManager as defaultKeyManager, type KeyManager } from '../lib/session/keyManager';
import {
  createAudioOutput,
  createInputChain,
  createLevelMeter,
  isSupported,
  openMicrophone,
} from '../lib/media/devices';
import { useChat } from './ChatProvider';
import { useSession } from './SessionProvider';
import { useSettings } from './SettingsProvider';

export interface CallContextValue {
  call: CallSnapshot;
  /** Whether this build can place a call at all: media devices and WebRTC both present. */
  supported: boolean;
  startCall: (conversationId: string, peerId: string) => void;
  accept: () => void;
  decline: () => void;
  hangUp: () => void;
  toggleMuted: () => void;
  /** Push to talk: the button or key went down or came up. */
  setTalking: (talking: boolean) => void;
  /** Take the "call ended" notice down early. */
  dismiss: () => void;
}

const CallContext = createContext<CallContextValue | null>(null);

/// The browser's media stack, as the engine wants it. The desktop shell
/// replaces the functions in lib/media/devices, not this object.
const browserMedia: CallMedia = {
  openMicrophone,
  createInputChain,
  createLevelMeter,
  createAudioOutput,
};

function callsSupported(): boolean {
  return typeof RTCPeerConnection !== 'undefined' && isSupported();
}

export function CallProvider({
  children,
  keys = defaultKeyManager,
}: {
  children: ReactNode;
  keys?: KeyManager;
}) {
  const { account } = useSession();
  const { callSignalling, conversations, friends } = useChat();
  const { settings } = useSettings();
  const supported = callsSupported();

  // The engine's initial settings, read once at creation. A ref so the effect
  // that creates it does not have to depend on settings and recreate it on
  // every slider move; applySettings below keeps the live engine current.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // The other person's public key, for sealing descriptions to them. Read by
  // the engine outside React's render cycle, so a ref rather than a closure
  // over stale state. Conversations first: they carry the key of somebody who
  // is no longer a friend, and their in-progress call still has to end cleanly.
  const peerKeys = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const map = new Map<string, string>();
    for (const friend of friends) {
      if (friend.publicKey) map.set(friend.id, friend.publicKey);
    }
    for (const conversation of conversations) {
      for (const participant of conversation.participants) {
        if (participant.publicKey) map.set(participant.id, participant.publicKey);
      }
    }
    peerKeys.current = map;
  }, [friends, conversations]);

  // One engine per identity and signalling channel, created and destroyed by
  // the same effect. Not a useMemo: StrictMode runs an effect's cleanup and
  // re-runs it against the same memoised value, and an engine destroyed once
  // has let go of its signalling subscriptions for good. This way each mount
  // gets its own, and the one that is torn down is the one that was created.
  const [engine, setEngine] = useState<CallEngine | null>(null);

  useEffect(() => {
    if (!account) return;

    const created = new CallEngine({
      signalling: callSignalling,
      media: browserMedia,
      sealer: createCallSealer({
        privateKey: keys.requirePrivateKey(),
        publicKey: keys.requirePublicKey(),
        resolvePeerKey: async (peerId) => {
          const encoded = peerKeys.current.get(peerId);
          return encoded ? fromBase64(encoded) : null;
        },
      }),
      selfId: account.id,
      settings: settingsRef.current.voice,
      getIceServers: async () => {
        const ice = await callsApi.ice();
        return { iceServers: ice.iceServers, relay: ice.relay };
      },
    });
    setEngine(created);

    return () => {
      created.destroy();
      setEngine((current) => (current === created ? null : current));
    };
    // Settings are pushed in by the effect below; only the identity and the
    // channel decide whether a new engine is needed.
  }, [account, callSignalling, keys]);

  useEffect(() => {
    engine?.applySettings(settings.voice);
  }, [engine, settings.voice]);

  const call = useSyncExternalStore(
    useCallback((listener: () => void) => engine?.subscribe(listener) ?? (() => {}), [engine]),
    useCallback(() => engine?.current ?? IDLE_CALL, [engine]),
    useCallback(() => engine?.current ?? IDLE_CALL, [engine]),
  );

  // Push to talk. Only while in a call and only in that mode, so the key
  // means nothing the rest of the time.
  const pushToTalk =
    settings.voice.inputMode === 'push-to-talk' &&
    (call.phase === 'connecting' || call.phase === 'connected');

  useEffect(() => {
    if (!engine || !pushToTalk) return;

    function down(event: KeyboardEvent) {
      if (event.code === 'Space' && event.ctrlKey) {
        event.preventDefault();
        if (!event.repeat) engine!.setTalking(true);
      }
    }
    function up(event: KeyboardEvent) {
      // Letting go of either half releases the key. Waiting for Space alone
      // would leave the microphone open if Control came up first.
      if (event.code === 'Space' || event.key === 'Control') {
        if (event.code === 'Space') event.preventDefault();
        engine!.setTalking(false);
      }
    }
    function blur() {
      engine!.setTalking(false);
    }

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      engine.setTalking(false);
    };
  }, [engine, pushToTalk]);

  const value = useMemo<CallContextValue>(
    () => ({
      call,
      supported: supported && engine !== null,
      startCall: (conversationId, peerId) => void engine?.call(conversationId, peerId),
      accept: () => void engine?.accept(),
      decline: () => engine?.decline(),
      hangUp: () => engine?.hangUp(),
      toggleMuted: () => engine?.toggleMuted(),
      setTalking: (talking) => engine?.setTalking(talking),
      dismiss: () => engine?.dismiss(),
    }),
    [call, engine, supported],
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall(): CallContextValue {
  const context = useContext(CallContext);
  if (!context) throw new Error('useCall must be used inside a <CallProvider>');
  return context;
}
