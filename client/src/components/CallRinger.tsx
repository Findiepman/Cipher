/**
 * The sound an incoming call makes.
 *
 * A watcher rather than a change to the call engine. It reads the phase the
 * engine already publishes and rings while that phase says a call is waiting
 * for an answer, which means the engine keeps knowing nothing about audio it
 * does not carry, and the ringtone can change without touching signalling.
 *
 * Which pattern plays is per person: see lib/settings/notificationSounds.ts.
 * That is the whole point of the feature, so it is read fresh on every ring
 * rather than captured when the call arrives.
 */
import { useEffect, useRef } from 'react';
import { isMuted, ringSoundFor } from '../lib/settings/notificationSounds';
import { type StopRing, startRing, unlock } from '../lib/media/sounds';
import { useCall } from '../state/CallProvider';
import { useSettings } from '../state/SettingsProvider';

export function CallRinger() {
  const { call } = useCall();
  const { settings } = useSettings();
  const stop = useRef<StopRing | null>(null);

  const ringing = call.phase === 'ringing' && call.direction === 'incoming';
  const peerId = call.peerId;
  const notifications = settings.notifications;
  // Do not disturb silences the ring but not the call: the panel still shows
  // it, and you can still answer. A ringtone is the one thing the presence
  // promised to stop.
  const quiet = settings.profile.presence === 'dnd';

  useEffect(() => {
    const silent = isMuted(notifications.mutedUntil) || quiet;

    if (!ringing || silent) {
      stop.current?.();
      stop.current = null;
      return;
    }

    // Already ringing for this call: leave the pattern running rather than
    // restarting it every time the snapshot changes for an unrelated reason.
    if (stop.current) return;

    // An inbound call is the one alert that arrives with no click of its own,
    // so the audio context may still be locked from page load. This is a no-op
    // when it is already open.
    unlock();
    stop.current = startRing(ringSoundFor(notifications, peerId));

    return () => {
      stop.current?.();
      stop.current = null;
    };
  }, [ringing, peerId, notifications, quiet]);

  return null;
}
