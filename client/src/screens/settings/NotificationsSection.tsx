/**
 * Notifications, and the one setting on this screen that is a security choice
 * wearing a convenience choice's clothes.
 *
 * A desktop notification is handed to the operating system. On Windows it goes
 * to the Action Centre, on macOS it can be mirrored to a phone and on either
 * it can sit on a lock screen in a room full of people. Every one of those is a
 * copy of a decrypted message living somewhere this app cannot reach. So the
 * preview toggle defaults off and says exactly that, rather than being a line
 * of small print somewhere else.
 *
 * The toggles here are read by `components/DesktopNotifier.tsx`, which is what
 * actually raises one. What this screen owns is asking the browser for
 * permission and letting you see one, because a notification is the one alert
 * in this app you cannot check by turning it on and waiting: it only appears
 * when the window is in the background, which the settings screen never is.
 */
import { useCallback, useEffect, useState } from 'react';
import { Avatar } from '../../components/Avatar';
import { SpeakerIcon } from '../../components/Icons';
import { Actions, Group, Note, Row, Select, Toggle } from '../../components/settings/controls';
import {
  askPermission,
  permissionNow,
  show as showNotification,
} from '../../lib/media/notifications';
import type { NotifyPermission } from '../../lib/settings/desktopNotifications';
import {
  MESSAGE_SOUNDS,
  MESSAGE_SOUND_IDS,
  RING_SOUNDS,
  RING_SOUND_IDS,
  type MessageSound,
  type RingSound,
  playMessage,
  previewRing,
} from '../../lib/media/sounds';
import type { Key } from '../../lib/i18n/en';
import { clockTime } from '../../lib/i18n/format';
import type { Locale } from '../../lib/i18n/locales';
import { withPersonSound } from '../../lib/settings/notificationSounds';
import { useChat } from '../../state/ChatProvider';
import { useI18n, useT, type Translate } from '../../state/I18nProvider';
import { useSettings } from '../../state/SettingsProvider';

const MUTE_OPTIONS: { label: Key; minutes: number | null }[] = [
  { label: 'notify.mute.30m', minutes: 30 },
  { label: 'notify.mute.2h', minutes: 120 },
  { label: 'notify.mute.tomorrow', minutes: 60 * 24 },
  { label: 'notify.mute.forever', minutes: null },
];

export function NotificationsSection() {
  const { settings, update } = useSettings();
  const { locale, t } = useI18n();
  const notifications = settings.notifications;
  const [permission, setPermission] = useState<NotifyPermission>(permissionNow);

  const muted = isMuted(notifications.mutedUntil);

  // A pause that has run out should say so without waiting for a click
  // elsewhere to re-render this screen.
  useMuteExpiry(
    notifications.mutedUntil,
    useCallback(() => update('notifications', { mutedUntil: null }), [update]),
  );

  async function enable() {
    const result = await askPermission();
    setPermission(result);
    update('notifications', { desktop: result === 'granted' });
  }

  /**
   * One of the real thing, drawn the way a real one would be.
   *
   * Deliberately ignores the preview toggle and shows fixed text: this is for
   * finding out whether your operating system shows them at all (Focus
   * Assist, Do Not Disturb and a notification setting per browser are three
   * separate places it can be silently switched off), not for previewing your
   * own messages.
   */
  function preview() {
    showNotification({
      title: t('notify.testTitle'),
      body: t('notify.testBody'),
      tag: 'cipher/test',
    });
  }

  return (
    <>
      <Group title={t('notify.group.pause')}>
        <Row
          label={t('notify.pause')}
          hint={
            muted
              ? t('notify.paused', { when: describeMute(notifications.mutedUntil, t, locale) })
              : t('notify.pauseHint')
          }
        >
          {muted ? (
            <button
              type="button"
              className="set-btn"
              onClick={() => update('notifications', { mutedUntil: null })}
            >
              {t('notify.resume')}
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
                {t(option.label)}
              </button>
            ))}
          </Actions>
        )}
      </Group>

      <Group title={t('notify.group.desktop')}>
        {permission === 'unsupported' && (
          <Note tone="warn">{t('notify.unsupported')}</Note>
        )}
        {permission === 'denied' && <Note tone="warn">{t('notify.denied')}</Note>}

        <Row label={t('notify.desktop')} hint={t('notify.desktopHint')}>
          {permission === 'default' ? (
            <button type="button" className="set-btn" onClick={() => void enable()}>
              {t('notify.allow')}
            </button>
          ) : (
            <Toggle
              label={t('notify.desktop')}
              checked={notifications.desktop && permission === 'granted'}
              disabled={permission !== 'granted'}
              onChange={(desktop) => update('notifications', { desktop })}
            />
          )}
        </Row>

        <Row label={t('notify.preview')} hint={t('notify.previewHint')}>
          <Toggle
            label={t('notify.preview')}
            checked={notifications.preview}
            disabled={!notifications.desktop || permission !== 'granted'}
            onChange={(preview) => update('notifications', { preview })}
          />
        </Row>

        {notifications.preview && (
          <Note tone="warn">{t('notify.previewWarn')}</Note>
        )}

        {permission === 'granted' && (
          <Row label={t('notify.test')} hint={t('notify.testHint')}>
            <button type="button" className="set-btn set-btn--quiet" onClick={preview}>
              {t('notify.testSend')}
            </button>
          </Row>
        )}
      </Group>

      <Group title={t('notify.group.sounds')}>
        <Row label={t('notify.newMessage')}>
          <Toggle
            label={t('notify.soundOnMessage')}
            checked={notifications.soundOnMessage}
            onChange={(soundOnMessage) => update('notifications', { soundOnMessage })}
          />
        </Row>

        <Row label={t('notify.messageSound')} hint={t('notify.messageSoundHint')}>
          <div className="set-sound">
            <Select
              label={t('notify.messageSound')}
              value={notifications.messageSound}
              options={messageOptions(t)}
              disabled={!notifications.soundOnMessage}
              onChange={(messageSound) => {
                update('notifications', { messageSound });
                playMessage(messageSound);
              }}
            />
            <PlayButton
              what={t(MESSAGE_SOUNDS[notifications.messageSound].label)}
              onPlay={() => playMessage(notifications.messageSound)}
            />
          </div>
        </Row>

        <Row label={t('notify.ringtone')} hint={t('notify.ringtoneHint')}>
          <div className="set-sound">
            <Select
              label={t('notify.ringtone')}
              value={notifications.callSound}
              options={ringOptions(t)}
              onChange={(callSound) => {
                update('notifications', { callSound });
                previewRing(callSound);
              }}
            />
            <PlayButton
              what={t(RING_SOUNDS[notifications.callSound].label)}
              onPlay={() => previewRing(notifications.callSound)}
            />
          </div>
        </Row>
        <Row label={t('notify.mentions')} hint={t('notify.mentionsHint')}>
          <Toggle
            label={t('notify.soundOnMention')}
            checked={notifications.soundOnMention}
            onChange={(soundOnMention) => update('notifications', { soundOnMention })}
          />
        </Row>
        <Row label={t('notify.sent')}>
          <Toggle
            label={t('notify.soundOnSend')}
            checked={notifications.soundOnSend}
            onChange={(soundOnSend) => update('notifications', { soundOnSend })}
          />
        </Row>
      </Group>

      <PerPersonSounds />

      <Group title={t('notify.group.badges')}>
        <Row label={t('notify.badge')} hint={t('notify.badgeHint')}>
          <Toggle
            label={t('notify.badge')}
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

function describeMute(until: string | null, t: Translate, locale: Locale): string {
  if (until === 'forever') return t('notify.untilYouSay');
  if (!until) return '';
  const at = clockTime(until, locale);
  return at ? t('notify.untilTime', { time: at }) : '';
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

/* Built per render rather than at module load, because the names change with
   the language and a module-level array would freeze whichever one was
   current when the file was first imported. */
const messageOptions = (t: Translate) =>
  MESSAGE_SOUND_IDS.map((id) => ({ value: id, label: t(MESSAGE_SOUNDS[id].label) }));

const ringOptions = (t: Translate) =>
  RING_SOUND_IDS.map((id) => ({ value: id, label: t(RING_SOUNDS[id].label) }));

/** Audition button. Small, because it sits beside every picker on the screen. */
function PlayButton({ what, onPlay }: { what: string; onPlay: () => void }) {
  const t = useT();
  const label = t('notify.play', { what });
  return (
    <button
      type="button"
      className="set-play"
      onClick={onPlay}
      title={label}
      aria-label={label}
    >
      <SpeakerIcon size={15} />
    </button>
  );
}

/**
 * A sound per person, which is the setting this screen exists for.
 *
 * Reading a name off a screen takes a glance you do not always have. Hearing
 * which of two people is calling takes nothing, and that is worth a row per
 * friend. Only friends are listed: a per person sound for someone you have
 * never spoken to is a setting with nothing to attach to.
 */
function PerPersonSounds() {
  const { settings, update } = useSettings();
  const { friends, usersById } = useChat();
  const t = useT();
  const perPerson = settings.notifications.perPerson;

  if (friends.length === 0) {
    return (
      <Group title={t('notify.group.perPerson')}>
        <Note>{t('notify.perPersonEmpty')}</Note>
      </Group>
    );
  }

  return (
    <Group title={t('notify.group.perPerson')}>
      <p className="set-people__lede">{t('notify.perPersonLede')}</p>

      <div className="set-people">
        {friends.map((friend) => {
          const user = usersById.get(friend.id);
          const picks = perPerson[friend.id] ?? {};
          const message = picks.message;
          const call = picks.call;

          return (
            <div className="set-person" key={friend.id}>
              <div className="set-person__who">
                {user && <Avatar user={user} size={28} />}
                <span className="set-person__name">{user?.name ?? friend.username}</span>
              </div>

              <div className="set-person__picks">
                <div className="set-sound">
                  <Select
                    label={t('notify.messageSoundFor', { name: friend.username })}
                    value={message ?? ''}
                    placeholder={t('notify.sameForEveryone')}
                    options={messageOptions(t)}
                    onChange={(next) => {
                      const value = (next as MessageSound | '') || null;
                      update('notifications', {
                        perPerson: withPersonSound(perPerson, friend.id, 'message', value),
                      });
                      if (value) playMessage(value);
                    }}
                  />
                  <PlayButton
                    what={
                      message
                        ? t(MESSAGE_SOUNDS[message].label)
                        : t('notify.defaultMessageSound')
                    }
                    onPlay={() => playMessage(message ?? settings.notifications.messageSound)}
                  />
                </div>

                <div className="set-sound">
                  <Select
                    label={t('notify.ringtoneFor', { name: friend.username })}
                    value={call ?? ''}
                    placeholder={t('notify.sameForEveryone')}
                    options={ringOptions(t)}
                    onChange={(next) => {
                      const value = (next as RingSound | '') || null;
                      update('notifications', {
                        perPerson: withPersonSound(perPerson, friend.id, 'call', value),
                      });
                      if (value) previewRing(value);
                    }}
                  />
                  <PlayButton
                    what={call ? t(RING_SOUNDS[call].label) : t('notify.defaultRingtone')}
                    onPlay={() => previewRing(call ?? settings.notifications.callSound)}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Group>
  );
}
