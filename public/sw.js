const CACHE_NAME = '0revday-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Pass through all requests directly to the network
  event.respondWith(
    fetch(event.request).catch(() => {
      // Basic offline fallback just to satisfy PWA requirements
      return new Response('You are offline.');
    })
  );
});
