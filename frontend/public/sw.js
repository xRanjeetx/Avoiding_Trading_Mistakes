// Only shows reminder notifications and brings the app forward when one is tapped. No caching.
// A push from the server arrives here even when the app is closed.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  if (!data.title) return;
  event.waitUntil(
    self.registration.showNotification(data.title, { body: data.body || "", tag: data.tag, icon: "/icon.svg", badge: "/icon.svg" }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list[0];
      return open ? open.focus() : self.clients.openWindow("/");
    }),
  );
});
