/**
 * Service worker — receives Web Push messages and shows OS notifications on
 * the desktop / phone even when the app tab is closed. Clicking a
 * notification focuses (or opens) the app at the notification's link.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* non-JSON payload */ }
  const title = data.title || 'Update';
  const options = {
    body: data.body || '',
    data: { link: data.link || '/' },
    icon: '/favicon.ico',
    badge: '/favicon.ico',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const win of wins) {
        if ('focus' in win) {
          win.focus();
          if ('navigate' in win) win.navigate(link);
          return;
        }
      }
      return clients.openWindow(link);
    })
  );
});
