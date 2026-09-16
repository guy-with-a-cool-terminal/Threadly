// Minimal service worker, present only to satisfy PWA installability
// criteria (a registered service worker with a fetch handler). This app is
// a live email client backed by realtime Supabase data, so it intentionally
// does not cache anything, precache assets, or serve offline responses.
// Do not add caching logic here without checking that it can not serve
// stale inbox data.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
