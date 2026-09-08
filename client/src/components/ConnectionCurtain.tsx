/**
 * The curtain that comes down when the connection goes.
 *
 * The whole design is in the timing at both ends. A socket that blinks out and
 * back (a handover between cells, a laptop waking up) is normal, and a screen
 * that covers the app every time one happens is worse than the blink. So
 * nothing is drawn until the connection has been bad for `GRACE_MS` without
 * recovering.
 *
 * Coming back is the other half. The curtain does not simply vanish: the bar
 * fills, says "Back online", and holds for `SETTLE_MS` before it lifts. That
 * pause is not decoration. It is the only moment the app can tell you the
 * thing you were waiting for actually happened, and without it a long outage
 * ends with a flicker you might not even catch.
 *
 * It covers rather than replaces, so a reconnect puts you back exactly where
 * you were, with whatever you had half typed still in the composer.
 */
import { useEffect, useRef, useState } from 'react';
import type { ConnectionState } from '../lib/transport/types';
import { LoadingScreen } from './LoadingScreen';

/** How long a bad connection has to stay bad before it is worth saying so. */
const GRACE_MS = 1800;

/** How long "Back online" stays up once it is true. */
const SETTLE_MS = 900;

export function ConnectionCurtain({ connection }: { connection: ConnectionState }) {
  // `idle` is "not started yet" rather than "broken", and covering the app
  // before the first connect attempt would flash the curtain on every load.
  const struggling = connection === 'connecting' || connection === 'offline';
  const settled = useSettled(struggling, GRACE_MS);
  const [recovering, setRecovering] = useState(false);
  const wasShown = useRef(false);

  useEffect(() => {
    if (settled) {
      wasShown.current = true;
      setRecovering(false);
      return;
    }
    // Only worth announcing a recovery from an outage the user was told about.
    if (!wasShown.current) return;
    wasShown.current = false;
    setRecovering(true);
    const timer = setTimeout(() => setRecovering(false), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [settled]);

  if (!settled && !recovering) return null;

  if (recovering) {
    return (
      <LoadingScreen
        overlay
        tone="slow"
        title="load.backOnline"
        detail="load.backOnlineDetail"
        // The one number here that is certainly true.
        progress={1}
        tips={false}
      />
    );
  }

  return (
    <LoadingScreen
      overlay
      tone={connection === 'offline' ? 'offline' : 'slow'}
      // Null, not a percentage: nobody knows how far along a wait for a network
      // is, and a bar that crept toward full would be inventing one.
      progress={null}
    />
  );
}

/**
 * True once `active` has stayed true for `delay` without flickering off.
 *
 * Turning off is immediate: the moment the connection is back, this goes false,
 * because a "reconnecting" screen over a working app is its own bug.
 */
function useSettled(active: boolean, delay: number): boolean {
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (!active) {
      setSettled(false);
      return;
    }
    const timer = setTimeout(() => setSettled(true), delay);
    return () => clearTimeout(timer);
  }, [active, delay]);

  return settled;
}
