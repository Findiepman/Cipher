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
import type { Key } from '../../lib/i18n/en';
import type { InputMode } from '../../lib/settings/types';
import { useT } from '../../state/I18nProvider';
import { useSettings } from '../../state/SettingsProvider';

const INPUT_MODES: { value: InputMode; label: Key }[] = [
  { value: 'voice-activity', label: 'voice.mode.activity' },
  { value: 'push-to-talk', label: 'voice.mode.push' },
];

export function VoiceVideoSection() {
  const { settings, update } = useSettings();
  const t = useT();
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
    return <Note tone="warn">{t('voice.unsupported')}</Note>;
  }

  return (
    <>
      {!devices.labelled && (
        <Note tone="warn">
          {t('voice.unnamed')}{' '}
          <button type="button" className="set-link" onClick={() => void grant('audio')}>
            {t('voice.allowMic')}
          </button>{' '}
          <button type="button" className="set-link" onClick={() => void grant('video')}>
            {t('voice.allowCamera')}
          </button>
        </Note>
      )}

      <Group title={t('voice.group.voice')}>
        <Row label={t('voice.input')} hint={t('voice.inputHint')}>
          <Select
            label={t('voice.input')}
            value={voice.inputDeviceId ?? ''}
            placeholder={t('voice.systemDefault')}
            options={devices.microphones.map((device) => ({
              value: device.id,
              label: device.label,
            }))}
            onChange={(id) => update('voice', { inputDeviceId: id || null })}
          />
        </Row>

        <Row label={t('voice.inputVolume')}>
          <Slider
            label={t('voice.inputVolume')}
            value={voice.inputVolume}
            min={0}
            max={100}
            onChange={(inputVolume) => update('voice', { inputVolume })}
            format={(value) => `${value}%`}
          />
        </Row>

        <Row
          label={t('voice.output')}
          hint={t(canChooseOutput() ? 'voice.outputHint' : 'voice.outputFixed')}
        >
          <Select
            label={t('voice.output')}
            value={voice.outputDeviceId ?? ''}
            placeholder={t('voice.systemDefault')}
            disabled={!canChooseOutput()}
            options={devices.speakers.map((device) => ({
              value: device.id,
              label: device.label,
            }))}
            onChange={(id) => update('voice', { outputDeviceId: id || null })}
          />
        </Row>

        <Row label={t('voice.outputVolume')}>
          <Slider
            label={t('voice.outputVolume')}
            value={voice.outputVolume}
            min={0}
            max={100}
            onChange={(outputVolume) => update('voice', { outputVolume })}
            format={(value) => `${value}%`}
          />
        </Row>
      </Group>

      <Group title={t('voice.group.mode')}>
        <Row label={t('voice.whenOpen')}>
          <Segmented
            label={t('voice.group.mode')}
            value={voice.inputMode}
            options={INPUT_MODES.map((one) => ({ ...one, label: t(one.label) }))}
            onChange={(inputMode) => update('voice', { inputMode })}
          />
        </Row>

        {voice.inputMode === 'voice-activity' && (
          <Row label={t('voice.sensitivity')} hint={t('voice.sensitivityHint')}>
            <Slider
              label={t('voice.sensitivity')}
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

      <Group title={t('voice.group.processing')} hint={t('voice.processingHint')}>
        <Row label={t('voice.echo')}>
          <Toggle
            label={t('voice.echo')}
            checked={voice.echoCancellation}
            onChange={(echoCancellation) => update('voice', { echoCancellation })}
          />
        </Row>
        <Row label={t('voice.noise')}>
          <Toggle
            label={t('voice.noise')}
            checked={voice.noiseSuppression}
            onChange={(noiseSuppression) => update('voice', { noiseSuppression })}
          />
        </Row>
        <Row label={t('voice.gain')}>
          <Toggle
            label={t('voice.gain')}
            checked={voice.autoGainControl}
            onChange={(autoGainControl) => update('voice', { autoGainControl })}
          />
        </Row>
      </Group>

      <Group title={t('voice.group.video')}>
        <Row label={t('voice.camera')}>
          <Select
            label={t('voice.camera')}
            value={voice.cameraDeviceId ?? ''}
            placeholder={t('voice.systemDefault')}
            options={devices.cameras.map((device) => ({
              value: device.id,
              label: device.label,
            }))}
            onChange={(id) => update('voice', { cameraDeviceId: id || null })}
          />
        </Row>
        <Row label={t('voice.mirror')} hint={t('voice.mirrorHint')}>
          <Toggle
            label={t('voice.mirror')}
            checked={voice.mirrorCamera}
            onChange={(mirrorCamera) => update('voice', { mirrorCamera })}
          />
        </Row>
        <CameraPreview />
      </Group>

      <Note tone="plain">{t('voice.note')}</Note>
    </>
  );
}

/* ------------------------------------------------------------- mic test --- */

function MicTest() {
  const { settings } = useSettings();
  const t = useT();
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
            {t('voice.stopTest')}
          </button>
        ) : (
          <button type="button" className="set-btn" onClick={() => void start()}>
            {t('voice.testMic')}
          </button>
        )}
        {running && (
          <span className="set-mic__hint">
            {t(
              gate === null
                ? 'voice.saySomething'
                : open
                  ? 'voice.wouldBeHeard'
                  : 'voice.belowThreshold',
            )}
          </span>
        )}
      </Actions>

      {failed && <Note tone="warn">{t('voice.micFailed')}</Note>}
    </div>
  );
}

/* -------------------------------------------------------- camera preview --- */

function CameraPreview() {
  const { settings } = useSettings();
  const t = useT();
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
        {!running && (
          <span className="set-camera__placeholder">{t('voice.cameraOff')}</span>
        )}
      </div>

      <Actions>
        {running ? (
          <button type="button" className="set-btn set-btn--quiet" onClick={stop}>
            {t('voice.stopPreview')}
          </button>
        ) : (
          <button type="button" className="set-btn" onClick={() => void start()}>
            {t('voice.previewCamera')}
          </button>
        )}
      </Actions>

      {failed && <Note tone="warn">{t('voice.cameraFailed')}</Note>}
    </div>
  );
}
