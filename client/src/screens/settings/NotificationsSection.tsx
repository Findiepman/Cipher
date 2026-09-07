/**
 * Notifications, and the one setting on this screen that is a security choice
 * wearing a convenience choice's clothes.
 *
 * A desktop notification is handed to the operating system. On Windows it goes
 * to the Action Centre, on macOS it can be mirrored to a phone, and on either
 * it can sit on a lock screen in a room full of people. Every one of those is a
 * copy of a decrypted message living somewhere this app cannot reach. So the
 * preview toggle defaults off and says exactly that, rather than being a line
 * of small print somewhere else.
 */
import { useCallback, useEffect, useState } from 'react';
import { Actions, Group, Note, Row, Toggle } from '../../components/settings/controls';
import { useSettings } from '../../state/SettingsProvider';

type Permission = 'default' | 'granted' | 'denied' | 'unsupported';

function readPermission(): Permission {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

const MUTE_OPTIONS: { label: string; minutes: number | null }[] = [
  { label: '30 minutes', minutes: 30 },
  { label: '2 hours', minutes: 120 },
  { label: 'Until tomorrow', minutes: 60 * 24 },
  { label: 'Until I turn it back on', minutes: null },
];

export function NotificationsSection() {
  const { settings, update } = useSettings();
  const notifications = settings.notifications;
  const [permission, setPermission] = useState<Permission>(readPermission);

  const muted = isMuted(notifications.mutedUntil);

  // A pause that has run out should say so without waiting for a click
  // elsewhere to re-render this screen.
  useMuteExpiry(
    notifications.mutedUntil,
    useCallback(() => update('notifications', { mutedUntil: null }), [update]),
  );

  async function enable() {
    if (typeof Notification === 'undefined') return;
    const result = await Notification.requestPermission();
    setPermission(result);
    update('notifications', { desktop: result === 'granted' });
  }

  return (
    <>
      <Group title="pause">
        <Row
          label="Pause notifications"
          hint={
            muted
              ? `Paused ${describeMute(notifications.mutedUntil)}.`
              : 'Nothing will sound or pop up while paused. Messages still arrive.'
          }
        >
          {muted ? (
            <button
              type="button"
              className="set-btn"
              onClick={() => update('notifications', { mutedUntil: null })}
            >
              Resume
            </button>
          ) : null}
        </Row>

        {!muted && (
          <Actions>
            {MUTE_OPTIONS.map((option) => (
              <button
                key={option.label}
                type="button"
                className="set-btn set-btn--quiet"
                onClick={() =>
                  update('notifications', { mutedUntil: muteUntil(option.minutes) })
                }
              >
                {option.label}
              </button>
            ))}
          </Actions>
        )}
      </Group>

      <Group title="desktop">
        {permission === 'unsupported' && (
          <Note tone="warn">This build cannot show desktop notifications.</Note>
        )}
        {permission === 'denied' && (
          <Note tone="warn">
            Notifications are blocked for this app in your browser or system
            settings. That has to be changed there — this screen cannot override
            it.
          </Note>
        )}

        <Row
          label="Desktop notifications"
          hint="A popup when a message arrives while the app is in the background."
        >
          {permission === 'default' ? (
            <button type="button" className="set-btn" onClick={() => void enable()}>
              Allow
            </button>
          ) : (
            <Toggle
              label="Desktop notifications"
              checked={notifications.desktop && permission === 'granted'}
              disabled={permission !== 'granted'}
              onChange={(desktop) => update('notifications', { desktop })}
            />
          )}
        </Row>

        <Row
          label="Show message text in notifications"
          hint="Off, a notification says only that someone messaged you. On, it
                includes what they said — which hands decrypted text to the
                operating system's notification centre, where it may be logged,
                mirrored to another device, or shown on a locked screen."
        >
          <Toggle
            label="Show message text in notifications"
            checked={notifications.preview}
            disabled={!notifications.desktop || permission !== 'granted'}
            onChange={(preview) => update('notifications', { preview })}
          />
        </Row>

        {notifications.preview && (
          <Note tone="warn">
            Message text will leave the app's control every time a notification
            is shown.
          </Note>
        )}
      </Group>

      <Group title="sounds">
        <Row label="New message">
          <Toggle
            label="Sound on new message"
            checked={notifications.soundOnMessage}
            onChange={(soundOnMessage) => update('notifications', { soundOnMessage })}
          />
        </Row>
        <Row label="Mentions" hint="Kept separate so you can go quiet without going deaf.">
          <Toggle
            label="Sound on mention"
            checked={notifications.soundOnMention}
            onChange={(soundOnMention) => update('notifications', { soundOnMention })}
          />
        </Row>
        <Row label="Message sent">
          <Toggle
            label="Sound on message sent"
            checked={notifications.soundOnSend}
            onChange={(soundOnSend) => update('notifications', { soundOnSend })}
          />
        </Row>
      </Group>

      <Group title="badges">
        <Row
          label="Unread count"
          hint="The number on the app icon and in the tab title."
        >
          <Toggle
            label="Unread count"
            checked={notifications.unreadBadge}
            onChange={(unreadBadge) => update('notifications', { unreadBadge })}
          />
        </Row>
      </Group>
    </>
  );
}

/* --------------------------------------------------------------- muting --- */

export function isMuted(until: string | null): boolean {
  if (!until) return false;
  // The sentinel for "indefinitely", so a paused state cannot silently expire.
  if (until === 'forever') return true;
  const at = Date.parse(until);
  return Number.isNaN(at) ? false : at > Date.now();
}

function muteUntil(minutes: number | null): string {
  if (minutes === null) return 'forever';
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function describeMute(until: string | null): string {
  if (until === 'forever') return 'until you turn it back on';
  if (!until) return '';
  const date = new Date(until);
  if (Number.isNaN(date.getTime())) return '';
  return `until ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

/** Clears a pause once it has run out, so the section stops saying "paused". */
function useMuteExpiry(until: string | null, onExpire: () => void) {
  useEffect(() => {
    if (!until || until === 'forever') return;
    const at = Date.parse(until);
    if (Number.isNaN(at)) return;
    const delay = at - Date.now();
    if (delay <= 0) {
      onExpire();
      return;
    }
    const timer = setTimeout(onExpire, delay);
    return () => clearTimeout(timer);
  }, [until, onExpire]);
}
