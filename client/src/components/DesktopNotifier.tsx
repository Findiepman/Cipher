/**
 * The notification the operating system draws when you are not looking.
 *
 * Sibling to MessageChime, and deliberately a second component rather than
 * three more lines inside it: the two agree about what an arriving message is
 * (`useArrivingMessages`) and disagree about everything after that. A chime
 * for a conversation you are not currently reading is useful while you sit at
 * the keyboard. A notification for the same message is not, because you can
 * see the app.
 *
 * Whether an arrival is allowed out at all is `notifiable`, which is a pure
 * function with tests, because it is the gate between somebody's decrypted
 * words and the operating system's notification centre. Nothing about that
 * decision is made here.
 */
import { useEffect } from 'react';
import { dismissAll, permissionNow, show } from '../lib/media/notifications';
import { notifiable, previewOf } from '../lib/settings/desktopNotifications';
import { useChat } from '../state/ChatProvider';
import { useT } from '../state/I18nProvider';
import { useSettings } from '../state/SettingsProvider';
import { useArrivingMessages } from '../state/useArrivingMessages';

/**
 * A reconnect pulls a backlog, so several conversations can move in one pass.
 * Three toasts is a glance; nine is a wall you clear without reading, which is
 * worse than none. The rest are still unread counts in the list, which is the
 * thing that was always going to tell you the real number.
 */
const MOST_AT_ONCE = 3;

export function DesktopNotifier() {
  const { usersById, selectChannel } = useChat();
  const { settings } = useSettings();
  const t = useT();

  useArrivingMessages((arrivals) => {
    const allowed = notifiable(arrivals, settings.notifications, {
      permission: permissionNow(),
      // Read here rather than tracked in state: it is only ever needed at this
      // exact moment, and a listener would be a subscription kept alive to
      // answer a question nobody is asking in between. The same test
      // ChatProvider uses to decide a conversation has been read.
      watching: document.hasFocus() && !document.hidden,
    });

    for (const arrival of allowed.slice(0, MOST_AT_ONCE)) {
      const author = usersById.get(arrival.message.authorId);
      show({
        // The author rather than the conversation, because for a DM they are
        // the same thing and for anything else the author is the news. Their
        // nickname if you gave them one: `User.name` already resolved that.
        title: author?.name ?? arrival.channelName,
        body:
          previewOf(arrival, settings.notifications.preview) ??
          t(arrival.mentioned ? 'notify.mentionedYou' : 'chat.newMessage'),
        tag: arrival.channelId,
        icon: author?.avatarUrl,
        onClick: () => selectChannel(arrival.channelId),
      });
    }
  });

  // Coming back to the app answers every notification it raised, whether or
  // not you read the conversation each one was about. Leaving them to be
  // cleared by hand is how a notification centre stops being read at all.
  useEffect(() => {
    const clear = () => {
      if (document.hasFocus() && !document.hidden) dismissAll();
    };
    window.addEventListener('focus', clear);
    document.addEventListener('visibilitychange', clear);
    return () => {
      window.removeEventListener('focus', clear);
      document.removeEventListener('visibilitychange', clear);
      // Unmounting means signing out or a reload. Either way the toasts are
      // about a session that no longer exists.
      dismissAll();
    };
  }, []);

  return null;
}
