const CACHE = 'cialpa-seguimiento-v1.7.0';
const STATIC_ASSETS = [
  './', './index.html', './manifest.webmanifest', './version.json',
  './assets/css/app.css', './assets/js/app.js', './assets/js/api.js', './assets/js/charts.js',
  './assets/js/config.js', './assets/js/data.js', './assets/js/map.js', './assets/js/pdf-viewer.js', './assets/js/utils.js',
  './assets/data/dashboard.json', './assets/img/logo.png', './assets/img/favicon.png',
  './assets/img/icon-192.png', './assets/img/icon-512.png',
  './assets/vendor/leaflet/leaflet.css', './assets/vendor/leaflet/leaflet.js',
  './assets/vendor/lucide/lucide.min.js', './assets/vendor/chartjs/chart.umd.js',
  './assets/vendor/pdfjs/pdf.mjs', './assets/vendor/pdfjs/pdf.worker.mjs'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const networkFirst = request.mode === 'navigate' || url.pathname.endsWith('/dashboard.json') || url.pathname.endsWith('/version.json');
  if (networkFirst) {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
      return response;
    }).catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html'))));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok) caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
    return response;
  })));
});
