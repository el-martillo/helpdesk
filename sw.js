const CACHE_NAME = 'elmartillo-helpdesk-v2';

// Assets to pre-cache on install.
// HTML files are intentionally excluded — they must always be fetched
// fresh from the network so JS/CSS fixes take effect immediately.
const PRECACHE_URLS = [
  '/helpdesk/logo.png',
  '/helpdesk/favicon.ico',
  '/helpdesk/manifest.json',
];

// Install — pre-cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// Activate — delete old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetch strategy:
// - Supabase API calls → network only (never cache auth/data)
// - Google fonts/CDN → cache first
// - Everything else → network first, fall back to cache
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never intercept Supabase, reCAPTCHA, or Google Analytics
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('google.com') ||
    url.hostname.includes('googletagmanager.com') ||
    url.hostname.includes('googleapis.com')
  ) {
    return;
  }

  // Cache-first for Google Fonts and CDN assets
  if (
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('cdn.jsdelivr.net')
  ) {
    event.respondWith(
      caches.match(event.request).then(cached =>
        cached || fetch(event.request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
      )
    );
    return;
  }

  // Network-first for everything else (HTML, CSS, images)
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
