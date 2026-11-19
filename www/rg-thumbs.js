/* ReGroupRide · miniaturas con mapa de verdad en las fichas de rutas (grabadas, planificadas y de otros moteros).
   Un solo mapa escondido dibuja, de una en una, la miniatura de cada ruta que asoma en pantalla, y la guarda en el móvil
   (por ruta y por tema de día o de noche): la segunda vez sale al momento. Mientras tanto, y sin conexión, se queda el
   dibujo de siempre (solo el trazado). */
(function () {
  'use strict';
  var W = 480, H = 270, VER = 'v2', mem = {}, queue = [], busy = false, map = null, mapDark = null, loaded = null, io = null, errs = 0, tiles = 0, loadErrs = 0;
  var noop = function () {};
  function dark() {
    var t = document.documentElement.getAttribute('data-theme');
    return t === 'dark' || (t !== 'light' && !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches));
  }
  function thin(pts, n) { if (pts.length <= n) return pts; var out = [], step = (pts.length - 1) / (n - 1); for (var i = 0; i < n; i++) out.push(pts[Math.round(i * step)]); return out; }
  function sig(pts) { var a = pts[0], b = pts[pts.length - 1]; return pts.length + '_' + (+a[0]).toFixed(4) + '_' + (+a[1]).toFixed(4) + '_' + (+b[0]).toFixed(4) + '_' + (+b[1]).toFixed(4); }
  function paint(el, data) {
    if (!el || !el.isConnected) return;
    el.classList.add('rg-mapthumb');
    el.innerHTML = '<img alt="" src="' + data + '">';
    try { el.dispatchEvent(new CustomEvent('rg-thumb', { bubbles: true })); } catch (e) {}
  }
  // Trazado en violeta de marca de día y en lima de noche, sobre el mapa apagado.
  function color() { return dark() ? '#D9F21C' : '#5A2DB0'; }

  // pts: [[lon, lat], …] (uno solo = punto de salida)
  function attach(el, id, pts) {
    if (!el || !pts || !pts.length || !window.maplibregl || !window.RGMapStyle || !window.DB) return;
    pts = thin(pts.filter(function (p) { return p && isFinite(p[0]) && isFinite(p[1]); }), 200);
    if (!pts.length) return;
    var dk = dark(), k = 'thumb:' + VER + ':' + id + ':' + sig(pts) + ':' + (dk ? 'n' : 'd');
    el.dataset.tk = k;
    if (mem[k]) { paint(el, mem[k]); return; }
    DB.get(k, null).then(function (d) {
      if (el.dataset.tk !== k) return;
      if (d) { mem[k] = d; paint(el, d); return; }
      if (navigator.onLine === false) return;
      el._rgJob = { el: el, k: k, pts: pts, dk: dk };
      if (!window.IntersectionObserver) { queue.push(el._rgJob); el._rgJob = null; next(); return; }
      if (!io) io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (!e.isIntersecting) return; io.unobserve(e.target); var j = e.target._rgJob; if (j) { e.target._rgJob = null; queue.push(j); next(); } });
      }, { rootMargin: '400px 0px' });
      io.observe(el);
    }).catch(noop);
  }

  function ensure(dk) {
    if (map && mapDark === dk) return loaded;
    if (map) { try { map.remove(); } catch (e) {} map = null; }
    var box = document.getElementById('rgThumbMap');
    if (!box) { box = document.createElement('div'); box.id = 'rgThumbMap'; box.setAttribute('aria-hidden', 'true'); box.style.cssText = 'position:fixed;left:-3000px;top:0;width:' + W + 'px;height:' + H + 'px;pointer-events:none;visibility:hidden'; document.body.appendChild(box); }
    mapDark = dk;
    map = new maplibregl.Map({ container: box, style: RGMapStyle(dk), interactive: false, attributionControl: false, preserveDrawingBuffer: true, fadeDuration: 0, pixelRatio: 2 });
    errs = 0;
    map.on('error', function () { errs++; });
    map.on('data', function (e) { if (e && e.dataType === 'source' && e.tile) tiles++; });
    var m = map, col = color();
    loaded = new Promise(function (ok, no) {
      var t = setTimeout(function () { no(new Error('sin mapa')); }, 20000);
      m.once('load', function () {
        clearTimeout(t); loadErrs = errs;
        m.addSource('rgt', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({ id: 'rgt-veil', type: 'background', paint: { 'background-color': dk ? '#0F0F12' : '#FFFFFF', 'background-opacity': 0.42 } });      // mapa en tono apagado
        m.addLayer({ id: 'rgt-case', type: 'line', source: 'rgt', filter: ['==', '$type', 'LineString'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': dk ? '#0F0F12' : '#FFFFFF', 'line-width': 9 } });
        m.addLayer({ id: 'rgt-line', type: 'line', source: 'rgt', filter: ['==', '$type', 'LineString'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': col, 'line-width': 5.5 } });
        m.addLayer({ id: 'rgt-end', type: 'circle', source: 'rgt', filter: ['all', ['==', '$type', 'Point'], ['==', 'k', 'end']], paint: { 'circle-radius': 6.5, 'circle-color': dk ? '#0F0F12' : '#FFFFFF', 'circle-stroke-color': col, 'circle-stroke-width': 3.5 } });
        m.addLayer({ id: 'rgt-start', type: 'circle', source: 'rgt', filter: ['all', ['==', '$type', 'Point'], ['==', 'k', 'start']], paint: { 'circle-radius': 7.5, 'circle-color': col, 'circle-stroke-color': dk ? '#0F0F12' : '#FFFFFF', 'circle-stroke-width': 2.5 } });
        ok();
      });
    });
    loaded.catch(function () { if (map === m) { try { m.remove(); } catch (e) {} map = null; } });
    return loaded;
  }
  function render(j) {
    return ensure(j.dk).then(function () {
      errs = 0; tiles = 0;
      var line = j.pts.length > 1, f = [{ type: 'Feature', properties: { k: 'start' }, geometry: { type: 'Point', coordinates: j.pts[0] } }];
      if (line) { f.unshift({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: j.pts } }); f.push({ type: 'Feature', properties: { k: 'end' }, geometry: { type: 'Point', coordinates: j.pts[j.pts.length - 1] } }); }
      map.getSource('rgt').setData({ type: 'FeatureCollection', features: f });
      if (line) {
        var b = j.pts.reduce(function (a, p) { return [[Math.min(a[0][0], p[0]), Math.min(a[0][1], p[1])], [Math.max(a[1][0], p[0]), Math.max(a[1][1], p[1])]]; }, [[j.pts[0][0], j.pts[0][1]], [j.pts[0][0], j.pts[0][1]]]);
        map.fitBounds(b, { padding: 30, maxZoom: 14, duration: 0 });
      } else map.jumpTo({ center: j.pts[0], zoom: 10 });
      return new Promise(function (ok) { var done = false, fin = function () { if (!done) { done = true; ok(); } }; map.once('idle', fin); setTimeout(fin, 9000); map.triggerRepaint(); });
    }).then(function () {
      // Sin teselas de verdad (sin conexión o el servidor de mapas no responde) no se guarda nada: se queda el dibujo de
      // siempre y se vuelve a intentar otro día, con otro mapa.
      var srcs = Object.keys((map.getStyle() || {}).sources || {}).filter(function (k) { return k !== 'rgt'; });
      var bad = loadErrs > 0 || errs > 0 || (map.areTilesLoaded && !map.areTilesLoaded()) || (srcs.length && !tiles && !srcs.every(function (k) { return map.isSourceLoaded(k); }));
      if (bad) { if (loadErrs > 0) { try { map.remove(); } catch (e) {} map = null; } return null; }
      return map.getCanvas().toDataURL('image/jpeg', 0.74);
    });
  }
  function next() {
    if (busy) return;
    var j = queue.shift(); if (!j) return;
    if (!j.el.isConnected || j.el.dataset.tk !== j.k) { next(); return; }
    if (mem[j.k]) { paint(j.el, mem[j.k]); next(); return; }
    busy = true;
    render(j).then(function (d) {
      if (!d) return;
      mem[j.k] = d; DB.set(j.k, d).catch(noop);
      [].forEach.call(document.querySelectorAll('[data-tk="' + j.k + '"]'), function (el) { paint(el, d); });
    }).catch(noop).then(function () { busy = false; setTimeout(next, 30); });
  }
  window.RGThumbs = { attach: attach };
})();
