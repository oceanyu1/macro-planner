// Minimal service worker: makes the app installable. Network-only on purpose,
// so you never see a stale plan. Push reminders (phase 4) will hook in here.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
