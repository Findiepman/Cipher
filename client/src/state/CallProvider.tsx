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
import { callsApi } from '../lib/api';
import { CallEngine } from '../lib/call/engine';
import { createCallSealer } from '../lib/call/sealing';
import { IDLE_CALL, type CallMedia, type CallSnapshot } from '../lib/call/types';
import { keyManager as defaultKeyManager, type KeyManager } from '../lib/session/keyManager';
import {
  canChooseOutput,
  createAudioOutput,
  createInputChain,
  createLevelMeter,
  isSupported,
  listDevices,
  openMicrophone,
} from '../lib/media/devices';
import { isMuted } from '../lib/settings/notificationSounds';
import { useChat } from './ChatProvider';
import { useT } from './I18nProvider';
import { usePlatform } from './PlatformProvider';
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
  /**
   * Where a phone plays the call: its earpiece or its loudspeaker. Null when
   * the browser offers no such choice, which is every phone browser but
   * Chrome on Android, and every desktop.
   */
  outputRoute: OutputRoute | null;
  toggleOutputRoute: () => void;
}

export type OutputRoute = 'speaker' | 'earpiece';

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

/// A phone, as far as CSS can tell: a coarse pointer and a narrow window.
function isPhone(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse) and (max-width: 820px)').matches
  );
}

/**
 * Android Chrome names its outputs "Earpiece" and "Speakerphone" (and a wired
 * or Bluetooth headset when one is plugged in). No standard says so, which is
 * why this is a label match and why it fails soft: no match, no toggle.
 */
const EARPIECE = /earpiece|receiver|handset/i;
const SPEAKER = /speaker/i;

export function CallProvider({
  children,
  keys = defaultKeyManager,
}: {
  children: ReactNode;
  keys?: KeyManager;
}) {
  const { account } = useSession();
  const { callSignalling, resolvePeerKey } = useChat();
  const { settings } = useSettings();
  const supported = callsSupported();

  // The engine's initial settings, read once at creation. A ref so the effect
  // that creates it does not have to depend on settings and recreate it on
  // every slider move; applySettings below keeps the live engine current.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // The other person's public key, for sealing descriptions to them, comes
  // from ChatProvider so that a call sees exactly the key a message would:
  // pinned on first use, and refused while a change is waiting on the user.
  // A refused key fails the call the way a missing one does.

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
        resolvePeerKey,
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

  // Earpiece or loudspeaker, on a phone. The device list only carries labels
  // once the microphone has been granted, so it is read when the call is up,
  // not before. Nothing here can tell where the browser is playing right now;
  // phones start on the loudspeaker for WebRTC, so that is the assumption
  // until the toggle is pressed.
  const [routes, setRoutes] = useState<{ earpiece: string; speaker: string } | null>(null);
  const [outputRoute, setOutputRoute] = useState<OutputRoute>('speaker');
  const inCall = call.phase === 'connecting' || call.phase === 'connected';

  useEffect(() => {
    if (!inCall || !isPhone() || !canChooseOutput()) {
      setRoutes(null);
      setOutputRoute('speaker');
      return;
    }
    let live = true;
    void listDevices().then(({ speakers }) => {
      if (!live) return;
      const earpiece = speakers.find((device) => EARPIECE.test(device.label));
      const speaker = speakers.find((device) => SPEAKER.test(device.label));
      setRoutes(earpiece && speaker ? { earpiece: earpiece.id, speaker: speaker.id } : null);
    });
    return () => {
      live = false;
    };
  }, [inCall]);

  const toggleOutputRoute = useCallback(() => {
    if (!engine || !routes) return;
    const next: OutputRoute = outputRoute === 'speaker' ? 'earpiece' : 'speaker';
    engine.setOutputDevice(routes[next]);
    setOutputRoute(next);
  }, [engine, routes, outputRoute]);

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

  // A ring while the window is somewhere behind: flash the taskbar entry (or
  // bounce the dock) and, if notifications are on, say who it is. The in-app
  // toast and the ringtone (components/CallRinger.tsx) are what you get when
  // the window is in front; this is for when it is not. Nothing here answers
  // the call: that is still a click away.
  const platform = usePlatform();
  const t = useT();
  const { usersById } = useChat();
  const ringing = call.phase === 'ringing' && call.direction === 'incoming';
  const peerName = call.peerId ? usersById.get(call.peerId)?.name : undefined;
  useEffect(() => {
    if (!ringing) return;
    void platform.attention(true);
    if (typeof document !== 'undefined' && document.hasFocus() && !document.hidden) return;

    // The same gates the message notifier applies, minus "is it your own".
    const { notifications } = settings;
    if (!notifications.desktop || platform.notificationPermission() !== 'granted') return;
    if (isMuted(notifications.mutedUntil)) return;

    void platform.notify({
      title: t('notify.callTitle'),
      // The name is behind the preview setting for the same reason the text
      // of a message is: who is calling you is not for a lock screen either.
      body:
        notifications.preview && peerName
          ? t('notify.callFrom', { name: peerName })
          : t('notify.callSomeone'),
      tag: 'call',
      onClick: () => void platform.focus(),
    });
    // Deliberately not depending on the name, the settings or `t`: the ones
    // at the moment the ring starts are the ones to use, and a rename or a
    // language change mid-ring is not worth a second popup.
  }, [ringing, platform]);

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
      outputRoute: routes ? outputRoute : null,
      toggleOutputRoute,
    }),
    [call, engine, supported, routes, outputRoute, toggleOutputRoute],
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall(): CallContextValue {
  const context = useContext(CallContext);
  if (!context) throw new Error('useCall must be used inside a <CallProvider>');
  return context;
}
