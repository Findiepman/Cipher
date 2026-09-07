/**
 * The one floating piece of call UI.
 *
 * While somebody is ringing you it is the incoming call toast: who, accept,
 * decline. Once a call is under way it is the in-call bar: who, how long,
 * mute, hang up, and the push-to-talk button when that mode is on. When a
 * call ends it lingers a few seconds to say why, then goes.
 *
 * It floats above everything, settings included, because a call does not
 * stop being a call when you open a settings screen, and the hang-up button
 * has to be reachable from anywhere.
 *
 * It says nothing about encryption. The audio is genuinely end to end, and
 * the signalling that set it up is not yet bound to your identity key, and a
 * badge would be true in the part people do not check and false in the part
 * they do (voice-plan.md, STATUS.md decision 21).
 */
import { useEffect, useState } from 'react';
import type { CallEndReason, CallSnapshot } from '../lib/call/types';
import { useCall } from '../state/CallProvider';
import { useChat } from '../state/ChatProvider';
import { useSettings } from '../state/SettingsProvider';
import type { User } from '../types';
import { Avatar } from './Avatar';
import { CloseIcon, MicIcon, MicOffIcon, PhoneIcon, PhoneOffIcon, SpeakerIcon } from './Icons';
import '../styles/call.css';

export function CallPanel() {
  const { call } = useCall();
  const { usersById } = useChat();

  if (call.phase === 'idle') return null;

  const peer = call.peerId ? usersById.get(call.peerId) : undefined;

  if (call.phase === 'ringing') return <IncomingCall peer={peer} />;
  return <InCall call={call} peer={peer} />;
}

/* ----------------------------------------------------------- incoming --- */

function IncomingCall({ peer }: { peer: User | undefined }) {
  const { accept, decline } = useCall();
  const name = peer?.name ?? 'Someone';

  return (
    <div className="call call--ringing" role="alertdialog" aria-label={`${name} is calling`}>
      <div className="call__who">
        {peer && <Avatar user={peer} size={52} />}
        <div className="call__names">
          <span className="call__name">{name}</span>
          <span className="call__status">is calling</span>
        </div>
      </div>

      <div className="call__actions">
        <button type="button" className="call__btn call__btn--quiet" onClick={decline}>
          Decline
        </button>
        <button type="button" className="call__btn call__btn--accept" onClick={accept} autoFocus>
          <PhoneIcon size={15} />
          Accept
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- in call --- */

function InCall({ call, peer }: { call: CallSnapshot; peer: User | undefined }) {
  const { hangUp, toggleMuted, setTalking, dismiss, outputRoute, toggleOutputRoute } = useCall();
  const { settings } = useSettings();
  const name = peer?.name ?? 'Unknown';
  const ended = call.phase === 'ended';
  const pushToTalk = settings.voice.inputMode === 'push-to-talk';

  return (
    <div className={`call${ended ? ' call--ended' : ''}`} role="status" aria-live="polite">
      <div className="call__who">
        {peer && <Avatar user={peer} size={44} />}
        <div className="call__names">
          <span className="call__name">{name}</span>
          <span className="call__status">
            {ended ? endedLabel(call, name) : <Status call={call} />}
          </span>
        </div>
      </div>

      {ended ? (
        <div className="call__actions">
          <button
            type="button"
            className="icon-button"
            onClick={dismiss}
            aria-label="Dismiss"
            title="Dismiss"
          >
            <CloseIcon size={16} />
          </button>
        </div>
      ) : (
        <div className="call__actions">
          {pushToTalk && call.phase === 'connected' && (
            <button
              type="button"
              className={`call__btn call__btn--quiet call__talk${call.talking ? ' call__talk--held' : ''}`}
              onPointerDown={(event) => {
                event.preventDefault();
                setTalking(true);
              }}
              onPointerUp={() => setTalking(false)}
              onPointerLeave={() => setTalking(false)}
              onPointerCancel={() => setTalking(false)}
              onContextMenu={(event) => event.preventDefault()}
              title="Hold to talk, or hold Ctrl+Space"
              aria-pressed={call.talking}
            >
              {call.talking ? 'Talking' : 'Hold to talk'}
            </button>
          )}

          {/* Phones only, and only where the browser lets a page pick the
              output. Pressed means the loudspeaker is on. */}
          {outputRoute && (
            <button
              type="button"
              className={`call__round${outputRoute === 'speaker' ? ' call__round--active' : ''}`}
              onClick={toggleOutputRoute}
              aria-pressed={outputRoute === 'speaker'}
              aria-label={outputRoute === 'speaker' ? 'Switch to earpiece' : 'Switch to speaker'}
              title={outputRoute === 'speaker' ? 'Switch to earpiece' : 'Switch to speaker'}
            >
              <SpeakerIcon size={17} />
            </button>
          )}

          <button
            type="button"
            className={`call__round${call.muted ? ' call__round--active' : ''}`}
            onClick={toggleMuted}
            aria-pressed={call.muted}
            aria-label={call.muted ? 'Unmute' : 'Mute'}
            title={call.muted ? 'Unmute' : 'Mute'}
          >
            {call.muted ? <MicOffIcon size={18} /> : <MicIcon size={18} />}
            <span
              className={`call__level${call.transmitting ? ' call__level--on' : ''}`}
              aria-hidden
            />
          </button>

          <button
            type="button"
            className="call__round call__round--hangup"
            onClick={hangUp}
            aria-label={call.phase === 'calling' ? 'Cancel call' : 'Hang up'}
            title={call.phase === 'calling' ? 'Cancel call' : 'Hang up'}
          >
            <PhoneOffIcon size={18} />
          </button>
        </div>
      )}
    </div>
  );
}

function Status({ call }: { call: CallSnapshot }) {
  switch (call.phase) {
    case 'calling':
      return <>calling…</>;
    case 'connecting':
      return <>connecting…</>;
    case 'connected':
      return <Elapsed since={call.connectedAt ?? Date.now()} />;
    default:
      return null;
  }
}

/** mm:ss, ticking. Machine fact, so mono. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  return <span className="mono">{formatElapsed(now - since)}</span>;
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/// Why the call ended, in words. Nothing here claims anything the code does
/// not do; "connection lost" is a fact about a socket, not a promise.
export function endedLabel(call: Pick<CallSnapshot, 'endReason' | 'endMessage' | 'relay'>, name: string): string {
  const reason: CallEndReason | null = call.endReason;
  switch (reason) {
    case 'hangup':
      return 'Call ended';
    case 'rejected':
      return `${name} declined`;
    case 'no_answer':
      return 'No answer';
    case 'missed':
      return `Missed call from ${name}`;
    case 'disconnected':
      return 'Connection lost';
    case 'busy':
      return `${name} is in another call`;
    case 'in_call':
      return 'You are already in a call in another tab';
    case 'no_microphone':
      return 'Your microphone could not be opened. Check the browser permission and the input device in settings.';
    case 'unreadable':
      return 'The call could not be set up with this person.';
    case 'failed':
      return call.relay === false
        ? 'Could not connect. This server has no relay, so calls only work when both sides can reach each other directly.'
        : 'The connection failed.';
    case 'refused':
      return call.endMessage ?? 'The call could not be placed.';
    default:
      return 'Call ended';
  }
}
