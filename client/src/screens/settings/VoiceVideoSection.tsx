/**
 * Microphone, speakers, camera.
 *
 * Two things shape this screen. First, browsers hide device names until you
 * have granted access once, so before permission there is nothing worth
 * listing and the screen says so instead of showing "Microphone 2" three times.
 * Second, every stream opened here is opened for a preview and closed the
 * moment the preview stops. The mic test and the camera preview are the only
 * reasons this screen touches hardware at all.
 *
 * All of it goes through lib/media/devices, which is the seam the desktop shell
 * replaces if it ever needs native device handling.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Actions,
  Group,
  Note,
  Row,
  Segmented,
  Select,
  Slider,
  Toggle,
} from '../../components/settings/controls';
import {
  EMPTY_DEVICES,
  canChooseOutput,
  createLevelMeter,
  isSupported,
  listDevices,
  onDeviceChange,
  openCamera,
  openMicrophone,
  requestAccess,
  stopStream,
  type DeviceList,
} from '../../lib/media/devices';
import type { InputMode } from '../../lib/settings/types';
import { useSettings } from '../../state/SettingsProvider';

const INPUT_MODES: { value: InputMode; label: string }[] = [
  { value: 'voice-activity', label: 'Voice activity' },
  { value: 'push-to-talk', label: 'Push to talk' },
];

export function VoiceVideoSection() {
  const { settings, update } = useSettings();
  const voice = settings.voice;
  const [devices, setDevices] = useState<DeviceList>(EMPTY_DEVICES);
  const supported = isSupported();

  const refresh = useCallback(() => {
    void listDevices().then(setDevices);
  }, []);

  useEffect(() => {
    refresh();
    return onDeviceChange(refresh);
  }, [refresh]);

  async function grant(kind: 'audio' | 'video') {
    await requestAccess(kind);
    refresh();
  }

  if (!supported) {
    return (
      <Note tone="warn">
        This build has no access to media devices, so there is nothing to
        configure here.
      </Note>
    );
  }

  return (
    <>
      {!devices.labelled && (
        <Note tone="warn">
          Your browser hides device names until you allow access once. Until then
          the lists below are unnamed.{' '}
          <button type="button" className="set-link" onClick={() => void grant('audio')}>
            Allow microphone
          </button>{' '}
          <button type="button" className="set-link" onClick={() => void grant('video')}>
            Allow camera
          </button>
        </Note>
      )}

      <Group title="voice">
        <Row label="Input device" hint="Which microphone calls use.">
          <Select
            label="Input device"
            value={voice.inputDeviceId ?? ''}
            placeholder="System default"
            options={devices.microphones.map((device) => ({
              value: device.id,
              label: device.label,
            }))}
            onChange={(id) => update('voice', { inputDeviceId: id || null })}
          />
        </Row>

        <Row label="Input volume">
          <Slider
            label="Input volume"
            value={voice.inputVolume}
            min={0}
            max={100}
            onChange={(inputVolume) => update('voice', { inputVolume })}
            format={(value) => `${value}%`}
          />
        </Row>

        <Row
          label="Output device"
          hint={
            canChooseOutput()
              ? 'Where call audio is played.'
              : 'This browser always plays through the system default, so there is nothing to pick.'
          }
        >
          <Select
            label="Output device"
            value={voice.outputDeviceId ?? ''}
            placeholder="System default"
            disabled={!canChooseOutput()}
            options={devices.speakers.map((device) => ({
              value: device.id,
              label: device.label,
            }))}
            onChange={(id) => update('voice', { outputDeviceId: id || null })}
          />
        </Row>

        <Row label="Output volume">
          <Slider
            label="Output volume"
            value={voice.outputVolume}
            min={0}
            max={100}
            onChange={(outputVolume) => update('voice', { outputVolume })}
            format={(value) => `${value}%`}
          />
        </Row>
      </Group>

      <Group title="input mode">
        <Row label="When your mic is open">
          <Segmented
            label="Input mode"
            value={voice.inputMode}
            options={INPUT_MODES}
            onChange={(inputMode) => update('voice', { inputMode })}
          />
        </Row>

        {voice.inputMode === 'voice-activity' && (
          <Row
            label="Sensitivity"
            hint="How loud you have to be before you are transmitted. Watch the
                  meter below and set it just above your room."
          >
            <Slider
              label="Sensitivity"
              value={voice.sensitivity}
              min={0}
              max={100}
              onChange={(sensitivity) => update('voice', { sensitivity })}
              format={(value) => `${value}`}
            />
          </Row>
        )}

        <MicTest />
      </Group>

      <Group
        title="processing"
        hint="Handled by the browser's audio stack. Turn them off if you are
              using an interface that already does its own."
      >
        <Row label="Echo cancellation">
          <Toggle
            label="Echo cancellation"
            checked={voice.echoCancellation}
            onChange={(echoCancellation) => update('voice', { echoCancellation })}
          />
        </Row>
        <Row label="Noise suppression">
          <Toggle
            label="Noise suppression"
            checked={voice.noiseSuppression}
            onChange={(noiseSuppression) => update('voice', { noiseSuppression })}
          />
        </Row>
        <Row label="Automatic gain control">
          <Toggle
            label="Automatic gain control"
            checked={voice.autoGainControl}
            onChange={(autoGainControl) => update('voice', { autoGainControl })}
          />
        </Row>
      </Group>

      <Group title="video">
        <Row label="Camera">
          <Select
            label="Camera"
            value={voice.cameraDeviceId ?? ''}
            placeholder="System default"
            options={devices.cameras.map((device) => ({
              value: device.id,
              label: device.label,
            }))}
            onChange={(id) => update('voice', { cameraDeviceId: id || null })}
          />
        </Row>
        <Row label="Mirror my camera" hint="Only changes your own preview, not what others see.">
          <Toggle
            label="Mirror my camera"
            checked={voice.mirrorCamera}
            onChange={(mirrorCamera) => update('voice', { mirrorCamera })}
          />
        </Row>
        <CameraPreview />
      </Group>

      <Note tone="sealed">
        Calls are not built yet. These choices are stored now so that when calls
        land they start on the right hardware.
      </Note>
    </>
  );
}

/* ------------------------------------------------------------- mic test --- */

function MicTest() {
  const { settings } = useSettings();
  const voice = settings.voice;
  const [running, setRunning] = useState(false);
  const [level, setLevel] = useState(0);
  const [failed, setFailed] = useState(false);

  // Held in refs, not state: these are teardown handles, and re-rendering on
  // every frame because a MediaStream changed identity would be pointless.
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    stopStream(streamRef.current);
    streamRef.current = null;
    setRunning(false);
    setLevel(0);
  }, []);

  // The stream must not outlive the screen; leaving it open would keep the
  // recording indicator lit long after the user closed settings.
  useEffect(() => stop, [stop]);

  async function start() {
    setFailed(false);
    const stream = await openMicrophone({
      deviceId: voice.inputDeviceId,
      echoCancellation: voice.echoCancellation,
      noiseSuppression: voice.noiseSuppression,
      autoGainControl: voice.autoGainControl,
    });
    if (!stream) {
      setFailed(true);
      return;
    }

    streamRef.current = stream;
    setRunning(true);

    const meter = createLevelMeter(stream);
    const tick = () => {
      setLevel(meter.read());
      frameRef.current = requestAnimationFrame(tick);
    };
    tick();
  }

  const gate = voice.inputMode === 'voice-activity' ? voice.sensitivity : null;
  const open = gate === null || level >= gate;

  return (
    <div className="set-mic">
      <div className="set-mic__meter" aria-hidden>
        <div
          className={open ? 'set-mic__fill set-mic__fill--open' : 'set-mic__fill'}
          style={{ width: `${level}%` }}
        />
        {gate !== null && <div className="set-mic__gate" style={{ left: `${gate}%` }} />}
      </div>

      <Actions>
        {running ? (
          <button type="button" className="set-btn set-btn--quiet" onClick={stop}>
            Stop test
          </button>
        ) : (
          <button type="button" className="set-btn" onClick={() => void start()}>
            Test microphone
          </button>
        )}
        {running && (
          <span className="set-mic__hint">
            {gate === null
              ? 'Say something, the bar should move.'
              : open
                ? 'You would be heard.'
                : 'Below the threshold, nothing would be sent.'}
          </span>
        )}
      </Actions>

      {failed && <Note tone="warn">That microphone could not be opened.</Note>}
    </div>
  );
}

/* -------------------------------------------------------- camera preview --- */

function CameraPreview() {
  const { settings } = useSettings();
  const voice = settings.voice;
  const video = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);

  const stop = useCallback(() => {
    stopStream(streamRef.current);
    streamRef.current = null;
    if (video.current) video.current.srcObject = null;
    setRunning(false);
  }, []);

  useEffect(() => stop, [stop]);

  async function start() {
    setFailed(false);
    const stream = await openCamera(voice.cameraDeviceId);
    if (!stream) {
      setFailed(true);
      return;
    }
    streamRef.current = stream;
    setRunning(true);
    if (video.current) {
      video.current.srcObject = stream;
      void video.current.play().catch(() => {});
    }
  }

  return (
    <div className="set-camera">
      <div className={running ? 'set-camera__frame set-camera__frame--live' : 'set-camera__frame'}>
        <video
          ref={video}
          className={voice.mirrorCamera ? 'set-camera__video set-camera__video--mirror' : 'set-camera__video'}
          muted
          playsInline
          hidden={!running}
        />
        {!running && <span className="set-camera__placeholder">Camera off</span>}
      </div>

      <Actions>
        {running ? (
          <button type="button" className="set-btn set-btn--quiet" onClick={stop}>
            Stop preview
          </button>
        ) : (
          <button type="button" className="set-btn" onClick={() => void start()}>
            Preview camera
          </button>
        )}
      </Actions>

      {failed && <Note tone="warn">That camera could not be opened.</Note>}
    </div>
  );
}
