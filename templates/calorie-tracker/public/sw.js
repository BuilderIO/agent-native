// This service worker unregisters itself and clears all caches
// to fix deployment caching issues

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      // Clear all caches
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => caches.delete(cacheName))
        );
      }),
      // Unregister this service worker
      self.registration.unregister()
    ])
  );
});
