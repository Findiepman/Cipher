/**
 * The service worker, and today it does exactly one job: show notifications.
 *
 * It exists because of a rule that is easy to miss. Chrome on Android refuses
 * `new Notification()` outright, with an Illegal constructor, and a
 * notification there may only be raised through a registration. So on a phone
 * the app was not "not notifying", it was structurally incapable of it, and no
 * amount of permission granting would have changed that.
 *
 * What this is NOT is push. Push is notifications while the app is closed, and
 * it needs a VAPID keypair, a subscription table and a server that calls out
 * to Google or Apple. None of that exists, and none of it is needed for this:
 * a registration can show a notification whenever the page asks it to, which
 * covers the case that actually matters day to day, the app open behind
 * something else. The two were described as one piece of work in
 * lib/media/notifications.ts and they are not.
 *
 * Deliberately no fetch handler. A service worker that caches would start
 * serving a stale app the moment it is registered, which is a large and
 * surprising behaviour change to acquire as a side effect of wanting a popup.
 */

// Take over as soon as installed rather than waiting for every tab to close,
// so a first visit gets notifications without a reload.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'notify') return;

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body ?? undefined,
      tag: data.tag,
      icon: data.icon || '/logo.png',
      // The app plays its own sound, chosen per person. Without this the OS
      // adds one of its own and you hear both.
      silent: true,
      data: { tag: data.tag },
    }),
  );
});

/**
 * Clicking one focuses the app rather than opening a second copy of it, which
 * is what a notification for a chat should do.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow('/');
    }),
  );
});
