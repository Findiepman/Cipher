/**
 * The one place the app talks to microphones, speakers and cameras.
 *
 * client/AGENTS.md keeps platform-specific behaviour behind a small adapter
 * rather than in components, and this is that adapter for media. Today it is
 * pure `navigator.mediaDevices`, which the desktop shell's webview provides
 * too; when the shell needs to do something native (a system-level device
 * picker, or a permission prompt the OS owns) it replaces this module's
 * implementation, not the settings UI.
 *
 * Every call is written to fail soft. Media permissions are refused routinely,
 * and a settings screen that throws because a user said "no" to the microphone
 * is worse than one that says "no microphone access".
 */

export type MediaKind = 'audioinput' | 'audiooutput' | 'videoinput';

export interface DeviceOption {
  id: string;
  label: string;
}

export interface DeviceList {
  microphones: DeviceOption[];
  speakers: DeviceOption[];
  cameras: DeviceOption[];
  /**
   * True once the browser has handed over real labels, which only happens
   * after permission is granted. Until then the lists are anonymous entries
   * like "Microphone 2" and there is nothing useful to choose between.
   */
  labelled: boolean;
}

export const EMPTY_DEVICES: DeviceList = {
  microphones: [],
  speakers: [],
  cameras: [],
  labelled: false,
};

export type AccessState = 'unknown' | 'granted' | 'denied' | 'unsupported';

export interface LevelMeter {
  /** Current input level, 0 to 100, smoothed enough to look like a meter. */
  read(): number;
  stop(): void;
}

function mediaApi(): MediaDevices | null {
  if (typeof navigator === 'undefined') return null;
  return navigator.mediaDevices ?? null;
}

/** Whether this build can talk to media hardware at all. */
export function isSupported(): boolean {
  return mediaApi() !== null;
}

/**
 * Whether audio output can be routed per-element. Chromium-only for now;
 * Firefox and Safari play through the OS default and the UI says so rather
 * than offering a picker that would silently do nothing.
 */
export function canChooseOutput(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}

export async function listDevices(): Promise<DeviceList> {
  const api = mediaApi();
  if (!api?.enumerateDevices) return EMPTY_DEVICES;

  let devices: MediaDeviceInfo[];
  try {
    devices = await api.enumerateDevices();
  } catch {
    return EMPTY_DEVICES;
  }

  const pick = (kind: MediaKind, noun: string): DeviceOption[] =>
    devices
      .filter((device) => device.kind === kind)
      .map((device, index) => ({
        id: device.deviceId,
        label: device.label || `${noun} ${index + 1}`,
      }));

  return {
    microphones: pick('audioinput', 'Microphone'),
    speakers: pick('audiooutput', 'Speaker'),
    cameras: pick('videoinput', 'Camera'),
    labelled: devices.some((device) => device.label !== ''),
  };
}

/** Fires whenever hardware is plugged in or pulled out. */
export function onDeviceChange(handler: () => void): () => void {
  const api = mediaApi();
  if (!api?.addEventListener) return () => {};
  api.addEventListener('devicechange', handler);
  return () => api.removeEventListener('devicechange', handler);
}

/**
 * Asks for access purely to unlock device labels, then hands the stream
 * straight back so the caller can stop it. Nothing is recorded, and no stream
 * outlives the screen that opened it.
 */
export async function requestAccess(kind: 'audio' | 'video'): Promise<AccessState> {
  const api = mediaApi();
  if (!api?.getUserMedia) return 'unsupported';
  try {
    const stream = await api.getUserMedia(kind === 'audio' ? { audio: true } : { video: true });
    stopStream(stream);
    return 'granted';
  } catch {
    return 'denied';
  }
}

export interface MicrophoneOptions {
  deviceId: string | null;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}

export async function openMicrophone(options: MicrophoneOptions): Promise<MediaStream | null> {
  const api = mediaApi();
  if (!api?.getUserMedia) return null;
  try {
    return await api.getUserMedia({
      audio: {
        ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : {}),
        echoCancellation: options.echoCancellation,
        noiseSuppression: options.noiseSuppression,
        autoGainControl: options.autoGainControl,
      },
    });
  } catch {
    return null;
  }
}

export async function openCamera(deviceId: string | null): Promise<MediaStream | null> {
  const api = mediaApi();
  if (!api?.getUserMedia) return null;
  try {
    return await api.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId } } : true,
    });
  } catch {
    return null;
  }
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

/**
 * An RMS meter over a live microphone stream.
 *
 * Polled rather than pushed: the caller already has an animation frame running
 * to paint the bar, and a second timer feeding it would only add jitter.
 */
export function createLevelMeter(stream: MediaStream): LevelMeter {
  const AudioContextCtor =
    typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);

  if (!AudioContextCtor) return { read: () => 0, stop: () => {} };

  const context = new AudioContextCtor();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.7;
  source.connect(analyser);

  const samples = new Float32Array(analyser.fftSize);
  let smoothed = 0;

  return {
    read() {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const rms = Math.sqrt(sum / samples.length);
      // Speech sits low in a linear RMS, so the scale is compressed to put
      // ordinary talking in the middle of the bar instead of the first tenth.
      const level = Math.min(100, Math.round(Math.sqrt(rms) * 160));
      // Rise fast, fall slow: a meter that drops instantly reads as broken.
      smoothed = level > smoothed ? level : smoothed * 0.85 + level * 0.15;
      return Math.round(smoothed);
    },
    stop() {
      source.disconnect();
      analyser.disconnect();
      void context.close().catch(() => {});
    },
  };
}
