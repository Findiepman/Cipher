/**
 * "A message just landed", as a hook, once.
 *
 * Two things react to an arriving message and they want different answers to
 * it: the chime plays a sound, the notifier tells the operating system. What
 * they share is the awkward part, which is *noticing*. It is written as a
 * watcher over the history this device already holds rather than as a hook
 * inside the transport, because "a message arrived" is a UI event and the
 * transport has enough jobs.
 *
 * Two rules live here rather than in either caller, because getting them
 * wrong in one place and not the other is how the app ends up chiming without
 * notifying, or notifying twice:
 *
 *   - A conversation is primed the first time any message in it is seen, and
 *     that first sight is never an arrival. Priming per conversation rather
 *     than on the first pass matters, because histories do not all land at
 *     once: the list of conversations arrives before any of their messages,
 *     and a backlog is pulled when you first open one. A watcher primed once
 *     at the start would call every one of those an arrival, which is a
 *     chime for a message from last Tuesday and, worse, a notification for
 *     it if you happened to alt-tab away while the app was loading.
 *   - A message this device sent keeps its clientId when the server assigns
 *     the real id, so the newest message is keyed on that. Without it the
 *     acknowledgement counts as a second arrival and everything happens twice.
 *
 * What this costs, stated plainly: the very first message in a conversation
 * this device has never seen is silent, because it is indistinguishable here
 * from a backlog. Fixing that properly means noticing arrivals in
 * `chatStore`, which already tells `backlog` apart from live delivery, rather
 * than by diffing the history afterwards. That is the right home for this and
 * a bigger change than it looks.
 *
 * Everything else, including whether you are looking at the conversation, is
 * the caller's to decide: the chime and the notification genuinely disagree
 * about that one.
 */
import { useEffect, useRef } from 'react';
import { mentions } from '../components/MessageList';
import type { Arrival } from '../lib/settings/desktopNotifications';
import { useChat } from './ChatProvider';

export function useArrivingMessages(onArrive: (arrivals: Arrival[]) => void): void {
  const { channels, messagesFor, self } = useChat();

  /* The newest callback, so the effect can depend on the messages alone. A
     caller that closes over settings would otherwise re-run this on every
     preference change, and re-running it is not free: it walks every
     conversation. Reading through the ref keeps the settings current anyway,
     because it is read at the moment something arrives. */
  const latest = useRef(onArrive);
  latest.current = onArrive;

  /**
   * Newest message per channel, as of the last pass. A channel absent from
   * this map has never been seen with a message in it, which is what makes
   * priming per conversation rather than per pass.
   */
  const seen = useRef(new Map<string, string>());

  // A cheap signature of "what is newest everywhere", so the effect runs when
  // that changes and not on every unrelated re-render.
  const newest = channels
    .map((channel) => `${channel.id}:${messagesFor(channel.id).at(-1)?.id ?? ''}`)
    .join('|');

  useEffect(() => {
    const arrivals: Arrival[] = [];

    for (const channel of channels) {
      const last = messagesFor(channel.id).at(-1);
      if (!last) continue;

      const key = last.clientId ?? last.id;
      const previous = seen.current.get(channel.id);
      seen.current.set(channel.id, key);

      // Never seen with anything in it before: this is a history landing, not
      // a message arriving.
      if (previous === undefined) continue;
      if (previous === key) continue;

      arrivals.push({
        channelId: channel.id,
        channelName: channel.name,
        message: last,
        own: last.authorId === self?.id,
        // Kept here so both callers agree on what counts as being named.
        mentioned: self ? mentions(last, self.name) : false,
      });
    }

    if (arrivals.length > 0) latest.current(arrivals);
  }, [newest, channels, messagesFor, self]);
}
