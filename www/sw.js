/* Inclina — service worker: deja la app disponible sin cobertura.
   Archivos propios: red primero y copia en caché (así las actualizaciones llegan al momento).
   Las fuentes van incluidas en fonts/. */
var CACHE = 'regroupride-v0.60.8';
var SHELL = ['./', './index.html', './app.js?v=0.60.8', './lean-core.js?v=0.60.8', './geo.js?v=0.60.8', './db.js?v=0.60.8', './achievements.js?v=0.60.8', './platform.js?v=0.60.8', './manifest.webmanifest?v=0.60.8',
  './vendor/maplibre-gl.js', './vendor/maplibre-gl.css', './icon-192.png', './icon-512.png', './icon-512-maskable.png',
  './fonts/outfit-latin-wght-normal.woff2', './fonts/manrope-latin-wght-normal.woff2', './rg-lib.js?v=0.60.8', './rg-mapstyle.js?v=0.60.8', './rg-app.js?v=0.60.8', './rg-extras.js?v=0.60.8', './rg-creador.js?v=0.60.8', './rg-art.js?v=0.60.8', './rg-crop.js?v=0.60.8', './rg-tour.js?v=0.60.8', './rg-trips.js?v=0.60.8', './rg-photo.js?v=0.60.8', './rg-lean.js?v=0.60.8', './rg-groups.js?v=0.60.8', './rg-shell.js?v=0.60.8', './rg-solo.js?v=0.60.8', './rg-open.js?v=0.60.8', './rg-road.js?v=0.60.8', './rg-garage.js?v=0.60.8', './rg-social.js?v=0.60.8', './rg-offline.js?v=0.60.8', './rg-oauth.js?v=0.60.8', './rg-routes.js?v=0.60.8', './rg-ui.js?v=0.60.8', './rg-share.js?v=0.60.8', './portada.svg', './rg-i18n.js?v=0.60.8', './rg-i18n-en.js?v=0.60.8', './rg-asfalto.css?v=0.60.8', './creador.jpg', './creador-moto.jpg', './rg-thumbs.js?v=0.60.8', './rg-live.js?v=0.60.8', './rg-club.js?v=0.60.8', './rg-group.js?v=0.60.8', './rg-sync.js?v=0.60.8', './vendor/qrcode.js', './rg-theme.css?v=0.60.8', './rg-quedada.css?v=0.60.8', './rg-plano.css?v=0.60.8', './fonts/barlow-semi-condensed-latin-600-normal.woff2', './fonts/barlow-semi-condensed-latin-700-normal.woff2', './fonts/barlow-condensed-latin-500-normal.woff2', './fonts/barlow-condensed-latin-600-normal.woff2', './fonts/barlow-condensed-latin-700-normal.woff2', './simbolo.svg', './vendor/supabase.js'];

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
