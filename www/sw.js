/* Inclina — service worker: deja la app disponible sin cobertura.
   Archivos propios: red primero y copia en caché (así las actualizaciones llegan al momento).
   Las fuentes van incluidas en fonts/. */
var CACHE = 'regroupride-v0.27.0';
var SHELL = ['./', './index.html', './app.js?v=0.27.0', './lean-core.js?v=0.27.0', './geo.js?v=0.27.0', './db.js?v=0.27.0', './achievements.js?v=0.27.0', './platform.js?v=0.27.0', './manifest.webmanifest?v=0.27.0',
  './vendor/maplibre-gl.js', './vendor/maplibre-gl.css', './icon-192.png', './icon-512.png', './icon-512-maskable.png',
  './fonts/outfit-latin-wght-normal.woff2', './fonts/manrope-latin-wght-normal.woff2', './rg-lib.js?v=0.27.0', './rg-mapstyle.js?v=0.27.0', './rg-app.js?v=0.27.0', './rg-extras.js?v=0.27.0', './rg-thumbs.js?v=0.27.0', './rg-live.js?v=0.27.0', './rg-club.js?v=0.27.0', './rg-group.js?v=0.27.0', './rg-sync.js?v=0.27.0', './vendor/qrcode.js', './rg-theme.css?v=0.27.0', './rg-quedada.css?v=0.27.0', './simbolo.svg', './vendor/supabase.js'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE && k !== CACHE + '-tiles'; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (/tiles\.openfreemap\.org$/.test(url.hostname)) {
    e.respondWith(caches.open(CACHE + '-tiles').then(function (c) {
      return fetch(req).then(function (res) { if (res && res.ok) c.put(req, res.clone()); return res; }).catch(function () { return c.match(req).then(function (hit) { return hit || Response.error(); }); });
    }));
    return;
  }
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) { return hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()); });
    }));
  }
});
