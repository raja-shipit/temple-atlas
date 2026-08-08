// Minimal offline shell caching — spec Section 7: "Consider caching the app
// shell and already-loaded temple data for offline/low-connectivity use...
// arguably closer to the core use case than the trip planner" given rural
// temple sites often have poor signal.
//
// This is intentionally basic: cache the app shell on install, fall back to
// cache on network failure. It does NOT yet cache map tiles or Supabase API
// responses — that's the next layer to add once the data layer is live.
const CACHE_NAME = "temple-atlas-shell-v1";
const SHELL_ASSETS = ["/", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
