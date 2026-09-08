/**
 * The sound an arriving message makes.
 *
 * Noticing the message is `useArrivingMessages`, shared with the notifier.
 * What is left here is the two rules that are about sound specifically, and
 * they are the reason this is not three lines in ChatProvider:
 *
 *   - It says nothing about the conversation you are reading, in a tab you are
 *     looking at. You can already see it.
 *   - A mention can sound when ordinary messages do not, which is what the two
 *     separate toggles in settings promise.
 *
 * Note that this is a looser test than the notifier's: a chime for a
 * conversation you are not currently in is useful even while you are at the
 * keyboard, and a notification for the same message would not be.
 */
import { isMuted, messageSoundFor } from '../lib/settings/notificationSounds';
import { playMessage } from '../lib/media/sounds';
import { useChat } from '../state/ChatProvider';
import { useSettings } from '../state/SettingsProvider';
import { useArrivingMessages } from '../state/useArrivingMessages';

export function MessageChime() {
  const { activeChannelId } = useChat();
  const { settings } = useSettings();

  useArrivingMessages((arrivals) => {
    const notifications = settings.notifications;
    if (isMuted(notifications.mutedUntil)) return;
    const focused = typeof document === 'undefined' || document.visibilityState === 'visible';

    for (const arrival of arrivals) {
      if (arrival.own) {
        // Your own message, the moment it is queued. Off by default: most
        // people do not want to hear themselves type.
        if (notifications.soundOnSend) playMessage(notifications.messageSound);
        continue;
      }

      if (focused && arrival.channelId === activeChannelId) continue;

      // Kept separate so you can go quiet without going deaf: a mention sounds
      // even when ordinary messages are switched off.
      const allowed = arrival.mentioned
        ? notifications.soundOnMention
        : notifications.soundOnMessage;
      if (!allowed) continue;

      playMessage(messageSoundFor(notifications, arrival.message.authorId));
      // One sound, however many conversations moved at once. Two chimes on top
      // of each other is noise, not information.
      break;
    }
  });

  return null;
}
