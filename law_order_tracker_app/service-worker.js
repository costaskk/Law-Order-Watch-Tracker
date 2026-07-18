const CACHE_VERSION = 'wolf-v4-20260718-v402';
const CORE_CACHE = `${CACHE_VERSION}-core`;
const DATA_CACHE = `${CACHE_VERSION}-data`;
const CORE_ASSETS = [
  './', './index.html', './styles.css', './app.js', './manifest.webmanifest',
  './data/show_themes.js', './data/wolf_artwork_base.js',
  './assets/wolf-favicon.svg', './assets/wolf-icon-192.png', './assets/wolf-icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CORE_CACHE).then(cache => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => !key.startsWith(CACHE_VERSION)).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (_) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw _;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const update = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => cached);
  return cached || update;
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (url.pathname.includes('/data/episodes.json') || url.pathname.includes('/data/wolf_cast_index.json') || url.pathname.includes('/data/wolf_episode_artwork.json')) {
    event.respondWith(networkFirst(event.request, DATA_CACHE));
    return;
  }
  if (url.pathname.includes('/assets/') || url.pathname.endsWith('.css') || url.pathname.endsWith('.js')) {
    event.respondWith(staleWhileRevalidate(event.request, CORE_CACHE));
    return;
  }
  if (event.request.mode === 'navigate') event.respondWith(networkFirst(event.request, CORE_CACHE));
});
