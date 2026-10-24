const CACHE = 'anime-rank-mobile-v1';
const APP_SHELL = ['/', '/manifest.webmanifest'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || event.request.url.includes('/ws')) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
