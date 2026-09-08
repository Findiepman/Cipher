/**
 * The card in the corner when a message lands and you are looking elsewhere in
 * the app.
 *
 * The third sibling on `useArrivingMessages`, after the chime and the OS
 * notification, and the one that fills the gap the other two leave. The chime
 * tells you something happened but not what or who. The notification says both
 * but only when you cannot see the app. In between sits the common case, which
 * is you at the keyboard reading one conversation while another moves, and
 * until now that case had a sound and nothing to look at.
 *
 * The pairing with `DesktopNotifier` is exact and deliberate: `toastable`
 * requires `watching`, `notifiable` requires the opposite, so any given message
 * raises one or the other and never both. `messageToasts.test.ts` asserts that
 * rather than trusting it.
 *
 * Dismissal is on a timer per card rather than one timer for the stack,
 * because cards do not arrive together: a shared timer would cut a card that
 * appeared a moment ago along with one that has been sitting there five
 * seconds. Hovering the stack holds all of them, which is the one place a
 * shared rule is right, because reaching for the second card should not let
 * the first expire under the pointer.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Avatar } from './Avatar';
import type { Arrival } from '../lib/settings/desktopNotifications';
import { toastPreviewOf, toastable } from '../lib/settings/messageToasts';
import { useChat } from '../state/ChatProvider';
import { useT } from '../state/I18nProvider';
import { useSettings } from '../state/SettingsProvider';
import { useArrivingMessages } from '../state/useArrivingMessages';
import type { User } from '../types';
import '../styles/message-toast.css';

/** How long a card sits there before it fades, with nothing touching it. */
const LINGER_MS = 5000;

/**
 * A reconnect pulls a backlog, so several conversations can move at once.
 * Three is a glance; nine is a wall you dismiss without reading, which is
 * worse than none, and the unread counts in the list were always going to be
 * the honest total.
 */
const MOST_AT_ONCE = 3;

interface Toast {
  /** Unique per card. Not the channel: two messages there are two cards. */
  id: number;
  channelId: string;
  title: string;
  body: string;
  user: User | null;
}

let nextId = 0;

export function MessageToasts() {
  const { usersById, selectChannel, activeChannelId } = useChat();
  const { settings } = useSettings();
  const t = useT();

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [held, setHeld] = useState(false);

  const drop = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  useArrivingMessages((arrivals) => {
    const allowed = toastable(arrivals, settings.notifications, {
      // Read at this moment rather than tracked in state, the same way
      // DesktopNotifier does it: it is only ever needed here, and a listener
      // would be a subscription kept alive to answer a question nobody asks
      // in between.
      watching: document.hasFocus() && !document.hidden,
      activeChannelId,
    });

    const fresh = allowed.slice(0, MOST_AT_ONCE).map((arrival) => toastFrom(arrival));
    if (fresh.length > 0) {
      // Newest on top, and the stack never grows past what fits a glance.
      setToasts((current) => [...fresh.reverse(), ...current].slice(0, MOST_AT_ONCE));
    }
  });

  function toastFrom(arrival: Arrival): Toast {
    const author = usersById.get(arrival.message.authorId) ?? null;
    return {
      id: (nextId += 1),
      channelId: arrival.channelId,
      // The author, not the conversation: for a DM they are the same, and
      // anywhere else the author is the news. Their nickname if you set one,
      // which `User.name` has already resolved.
      title: author?.name ?? arrival.channelName,
      body:
        toastPreviewOf(arrival, settings.notifications.toastPreview) ??
        t(arrival.mentioned ? 'notify.mentionedYou' : 'chat.newMessage'),
      user: author,
    };
  }

  return (
    <div
      className="toasts"
      // Not aria-live: each card is a button, and a live region would read the
      // same words the screen reader is about to reach anyway.
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
    >
      {toasts.map((toast) => (
        <ToastCard
          key={toast.id}
          toast={toast}
          held={held}
          onExpire={() => drop(toast.id)}
          onOpen={() => {
            selectChannel(toast.channelId);
            drop(toast.id);
          }}
          dismissLabel={t('notify.toastDismiss')}
        />
      ))}
    </div>
  );
}

function ToastCard({
  toast,
  held,
  onExpire,
  onOpen,
  dismissLabel,
}: {
  toast: Toast;
  held: boolean;
  onExpire: () => void;
  onOpen: () => void;
  dismissLabel: string;
}) {
  const expire = useRef(onExpire);
  expire.current = onExpire;

  useEffect(() => {
    // Held restarts the countdown rather than resuming it. Simpler, and the
    // generous reading is the right one: someone who just moved the pointer
    // away has only now finished looking.
    if (held) return;
    const timer = window.setTimeout(() => expire.current(), LINGER_MS);
    return () => window.clearTimeout(timer);
  }, [held]);

  return (
    <div className="toast">
      {/* The card is the button, because "click it to go there" is the whole
          interaction and a card with one small target inside it is a worse
          version of the same thing. */}
      <button type="button" className="toast__open" onClick={onOpen}>
        {toast.user ? (
          <Avatar user={toast.user} size={36} />
        ) : (
          <div className="toast__avatar-gap" />
        )}
        <span className="toast__text">
          <span className="toast__title">{toast.title}</span>
          <span className="toast__body">{toast.body}</span>
        </span>
      </button>
      <button
        type="button"
        className="toast__dismiss"
        onClick={onExpire}
        title={dismissLabel}
        aria-label={dismissLabel}
      >
        ×
      </button>
    </div>
  );
}
