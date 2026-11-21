/* Inclina v2 — grabador de rutas con inclinación real.
   Secciones: arranque · tema · indicadores · sensores · GPS · mapa · grabación · render · vistas ·
   rutas · detalle y reproducción · estadísticas · garaje · ajustes · simulación. */
(function () {
  'use strict';
  var APP_VERSION = '0.40.0';
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var clamp = function (x, lo, hi) { return Math.max(lo, Math.min(hi, x)); };
  var IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  window.addEventListener('error', function (e) {
    try { var n = document.getElementById('toast'); n.textContent = 'Error (v' + APP_VERSION + '): ' + (e.message || e); n.className = 'toast notice bad'; n.hidden = false; } catch (x) {}
  });
  if (typeof LeanCore === 'undefined' || typeof Platform === 'undefined' || typeof Geo === 'undefined' || typeof DB === 'undefined') throw new Error('faltan archivos de la app (versión antigua en caché)');
  var HAS_MAP = typeof maplibregl !== 'undefined';

  /* ---------- ajustes (localStorage: pequeños y síncronos) ---------- */
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  var settings = Object.assign({ invert: false, vMin: 15, minPeak: 10, theme: 'auto', gyroGain: 1, gyroGainSrc: 'web', voice: false, autoPause: false, autoStart: false, follow: true, headingUp: false, colorMode: 'lean' }, LS.get('inclina.settings', {}));
  // La voz y la pausa automática vienen apagadas. En las instalaciones anteriores venían encendidas: se apagan una vez
  // (quien las quiera las vuelve a encender en Ajustes y ya se quedan así).
  if (!settings.defaultsOff) { settings.voice = false; settings.autoPause = false; settings.defaultsOff = 1; LS.set('inclina.settings', settings); }
  var MOTION_SRC = Platform.hasNativeMotion() ? 'native' : 'web';
  if (settings.gyroGainSrc !== MOTION_SRC) { settings.gyroGain = 1; settings.gyroGainSrc = MOTION_SRC; }
  var calib = LS.get('inclina.calib', null);
  function saveSettings() { LS.set('inclina.settings', settings); }
  function isDark() { return settings.theme === 'dark' || (settings.theme === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); }
  function applyTheme() {
    if (settings.theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', settings.theme);
    if (map) setMapStyle(map); if (dmap) setMapStyle(dmap, true);
  }
  applyTheme();
  if (window.matchMedia) { try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { if (settings.theme === 'auto') applyTheme(); }); } catch (e) {} }

  /* ---------- datos en memoria ---------- */
  var rides = [], vehicles = [];

  /* ---------- utilidades de formato ---------- */
  function fmtTime(ms) { var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60; return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0'); }
  function fmtClockS(ms) { return fmtTime(ms).replace(/^00:/, ''); }
  function fmtDur(ms) { var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); if (!h && !m) return s + ' s'; return h ? h + ' h ' + String(m).padStart(2, '0') + ' min' : m + ' min'; }
  function fmtKm(km, d) { return (km || 0).toFixed(d == null ? 1 : d).replace('.', ',') + ' km'; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function fmtDate(ts) { var d = new Date(ts); return cap(d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\.|,/g, '')); }
  function fmtDateLong(ts) { var d = new Date(ts); return cap(d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })); }
  function fmtClock(ts) { return new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }); }
  function monthName(y, m) { return cap(new Date(y, m, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function rideTitle(r) { return r.name ? r.name : fmtDate(r.start); }

  /* ---------- indicadores (SVG) ---------- */
  var NS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function makeGauge(container, mini) {
    var CX = 190, CY = mini ? 200 : 222, R = mini ? 150 : 160, EDGE = 64, SPAN = 60;
    var svg = el('svg', { viewBox: mini ? '0 0 380 232' : '0 0 380 178' });
    function pt(a, r) { var k = a * Math.PI / 180; return [CX + r * Math.sin(k), CY - r * Math.cos(k)]; }
    function arc(r, a0, a1) { var p0 = pt(a0, r), p1 = pt(a1, r); return 'M' + p0[0].toFixed(1) + ' ' + p0[1].toFixed(1) + ' A' + r + ' ' + r + ' 0 0 ' + (a1 > a0 ? 1 : 0) + ' ' + p1[0].toFixed(1) + ' ' + p1[1].toFixed(1); }
    svg.appendChild(el('path', { 'class': 'track', d: arc(R, -EDGE, EDGE) }));
    var fill = el('path', { 'class': 'fill', d: '' }); svg.appendChild(fill);
    for (var a = -SPAN; a <= SPAN; a += (mini ? 30 : 10)) {
      var major = a % 30 === 0, o = pt(a, R - 13), i = pt(a, R - (major ? 30 : 23));
      svg.appendChild(el('line', { 'class': 'tick' + (major ? ' major' : ''), x1: o[0].toFixed(1), y1: o[1].toFixed(1), x2: i[0].toFixed(1), y2: i[1].toFixed(1) }));
      if (major && !mini) { var lp = pt(a, R - 46); var t = el('text', { 'class': 'tlabel', x: lp[0].toFixed(1), y: (lp[1] + 6).toFixed(1), 'text-anchor': 'middle' }); t.textContent = Math.abs(a); svg.appendChild(t); }
    }
    var lL = el('path', { 'class': 'mark last l', d: '' }), lR = el('path', { 'class': 'mark last r', d: '' }); svg.appendChild(lL); svg.appendChild(lR);
    var mL = el('path', { 'class': 'mark l', d: '' }), mR = el('path', { 'class': 'mark r', d: '' }); svg.appendChild(mL); svg.appendChild(mR);
    var needle = el('line', { 'class': 'needle', x1: CX, y1: CY - R - 20, x2: CX, y2: CY - R + 20 }); svg.appendChild(needle);
    var num = null; if (mini) { num = el('text', { 'class': 'num', x: CX, y: CY - 6 }); num.textContent = '0°'; svg.appendChild(num); }
    container.innerHTML = ''; container.appendChild(svg);
    function markPath(a) { if (!(Math.abs(a) > 0.5)) return ''; var tip = pt(a, R + 18), b1 = pt(a - 3.2, R + 40), b2 = pt(a + 3.2, R + 40); return 'M' + tip[0].toFixed(1) + ' ' + tip[1].toFixed(1) + ' L' + b1[0].toFixed(1) + ' ' + b1[1].toFixed(1) + ' L' + b2[0].toFixed(1) + ' ' + b2[1].toFixed(1) + ' Z'; }
    var last = {};
    return function update(phi, maxL, maxR, lastL, lastR) {
      lastL = lastL || 0; lastR = lastR || 0;
      var c = clamp(phi, -EDGE, EDGE), key = c.toFixed(1) + '|' + maxL.toFixed(0) + '|' + maxR.toFixed(0) + '|' + lastL.toFixed(0) + '|' + lastR.toFixed(0);
      if (last.k === key) return; last.k = key;
      lL.setAttribute('d', Math.abs(lastL - maxL) < 0.5 ? '' : markPath(-Math.min(lastL, EDGE))); lR.setAttribute('d', Math.abs(lastR - maxR) < 0.5 ? '' : markPath(Math.min(lastR, EDGE)));
      fill.setAttribute('d', Math.abs(c) < 0.5 ? '' : arc(R, 0, c)); fill.setAttribute('class', 'fill' + (c > 0 ? ' r' : ''));
      var n1 = pt(c, R - 20), n2 = pt(c, R + 20);
      needle.setAttribute('x1', n1[0].toFixed(1)); needle.setAttribute('y1', n1[1].toFixed(1)); needle.setAttribute('x2', n2[0].toFixed(1)); needle.setAttribute('y2', n2[1].toFixed(1));
      mL.setAttribute('d', markPath(-Math.min(maxL, EDGE))); mR.setAttribute('d', markPath(Math.min(maxR, EDGE)));
      if (num) num.textContent = Math.round(Math.abs(phi)) + '°';
    };
  }
  var gaugeFull = makeGauge($('#gaugeFull'), false), gaugeMini = makeGauge($('#gaugeMini'), true);

  /* ---------- sensores y estimador ---------- */
  var est = LeanCore.createEstimator({ invert: settings.invert, gyroGain: settings.gyroGain });
  var det = LeanCore.createCornerDetector({ minPeak: settings.minPeak });
  if (calib && calib.up) est.setFrame(LeanCore.buildFrame(calib.up), calib.bias, calib.kind || 'manual');
  est.setOnGain(function (g) { settings.gyroGain = g; settings.gyroGainSrc = MOTION_SRC; saveSettings(); });
  est.setOnFrame(function (f) { if (sens.demo) return; var first = !calib; calib = { up: f.up, bias: f.bias, at: Date.now(), kind: f.kind }; LS.set('inclina.calib', calib); if (first) hideNotice(); });
  var sens = { gyro: false, lastMotion: 0, lastGps: 0, speedKmh: null, speedMs: null, heading: null, gpsAcc: null, listening: false, nativeStop: null, gpsError: null, demo: false, rate: 0, src: MOTION_SRC, fix: null };
  var lastMotionT = null, rateCount = 0, rateT0 = 0, lastNativeTs = null;
  var live = { phi: 0, source: 'gyro', leanMaxSinceFix: 0, lastL: 0, lastR: 0, curSide: 0, curPeak: 0 };
  // "Última": pico de la curva en curso o de la última acabada, por lado. Empieza a 6°, acaba por debajo de 3°.
  function trackLast(phi) {
    var a = Math.abs(phi), side = phi < 0 ? -1 : 1;
    if (live.curSide === 0) { if (a >= 6) { live.curSide = side; live.curPeak = a; } }
    else if (side === live.curSide) { if (a > live.curPeak) live.curPeak = a; if (a < 3) live.curSide = 0; }
    else if (a >= 6) { live.curSide = side; live.curPeak = a; }
    else if (a < 3) live.curSide = 0;
    if (live.curSide < 0) live.lastL = live.curPeak; else if (live.curSide > 0) live.lastR = live.curPeak;
  }
  function resetLast() { live.lastL = 0; live.lastR = 0; live.curSide = 0; live.curPeak = 0; }

  function handleSample(acc, rot, now, dtOverride) {
    var dt = dtOverride != null ? dtOverride : (lastMotionT == null ? 0 : (now - lastMotionT) / 1000);
    lastMotionT = now; sens.lastMotion = now; sens.gyro = !!rot;
    rateCount++; if (now - rateT0 > 1000) { sens.rate = rateCount * 1000 / (now - rateT0); rateCount = 0; rateT0 = now; }
    var s = est.update(acc, rot, dt, now);
    live.phi = s.phi; live.source = s.source;
    if (s.ready) trackLast(!rec || leanCounts(now) ? s.phi : 0);
    if (Math.abs(s.phi) > live.leanMaxSinceFix) live.leanMaxSinceFix = Math.abs(s.phi);
    if (rec) recFeed(s.phi, now);
  }
  function onMotion(e) {
    if (sens.demo) return;
    var a = e.accelerationIncludingGravity, g = e.rotationRate, acc = null, rot = null;
    if (a && a.x != null) acc = IOS ? [-a.x, -a.y, -a.z] : [a.x, a.y, a.z];
    if (g && g.beta != null) rot = [g.beta, g.gamma, g.alpha];
    handleSample(acc, rot, performance.now());
  }
  function onNativeBatch(data) {
    if (sens.demo) return;
    var now = performance.now(), ss = data.samples, n = ss.length;
    for (var i = 0; i < n; i++) {
      var q = ss[i], ts = q[6], dt = lastNativeTs == null ? 0 : (ts - lastNativeTs) / 1000; lastNativeTs = ts;
      handleSample([q[0], q[1], q[2]], q[3] == null ? null : [q[3], q[4], q[5]], now - (n - 1 - i) * 5, dt);
    }
  }
  function startMotion() {
    return new Promise(function (resolve) {
      if (Platform.hasNativeMotion()) {
        if (!sens.listening) { sens.nativeStop = Platform.startNativeMotion(onNativeBatch, 200); sens.listening = !!sens.nativeStop; }
        resolve(sens.listening ? 'ok' : 'unsupported'); return;
      }
      if (typeof DeviceMotionEvent === 'undefined') { resolve('unsupported'); return; }
      var attach = function () { if (!sens.listening) { window.addEventListener('devicemotion', onMotion); sens.listening = true; } resolve('ok'); };
      if (typeof DeviceMotionEvent.requestPermission === 'function') DeviceMotionEvent.requestPermission().then(function (r) { if (r === 'granted') attach(); else resolve('denied'); }, function () { resolve('denied'); });
      else attach();
    });
  }
  // Los sensores se encienden al abrir la app, sin esperar a pulsar nada ni a que cargue el resto: cuando se
  // abre el inclinómetro o empieza la ruta ya hay referencia y ángulo. (En iPhone el navegador exige un toque.)
  if (Platform.hasNativeMotion() || (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission !== 'function')) startMotion();

  /* ---------- GPS ---------- */
  var gpsStop = null, gpsMode = null, lastFix = null, autoStartSince = null;
  function onFix(pos) {
    var c = pos.coords, now = performance.now();
    sens.lastGps = now; sens.gpsError = null; sens.gpsAcc = c.accuracy;
    var v = c.speed;
    if ((v == null || isNaN(v)) && lastFix && c.accuracy < 40) { var d = Geo.dist(lastFix.lat, lastFix.lon, c.latitude, c.longitude), dtp = (pos.timestamp - lastFix.ts) / 1000; if (dtp > 0.5) v = d / dtp; }
    if (v != null && !isNaN(v)) { sens.speedMs = v; sens.speedKmh = v * 3.6; est.setSpeed(v, now); }
    if (c.heading != null && !isNaN(c.heading) && v > 1.5) sens.heading = c.heading;
    else if (lastFix && v > 1.5 && Geo.dist(lastFix.lat, lastFix.lon, c.latitude, c.longitude) > 5) sens.heading = Geo.bearing(lastFix.lat, lastFix.lon, c.latitude, c.longitude);
    var fix = { lat: c.latitude, lon: c.longitude, ts: pos.timestamp || Date.now(), acc: c.accuracy, alt: (c.altitude != null && !isNaN(c.altitude)) ? c.altitude : null, v: (v != null && !isNaN(v)) ? v : null };
    sens.fix = fix;
    if (rec) recFix(fix, lastFix);
    else if (settings.autoStart && currentView === 'map' && !demoTimer && calib) {
      if (sens.speedKmh != null && sens.speedKmh > 20) { if (autoStartSince == null) autoStartSince = now; else if (now - autoStartSince > 5000) { autoStartSince = null; startRide(true); } }
      else autoStartSince = null;
    }
    lastFix = fix; rememberFix(fix);
    updatePosition(fix);
    if (window.RGNav) RGNav.onFix(fix);
    if (!sens.demo) maybeFetchWeather(fix);
    if (parkOpen && (now - (prev.parkT || 0)) > 3000) { prev.parkT = now; renderParkCard(); }
  }
  // Última posición conocida: se guarda para abrir el mapa donde estabas, sin esperar al GPS.
  var savedFix = LS.get('rg.lastFix', null), savedFixAt = 0;
  function rememberFix(fix) { var t = Date.now(); if (t - savedFixAt < 15000) return; savedFixAt = t; LS.set('rg.lastFix', { lat: Math.round(fix.lat * 1e5) / 1e5, lon: Math.round(fix.lon * 1e5) / 1e5, t: t }); }
  function onFixError(err) { sens.gpsError = err && err.code === 1 ? 'denegado' : (err && err.code === 0 ? 'no disponible' : 'sin señal'); }
  function startGps(mode) {
    if (gpsMode === mode) return;
    stopGps();
    gpsMode = mode;
    gpsStop = mode === 'bg' ? Platform.watchPositionBackground(onFix, onFixError, { title: 'ReGroupRide está siguiendo tu ruta', message: 'Toca Parar en la app cuando acabes.' }) : Platform.watchPosition(onFix, onFixError);
  }
  function stopGps() { if (gpsStop) { try { gpsStop(); } catch (e) {} } gpsStop = null; gpsMode = null; }

  /* ---------- mapa ---------- */
  var map = null, dmap = null, posMarker = null, mapReady = false, liveFeatures = [], mapFollow = settings.follow !== false;
  // El mapa lleva estilo propio (rg-mapstyle.js, Dirección A): no hay que descargar nada para montarlo.
  function fallbackStyle() { return { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': isDark() ? '#1E2226' : '#F2EFE9' } }] }; }
  function loadStyle() { var st; try { st = window.RGMapStyle ? window.RGMapStyle(isDark()) : fallbackStyle(); } catch (e) { st = fallbackStyle(); } return Promise.resolve(st); }
  function setMapStyle(m, isDetail) { loadStyle().then(function (st) { m.setStyle(st); m.once('style.load', function () { if (isDetail) { if (detailTrack) drawDetailTrack(); } else drawLiveTrack(true); }); }); }
  function addTrackLayers(m, prefix) {
    if (m.getSource(prefix + '-track')) return;
    m.addSource(prefix + '-track', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({ id: prefix + '-track-casing', type: 'line', source: prefix + '-track', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.55 } });
    m.addLayer({ id: prefix + '-track-line', type: 'line', source: prefix + '-track', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 5 } });
  }
  function initMap() {
    if (!HAS_MAP || map) return;
    loadStyle().then(function (st) {
      var c0 = lastFix || quickFix || savedFix;
      map = new maplibregl.Map({ container: 'map', style: st, center: c0 ? [c0.lon, c0.lat] : [-3.7, 40.4], zoom: c0 ? (c0.acc && c0.acc > 300 ? 12 : 15) : 5, attributionControl: false, pitchWithRotate: false, touchPitch: false });
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'top-left');
    // el crédito del mapa sale recogido (una «i» que se abre al tocarla) y fuera de la barra de pestañas
    function tidyAttrib() { var cr = document.querySelector('#map .maplibregl-ctrl-attrib'); if (cr) { cr.classList.remove('maplibregl-compact-show'); cr.removeAttribute('open'); } }
      map.on('load', function () { mapReady = true; tidyAttrib(); map.once('idle', tidyAttrib); addTrackLayers(map, 'live'); addExtraLayers(map); drawLiveTrack(true); refreshMine(); drawPlan(); drawParking(); if (lastFix) { if (mapFollow) map.jumpTo({ center: [lastFix.lon, lastFix.lat], zoom: 15 }); updatePosition(lastFix); } else showQuick(); });
      map.on('style.load', function () { if (mapReady) { addTrackLayers(map, 'live'); addExtraLayers(map); refreshMine(); drawPlan(); } });
      map.on('click', function (e) { if (planMode) addWaypoint(e.lngLat.lat, e.lngLat.lng); });
      map.on('dragstart', function () { setFollow(false); });
      map.on('error', function () {});
      var pe = document.createElement('div'); pe.className = 'pos-marker';
      pe.innerHTML = '<svg viewBox="0 0 34 34"><circle class="halo" cx="17" cy="17" r="15"/><path class="arrow" d="M17 5l8 20-8-5-8 5z" stroke-width="2.2" stroke-linejoin="round"/></svg>';
      posMarker = new maplibregl.Marker({ element: pe, rotationAlignment: 'map' });
      // la posición sale ya (la exacta si ha llegado; si no, la última conocida, atenuada), sin esperar al dibujo del mapa
      if (lastFix) updatePosition(lastFix); else showQuick();
    });
  }
  // Posición rápida (la última que conoce el teléfono, aunque sea aproximada): centra el mapa mientras llega el GPS bueno.
  var quickFix = null;
  function showQuick() {
    var q = quickFix || savedFix;
    if (!q || lastFix || !map || !posMarker) return;
    // mismo zoom que tendrá con el GPS (15), para no cargar dos veces el mapa; solo se aleja si la posición es muy imprecisa
    var z = q.acc && q.acc > 300 ? 12 : 15, c = map.getCenter();
    if (Math.abs(c.lat - q.lat) > 1e-5 || Math.abs(c.lng - q.lon) > 1e-5 || Math.abs(map.getZoom() - z) > 0.01) map.jumpTo({ center: [q.lon, q.lat], zoom: z });
    if (posMarker) { posMarker.getElement().classList.add('approx'); posMarker.setLngLat([q.lon, q.lat]); if (!posMarker._added) { posMarker.addTo(map); posMarker._added = true; } }
  }
  function askQuick() { Platform.quickPosition(function (pos) { if (!pos || !pos.coords) return; if (lastFix && Date.now() - lastFix.ts < 20000) return; quickFix = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy, at: Date.now() }; if (lastFix) staleShow(); else showQuick(); }); }
  // Al volver a la app con la posición vieja: se enseña ya la que tenga el teléfono (aproximada) mientras el GPS vuelve a coger señal.
  function staleShow() { if (!quickFix || !map || !posMarker || rec) return; posMarker.getElement().classList.add('approx'); posMarker.setLngLat([quickFix.lon, quickFix.lat]); if (mapFollow && currentView === 'map' && mapReady) map.easeTo({ center: [quickFix.lon, quickFix.lat], duration: 500 }); }
  askQuick();
  // Vigilante del GPS: si a los pocos segundos de pedirlo no ha llegado ninguna posición (pasa al abrir en frío o al volver de
  // segundo plano), se vuelve a pedir la rápida y se reinicia la escucha, en vez de quedarse esperando.
  var gpsKicks = 0;
  function gpsCheck() {
    if (rec || sens.demo || gpsMode !== 'fg' || document.visibilityState === 'hidden') return;
    var age = sens.lastGps ? performance.now() - sens.lastGps : Infinity;
    if (age < 7000) { gpsKicks = 0; return; }
    askQuick();
    if (gpsKicks < 3) { gpsKicks++; stopGps(); startGps('fg'); }
  }
  setTimeout(gpsCheck, 6000); setInterval(gpsCheck, 12000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState !== 'visible' || rec) return; gpsKicks = 0; askQuick(); setTimeout(gpsCheck, 5000); });
  function setFollow(on) { mapFollow = on; settings.follow = on; saveSettings(); $('#btnFollow').setAttribute('aria-pressed', String(on)); if (on && lastFix) updatePosition(lastFix, true); }
  $('#btnFollow').addEventListener('click', function () { setFollow(!mapFollow); });
  $('#btnHeading').addEventListener('click', function () { settings.headingUp = !settings.headingUp; saveSettings(); $('#btnHeading').setAttribute('aria-pressed', String(settings.headingUp)); if (map && !settings.headingUp) map.easeTo({ bearing: 0 }); });
  if (settings.headingUp) { settings.headingUp = false; saveSettings(); }   // la brújula ya no está en el menú: el mapa vuelve a ir con el norte arriba
  $('#btnHeading').setAttribute('aria-pressed', String(!!settings.headingUp)); $('#btnFollow').setAttribute('aria-pressed', String(mapFollow));
  var firstFixCentered = false;
  function updatePosition(fix, force) {
    if (!map || !posMarker) return;
    if (posMarker) { posMarker.getElement().classList.remove('approx'); posMarker.setLngLat([fix.lon, fix.lat]); if (!posMarker._added) { posMarker.addTo(map); posMarker._added = true; } if (sens.heading != null) posMarker.setRotation(sens.heading - (settings.headingUp ? map.getBearing() : 0) + (settings.headingUp ? map.getBearing() : 0)); }
    if (!firstFixCentered) { firstFixCentered = true; var c0 = map.getCenter(); if (Math.abs(c0.lat - fix.lat) > 1e-5 || Math.abs(c0.lng - fix.lon) > 1e-5 || Math.abs(map.getZoom() - 15) > 0.01) map.jumpTo({ center: [fix.lon, fix.lat], zoom: 15 }); return; }
    if (!mapReady) return;      // mientras carga el mapa: solo se coloca el marcador; la cámara se pone al día al cargar
    if (mapFollow && (currentView === 'map')) {
      var opts = { center: [fix.lon, fix.lat], duration: force ? 300 : 900, easing: function (t) { return t; } };
      if (settings.headingUp && sens.heading != null) opts.bearing = sens.heading;
      if (rec && map.getZoom() < 14) opts.zoom = 15;
      // Parado (el GPS repite la misma posición cada segundo): no se mueve la cámara ni se redibuja el mapa.
      var cc = map.getCenter();
      if (!force && opts.bearing == null && opts.zoom == null && !map.isMoving() && Math.abs(cc.lat - fix.lat) < 5e-6 && Math.abs(cc.lng - fix.lon) < 5e-6) return;
      map.easeTo(opts);
    }
  }
  function drawLiveTrack(full) {
    if (!map || !mapReady || !map.getSource('live-track')) return;
    map.getSource('live-track').setData({ type: 'FeatureCollection', features: liveFeatures });
  }

  /* ---------- capas extra del mapa: mis rutas y ruta planificada ---------- */
  var EMPTY_FC = { type: 'FeatureCollection', features: [] }, mineCache = null, mineDirty = true;
  function addExtraLayers(m) {
    if (!m.getSource('mine')) {
      m.addSource('mine', { type: 'geojson', data: EMPTY_FC });
      m.addLayer({ id: 'mine-line', type: 'line', source: 'mine', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#1D5FCC', 'line-width': 3, 'line-opacity': 0.5 } }, 'live-track-casing');
    }
    if (!m.getSource('plan')) {
      m.addSource('plan', { type: 'geojson', data: EMPTY_FC });
      var ink = isDark() ? '#E8EDF2' : '#0E141B', fillet = isDark() ? '#0B0F14' : '#FFFFFF';
      m.addLayer({ id: 'plan-casing', type: 'line', source: 'plan', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': fillet, 'line-width': 10, 'line-opacity': 0.92 } }, 'live-track-casing');
      m.addLayer({ id: 'plan-line', type: 'line', source: 'plan', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ink, 'line-width': 5 } }, 'live-track-casing');
    }
    if (!m.getSource('rejoin')) {
      m.addSource('rejoin', { type: 'geojson', data: EMPTY_FC });
      m.addLayer({ id: 'rejoin-line', type: 'line', source: 'rejoin', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': isDark() ? '#E8EDF2' : '#0E141B', 'line-width': 4.5, 'line-dasharray': [1.2, 1.3] } }, 'live-track-casing');
    }
    if (window.RGNav) RGNav.redraw();
  }
  function refreshMine() {
    if (!map || !mapReady || !map.getSource('mine')) return;
    if (!settings.layerRides) { map.getSource('mine').setData(EMPTY_FC); return; }
    if (!mineDirty && mineCache) { map.getSource('mine').setData(mineCache); return; }
    var withTrack = rides.filter(function (r) { return r.hasTrack; });
    Promise.all(withTrack.map(function (r) { return DB.getTrack(r.id).then(function (pts) { return Geo.simplify(pts || [], 20).map(function (p) { return [p[2], p[1]]; }); }).catch(function () { return []; }); })).then(function (lines) {
      mineCache = { type: 'FeatureCollection', features: lines.filter(function (l) { return l.length > 1; }).map(function (c) { return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } }; }) };
      mineDirty = false;
      if (map && map.getSource('mine')) map.getSource('mine').setData(settings.layerRides ? mineCache : EMPTY_FC);
    });
  }
  $('#btnLayers').setAttribute('aria-pressed', String(!!settings.layerRides));
  $('#btnLayers').addEventListener('click', function () { settings.layerRides = !settings.layerRides; saveSettings(); $('#btnLayers').setAttribute('aria-pressed', String(settings.layerRides)); refreshMine(); if (settings.layerRides) toast(rides.some(function (r) { return r.hasTrack; }) ? 'Tus rutas grabadas, en azul.' : 'Aún no hay rutas grabadas que mostrar.', 'ok'); });

  /* ---------- tiempo (Open-Meteo) ---------- */
  var wx = { data: null, at: 0, lat: null, lon: null, busy: false, failAt: 0 };
  var WX_CODES = { 0: 'Despejado', 1: 'Casi despejado', 2: 'Nubes y claros', 3: 'Cubierto', 45: 'Niebla', 48: 'Niebla', 51: 'Llovizna', 53: 'Llovizna', 55: 'Llovizna', 56: 'Llovizna helada', 57: 'Llovizna helada', 61: 'Lluvia débil', 63: 'Lluvia', 65: 'Lluvia fuerte', 66: 'Lluvia helada', 67: 'Lluvia helada', 71: 'Nieve', 73: 'Nieve', 75: 'Nieve', 77: 'Nieve', 80: 'Chubascos', 81: 'Chubascos', 82: 'Chubascos fuertes', 85: 'Nieve', 86: 'Nieve', 95: 'Tormenta', 96: 'Tormenta y granizo', 99: 'Tormenta y granizo' };
  function wxText(w) { return (WX_CODES[w.code] || 'Tiempo') + ' · ' + w.t + ' °C · viento ' + w.wind + ' km/h'; }
  function maybeFetchWeather(fix) {
    if (!fix || wx.busy || sens.demo || (typeof navigator.onLine === 'boolean' && !navigator.onLine)) return;
    var now = Date.now(), moved = wx.lat == null || Geo.dist(wx.lat, wx.lon, fix.lat, fix.lon) > 3000;
    if (!moved && now - wx.at < 10 * 60000) return;
    if (now - wx.failAt < 3 * 60000) return;
    wx.busy = true;
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + fix.lat.toFixed(3) + '&longitude=' + fix.lon.toFixed(3) + '&current=temperature_2m,weather_code,wind_speed_10m,precipitation&wind_speed_unit=kmh&timezone=auto';
    fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (j) {
      var c = j.current || {}; if (c.temperature_2m == null) throw new Error('sin datos');
      wx.data = { t: Math.round(c.temperature_2m), code: c.weather_code, wind: Math.round(c.wind_speed_10m || 0), rain: c.precipitation || 0, at: now };
      wx.at = now; wx.lat = fix.lat; wx.lon = fix.lon; wx.failAt = 0; renderWx();
      if (rec && !rec.weather) rec.weather = wx.data;
    }).catch(function () { wx.failAt = now; }).then(function () { wx.busy = false; });
  }
  // en la píldora del mapa, solo los grados (ámbar si moja); el cielo entero se lee al tocarla
function renderWx() { var e = $('#chipWx'); if (!wx.data) { e.hidden = true; return; } e.hidden = false; e.textContent = wx.data.t + '°'; e.title = wxText(wx.data); e.setAttribute('aria-label', wxText(wx.data)); e.onclick = function () { if (wx.data) toast(wxText(wx.data)); }; e.className = 'chip wx' + (wx.data.rain > 0 || wx.data.code >= 51 ? ' warn' : ' ok'); }

  /* ---------- aparcamiento ---------- */
  var parking = null, parkMarker = null, parkOpen = false;
  function loadParking() { return DB.get('parking', null).then(function (p) { parking = p || null; drawParking(); }); }
  function drawParking() {
    $('#btnPark').setAttribute('aria-pressed', String(!!parking));
    if (!map || !mapReady) return;
    if (parking) {
      if (!parkMarker) { var el = document.createElement('div'); el.className = 'park-marker'; el.textContent = 'P'; el.title = 'Aquí dejaste la moto'; el.addEventListener('click', function (e) { e.stopPropagation(); openPark(); }); parkMarker = new maplibregl.Marker({ element: el, anchor: 'center' }); }
      parkMarker.setLngLat([parking.lon, parking.lat]).addTo(map);
    } else if (parkMarker) parkMarker.remove();
  }
  function fmtAgo(ts) { var m = Math.round((Date.now() - ts) / 60000); if (m < 1) return 'ahora mismo'; if (m < 60) return 'hace ' + m + ' min'; var h = Math.floor(m / 60); if (h < 24) return 'hace ' + h + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : ''); return 'el ' + fmtDate(ts).toLowerCase() + ' a las ' + fmtClock(ts); }
  function renderParkCard() {
    var info = $('#parkInfo'), has = !!parking;
    $('#parkHere').textContent = has ? 'Guardar aquí de nuevo' : 'Guardar aquí'; $('#parkHere').disabled = !lastFix;
    $('#parkGo').hidden = !has; $('#parkShow').hidden = !has; $('#parkForget').hidden = !has;
    if (!has) info.textContent = lastFix ? 'Guarda dónde dejas la moto y vuelve a ella sin buscar.' : 'Esperando señal GPS para guardar la posición.';
    else { var d = lastFix ? Geo.dist(lastFix.lat, lastFix.lon, parking.lat, parking.lon) : null; info.innerHTML = 'Aparcada ' + fmtAgo(parking.at) + (d != null ? ' · a <b>' + (d < 1000 ? Math.round(d) + ' m' : fmtKm(d / 1000)) + '</b> de ti' : ''); }
  }
  function openPark() { if (planMode) exitPlanMode(); parkOpen = true; $('#parkCard').hidden = false; renderParkCard(); render(); }
  function closePark() { parkOpen = false; $('#parkCard').hidden = true; render(); }
  $('#btnPark').addEventListener('click', function () { if (parkOpen) closePark(); else openPark(); });
  $('#parkClose').addEventListener('click', closePark);
  $('#parkHere').addEventListener('click', function () { if (!lastFix) return; parking = { lat: lastFix.lat, lon: lastFix.lon, acc: lastFix.acc, at: Date.now() }; DB.set('parking', parking).then(function () { drawParking(); renderParkCard(); toast('Aparcamiento guardado.', 'ok'); return setFlag('park'); }); });
  $('#parkGo').addEventListener('click', function () { if (parking) Platform.openExternal('https://www.google.com/maps/dir/?api=1&destination=' + parking.lat.toFixed(6) + ',' + parking.lon.toFixed(6) + '&travelmode=walking'); });
  $('#parkShow').addEventListener('click', function () { if (parking && map) { setFollow(false); map.flyTo({ center: [parking.lon, parking.lat], zoom: Math.max(map.getZoom(), 16) }); } });
  $('#parkForget').addEventListener('click', function () { parking = null; DB.set('parking', null).then(function () { drawParking(); renderParkCard(); closePark(); }); });

  /* ---------- rutas planificadas ---------- */
  var plans = [], planMode = false, pl = { wps: [], markers: [], coords: [], dist: 0, dur: 0, routed: false, pending: false }, activePlan = null, routeTimer = null, routeSeq = 0;
  function loadPlans() { return DB.get('plans', []).then(function (p) { plans = p || []; plans.forEach(function (x) { if (x.cloudId && x.pub === undefined) x.pub = true; }); activePlan = settings.activePlanId ? plans.filter(function (x) { return x.id === settings.activePlanId; })[0] || null : null; drawPlan(); renderFollow(); }); }
  function savePlans() { return DB.set('plans', plans); }
  function syncSoon() { if (window.RGSync) RGSync.soon(5000); }      // copia en la cuenta
  function enterPlanMode() {
    if (rec) { toast('Para la grabación antes de planificar una ruta.', 'warn'); return; }
    if (parkOpen) closePark();
    planMode = true; $('#planCard').hidden = false; $('#btnPlan').setAttribute('aria-pressed', 'true'); $('#planName').value = '';
    setFollow(false); if (map) map.getCanvas().style.cursor = 'crosshair';
    drawPlan(); renderFollow(); renderPlanInfo(); render();
    if (map && map.getZoom() < 9 && lastFix) map.easeTo({ center: [lastFix.lon, lastFix.lat], zoom: 12 });
  }
  function exitPlanMode() { planMode = false; $('#planCard').hidden = true; $('#btnPlan').setAttribute('aria-pressed', 'false'); clearPlan(); if (map) map.getCanvas().style.cursor = ''; drawPlan(); renderFollow(); render(); }
  function addWaypoint(lat, lon, name) {
    var el = document.createElement('div'); el.className = 'wp-marker'; el.addEventListener('click', function (e) { e.stopPropagation(); });
    var mk = new maplibregl.Marker({ element: el, draggable: true, anchor: 'center' }).setLngLat([lon, lat]).addTo(map);
    mk.on('dragend', function () { var ll = mk.getLngLat(), i = pl.markers.indexOf(mk); if (i >= 0) pl.wps[i] = [ll.lat, ll.lng, pl.wps[i][2] || '']; scheduleRoute(); });
    pl.wps.push([lat, lon, name || '']); if (name) el.title = name; pl.markers.push(mk); relabelWps(); scheduleRoute();
  }
  function relabelWps() { pl.markers.forEach(function (m, i) { var el = m.getElement(); el.textContent = String(i + 1); el.classList.toggle('end', i > 0 && i === pl.markers.length - 1); }); }
  function clearPlan() { pl.markers.forEach(function (m) { m.remove(); }); pl = { wps: [], markers: [], coords: [], dist: 0, dur: 0, routed: false, pending: false }; routeSeq++; drawPlan(); renderPlanInfo(); }
  function scheduleRoute() { pl.pending = pl.wps.length >= 2; if (routeTimer) clearTimeout(routeTimer); routeTimer = setTimeout(computeRoute, 350); renderPlanInfo(); }
  function computeRoute() {
    var seq = ++routeSeq, wps = pl.wps.slice();
    if (wps.length < 2) { pl.coords = wps.map(function (w) { return [w[1], w[0]]; }); pl.dist = 0; pl.dur = 0; pl.routed = false; pl.pending = false; drawPlan(); renderPlanInfo(); return; }
    routeBetween(wps).then(function (r) { if (seq !== routeSeq) return; pl.coords = r.coords; pl.dist = r.dist; pl.dur = r.dur; pl.routed = r.routed; pl.steps = r.steps || []; pl.pending = false; drawPlan(); renderPlanInfo(); });
  }
  function routeBetween(wps) {
    var straight = function () { var d = 0; for (var i = 1; i < wps.length; i++) d += Geo.dist(wps[i - 1][0], wps[i - 1][1], wps[i][0], wps[i][1]); return { coords: wps.map(function (w) { return [w[1], w[0]]; }), dist: d / 1000, dur: d / 1000 / 60 * 3600, routed: false }; };
    if (typeof navigator.onLine === 'boolean' && !navigator.onLine) return Promise.resolve(straight());
    var url = 'https://router.project-osrm.org/route/v1/driving/' + wps.map(function (w) { return w[1].toFixed(5) + ',' + w[0].toFixed(5); }).join(';') + '?overview=full&geometries=geojson&steps=true';
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null; if (ctrl) setTimeout(function () { ctrl.abort(); }, 8000);
    return fetch(url, ctrl ? { signal: ctrl.signal } : {}).then(function (r) { return r.json(); }).then(function (j) { if (!j.routes || !j.routes[0]) throw new Error('sin ruta'); var rt = j.routes[0]; return { coords: rt.geometry.coordinates, dist: rt.distance / 1000, dur: rt.duration, routed: true, steps: RGLib.stepsFromOsrm(rt) }; }).catch(straight);
  }
  function drawPlan() {
    if (!map || !mapReady || !map.getSource('plan')) return;
    var coords = planMode ? pl.coords : (activePlan ? activePlan.coords : []);
    map.getSource('plan').setData(coords.length > 1 ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } : EMPTY_FC);
  }
  function renderPlanInfo() {
    var n = pl.wps.length;
    $('#planUndo').disabled = !n; $('#planClear').disabled = !n; $('#planSave').disabled = n < 2 || pl.pending; $('#planGmaps').disabled = n < 2;
    $('#planInfo').innerHTML = n === 0 ? 'Pega el enlace de la ruta o toca el mapa para añadir puntos.' : (n === 1 ? '1 punto · toca el mapa para añadir el destino.' : (pl.pending ? n + ' puntos · calculando…' : n + ' puntos · <b>' + fmtKm(pl.dist) + '</b> · ' + fmtDur(pl.dur * 1000) + (pl.routed ? ' por carretera' : ' <span class="muted">(en línea recta: sin conexión al enrutador)</span>')));
  }
  function openInMaps(wps) { if (window.RGNav && RGNav.openMaps) RGNav.openMaps(wps); else Platform.openExternal(gmapsDirUrl(wps)); }
  function gmapsDirUrl(wps) {
    var o = wps[0], d = wps[wps.length - 1], mid = wps.slice(1, -1).slice(0, 9);
    return 'https://www.google.com/maps/dir/?api=1&origin=' + o[0].toFixed(6) + ',' + o[1].toFixed(6) + '&destination=' + d[0].toFixed(6) + ',' + d[1].toFixed(6) + (mid.length ? '&waypoints=' + mid.map(function (w) { return w[0].toFixed(6) + ',' + w[1].toFixed(6); }).join('|') : '') + '&travelmode=driving';
  }
  function planThumb(p) { return Geo.thumbSvg(p.coords.map(function (c) { return [0, c[1], c[0]]; }), 120, 'currentColor'); }
  function followPlan(p, fit) {
    activePlan = p; settings.activePlanId = p ? p.id : null; saveSettings(); drawPlan(); renderFollow();
    if (p && fit && map && mapReady) { setFollow(false); var b = Geo.bounds(p.coords.map(function (c) { return [0, c[1], c[0]]; })); if (b) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: { top: 120, bottom: 220, left: 40, right: 70 }, duration: 600 }); }
  }
  function renderFollow() { $('#followCard').hidden = !activePlan || planMode; if (activePlan) $('#followName').textContent = activePlan.name; $('#followSave').hidden = !(activePlan && activePlan.preview); if (window.RGNav) RGNav.sync(); }
  // Ruta de otro motero que estoy mirando en el mapa: «Guardar» la pasa a mis rutas planificadas.
  $('#followSave').addEventListener('click', function () {
    var p = activePlan; if (!p || !p.preview) return;
    delete p.preview; plans = plans.filter(function (x) { return x.id !== p.id; }); plans.unshift(p);
    savePlans().then(function () { syncSoon(); settings.activePlanId = p.id; saveSettings(); renderFollow(); toast('Ruta guardada en tus rutas planificadas.', 'ok'); });
  });
  $('#btnPlan').addEventListener('click', function () { if (planMode) exitPlanMode(); else enterPlanMode(); });
  $('#planClose').addEventListener('click', exitPlanMode);
  $('#planUndo').addEventListener('click', function () { var m = pl.markers.pop(); if (m) m.remove(); pl.wps.pop(); relabelWps(); scheduleRoute(); });
  $('#planClear').addEventListener('click', clearPlan);
  $('#planGmaps').addEventListener('click', function () { if (pl.wps.length >= 2) openInMaps(pl.wps); });
  $('#planSave').addEventListener('click', function () {
    if (pl.wps.length < 2 || pl.pending) return;
    var coords = Geo.simplify(pl.coords.map(function (c) { return [0, c[1], c[0]]; }), 8).map(function (p) { return [p[2], p[1]]; });
    var p = { id: Date.now(), name: $('#planName').value.trim() || ('Ruta planificada ' + (plans.length + 1)), wps: pl.wps.slice(), coords: coords, dist: Math.round(pl.dist * 10) / 10, dur: Math.round(pl.dur), routed: pl.routed, steps: pl.routed ? (pl.steps || []) : [], created: Date.now() };
    plans.unshift(p);
    savePlans().then(function () { exitPlanMode(); followPlan(p, false); toast('Ruta guardada. Pulsa «Iniciar ruta» cuando salgas.', 'ok'); syncSoon(); return setFlag('plan'); });
  });
  $('#followStop').addEventListener('click', function () { followPlan(null, false); });
  $('#followGmaps').addEventListener('click', function () { if (activePlan) openInMaps(activePlan.wps); });
  // Cambiar el nombre de una ruta planificada (también las importadas de Google Maps, GPX o de otro motero).
  function renamePlan(p) {
    var done = function (n) {
      n = (n || '').trim().slice(0, 60); if (!n || n === p.name) return;
      p.name = n; p.dirty = 1;
      savePlans().then(function () {
        renderRides(); if (activePlan && activePlan.id === p.id) followPlan(p, false);
        if (window.RGSync) RGSync.pushPlan(p).then(function () { delete p.dirty; return savePlans(); }).catch(function () { RGSync.soon(4000); });
        toast('Nombre cambiado.', 'ok');
      });
    };
    if (!window.RGCloud) { done(window.prompt('Nombre de la ruta', p.name)); return; }
    RGCloud.sheet('<div class="head"><h1>Nombre de la ruta</h1><button class="btn small icon" id="pnX" type="button" aria-label="Cerrar"><svg><use href="#i-close"/></svg></button></div>' +
      '<form id="pnForm" class="rg-form"><label>Nombre<input id="pnName" type="text" maxlength="60" required autocomplete="off" value="' + esc(p.name) + '"></label>' +
      '<button class="btn big primary" type="submit"><svg><use href="#i-check"/></svg>Guardar</button></form>');
    var inp = $('#pnName'); setTimeout(function () { try { inp.focus(); inp.select(); } catch (e) {} }, 60);
    $('#pnX').addEventListener('click', RGCloud.closeSheet);
    $('#pnForm').addEventListener('submit', function (ev) { ev.preventDefault(); var n = inp.value; RGCloud.closeSheet(); done(n); });
  }
  function renderPlans(list) {
    var top = document.createElement('div'); top.className = 'actions rg-plantop';
    top.innerHTML = '<button class="btn primary wide" type="button" id="btnNewPlan"><svg><use href="#i-route"/></svg>Planificar una ruta nueva</button><button class="btn wide" type="button" id="btnExplore"><svg><use href="#i-people"/></svg>Explorar rutas públicas de otros moteros</button>';
    top.querySelector('#btnNewPlan').addEventListener('click', function () { showView('map'); enterPlanMode(); });
    top.querySelector('#btnExplore').addEventListener('click', function () { if (window.RGNav) RGNav.explore(); });
    list.appendChild(top);
    if (!plans.length) { var e = document.createElement('div'); e.className = 'empty'; e.textContent = 'Aún no hay rutas planificadas. Crea una pegando un enlace de Google Maps o tocando el mapa, guárdala y pulsa «Iniciar ruta».'; list.appendChild(e); return; }
    plans.forEach(function (p) {
      var d = document.createElement('div'); d.className = 'plan';
      d.innerHTML = '<div class="thumb">' + planThumb(p) + '</div><div><div class="name rg-pname"><span>' + esc(p.name) + '</span><button class="btn small icon" type="button" data-act="ren" title="Cambiar el nombre" aria-label="Cambiar el nombre"><svg><use href="#i-edit"/></svg></button></div><div class="muted">' + fmtKm(p.dist) + ' · ' + fmtDur(p.dur * 1000) + (p.routed ? ' por carretera' : ' en línea recta') + ' · ' + p.wps.length + ' puntos · ' + fmtDate(p.created) + '</div></div>' +
        '<div class="plan-actions"><button class="btn small primary" type="button" data-act="follow"><svg><use href="#i-play"/></svg>' + (activePlan && activePlan.id === p.id ? 'Seleccionada' : 'Seguir esta ruta') + '</button><button class="btn small' + (p.pub ? ' on' : '') + '" type="button" data-act="pub"><svg><use href="#i-' + (p.pub ? 'check' : 'lock') + '"/></svg>' + (p.pub ? 'Pública' : 'Privada · publicar') + '</button><button class="btn small" type="button" data-act="gpx"><svg><use href="#i-download"/></svg>Descargar GPX</button><button class="btn small" type="button" data-act="gmaps"><svg><use href="#i-gmaps"/></svg>Google Maps</button><button class="btn small danger" type="button" data-act="del"><svg><use href="#i-trash"/></svg>Borrar</button></div>';
      d.querySelectorAll('button').forEach(function (b) { b.addEventListener('click', function () {
        if (b.dataset.act === 'ren') renamePlan(p);
        if (b.dataset.act === 'follow') { followPlan(p, true); showView('map'); }
        if (b.dataset.act === 'gmaps') openInMaps(p.wps);
        if (b.dataset.act === 'gpx' && window.RGNav) RGNav.exportGpx(p);
        if (b.dataset.act === 'pub' && window.RGNav) RGNav.togglePublic(p);
        if (b.dataset.act === 'del') armOrRun(b, 'Borrar', 'Toca otra vez', function () { if (window.RGSync) RGSync.planDeleted(p); plans = plans.filter(function (x) { return x.id !== p.id; }); if (activePlan && activePlan.id === p.id) followPlan(null, false); savePlans().then(renderRides); });
      }); });
      list.appendChild(d);
      if (window.RGThumbs) RGThumbs.attach(d.querySelector('.thumb'), 'p' + p.id, p.coords);
    });
  }

  /* ---------- grabación ---------- */
  var rec = null, recTick = null, lastSave = 0, demoTimer = null, pausedSince = null;
  function newRec() { var principal = vehicles.filter(function (v) { return v.principal; })[0]; return { id: Date.now(), start: Date.now(), end: null, name: '', maxL: 0, maxR: 0, vMax: 0, dist: 0, movingS: 0, corners: [], points: [], vehicleId: principal ? principal.id : null, favorite: false, stars: 0, note: '' }; }
  // En una ruta, la inclinación solo cuenta (máximas, «última», curvas) cuando la moto rueda y su vertical ya se ha
  // medido en marcha. Así no se cuela lo de parado: levantarla de la pata de cabra, colocar el móvil en el soporte,
  // o un cero provisional tomado en cuesta. Sin GPS (denegado o no disponible) no se puede saber: cuenta todo, como antes.
  function leanCounts(now) {
    if (sens.demo || (!sens.lastGps && sens.gpsError)) return true;
    var v = (sens.lastGps && (now - sens.lastGps) < 30000) ? sens.speedKmh : null;
    return v != null && v >= settings.vMin && (est.state.confirmed || est.state.frameKind === 'manual');
  }
  function recFeed(phi, now) {
    if (!leanCounts(now)) phi = 0;
    if (phi < -2 && -phi > rec.maxL) rec.maxL = -phi;
    if (phi > 2 && phi > rec.maxR) rec.maxR = phi;
    var v = (sens.speedKmh != null && (now - sens.lastGps) < 5000) ? Math.round(sens.speedKmh) : null;
    var c = det.feed(phi, v, now);
    if (c) addCorner(c);
  }
  function addCorner(c) {
    if (c.vPeak != null && c.vPeak < settings.vMin) return;
    var tEpoch = Date.now() - Math.round(performance.now() - c.t), idx = rec.points.length ? Geo.indexAtTime(rec.points, tEpoch) : -1, p = idx >= 0 ? rec.points[idx] : null;
    var corner = { t: tEpoch, side: c.side, peak: Math.round(c.peak * 10) / 10, v: c.vPeak, dur: Math.round(c.dur * 10) / 10, lat: p ? p[1] : null, lon: p ? p[2] : null, idx: idx };
    rec.corners.push(corner);
    if (settings.voice && Platform.canSpeak() && !sens.demo) Platform.speak(String(Math.round(c.peak)));
  }
  function recFix(fix, prev) {
    var moving = fix.v != null ? fix.v > 0.8 : (prev ? Geo.dist(prev.lat, prev.lon, fix.lat, fix.lon) / Math.max(0.5, (fix.ts - prev.ts) / 1000) > 0.8 : false);
    if (settings.autoPause) { if (!moving) { if (pausedSince == null) pausedSince = fix.ts; } else pausedSince = null; }
    var paused = settings.autoPause && pausedSince != null && fix.ts - pausedSince > 20000;
    var lean = est.state.ready ? (live.leanMaxSinceFix > 3 ? (live.phi < 0 ? -live.leanMaxSinceFix : live.leanMaxSinceFix) : live.phi) : null;
    if (lean != null) lean = Math.round(lean * 10) / 10;
    live.leanMaxSinceFix = 0;
    var pt = [fix.ts, +fix.lat.toFixed(6), +fix.lon.toFixed(6), fix.alt == null ? null : Math.round(fix.alt), fix.v == null ? null : Math.round(fix.v * 100) / 100, Math.round(fix.acc || 0), lean];
    if (paused && rec.points.length) { var lp = rec.points[rec.points.length - 1]; if (Geo.dist(lp[1], lp[2], fix.lat, fix.lon) < 15) return; }
    rec.points.push(pt);
    if (prev && fix.acc <= 40 && moving) {
      var seg = Geo.dist(prev.lat, prev.lon, fix.lat, fix.lon), dt = (fix.ts - prev.ts) / 1000;
      if (seg < 2000 && dt > 0 && dt < 120) { rec.dist += seg / 1000; rec.movingS += dt; if (fix.v != null && fix.v * 3.6 > rec.vMax && fix.v < 120) rec.vMax = fix.v * 3.6; }
      liveFeatures.push({ type: 'Feature', properties: { color: Geo.leanColor(lean || 0) }, geometry: { type: 'LineString', coordinates: [[prev.lon, prev.lat], [fix.lon, fix.lat]] } });
      drawLiveTrack();
    }
    rec.paused = paused;
    if (performance.now() - lastSave > 10000) persistRec();
  }
  function persistRec() { lastSave = performance.now(); var meta = recMeta(rec); meta.saved = Date.now(); meta.inProgress = true; DB.putRide(meta).then(function () { return DB.putTrack(rec.id, rec.points); }).catch(function () {}); }
  function recMeta(r) {
    var pts = r.points || [];
    return { id: r.id, start: r.start, end: r.end, name: r.name || '', maxL: Math.round(r.maxL * 10) / 10, maxR: Math.round(r.maxR * 10) / 10, vMax: Math.round(r.vMax), dist: Math.round(r.dist * 100) / 100, movingS: Math.round(r.movingS),
      corners: r.corners.map(function (c) { var o = {}; for (var k in c) o[k] = c[k]; return o; }), vehicleId: r.vehicleId || null, favorite: !!r.favorite, stars: r.stars || 0, note: r.note || '',
      trip: !!r.trip, hasTrack: pts.length > 1, hasLean: est.state.ready, nPoints: pts.length, cells: pts.length > 1 ? Achievements.cellsOf(pts) : [], thumb: pts.length > 1 ? Geo.simplify(pts, 25).slice(0, 400).map(function (p) { return [p[1], p[2]]; }) : null, recovered: !!r.recovered, demo: !!r.demo, imported: !!r.imported, weather: r.weather || null };
  }
  // trip = «trayecto»: un desplazamiento corto (ir a un recado). Mide lo mismo, pero no guarda por dónde has pasado.
  function startRide(auto, trip) {
    if (rec) return;
    startMotion().then(function (r) {
      if (r !== 'ok' && !sens.demo) toast('Sin acceso a los sensores: se grabará la ruta sin inclinación.', 'warn');
      if (!sens.demo) startGps('bg');
      Platform.keepAwake(true);
      resetLast(); rec = newRec(); if (trip) rec.trip = true; if (sens.demo) rec.demo = true; if (wx.data && Date.now() - wx.at < 30 * 60000) rec.weather = wx.data; det.setOptions({ minPeak: settings.minPeak }); liveFeatures = []; drawLiveTrack(true); pausedSince = null; lastSave = performance.now();
      LS.set('inclina.recording', rec.id);
      recTick = setInterval(render, 1000);
      setFollow(true);
      hideNotice(); render();
      if (window.RGNav) RGNav.sync();
      if (auto) toast('Grabando ruta (inicio automático).', 'ok'); else if (trip) toast('Trayecto en marcha. Pulsa Parar al llegar.', 'ok');
    });
  }
  function stopRide() {
    if (!rec) return;
    var c = det.flush(performance.now()); if (c) addCorner(c);
    rec.end = Date.now();
    var done = rec; rec = null;
    if (window.RGNav) RGNav.sync();
    if (recTick) clearInterval(recTick); recTick = null;
    LS.del('inclina.recording');
    Platform.keepAwake(false);
    if (sens.demo) stopDemo(); else { stopGps(); if (currentView === 'map') startGps('fg'); }
    if (done.points.length > 1) { var st = Geo.stats(done.points); done.altMax = st.altMax; done.climb = Math.round(st.climb); if (!done.dist) done.dist = st.distKm; if (!done.movingS) done.movingS = st.movingS; if (!done.vMax) done.vMax = st.vMaxKmh; }
    var meta = recMeta(done); meta.inProgress = false; meta.altMax = done.altMax; meta.climb = done.climb;
    if (done.points.length < 2 && !done.corners.length) { toast('Ruta demasiado corta: no se ha guardado.', 'warn'); liveFeatures = []; drawLiveTrack(true); DB.deleteRide(done.id).catch(function () {}); render(); return; }
    if (done.trip) {
      // Trayecto: se queda con las cifras (tiempo, km, velocidades, inclinación) y suma los km a la moto. Ni trazado ni curvas.
      meta.trip = true; meta.hasTrack = false; meta.thumb = null; meta.corners = []; meta.nPoints = 0; if (!meta.name) meta.name = 'Trayecto';
      DB.putRide(meta).then(function () { return DB.delTrack(done.id); }).then(function () { return reloadRides(); }).then(function () { liveFeatures = []; drawLiveTrack(true); render(); tripSummary(meta); syncSoon(); return checkAchievements(); });
      return;
    }
    DB.putRide(meta).then(function () { return DB.putTrack(done.id, done.points); }).then(function () { return reloadRides(); }).then(function () { liveFeatures = []; drawLiveTrack(true); openDetail(done.id); if (window.RGStats) RGStats.rideSaved(); syncSoon(); return checkAchievements(); });
  }
  function tripSummary(m) {
    if (!window.RGCloud) { toast('Trayecto guardado: ' + fmtKm(m.dist) + '.', 'ok'); return; }
    var secs = m.movingS || Math.round(((m.end || Date.now()) - m.start) / 1000), avg = secs > 0 ? Math.round(m.dist / (secs / 3600)) : 0;
    var v = vehicles.filter(function (x) { return x.id === m.vehicleId; })[0];
    var f = function (l, val, cls) { return '<div class="fig' + (cls ? ' ' + cls : '') + '"><span class="label">' + l + '</span><span class="val cifra">' + val + '</span></div>'; };
    RGCloud.sheet('<span class="rg-plaza"><i></i>Trayecto terminado</span><h1>' + fmtKm(m.dist) + ' · ' + fmtDur(secs * 1000) + '</h1>' +
      '<div class="rg-trip">' + f('Velocidad máx', (m.vMax || 0) + '<span class="unit">km/h</span>') + f('Velocidad media', avg + '<span class="unit">km/h</span>') + f('Máx izquierda', Math.round(m.maxL) + '°', 'l') + f('Máx derecha', Math.round(m.maxR) + '°', 'r') + '</div>' +
      '<p class="rg-small">' + (v ? 'Los km se han sumado a «' + esc(v.name) + '» para su mantenimiento. ' : '') + 'No se guarda por dónde has pasado. Lo tienes en Rutas, en «Trayectos».</p>' +
      '<button class="btn big primary" id="tripOk" type="button"><svg><use href="#i-check"/></svg>Hecho</button><button class="btn rg-skip danger" id="tripDel" type="button">Borrar este trayecto</button>', 'win');
    $('#tripOk').addEventListener('click', RGCloud.closeSheet);
    $('#tripDel').addEventListener('click', function () { RGCloud.closeSheet(); if (window.RGSync) RGSync.rideDeleted(m.id); DB.deleteRide(m.id).then(reloadRides).then(function () { toast('Trayecto borrado.', 'ok'); }); });
  }
  function recoverRide() {
    var id = LS.get('inclina.recording', null); if (!id) return Promise.resolve();
    LS.del('inclina.recording');
    return DB.getRide(id).then(function (r) { if (!r) return; r.inProgress = false; r.recovered = true; r.end = r.saved || r.start + 1; return DB.putRide(r); }).catch(function () {});
  }
  function askAndStart(trip) { trip = trip === true; if (window.RGPerm) RGPerm.ensure().then(function (ok) { if (ok) startRide(false, trip); }); else startRide(false, trip); }
  $('#btnRide').addEventListener('click', askAndStart);
  // En una ruta en grupo, un administrador elige si la termina para todos o solo para él.
  $('#btnStop').addEventListener('click', function () { if (window.RGGroup && RGGroup.askStop && RGGroup.askStop(stopRide)) return; stopRide(); });
  window.addEventListener('pagehide', function () { if (rec) persistRec(); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && rec) Platform.keepAwake(true); });

  /* ---------- render en vivo ---------- */
  var prev = {};
  function setText(id, v) { if (prev[id] !== v) { prev[id] = v; var e = $(id); if (e) e.textContent = v; } }
  function setHTML(id, v) { if (prev[id] !== v) { prev[id] = v; var e = $(id); if (e) e.innerHTML = v; } }
  function setClass(id, v) { if (prev['c' + id] !== v) { prev['c' + id] = v; var e = $(id); if (e) e.className = v; } }
  var toastTimer = null;
  function toast(msg, kind) { var n = $('#toast'); n.textContent = msg; n.className = 'toast notice' + (kind ? ' ' + kind : ''); n.hidden = false; if (toastTimer) clearTimeout(toastTimer); toastTimer = setTimeout(function () { n.hidden = true; }, kind === 'bad' ? 9000 : 5000); }
  function showNotice(msg, kind) { var n = $('#notice'); n.textContent = msg; n.className = 'notice' + (kind ? ' ' + kind : ''); n.hidden = false; }
  function hideNotice() { $('#notice').hidden = true; }
  function render() {
    var now = performance.now(), ready = est.state.ready, phi = ready ? live.phi : 0, ar = Math.round(Math.abs(phi));
    var mL = rec ? rec.maxL : sessMax.l, mR = rec ? rec.maxR : sessMax.r;
    if (!rec) { if (phi < -2 && -phi > sessMax.l) sessMax.l = -phi; if (phi > 2 && phi > sessMax.r) sessMax.r = phi; }
    var gpsFresh = sens.lastGps && (now - sens.lastGps) < 5000, speedTxt = (gpsFresh && sens.speedKmh != null) ? String(Math.round(sens.speedKmh)) : '—';
    var motionFresh = sens.lastMotion && (now - sens.lastMotion) < 2000;
    // HUD
    if (rec) {
      gaugeMini(phi, mL, mR, live.lastL, live.lastR);
      setText('#hudSpeed', speedTxt); setText('#hudMaxL', Math.round(mL) + '°'); setText('#hudMaxR', Math.round(mR) + '°');
      setText('#hudLastL', live.lastL ? Math.round(live.lastL) + '°' : '—'); setText('#hudLastR', live.lastR ? Math.round(live.lastR) + '°' : '—');
      setHTML('#hudMeta', '<b>' + fmtKm(rec.dist) + '</b> · ' + rec.corners.length + (rec.corners.length === 1 ? ' curva' : ' curvas') + (rec.paused ? ' · <span class="pause">en pausa</span>' : ''));
      setText('#rideTimer', fmtTime(Date.now() - rec.start)); setText('#hudTime', fmtTime(Date.now() - rec.start));
      setHTML('#hudLine', fmtKm(rec.dist) + (rec.trip ? ' · trayecto' : ' · ' + rec.corners.length + (rec.corners.length === 1 ? ' curva' : ' curvas')) + (rec.paused ? ' · <span class="pause">en pausa</span>' : ''));
    }
    $('#rideTimer').hidden = !rec; $('#rideTimer').className = 'timer cifra' + (rec ? ' on' : '');
    $('#hudCard').hidden = !rec; $('#idleCard').hidden = !!rec || planMode || parkOpen;
    // pantalla completa
    if (!$('#leanFull').hidden) {
      gaugeFull(phi, mL, mR, live.lastL, live.lastR);
      setText('#lfNum', ready ? ar + '°' : '—');
      setText('#lfLastL', live.lastL ? Math.round(live.lastL) + '°' : '—'); setText('#lfLastR', live.lastR ? Math.round(live.lastR) + '°' : '—');
      if (!ready) { setText('#lfSide', 'Leyendo sensores'); setClass('#lfSide', 'side'); }
      else if (ar >= 3) { setText('#lfSide', phi < 0 ? 'Izquierda' : 'Derecha'); setClass('#lfSide', 'side ' + (phi < 0 ? 'l' : 'r')); } else { setText('#lfSide', 'Vertical'); setClass('#lfSide', 'side'); }
      setText('#lfMaxL', Math.round(mL) + '°'); setText('#lfMaxR', Math.round(mR) + '°');
      setHTML('#lfSpeed', speedTxt + '<span class="unit">km/h</span>');
      setText('#lfMinor', rec ? rec.corners.length + ' curvas · ' + fmtKm(rec.dist) + (est.state.confirmed || sens.demo ? '' : ' · vertical provisional') : (ready ? (est.state.confirmed ? 'Sin grabar · pulsa Iniciar ruta en el mapa' : 'Vertical provisional: se mide sola al empezar a rodar') : 'Esperando a los sensores del móvil'));
      setText('#lfTimer', rec ? fmtTime(Date.now() - rec.start) : '00:00:00'); setClass('#lfTimer', 'timer cifra' + (rec ? ' on' : ''));
      setClass('#lfSens', 'chip ' + (motionFresh ? (sens.gyro ? 'ok' : 'warn') : (sens.listening ? 'bad' : ''))); setText('#lfSens', motionFresh ? (sens.gyro ? 'Sensores' : 'Sin giróscopo') : 'Sensores');
      setClass('#lfGps', 'chip ' + (gpsFresh ? 'ok' : (sens.gpsError ? 'bad' : (gpsMode ? 'warn' : '')))); setText('#lfGps', gpsFresh ? 'GPS' : (sens.gpsError ? 'GPS ' + sens.gpsError : (gpsMode ? 'GPS…' : 'GPS')));
    }
    // chips
    setClass('#chipSens', 'chip ' + (motionFresh ? (sens.gyro ? 'ok' : 'warn') : (sens.listening ? 'bad' : ''))); setText('#chipSens', motionFresh ? (sens.gyro ? 'Sensores' : 'Sin giróscopo') : 'Sensores');
    var gpsWeak = gpsFresh && sens.gpsAcc > 25;
    setClass('#chipGps', 'chip ' + (gpsFresh ? (gpsWeak ? 'warn' : 'ok') : (sens.gpsError ? 'bad' : (gpsMode ? 'warn' : '')))); setText('#chipGps', gpsFresh ? 'GPS' : (sens.gpsError ? 'GPS ' + sens.gpsError : (gpsMode ? 'GPS…' : 'GPS')));
    var awake = Platform.isAwake(); setClass('#chipWake', 'chip ' + (awake ? 'ok' : '')); setText('#chipWake', awake ? 'Pantalla fija' : 'Pantalla');
    if (currentView === 'settings' && now - (prev.diagT || 0) > 250) { prev.diagT = now; renderDiag(); }
  }
  var sessMax = { l: 0, r: 0 };
  function loop() { render(); requestAnimationFrame(loop); }
  requestAnimationFrame(loop);
  Platform.onWakeChange(function () { render(); });
  $('#chipWake').addEventListener('click', function () { Platform.keepAwake(!Platform.isAwake()); });

  /* ---------- vistas ---------- */
  var views = { map: $('#view-map'), rides: $('#view-rides'), detail: $('#view-detail'), stats: $('#view-stats'), garage: $('#view-garage'), settings: $('#view-settings'), profile: $('#view-profile'), club: $('#view-club') };
  var currentView = 'map';
  var inTimer = 0;
  function showView(name) {
    var changed = name !== currentView;
    currentView = name;
    for (var k in views) views[k].hidden = k !== name;
    if (changed) { var vw = views[name]; vw.classList.remove('rg-in'); void vw.offsetWidth; vw.classList.add('rg-in'); clearTimeout(inTimer); inTimer = setTimeout(function () { vw.classList.remove('rg-in'); }, 900); }
    $$('.tab').forEach(function (t) { t.setAttribute('aria-selected', String(t.dataset.view === (name === 'detail' ? 'rides' : (name === 'profile' ? 'map' : name)))); });
    if (name === 'map') { if (!rec) startGps('fg'); if (map) setTimeout(function () { map.resize(); }, 50); }
    else if (!rec && gpsMode === 'fg' && name !== 'detail') stopGps();
    if (name === 'club' && window.RGClub) RGClub.show();
    if (name === 'rides') renderRides();
    if (name === 'stats') renderStats();
    if (name === 'garage') renderGarage();
    if (name === 'settings') renderSettings();
    if (name === 'profile') renderProfile();
    if (name !== 'detail') stopReplay();
    views[name].scrollTop = 0;
  }
  $$('.tab').forEach(function (t) { t.addEventListener('click', function () { showView(t.dataset.view); }); });
  function openLeanFull() { $('#leanFull').hidden = false; startMotion(); if (!gpsMode && !rec) startGps('fg'); }
  function closeLeanFull() { $('#leanFull').hidden = true; }
  $('#btnTrip').addEventListener('click', function () { askAndStart(true); }); $('#btnHudLean').addEventListener('click', openLeanFull); $('#hudCard .hud').addEventListener('click', openLeanFull); $('#btnLeanClose').addEventListener('click', closeLeanFull);

  /* ---------- rutas: totales y lista ---------- */
  var ridesFilter = 'all', ridesQuery = '';
  function reloadRides() { return DB.allRides().then(function (a) { rides = a.filter(function (r) { return !r.inProgress; }); renderTotals(); mineDirty = true; if (settings.layerRides) refreshMine(); return rides; }); }
  function renderTotals() {
    var km = rides.reduce(function (s, r) { return s + (r.dist || 0); }, 0);
    setHTML('#totKm', Math.round(km) + '<span class="unit">km</span>'); setText('#totRides', String(rides.filter(function (r) { return !r.trip; }).length));
  }
  function renderRides() {
    var list = $('#ridesList'); list.innerHTML = '';
    var km = rides.reduce(function (s, r) { return s + (r.dist || 0); }, 0), year = new Date().getFullYear();
    var kmYear = rides.filter(function (r) { return new Date(r.start).getFullYear() === year; }).reduce(function (s, r) { return s + (r.dist || 0); }, 0);
    var hours = rides.reduce(function (s, r) { return s + (r.movingS || 0); }, 0) / 3600;
    $('#ridesSummary').innerHTML = fig('Total', Math.round(km) + '<span class="unit">km</span>') + fig('Este año', Math.round(kmYear) + '<span class="unit">km</span>') + fig('Horas', hours.toFixed(1).replace('.', ',')) + fig('Media', (rides.length ? Math.round(km / rides.length) : 0) + '<span class="unit">km</span>');
    var hasCar = vehicles.some(function (v) { return v.type === 'coche'; }); $('#pillMoto').hidden = !hasCar; $('#pillCoche').hidden = !hasCar;
    if (ridesFilter === 'plans') { $('#ridesActions').hidden = true; renderPlans(list); return; }
    if (ridesFilter === 'public') { $('#ridesActions').hidden = true; list.innerHTML = ''; if (window.RGNav) RGNav.renderPublic(list); return; }
    $('#ridesActions').hidden = rides.length === 0;
    var q = ridesQuery.trim().toLowerCase(), principal = vehicles.filter(function (v) { return v.principal; })[0];
    var typeOf = function (r) { var v = vehicles.filter(function (x) { return x.id === r.vehicleId; })[0] || (!r.vehicleId ? principal : null); return v ? v.type || 'moto' : 'moto'; };
    var shown = rides.filter(function (r) {
      if (ridesFilter === 'fav' && !r.favorite) return false;
      if ((ridesFilter === 'trips') !== !!r.trip) return false;
      if ((ridesFilter === 'moto' || ridesFilter === 'coche') && typeOf(r) !== ridesFilter) return false;
      if (q && (rideTitle(r) + ' ' + fmtDateLong(r.start) + ' ' + (r.note || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    if (!shown.length) { list.innerHTML = '<div class="empty">' + (rides.length ? (ridesFilter === 'trips' ? 'Aún no hay trayectos. Pulsa «Trayecto» en el mapa cuando vayas a un recado.' : 'Ninguna ruta coincide con el filtro.') : 'Aún no hay rutas grabadas. Pulsa «Iniciar ruta» en el mapa y a rodar.') + '</div>'; return; }
    var lastMonth = null;
    shown.forEach(function (r) {
      var d = new Date(r.start), mk = d.getFullYear() + '-' + d.getMonth();
      if (mk !== lastMonth) {
        lastMonth = mk;
        var inMonth = shown.filter(function (x) { var dd = new Date(x.start); return dd.getFullYear() === d.getFullYear() && dd.getMonth() === d.getMonth(); });
        var h = document.createElement('div'); h.className = 'month';
        h.innerHTML = '<span class="label">' + monthName(d.getFullYear(), d.getMonth()) + ' <span class="muted">· ' + inMonth.length + (ridesFilter === 'trips' ? (inMonth.length === 1 ? ' trayecto' : ' trayectos') : (inMonth.length === 1 ? ' ruta' : ' rutas')) + '</span></span><span class="label" style="color:var(--color-accent)">' + Math.round(inMonth.reduce(function (s, x) { return s + (x.dist || 0); }, 0)) + ' km</span>';
        list.appendChild(h);
      }
      var b = document.createElement('button'); b.type = 'button'; b.className = 'row';
      var thumb = r.thumb && r.thumb.length > 1 ? Geo.thumbSvg(r.thumb.map(function (p) { return [0, p[0], p[1]]; }), 56) : '<svg width="28" height="28" viewBox="0 0 24 24"><use href="#i-gauge"/></svg>';
      b.innerHTML = '<span class="thumb">' + thumb + '</span>' +
        '<span class="date">' + esc(rideTitle(r)) + ' <span>· ' + fmtClock(r.start) + (r.recovered ? ' · recuperada' : '') + (r.imported ? ' · GPX' : '') + (r.demo ? ' · simulada' : '') + '</span>' + (r.favorite ? '<svg class="fav" width="16" height="16" viewBox="0 0 24 24"><use href="#i-star"/></svg>' : '') + '</span>' +
        '<span class="big"><span><span class="n l">' + Math.round(r.maxL) + '°</span><span class="label l">Izq</span></span><span><span class="n r">' + Math.round(r.maxR) + '°</span><span class="label r">Dcha</span></span></span>' +
        '<span class="sub">' + fmtKm(r.dist) + ' · ' + fmtDur((r.movingS || 0) * 1000) + (r.trip ? '' : ' · ' + r.corners.length + ' curvas') + ' · ' + (r.vMax || 0) + ' km/h máx</span>' +
        '<span class="chev"><svg><use href="#i-chev"/></svg></span>';
      b.addEventListener('click', function () { openDetail(r.id); });
      if (window.RGThumbs && r.thumb && r.thumb.length > 1) RGThumbs.attach(b.querySelector('.thumb'), 'r' + r.id, r.thumb.map(function (p) { return [p[1], p[0]]; }));
      list.appendChild(b);
    });
  }
  function fig(label, valHtml, cls) { return '<div class="fig' + (cls ? ' ' + cls : '') + '"><span class="label">' + label + '</span><span class="val cifra">' + valHtml + '</span></div>'; }
  $$('#ridesFilters .pill').forEach(function (p) { p.addEventListener('click', function () { ridesFilter = p.dataset.f; $$('#ridesFilters .pill').forEach(function (x) { x.setAttribute('aria-pressed', String(x === p)); }); renderRides(); }); });
  $('#ridesSearch').addEventListener('input', function (e) { ridesQuery = e.target.value; renderRides(); });
  $('#btnImportGpx').addEventListener('click', function () { $('#gpxFile').value = ''; $('#gpxFile').click(); });
  $('#gpxFile').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0]; if (!f) return;
    var reader = new FileReader();
    reader.onerror = function () { toast('No se ha podido leer el archivo.', 'bad'); };
    reader.onload = function () {
      if (window.RGNav && RGNav.gpxPicked) RGNav.gpxPicked(String(reader.result || ''), f.name); else importRecordedGpx(reader.result, f.name);
    };
    reader.readAsText(f);
  });
  function importRecordedGpx(text, fname) {
    var f = { name: fname || 'ruta.gpx' };
    (function () {
      try {
        var g = Geo.fromGpx(text), pts = g.points;
        if (pts.length < 2) throw new Error('El archivo no tiene puntos de trazado.');
        var st = Geo.stats(pts), r = { id: pts[0][0] + Math.floor(Math.random() * 1000), start: pts[0][0], end: pts[pts.length - 1][0], name: g.name || f.name.replace(/\.gpx$/i, ''), maxL: 0, maxR: 0, vMax: Math.round(st.vMaxKmh), dist: Math.round(st.distKm * 100) / 100, movingS: Math.round(st.movingS), corners: [], vehicleId: null, favorite: false, stars: 0, note: '', hasTrack: true, hasLean: false, nPoints: pts.length, imported: true, altMax: st.altMax, climb: Math.round(st.climb), cells: Achievements.cellsOf(pts), thumb: Geo.simplify(pts, 25).slice(0, 400).map(function (p) { return [p[1], p[2]]; }) };
        pts.forEach(function (p) { if (p[6] != null) { r.hasLean = true; if (p[6] < -r.maxL) r.maxL = -p[6]; if (p[6] > r.maxR) r.maxR = p[6]; } });
        r.maxL = Math.round(r.maxL * 10) / 10; r.maxR = Math.round(r.maxR * 10) / 10;
        DB.putRide(r).then(function () { return DB.putTrack(r.id, pts); }).then(reloadRides).then(function () { toast('Ruta importada: ' + fmtKm(r.dist), 'ok'); openDetail(r.id); return setFlag('gpxImport'); });
      } catch (err) { toast('No se pudo importar: ' + err.message, 'bad'); }
    })();
  }

  /* ---------- detalle ---------- */
  var detailId = null, detailRide = null, detailTrack = [], detailCum = null, cornerMarkers = [], replayMarker = null, rp = { playing: false, speed: 10, t: 0, raf: null, lastFrame: 0 };
  function ensureDetailMap() {
    if (!HAS_MAP || dmap) return Promise.resolve(dmap);
    return loadStyle().then(function (st) {
      dmap = new maplibregl.Map({ container: 'detailMap', style: st, center: [-3.7, 40.4], zoom: 5, attributionControl: { compact: true }, pitchWithRotate: false, touchPitch: false });
      dmap.on('style.load', function () { addTrackLayers(dmap, 'd'); if (detailTrack.length) drawDetailTrack(); });
      dmap.on('error', function () {});
      var re = document.createElement('div'); re.className = 'replay-marker'; replayMarker = new maplibregl.Marker({ element: re });
      return new Promise(function (resolve) { dmap.once('load', function () { addTrackLayers(dmap, 'd'); resolve(dmap); }); });
    });
  }
  function drawDetailTrack() {
    if (!dmap || !dmap.getSource('d-track')) return;
    dmap.getSource('d-track').setData(detailTrack.length > 1 ? Geo.segmentsGeoJson(detailTrack, settings.colorMode) : { type: 'FeatureCollection', features: [] });
  }
  function openDetail(id) {
    var r = rides.filter(function (x) { return x.id === id; })[0]; if (!r) return;
    detailId = id; detailRide = r; stopReplay();
    $('#detailTitle').innerHTML = esc(rideTitle(r)) + ' <span class="muted">· ' + fmtClock(r.start) + '</span>';
    $('#detailSummary').innerHTML =
      fig('Máx izquierda', Math.round(r.maxL) + '°', 'l') + fig('Máx derecha', Math.round(r.maxR) + '°', 'r') +
      fig('Distancia', fmtKm(r.dist).replace(' km', '<span class="unit">km</span>'), 'm') + fig('Tiempo en marcha', r.movingS ? fmtClockS(r.movingS * 1000) : '—', 'm') +
      fig('Vel. media', (r.movingS ? Math.round(r.dist / (r.movingS / 3600)) : 0) + '<span class="unit">km/h</span>', 'm') + fig('Vel. máx', (r.vMax || 0) + '<span class="unit">km/h</span>', 'm') +
      fig('Altitud máx', r.altMax != null ? Math.round(r.altMax) + '<span class="unit">m</span>' : '—', 'm') + fig('Desnivel +', r.climb != null ? Math.round(r.climb) + '<span class="unit">m</span>' : '—', 'm');
    var wl = $('#detailWx'); wl.hidden = !r.weather; if (r.weather) wl.innerHTML = '<span><svg style="width:18px;height:18px;vertical-align:-4px;margin-right:4px"><use href="#i-weather"/></svg>Al salir: <b>' + esc(wxText(r.weather)) + '</b></span>';
    renderCornersTable(r);
    renderStars(r); $('#noteText').value = r.note || '';
    $('#btnFav').setAttribute('aria-pressed', String(!!r.favorite));
    var sel = $('#rideVehicle'); sel.innerHTML = '<option value="">Sin vehículo</option>' + vehicles.map(function (v) { return '<option value="' + v.id + '"' + (r.vehicleId === v.id ? ' selected' : '') + '>' + esc(v.name) + '</option>'; }).join('');
    $('#btnExportRide span').textContent = Platform.native ? 'Curvas CSV' : 'Curvas CSV';
    $('#btnGmaps').disabled = !r.hasTrack; $('#btnGpx').disabled = !r.hasTrack; $('#btnAsRoute').disabled = !r.hasTrack; $('#replay').hidden = !r.hasTrack;
    disarm($('#btnDeleteRide'), 'Borrar esta ruta');
    renderPhotos(r.id);
    showView('detail');
    detailTrack = []; cornerMarkers.forEach(function (m) { m.remove(); }); cornerMarkers = [];
    DB.getTrack(r.id).then(function (pts) {
      if (detailId !== r.id) return;
      detailTrack = pts || []; detailCum = detailTrack.length ? Geo.cumulative(detailTrack) : null;
      $('#replayTotal').textContent = detailTrack.length > 1 ? fmtClockS(detailTrack[detailTrack.length - 1][0] - detailTrack[0][0]) : '00:00';
      $('#replayRange').value = 0; rp.t = detailTrack.length ? detailTrack[0][0] : 0; updateReplayPoint();
      return ensureDetailMap().then(function () {
        if (!dmap || detailId !== r.id) return;
        dmap.resize(); drawDetailTrack();
        if (detailTrack.length > 1) { var b = Geo.bounds(detailTrack); dmap.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 36, duration: 0, maxZoom: 16 }); replayMarker.setLngLat([detailTrack[0][2], detailTrack[0][1]]).addTo(dmap); }
        r.corners.forEach(function (c, i) {
          if (c.lat == null) return;
          var e = document.createElement('div'); e.className = 'corner-marker ' + (c.side === 'I' ? 'l' : 'r'); e.textContent = Math.round(c.peak) + '°';
          e.addEventListener('click', function () { selectCorner(i); });
          cornerMarkers.push(new maplibregl.Marker({ element: e }).setLngLat([c.lon, c.lat]).addTo(dmap));
        });
      });
    });
  }
  function renderCornersTable(r) {
    var tb = $('#detailTable tbody'); tb.innerHTML = '';
    r.corners.forEach(function (c, i) {
      var tr = document.createElement('tr'); tr.dataset.i = i;
      tr.innerHTML = '<td>' + (i + 1) + '</td><td>' + fmtClock(c.t) + '</td><td><span class="' + (c.side === 'I' ? 'l' : 'r') + '">' + (c.side === 'I' ? 'Izq' : 'Dcha') + '</span></td><td class="n">' + Math.round(c.peak) + '°</td><td class="n">' + (c.v == null ? '—' : c.v) + '</td><td class="n">' + (c.dur || 0).toFixed(1).replace('.', ',') + '</td>';
      tr.addEventListener('click', function () { selectCorner(i); });
      tb.appendChild(tr);
    });
    // Las curvas van plegadas: al entrar en una ruta se ve el resumen, y la lista solo si se despliega.
    var n = r.corners.length, best = n ? Math.round(Math.max.apply(null, r.corners.map(function (c) { return Math.abs(c.peak || 0); }))) : 0;
    $('#cornersWrap').hidden = n === 0; $('#cornersWrap').open = false; $('#detailEmpty').hidden = n > 0;
    setText('#cornersSum', n + (n === 1 ? ' curva' : ' curvas') + (n ? ' · máxima ' + best + '°' : ''));
  }
  function selectCorner(i) {
    var c = detailRide.corners[i]; if (!c) return;
    $$('#detailTable tr').forEach(function (tr) { tr.classList.toggle('sel', tr.dataset.i == i); });
    if (detailTrack.length && c.t) { rp.playing = false; updatePlayBtn(); rp.t = c.t; updateReplayPoint(true); }
    if (dmap && c.lat != null) dmap.easeTo({ center: [c.lon, c.lat], zoom: Math.max(dmap.getZoom(), 15) });
  }
  $('#btnBack').addEventListener('click', function () { showView('rides'); });
  $$('#colorMode button').forEach(function (b) { b.addEventListener('click', function () { settings.colorMode = b.dataset.m; saveSettings(); $$('#colorMode button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); drawDetailTrack(); }); });
  $$('#colorMode button').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.m === settings.colorMode)); });
  // reproducción
  function updatePlayBtn() { $('#rpPlay').innerHTML = '<svg><use href="#i-' + (rp.playing ? 'pause' : 'play') + '"/></svg>'; }
  function updateReplayPoint(moveMap) {
    if (!detailTrack.length) { ['#rpV', '#rpLean', '#rpAlt', '#rpKm'].forEach(function (id) { $(id).textContent = '—'; }); return; }
    var t0 = detailTrack[0][0], t1 = detailTrack[detailTrack.length - 1][0], t = clamp(rp.t, t0, t1), p = Geo.interpolate(detailTrack, t), i = Geo.indexAtTime(detailTrack, t);
    $('#replayRange').value = Math.round((t - t0) / Math.max(1, t1 - t0) * 1000); $('#replayT').textContent = fmtClockS(t - t0);
    $('#rpV').textContent = p[4] != null ? String(Math.round(p[4] * 3.6)) : '—';
    $('#rpLean').innerHTML = p[6] != null ? '<span class="' + (p[6] < 0 ? 'l' : 'r') + '">' + Math.round(Math.abs(p[6])) + '°</span>' : '—';
    $('#rpAlt').textContent = p[3] != null ? Math.round(p[3]) + ' m' : '—';
    $('#rpKm').textContent = detailCum ? detailCum[i].toFixed(1).replace('.', ',') : '—';
    if (replayMarker && dmap) { replayMarker.setLngLat([p[2], p[1]]); if (moveMap || rp.playing) { var ctr = dmap.getCenter(), b = dmap.getBounds(); if (p[2] < b.getWest() || p[2] > b.getEast() || p[1] < b.getSouth() || p[1] > b.getNorth()) dmap.easeTo({ center: [p[2], p[1]], duration: 300 }); } }
  }
  function replayFrame(ts) {
    if (!rp.playing) return;
    var dt = rp.lastFrame ? ts - rp.lastFrame : 0; rp.lastFrame = ts;
    rp.t += dt * rp.speed;
    var t1 = detailTrack[detailTrack.length - 1][0];
    if (rp.t >= t1) { rp.t = t1; rp.playing = false; updatePlayBtn(); }
    updateReplayPoint();
    if (rp.playing) rp.raf = requestAnimationFrame(replayFrame);
  }
  function stopReplay() { rp.playing = false; rp.lastFrame = 0; if (rp.raf) cancelAnimationFrame(rp.raf); rp.raf = null; updatePlayBtn(); }
  $('#rpPlay').addEventListener('click', function () {
    if (!detailTrack.length) return;
    if (rp.playing) { stopReplay(); return; }
    if (rp.t >= detailTrack[detailTrack.length - 1][0]) rp.t = detailTrack[0][0];
    rp.playing = true; rp.lastFrame = 0; updatePlayBtn(); rp.raf = requestAnimationFrame(replayFrame);
  });
  $('#rpSpeed').addEventListener('click', function () { rp.speed = rp.speed === 1 ? 10 : (rp.speed === 10 ? 50 : 1); $('#rpSpeed').textContent = rp.speed + '×'; });
  $('#replayRange').addEventListener('input', function (e) { if (!detailTrack.length) return; var t0 = detailTrack[0][0], t1 = detailTrack[detailTrack.length - 1][0]; rp.playing = false; updatePlayBtn(); rp.t = t0 + (t1 - t0) * (e.target.value / 1000); updateReplayPoint(true); });
  function jumpCorner(dir) {
    if (!detailRide || !detailRide.corners.length) return;
    var cs = detailRide.corners, idx = -1;
    for (var i = 0; i < cs.length; i++) { if (dir > 0 && cs[i].t > rp.t + 500) { idx = i; break; } if (dir < 0 && cs[i].t < rp.t - 500) idx = i; }
    if (idx >= 0) selectCorner(idx);
  }
  $('#rpPrev').addEventListener('click', function () { jumpCorner(-1); }); $('#rpNext').addEventListener('click', function () { jumpCorner(1); });
  // nota, estrellas, favorita, vehículo, nombre
  function renderStars(r) { var s = $('#stars'); s.innerHTML = ''; for (var i = 1; i <= 5; i++) { var b = document.createElement('button'); b.type = 'button'; b.className = i <= (r.stars || 0) ? 'on' : ''; b.innerHTML = '<svg><use href="#i-star"/></svg>'; b.dataset.v = i; b.addEventListener('click', function (e) { var v = +e.currentTarget.dataset.v; r.stars = r.stars === v ? 0 : v; DB.putRide(r).then(checkAchievements); renderStars(r); }); s.appendChild(b); } var lbl = document.createElement('span'); lbl.className = 'muted'; lbl.style.marginLeft = '8px'; lbl.textContent = r.stars ? r.stars + '/5' : 'Sin puntuar'; s.appendChild(lbl); }
  var noteTimer = null;
  $('#noteText').addEventListener('input', function (e) { if (!detailRide) return; detailRide.note = e.target.value; if (noteTimer) clearTimeout(noteTimer); noteTimer = setTimeout(function () { DB.putRide(detailRide); }, 500); });
  $('#btnFav').addEventListener('click', function () { if (!detailRide) return; detailRide.favorite = !detailRide.favorite; $('#btnFav').setAttribute('aria-pressed', String(detailRide.favorite)); DB.putRide(detailRide); });
  $('#rideVehicle').addEventListener('change', function (e) { if (!detailRide) return; detailRide.vehicleId = e.target.value ? +e.target.value : null; DB.putRide(detailRide); });
  $('#btnRename').addEventListener('click', function () {
    if (!detailRide) return;
    var wrap = document.createElement('div'); wrap.className = 'form'; wrap.style.marginTop = '8px';
    wrap.innerHTML = '<input type="text" id="renameInput" maxlength="60" placeholder="Nombre de la ruta" value="' + esc(detailRide.name || '') + '"><div class="actions"><button class="btn" type="button" id="renameCancel">Cancelar</button><button class="btn primary" type="button" id="renameOk">Guardar</button></div>';
    var host = $('#btnRename').parentNode; host.parentNode.insertBefore(wrap, host);
    $('#renameInput').focus();
    $('#renameCancel').addEventListener('click', function () { wrap.remove(); });
    $('#renameOk').addEventListener('click', function () { detailRide.name = $('#renameInput').value.trim(); DB.putRide(detailRide).then(checkAchievements).then(function () { wrap.remove(); $('#detailTitle').innerHTML = esc(rideTitle(detailRide)) + ' <span class="muted">· ' + fmtClock(detailRide.start) + '</span>'; }); });
  });
  function disarm(b, label) { b.classList.remove('armed'); b.dataset.armed = ''; if (b._html != null) { b.innerHTML = b._html; b._html = null; } else if (!b.querySelector('svg')) b.textContent = label; if (b._t) clearTimeout(b._t); }
  function armOrRun(b, label, armedLabel, fn) { if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.classList.add('armed'); b._html = b.innerHTML; b.textContent = armedLabel; b._t = setTimeout(function () { disarm(b, label); }, 4000); return; } disarm(b, label); fn(); }
  $('#btnDeleteRide').addEventListener('click', function () { armOrRun($('#btnDeleteRide'), 'Borrar esta ruta', 'Toca otra vez para borrar', function () { if (window.RGSync) RGSync.rideDeleted(detailId); DB.deleteRide(detailId).then(reloadRides).then(function () { showView('rides'); }); }); });
  // fotos
  function renderPhotos(rideId) {
    if (window.RGSync) RGSync.pullPhotos(rideId).then(function (n) { if (n && detailId === rideId) renderPhotos(rideId); });
    DB.photosOf(rideId).then(function (ps) {
      var g = $('#photos'); g.innerHTML = '';
      ps.forEach(function (p) {
        var d = document.createElement('div'); d.className = 'ph';
        var img = document.createElement('img'); img.src = p.data; img.alt = ''; img.addEventListener('click', function () { $('#lightboxImg').src = p.data; $('#lightbox').hidden = false; });
        var del = document.createElement('button'); del.type = 'button'; del.className = 'del'; del.innerHTML = '<svg><use href="#i-close"/></svg>'; del.addEventListener('click', function () { if (window.RGSync) RGSync.photoDeleted(p); DB.deletePhoto(p.id).then(function () { renderPhotos(rideId); }); });
        d.appendChild(img); d.appendChild(del); g.appendChild(d);
      });
      var add = document.createElement('button'); add.type = 'button'; add.className = 'add'; add.innerHTML = '<svg><use href="#i-camera"/></svg>Añadir foto'; add.addEventListener('click', function () { $('#photoFile').value = ''; $('#photoFile').click(); }); g.appendChild(add);
    });
  }
  $('#lightbox').addEventListener('click', function () { $('#lightbox').hidden = true; });
  $('#photoFile').addEventListener('change', function (e) {
    var files = Array.prototype.slice.call(e.target.files || []), rideId = detailId; if (!files.length || !rideId) return;
    Promise.all(files.slice(0, 10).map(function (f) { return shrinkImage(f, 1280); })).then(function (datas) {
      return Promise.all(datas.filter(Boolean).map(function (data) { return DB.putPhoto({ id: Date.now() + Math.random(), rideId: rideId, data: data, t: Date.now() }); }));
    }).then(function () { renderPhotos(rideId); return setFlag('photo'); }).catch(function () { toast('No se pudo guardar la foto.', 'bad'); });
  });
  function shrinkImage(file, max) {
    return new Promise(function (resolve) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () { var k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.82)); };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }
  // exportaciones
  function rideFileBase(r) { return 'inclina_' + new Date(r.start).toISOString().slice(0, 16).replace(/[:T]/g, '-'); }
  function exportFail(e) { if (!/abort|cancel/i.test(String(e))) toast('No se ha podido exportar en este dispositivo.', 'bad'); }
  // Una ruta grabada se puede convertir en ruta para seguir (y, desde Planificadas, publicarla).
  $('#btnAsRoute').addEventListener('click', function () {
    if (!detailRide || !window.RGNav) return;
    var r = detailRide;
    DB.getTrack(r.id).then(function (pts) {
      if (!pts || pts.length < 2) { toast('Esta ruta no tiene trazado.', 'warn'); return; }
      return RGNav.trackAsPlan(rideTitle(r), pts.map(function (p) { return [p[2], p[1]]; }));
    });
  });
  $('#btnGpx').addEventListener('click', function () {
    if (!detailRide) return;
    DB.getTrack(detailRide.id).then(function (pts) { return Platform.downloadCsv(rideFileBase(detailRide) + '.gpx', Geo.toGpx(detailRide, pts), 'Ruta Inclina ' + rideTitle(detailRide)); }).then(function () { return setFlag('gpxExport'); }).catch(exportFail);
  });
  $('#btnGmaps').addEventListener('click', function () { if (!detailRide) return; DB.getTrack(detailRide.id).then(function (pts) { var u = Geo.googleMapsUrl(pts); if (u) Platform.openExternal(u); else toast('Esta ruta no tiene trazado.', 'warn'); }); });
  $('#btnShareCard').addEventListener('click', function () { if (!detailRide) return; DB.getTrack(detailRide.id).then(function (pts) { return makeShareCard(detailRide, pts); }).then(function (data) { return Platform.sharePng(rideFileBase(detailRide) + '.png', data, 'Ruta Inclina ' + rideTitle(detailRide)); }).then(function () { return setFlag('card'); }).catch(exportFail); });
  function csvFor(list) {
    var rows = [['fecha', 'hora_inicio', 'ruta', 'curva', 'hora_curva', 'lado', 'angulo_max_grados', 'velocidad_kmh', 'duracion_s', 'lat', 'lon', 'max_izq_ruta', 'max_dcha_ruta', 'km_ruta']];
    list.forEach(function (r) {
      var d = new Date(r.start), fecha = d.toISOString().slice(0, 10), hora = d.toTimeString().slice(0, 5);
      if (!r.corners.length) rows.push([fecha, hora, rideTitle(r), '', '', '', '', '', '', '', '', r.maxL, r.maxR, r.dist || 0]);
      r.corners.forEach(function (c, i) { rows.push([fecha, hora, rideTitle(r), i + 1, new Date(c.t).toTimeString().slice(0, 8), c.side === 'I' ? 'izquierda' : 'derecha', c.peak, c.v == null ? '' : c.v, c.dur, c.lat == null ? '' : c.lat, c.lon == null ? '' : c.lon, r.maxL, r.maxR, r.dist || 0]); });
    });
    return '﻿' + rows.map(function (r) { return r.map(function (x) { var s = String(x); return (typeof x === 'number') ? s.replace('.', ',') : (/[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s); }).join(';'); }).join('\r\n');
  }
  $('#btnExportRide').addEventListener('click', function () { if (!detailRide) return; Platform.downloadCsv(rideFileBase(detailRide) + '_curvas.csv', csvFor([detailRide]), 'Curvas ' + rideTitle(detailRide)).catch(exportFail); });
  $('#btnExportAll').addEventListener('click', function () { Platform.downloadCsv('regroupride_todas_las_curvas.csv', csvFor(rides), 'Inclina: todas las curvas').catch(exportFail); });

  /* tarjeta para compartir (canvas 1080×1350) */
  function makeShareCard(r, pts) {
    var W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H; var g = c.getContext('2d');
    var dark = isDark(), bg = dark ? '#121110' : '#F4F2EC', fg = dark ? '#F2EDE3' : '#15140F', fg2 = dark ? '#A39E93' : '#5C5A52', accent = dark ? '#FFAE1A' : '#B8420E', left = dark ? '#5FA8FF' : '#1D5FCC', right = dark ? '#FF66B8' : '#B3177A', line = dark ? '#3A3833' : '#C9C5B9';
    var ready = document.fonts && document.fonts.load ? Promise.all([document.fonts.load('800 60px "Barlow Condensed"'), document.fonts.load('600 30px "Barlow"')]).catch(function () {}) : Promise.resolve();
    return ready.then(function () {
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      g.fillStyle = accent; g.font = '800 54px "Barlow Condensed", sans-serif'; g.fillText('INCLINA', 72, 110);
      g.fillStyle = fg2; g.font = '600 30px "Barlow", sans-serif'; g.fillText(fmtDateLong(r.start) + ' · ' + fmtClock(r.start), 72, 160);
      g.fillStyle = fg; g.font = '700 64px "Barlow Condensed", sans-serif'; g.fillText(rideTitle(r), 72, 240);
      // trazado
      var box = { x: 72, y: 290, w: W - 144, h: 560 };
      g.fillStyle = dark ? '#1C1B19' : '#FCFBF8'; roundRect(g, box.x, box.y, box.w, box.h, 24); g.fill(); g.strokeStyle = line; g.lineWidth = 3; g.stroke();
      if (pts && pts.length > 1) {
        var s = Geo.simplify(pts, 10), b = Geo.bounds(s), cosLat = Math.cos(((b[1] + b[3]) / 2) * Math.PI / 180), w = (b[2] - b[0]) * cosLat, h = (b[3] - b[1]), span = Math.max(w, h, 1e-6), pad = 50, k = Math.min((box.w - 2 * pad) / Math.max(w, 1e-6), (box.h - 2 * pad) / Math.max(h, 1e-6));
        var ox = box.x + pad + ((box.w - 2 * pad) - w * k) / 2, oy = box.y + pad + ((box.h - 2 * pad) - h * k) / 2;
        g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = 14; g.strokeStyle = dark ? 'rgba(0,0,0,.35)' : 'rgba(255,255,255,.9)';
        g.beginPath(); s.forEach(function (p, i) { var x = ox + (p[2] - b[0]) * cosLat * k, y = oy + (b[3] - p[1]) * k; if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke();
        g.lineWidth = 8;
        for (var i = 1; i < s.length; i++) { var a = s[i - 1], q = s[i]; g.strokeStyle = Geo.leanColor(Math.abs(a[6] || 0) >= Math.abs(q[6] || 0) ? (a[6] || 0) : (q[6] || 0)); g.beginPath(); g.moveTo(ox + (a[2] - b[0]) * cosLat * k, oy + (b[3] - a[1]) * k); g.lineTo(ox + (q[2] - b[0]) * cosLat * k, oy + (b[3] - q[1]) * k); g.stroke(); }
      } else { g.fillStyle = fg2; g.font = '600 32px "Barlow", sans-serif'; g.textAlign = 'center'; g.fillText('Sin trazado', box.x + box.w / 2, box.y + box.h / 2); g.textAlign = 'left'; }
      // cifras
      var y0 = 930, cols = [[72, 'MÁX IZQ', Math.round(r.maxL) + '°', left], [W / 2 - 100, 'MÁX DCHA', Math.round(r.maxR) + '°', right], [W - 330, 'VEL. MÁX', (r.vMax || 0) + ' km/h', fg]];
      cols.forEach(function (col) { g.fillStyle = fg2; g.font = '600 26px "Barlow Condensed", sans-serif'; g.fillText(col[1], col[0], y0); g.fillStyle = col[3]; g.font = '800 110px "Barlow Condensed", sans-serif'; g.fillText(col[2], col[0], y0 + 110); });
      var y1 = 1160, cols2 = [[72, 'DISTANCIA', fmtKm(r.dist)], [W / 2 - 100, 'EN MARCHA', fmtDur((r.movingS || 0) * 1000)], [W - 330, 'CURVAS', String(r.corners.length)]];
      cols2.forEach(function (col) { g.fillStyle = fg2; g.font = '600 26px "Barlow Condensed", sans-serif'; g.fillText(col[1], col[0], y1); g.fillStyle = fg; g.font = '700 64px "Barlow Condensed", sans-serif'; g.fillText(col[2], col[0], y1 + 70); });
      g.fillStyle = fg2; g.font = '500 24px "Barlow", sans-serif'; g.fillText('Ángulo de inclinación medido con giróscopo · inclina.arrelbit.es', 72, H - 50);
      return c.toDataURL('image/png');
    });
  }
  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  /* ---------- estadísticas ---------- */
  var stats = { mode: 'month', y: new Date().getFullYear(), m: new Date().getMonth() };
  function ridesIn(y, m) { return rides.filter(function (r) { var d = new Date(r.start); return d.getFullYear() === y && (m == null || d.getMonth() === m); }); }
  function renderStats() {
    // metas semanales (lunes a domingo)
    var now = new Date(), dow = (now.getDay() + 6) % 7, monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow).getTime();
    var week = rides.filter(function (r) { return r.start >= monday; }), wh = week.reduce(function (s, r) { return s + (r.movingS || 0); }, 0) / 3600, wdays = {}; week.forEach(function (r) { wdays[new Date(r.start).toDateString()] = 1; });
    var goals = [['Horas en carretera', wh, 3, function (v) { return v.toFixed(1).replace('.', ','); }], ['Días activos', Object.keys(wdays).length, 3, String], ['Rutas de la semana', week.length, 3, String]];
    var done = goals.filter(function (g) { return g[1] >= g[2]; }).length;
    $('#goals').innerHTML = '<div class="goal"><span class="label" style="color:var(--color-text)">Metas semanales</span><span class="label">' + done + ' / 3</span></div>' + goals.map(function (g) { return '<div class="goal"><span>' + g[0] + '</span><span class="muted cifra">' + g[3](g[1]) + ' / ' + g[2] + '</span><span class="bar3"><i style="width:' + Math.min(100, g[1] / g[2] * 100) + '%"></i></span></div>'; }).join('');
    // periodo
    var inP = stats.mode === 'month' ? ridesIn(stats.y, stats.m) : ridesIn(stats.y, null);
    $('#perLabel').textContent = stats.mode === 'month' ? monthName(stats.y, stats.m) : String(stats.y);
    var km = inP.reduce(function (s, r) { return s + (r.dist || 0); }, 0), secs = inP.reduce(function (s, r) { return s + (r.movingS || 0); }, 0);
    $('#perKm').innerHTML = Math.round(km) + '<small>km</small>';
    $('#perRow').innerHTML = fig('Rutas', String(inP.length)) + fig('Horas', fmtDur(secs * 1000).replace(' min', 'm').replace(' h ', 'h ')) + fig('Media', (secs ? Math.round(km / (secs / 3600)) : 0) + '<span class="unit">km/h</span>') + fig('Curvas', String(inP.reduce(function (s, r) { return s + r.corners.length; }, 0)));
    // gráfico
    var bars = [], labels = [];
    if (stats.mode === 'month') { var days = new Date(stats.y, stats.m + 1, 0).getDate(); for (var d = 1; d <= days; d++) { bars.push(0); labels.push(d % 5 === 0 || d === 1 ? String(d) : ''); } inP.forEach(function (r) { bars[new Date(r.start).getDate() - 1] += r.dist || 0; }); $('#chartLabel').textContent = 'Km por día · máx ' + Math.round(Math.max.apply(null, bars.concat([0]))) + ' km'; }
    else { for (var mo = 0; mo < 12; mo++) { bars.push(0); labels.push('EFMAMJJASOND'[mo]); } inP.forEach(function (r) { bars[new Date(r.start).getMonth()] += r.dist || 0; }); $('#chartLabel').textContent = 'Km por mes · máx ' + Math.round(Math.max.apply(null, bars.concat([0]))) + ' km'; }
    var svg = $('#chart'); svg.innerHTML = ''; var n = bars.length, max = Math.max.apply(null, bars.concat([1])), bw = 360 / n;
    bars.forEach(function (v, i) { var h = v / max * 120, re = el('rect', { x: (i * bw + 1).toFixed(1), y: (130 - h).toFixed(1), width: Math.max(1, bw - 2).toFixed(1), height: h.toFixed(1), rx: 2, 'class': v ? '' : 'dim' }); if (!v) { re.setAttribute('height', 2); re.setAttribute('y', 128); } svg.appendChild(re); if (labels[i]) { var t = el('text', { x: (i * bw + bw / 2).toFixed(1), y: 146, 'text-anchor': 'middle' }); t.textContent = labels[i]; svg.appendChild(t); } });
    // récords del periodo
    var vMax = inP.reduce(function (s, r) { return Math.max(s, r.vMax || 0); }, 0), longest = inP.reduce(function (b, r) { return !b || (r.dist || 0) > (b.dist || 0) ? r : b; }, null), lean = inP.reduce(function (s, r) { return Math.max(s, r.maxL || 0, r.maxR || 0); }, 0);
    $('#perRecords').innerHTML = fig('Vel. máx', vMax + '<span class="unit">km/h</span>') + fig('Incl. máx', Math.round(lean) + '°') + fig('Ruta más larga', longest ? fmtKm(longest.dist).replace(' km', '<span class="unit">km</span>') : '—') + fig('Km totales', Math.round(rides.reduce(function (s, r) { return s + (r.dist || 0); }, 0)) + '<span class="unit">km</span>');
    // racha
    var daysSet = {}; rides.forEach(function (r) { daysSet[new Date(r.start).toDateString()] = 1; });
    var streak = 0, cur = new Date(); cur.setHours(0, 0, 0, 0); if (!daysSet[cur.toDateString()]) cur.setDate(cur.getDate() - 1);
    while (daysSet[cur.toDateString()]) { streak++; cur.setDate(cur.getDate() - 1); }
    var best = 0, run = 0, keys = Object.keys(daysSet).map(function (k) { return new Date(k).getTime(); }).sort(function (a, b) { return a - b; });
    for (var i = 0; i < keys.length; i++) { run = (i > 0 && keys[i] - keys[i - 1] <= 86400000 * 1.5) ? run + 1 : 1; if (run > best) best = run; }
    $('#streak').innerHTML = '<div class="goal"><span class="label" style="color:var(--color-text)">Racha activa</span><span class="cifra" style="font-size:26px;color:var(--color-accent)">' + streak + (streak === 1 ? ' día' : ' días') + '</span><span class="muted" style="grid-column:1/-1">' + (streak ? 'Días seguidos con al menos una ruta.' : 'Sal hoy y empieza una.') + ' Mejor racha: ' + best + (best === 1 ? ' día' : ' días') + '.</span></div>';
  }
  $$('#statsMode button').forEach(function (b) { b.addEventListener('click', function () { stats.mode = b.dataset.m; $$('#statsMode button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); renderStats(); }); });
  $('#perPrev').addEventListener('click', function () { if (stats.mode === 'month') { stats.m--; if (stats.m < 0) { stats.m = 11; stats.y--; } } else stats.y--; renderStats(); });
  $('#perNext').addEventListener('click', function () { if (stats.mode === 'month') { stats.m++; if (stats.m > 11) { stats.m = 0; stats.y++; } } else stats.y++; renderStats(); });

  /* ---------- garaje ---------- */
  var editingVehicle = null, vType = 'moto';
  function renderGarage() {
    var box = $('#vehicles'); box.innerHTML = '';
    var km = rides.reduce(function (s, r) { return s + (r.dist || 0); }, 0);
    var pend = maintDueSummary(), nDue = pend.filter(function (x) { return x.st === 'due'; }).length;
    $('#garageSummary').innerHTML = fig('Km totales', Math.round(km) + '<span class="unit">km</span>') + fig('Rutas', String(rides.length)) + fig('Vehículos', String(vehicles.length)) + fig('Mantenim.', nDue ? '<span style="color:var(--color-error)">' + nDue + '</span>' : (pend.length ? '<span style="color:var(--color-warn)">' + pend.length + '</span>' : '<span style="color:var(--color-ok)">OK</span>'));
    $('#maintForm').hidden = true;
    if (!vehicles.length) { box.innerHTML = '<div class="empty">Añade tu moto para llevar el odómetro y asociarle las rutas.</div>'; return; }
    var principal = vehicles.filter(function (v) { return v.principal; })[0];
    vehicles.forEach(function (v) {
      var mine = rides.filter(function (r) { return r.vehicleId === v.id || (!r.vehicleId && principal && principal.id === v.id); });
      var vkm = mine.reduce(function (s, r) { return s + (r.dist || 0); }, 0), vs = mine.reduce(function (s, r) { return s + (r.movingS || 0); }, 0), odo = Math.round((v.odoStart || 0) + vkm), digits = String(odo).padStart(6, '0');
      var d = document.createElement('div'); d.className = 'vehicle' + (v.principal ? ' main' : '');
      d.innerHTML = '<div class="vhead"><div>' + (v.principal ? '<span class="mstatus ok"><svg><use href="#i-check"/></svg>principal</span>' : '<span class="label">' + (v.type === 'coche' ? 'Coche' : 'Moto') + '</span>') + '<div class="name">' + esc(v.name) + '</div><div class="muted">' + esc([[v.make, v.model].filter(Boolean).join(' '), v.leanLimit ? 'margen orientativo ' + v.leanLimit + '°' : ''].filter(Boolean).join(' · ')) + '</div></div></div>' +
        '<div><span class="label">Odómetro · km</span><br><span class="odo">' + digits.slice(0, 5) + '<b>' + digits.slice(5) + '</b></span></div>' +
        '<div class="vstats">' + fig('Rutas', String(mine.length)) + fig('Horas', (vs / 3600).toFixed(0)) + fig('Km en la app', Math.round(vkm) + '') + '</div>' +
        '<div class="actions">' + (v.principal ? '' : '<button class="btn small" type="button" data-act="main">Hacer principal</button>') + '<button class="btn small" type="button" data-act="edit"><svg><use href="#i-edit"/></svg>Editar</button><button class="btn small danger" type="button" data-act="del">Quitar del garaje</button></div>' +
        maintHtml(v, odo);
      d.querySelectorAll('button').forEach(function (b) { b.addEventListener('click', function () {
        if (b.dataset.act === 'main') { vehicles.forEach(function (x) { x.principal = x.id === v.id; }); Promise.all(vehicles.map(DB.putVehicle)).then(renderGarage); }
        if (b.dataset.act === 'edit') openVehicleForm(v);
        if (b.dataset.act === 'del') armOrRun(b, 'Quitar del garaje', 'Toca otra vez para quitar', function () { DB.deleteVehicle(v.id).then(reloadVehicles).then(renderGarage); });
        if (b.dataset.act === 'addm') openMaintForm(v, null, odo);
        if (b.dataset.act === 'preset') previewPreset(v, odo);
        if (b.dataset.act === 'mdone') markMaintDone(v, b.dataset.m, odo);
        if (b.dataset.act === 'medit') openMaintForm(v, v.maint.filter(function (m) { return m.id === b.dataset.m; })[0], odo);
      }); });
      box.appendChild(d);
    });
  }
  function reloadVehicles() { return DB.allVehicles().then(function (a) { vehicles = a; return a; }); }

  /* ---------- mantenimiento por km ---------- */
  // Plan de la Zontes 703RR según la tabla de mantenimiento periódico del manual de taller (págs. 30-31):
  // aceite cada 5.000 km o 15 meses (primero a 500 km), filtro de aceite cada 10.000, filtro de aire cada 10.000, bujías cada 20.000,
  // líquido de frenos 2 años o 20.000 km, refrigerante 3 años o 30.000 km, latiguillos 4 años o 40.000 km, válvulas cada 40.000 km.
  var PRESETS = {
    zontes703: { name: 'Zontes 703RR (manual de taller)', items: [
      ['Aceite motor', 5000, 15], ['Filtro de aceite', 10000, null], ['Filtro de aire', 10000, null], ['Bujías', 20000, null],
      ['Líquido de frenos', 20000, 24], ['Refrigerante', 30000, 36], ['Latiguillos de freno', 40000, 48], ['Holgura de válvulas', 40000, null],
      ['Pastillas de freno: revisar', 5000, null], ['Revisión general: ruedas, dirección y tornillería', 5000, 12], ['Cadena: limpiar y engrasar', 1000, null]] },
    generic: { name: 'Plan genérico', items: [['Aceite motor', 5000, 12], ['Filtro de aceite', 10000, null], ['Filtro de aire', 10000, null], ['Bujías', 20000, null], ['Líquido de frenos', 20000, 24], ['Refrigerante', 30000, 36], ['Pastillas de freno: revisar', 5000, null], ['Cadena: limpiar y engrasar', 1000, null]] }
  };
  function isZontes(v) { return /zontes/i.test(v.make || '') || /703/.test(v.model || '') || /703/.test(v.name || ''); }
  function maintState(m, odo) {
    var kmUsed = Math.max(0, odo - (m.lastKm || 0)), kmLeft = m.everyKm ? m.everyKm - kmUsed : null;
    var moLeft = m.everyMonths && m.lastAt ? m.everyMonths - (Date.now() - m.lastAt) / (30.44 * 86400000) : null;
    var frac = 0; if (m.everyKm) frac = Math.max(frac, kmUsed / m.everyKm); if (moLeft != null) frac = Math.max(frac, 1 - moLeft / m.everyMonths);
    var st = 'ok'; if ((kmLeft != null && kmLeft <= 0) || (moLeft != null && moLeft <= 0)) st = 'due'; else if ((kmLeft != null && kmLeft <= Math.max(300, m.everyKm * 0.15)) || (moLeft != null && moLeft <= 1)) st = 'soon';
    return { kmLeft: kmLeft, moLeft: moLeft, frac: Math.min(1, frac), st: st };
  }
  function maintHtml(v, odo) {
    var items = v.maint || [], worst = 'ok', rows = '';
    items.map(function (m) { return { m: m, s: maintState(m, odo) }; }).sort(function (a, b) { return a.s.frac < b.s.frac ? 1 : -1; }).forEach(function (x) {
      var m = x.m, s = x.s; if (s.st === 'due') worst = 'due'; else if (s.st === 'soon' && worst !== 'due') worst = 'soon';
      var when = [];
      if (s.kmLeft != null) when.push(s.kmLeft <= 0 ? 'pasado por ' + fmtInt(-s.kmLeft) + ' km' : 'quedan ' + fmtInt(s.kmLeft) + ' km');
      if (s.moLeft != null) when.push(s.moLeft <= 0 ? 'pasado por ' + Math.round(-s.moLeft) + ' meses' : 'quedan ' + (s.moLeft < 1 ? 'días' : Math.round(s.moLeft) + ' meses'));
      var every = [m.everyKm ? 'cada ' + fmtInt(m.everyKm) + ' km' : null, m.everyMonths ? (m.everyKm ? 'o ' : 'cada ') + m.everyMonths + ' meses' : null].filter(Boolean).join(' ');
      rows += '<div class="mitem ' + s.st + '"><button class="edit" type="button" data-act="medit" data-m="' + m.id + '"><div class="mname">' + esc(m.name) + '</div><div class="msub">' + every + ' · ' + when.join(' · ') + (m.lastAt ? ' · última: ' + fmtDate(m.lastAt).toLowerCase() + (m.lastKm ? ' a ' + fmtInt(m.lastKm) + ' km' : '') : '') + '</div></button>' +
        '<span class="mstatus ' + s.st + '">' + ({ ok: '<svg><use href="#i-check"/></svg>al día', soon: '<svg><use href="#i-clock"/></svg>toca pronto', due: '<svg><use href="#i-warn"/></svg>pasada' })[s.st] + '</span><button class="btn small" type="button" data-act="mdone" data-m="' + m.id + '"><svg><use href="#i-check"/></svg>Hecho</button><div class="bar3"><i style="width:' + Math.round(s.frac * 100) + '%"></i></div></div>';
    });
    return '<div class="maint"><div class="mhead"><span class="label">Mantenimiento</span>' + (items.length ? '<span class="mstatus ' + worst + '">' + ({ ok: '<svg><use href="#i-check"/></svg>todo al día', soon: '<svg><use href="#i-clock"/></svg>algo toca pronto', due: '<svg><use href="#i-warn"/></svg>hay algo pasado' })[worst] + '</span>' : '') + '</div>' +
      (items.length ? rows : '<div class="muted">Lleva el aceite, los filtros y el resto por km: te avisa cuando toca.</div>') +
      '<div class="actions" style="margin-top:var(--sp-2)"><button class="btn small" type="button" data-act="addm"><svg><use href="#i-plus"/></svg>Tarea</button><button class="btn small" type="button" data-act="preset"><svg><use href="#i-sliders"/></svg>' + (isZontes(v) ? 'Plan 703RR' : 'Plan genérico') + '</button></div></div>';
  }
  function fmtInt(n) { return Math.round(n).toLocaleString('es-ES'); }
  // El plan no se pone solo: primero se enseña lo que se va a añadir, se puede quitar o cambiar cada tarea, y hay que confirmar.
  function previewPreset(v, odo) {
    var C = window.RGCloud; if (!C) { loadPreset(v, odo); return; }
    var p = isZontes(v) ? PRESETS.zontes703 : PRESETS.generic, have = (v.maint || []).map(function (m) { return m.name.toLowerCase(); });
    var fresh = p.items.filter(function (it) { return have.indexOf(it[0].toLowerCase()) < 0; }), old = p.items.length - fresh.length;
    if (!fresh.length) { toast('Ese plan ya está cargado.', 'warn'); return; }
    C.sheet('<div class="head"><h1>Plan de mantenimiento</h1><button class="btn small icon" id="prX" type="button"><svg><use href="#i-close"/></svg></button></div>' +
      '<p>' + esc(p.name) + '. Esto es lo que se añadiría a <b>' + esc(v.name || 'tu moto') + '</b>, contando desde ' + fmtInt(odo) + ' km. Quita lo que no quieras y cambia los intervalos antes de confirmar.</p>' +
      '<div class="pr-head"><span></span><span>Tarea</span><span>Cada km</span><span>Meses</span></div>' +
      fresh.map(function (it, i) { return '<div class="pr-row" data-i="' + i + '"><input type="checkbox" checked aria-label="Añadir ' + esc(it[0]) + '"><input type="text" class="pr-n" maxlength="40" value="' + esc(it[0]) + '"><input type="number" class="pr-k" inputmode="numeric" min="0" step="500" value="' + (it[1] || '') + '"><input type="number" class="pr-m" inputmode="numeric" min="0" value="' + (it[2] || '') + '" placeholder="—"></div>'; }).join('') +
      (old ? '<p class="muted rg-small" style="text-align:left">' + old + (old === 1 ? ' tarea del plan ya la tienes' : ' tareas del plan ya las tienes') + ' y no se repite.</p>' : '') +
      '<button class="btn big primary" id="prOk" type="button"></button><button class="btn rg-skip" id="prNo" type="button">Cancelar</button>');
    var rows = $$('#rgSheet .pr-row'), okb = $('#prOk');
    var count = function () { var n = rows.filter(function (r) { return r.querySelector('input[type=checkbox]').checked; }).length; okb.textContent = n ? 'Añadir ' + n + (n === 1 ? ' tarea' : ' tareas') : 'Marca alguna tarea'; okb.disabled = !n; };
    rows.forEach(function (r) { r.querySelector('input[type=checkbox]').addEventListener('change', function () { r.classList.toggle('off', !this.checked); count(); }); });
    count();
    $('#prX').addEventListener('click', C.closeSheet); $('#prNo').addEventListener('click', C.closeSheet);
    okb.addEventListener('click', function () {
      var added = 0; v.maint = v.maint || [];
      rows.forEach(function (r) {
        if (!r.querySelector('input[type=checkbox]').checked) return;
        var name = r.querySelector('.pr-n').value.trim(), km = parseInt(r.querySelector('.pr-k').value, 10) || null, mo = parseInt(r.querySelector('.pr-m').value, 10) || null;
        if (!name || (!km && !mo)) return;
        v.maint.push({ id: 'm' + Date.now() + '-' + (added++), name: name, everyKm: km, everyMonths: mo, lastKm: odo, lastAt: Date.now() });
      });
      C.closeSheet();
      if (!added) { toast('No se ha añadido nada: cada tarea necesita nombre y un intervalo.', 'warn'); return; }
      DB.putVehicle(v).then(reloadVehicles).then(function () { renderGarage(); toast(added + (added === 1 ? ' tarea añadida' : ' tareas añadidas') + ', contando desde ' + fmtInt(odo) + ' km. Toca una tarea para ajustar cuándo se hizo.', 'ok'); });
    });
  }
  function loadPreset(v, odo) {
    var p = isZontes(v) ? PRESETS.zontes703 : PRESETS.generic, have = (v.maint || []).map(function (m) { return m.name.toLowerCase(); }), added = 0;
    v.maint = v.maint || [];
    p.items.forEach(function (it) { if (have.indexOf(it[0].toLowerCase()) >= 0) return; v.maint.push({ id: 'm' + Date.now() + '-' + (added++), name: it[0], everyKm: it[1], everyMonths: it[2], lastKm: odo, lastAt: Date.now() }); });
    DB.putVehicle(v).then(reloadVehicles).then(function () { renderGarage(); toast(added ? p.name + ': ' + added + ' tareas añadidas, contando desde ' + fmtInt(odo) + ' km. Toca una tarea para ajustar cuándo se hizo.' : 'Ese plan ya está cargado.', added ? 'ok' : 'warn'); });
  }
  function markMaintDone(v, id, odo) {
    var m = (v.maint || []).filter(function (x) { return x.id === id; })[0]; if (!m) return;
    m.lastKm = odo; m.lastAt = Date.now(); v.maintLog = (v.maintLog || []).concat([{ id: id, name: m.name, km: odo, at: m.lastAt }]).slice(-200);
    DB.putVehicle(v).then(reloadVehicles).then(function () { renderGarage(); toast(m.name + ': anotado a ' + fmtInt(odo) + ' km.', 'ok'); return setFlag('maint'); });
  }
  var maintCtx = null;
  function openMaintForm(v, m, odo) {
    maintCtx = { v: v, m: m, odo: odo };
    $('#maintFormTitle').textContent = m ? 'Editar tarea' : 'Nueva tarea de mantenimiento';
    $('#mName').value = m ? m.name : ''; $('#mKm').value = m ? (m.everyKm || '') : ''; $('#mMonths').value = m ? (m.everyMonths || '') : '';
    $('#mLastKm').value = m ? (m.lastKm != null ? m.lastKm : '') : odo; $('#mLastDate').value = new Date(m && m.lastAt ? m.lastAt : Date.now()).toISOString().slice(0, 10);
    $('#mDelete').hidden = !m; disarm($('#mDelete'), 'Quitar esta tarea');
    $('#vehicleForm').hidden = true; $('#maintForm').hidden = false; $('#maintForm').scrollIntoView({ block: 'start', behavior: 'smooth' }); $('#mName').focus();
  }
  $('#mCancel').addEventListener('click', function () { $('#maintForm').hidden = true; }); $('#mClose').addEventListener('click', function () { $('#maintForm').hidden = true; });
  $('#mSave').addEventListener('click', function () {
    if (!maintCtx) return;
    var name = $('#mName').value.trim(), km = parseInt($('#mKm').value, 10) || 0, mo = parseInt($('#mMonths').value, 10) || 0;
    if (!name) { $('#mName').focus(); return; } if (!km && !mo) { $('#mKm').focus(); toast('Indica cada cuántos km o meses toca.', 'warn'); return; }
    var v = maintCtx.v, m = maintCtx.m || { id: 'm' + Date.now() }; v.maint = v.maint || []; if (!maintCtx.m) v.maint.push(m);
    m.name = name; m.everyKm = km || null; m.everyMonths = mo || null; m.lastKm = parseInt($('#mLastKm').value, 10) || 0; var d = $('#mLastDate').value; m.lastAt = d ? new Date(d + 'T12:00:00').getTime() : Date.now();
    DB.putVehicle(v).then(reloadVehicles).then(function () { $('#maintForm').hidden = true; renderGarage(); return setFlag('maint'); });
  });
  $('#mDelete').addEventListener('click', function () { armOrRun($('#mDelete'), 'Quitar esta tarea', 'Toca otra vez para quitar', function () { var v = maintCtx.v; v.maint = (v.maint || []).filter(function (x) { return x.id !== maintCtx.m.id; }); DB.putVehicle(v).then(reloadVehicles).then(function () { $('#maintForm').hidden = true; renderGarage(); }); }); });
  function maintDueSummary() {
    var out = [];
    vehicles.forEach(function (v) {
      var mine = rides.filter(function (r) { return r.vehicleId === v.id || (!r.vehicleId && v.principal); }), odo = Math.round((v.odoStart || 0) + mine.reduce(function (s, r) { return s + (r.dist || 0); }, 0));
      (v.maint || []).forEach(function (m) { var s = maintState(m, odo); if (s.st !== 'ok') out.push({ v: v, m: m, st: s.st }); });
    });
    return out;
  }
  function maintStartupNotice() {
    var due = maintDueSummary().filter(function (x) { return x.st === 'due'; }); if (!due.length) return;
    var key = 'inclina.maintNotice', last = LS.get(key, 0); if (Date.now() - last < 86400000) return; LS.set(key, Date.now());
    toast('Mantenimiento pendiente: ' + due.slice(0, 2).map(function (x) { return x.m.name + ' (' + x.v.name + ')'; }).join(', ') + (due.length > 2 ? ' y ' + (due.length - 2) + ' más' : '') + '. Míralo en el garaje.', 'warn');
  }
  function openVehicleForm(v) {
    editingVehicle = v || null; vType = v ? v.type : 'moto';
    $('#vehicleFormTitle').textContent = v ? 'Editar vehículo' : 'Nuevo vehículo';
    $('#vName').value = v ? v.name : ''; $('#vMake').value = v ? v.make || '' : ''; $('#vModel').value = v ? v.model || '' : ''; $('#vOdo').value = v ? (v.odoStart || 0) : '';
    $$('#vType button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.t === vType)); });
    $('#vStyle').value = v && v.style ? v.style : ''; $('#vLean').value = v && v.leanLimit ? v.leanLimit : ''; $('#vLeanShare').checked = !!(v && v.leanShare); $('#vLeanBox').hidden = vType === 'coche';
    $('#vehicleForm').hidden = false; $('#vName').focus();
  }
  $('#btnAddVehicle').addEventListener('click', function () { openVehicleForm(null); });
  $$('#vType button').forEach(function (b) { b.addEventListener('click', function () { vType = b.dataset.t; $$('#vType button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); $('#vLeanBox').hidden = vType === 'coche'; }); });
  // valor típico según el estilo: solo se propone si el campo está vacío o tenía otro valor típico
  var LEAN_TYP = { custom: 30, scooter: 38, trail: 42, naked: 47, sport: 52 };
  $('#vStyle').addEventListener('change', function () { var cur = parseInt($('#vLean').value, 10), typ = LEAN_TYP[this.value]; if (typ && (!cur || Object.keys(LEAN_TYP).some(function (k) { return LEAN_TYP[k] === cur; }))) $('#vLean').value = typ; });
  $('#vCancel').addEventListener('click', function () { $('#vehicleForm').hidden = true; }); $('#vClose').addEventListener('click', function () { $('#vehicleForm').hidden = true; });
  $('#vSave').addEventListener('click', function () {
    var name = $('#vName').value.trim(); if (!name) { $('#vName').focus(); return; }
    var v = editingVehicle || { id: Date.now(), principal: vehicles.length === 0 };
    v.name = name; v.make = $('#vMake').value.trim(); v.model = $('#vModel').value.trim(); v.type = vType; v.odoStart = Math.max(0, parseInt($('#vOdo').value, 10) || 0);
    var ll = parseInt($('#vLean').value, 10); v.style = vType === 'coche' ? '' : $('#vStyle').value; v.leanLimit = vType !== 'coche' && ll >= 15 && ll <= 65 ? ll : null; v.leanShare = !!(v.leanLimit && $('#vLeanShare').checked);
    DB.putVehicle(v).then(reloadVehicles).then(function () { $('#vehicleForm').hidden = true; renderGarage(); return checkAchievements(); });
  });

  /* ---------- perfil, XP y logros ---------- */
  var profile = { name: '', avatar: null }, unlocked = {}, flags = {}, achFilter = 'all';
  function loadProfile() { return Promise.all([DB.get('profile', null), DB.get('achievements', {}), DB.get('flags', {})]).then(function (r) { if (r[0]) profile = r[0]; else profile = { name: '', avatar: null }; unlocked = r[1] || {}; flags = r[2] || {}; var cn = window.RGCloud && RGCloud.user() ? RGCloud.profileName() : ''; if (cn) profile.name = cn; renderAvatar(); }); }
  function reloadProfile() { return loadProfile().then(function () { var i = $('#profileName'); if (i && document.activeElement !== i) i.value = profile.name || ''; if (!$('#view-profile').hidden) renderProfile(); drawParking(); return checkAchievements(); }); }
  // Con sesión abierta, el nombre es el de la cuenta (el que se puso al crearla), no uno guardado en el móvil.
  function setProfileName(n) { n = (n || '').trim(); if (!n || profile.name === n) return; profile.name = n; var i = $('#profileName'); if (i && document.activeElement !== i) i.value = n; renderAvatar(); DB.set('profile', profile); }
  function setFlag(k) { if (flags[k]) return Promise.resolve(); flags[k] = Date.now(); return DB.set('flags', flags).then(checkAchievements); }
  function checkAchievements() {
    var ctx = Achievements.computeContext(rides, vehicles, flags), fresh = Achievements.evaluate(ctx, unlocked);
    if (!fresh.length) return Promise.resolve();
    return DB.set('achievements', unlocked).then(function () {
      var a = fresh[0]; toast('Logro: ' + a.name + ' (+' + a.xp + ' XP)' + (fresh.length > 1 ? ' y ' + (fresh.length - 1) + ' más' : ''), 'ok');
      renderAvatar(); if (currentView === 'profile') renderProfile();
    });
  }
  function initial() { return (profile.name || 'I').trim().charAt(0).toUpperCase() || 'I'; }
  function renderAvatar() {
    ['#avatarMini', '#avatarBig'].forEach(function (id) { var e = $(id); if (!e) return; e.innerHTML = profile.avatar ? '<img src="' + profile.avatar + '" alt="">' : initial(); });
  }
  function renderProfile() {
    var ctx = Achievements.computeContext(rides, vehicles, flags), xp = Achievements.xpOf(unlocked), lv = Achievements.levelOf(xp);
    $('#profileName').value = profile.name || '';
    $('#levelPill').textContent = 'Nivel ' + lv.level.n + ' · ' + lv.level.name;
    $('#profileXp').textContent = xp + ' XP';
    if (lv.next) { var span = lv.next.xp - lv.level.xp; $('#levelNext').textContent = (lv.next.xp - xp) + ' XP para nivel ' + lv.next.n; $('#levelBar').style.width = Math.round((xp - lv.level.xp) / span * 100) + '%'; }
    else { $('#levelNext').textContent = 'Nivel máximo'; $('#levelBar').style.width = '100%'; }
    var hours = rides.reduce(function (s, r) { return s + (r.movingS || 0); }, 0) / 3600;
    var nCom = 0; try { var cu = window.RGCloud && RGCloud.user(); if (cu) nCom = (JSON.parse(localStorage.getItem('rg.club.list:' + cu.id) || '[]') || []).length; } catch (e) {}
    $('#profileTotals').innerHTML = fig('Km totales', Math.round(ctx.km) + '') + fig('Rutas', String(ctx.rides)) + fig('Comunidades', String(nCom));
    var mv = vehicles.filter(function (v) { return v.principal; })[0] || vehicles[0];
    $('#profileBike').innerHTML = mv ? '<button class="rg-bike" type="button" id="pfBike"><span class="rg-bike-ic"><svg><use href="#i-garage"/></svg></span><span><span class="label">Mi ' + (mv.type === 'coche' ? 'coche' : 'moto') + '</span><b>' + esc(mv.name) + '</b>' + (mv.odo != null ? '<span class="muted">' + Math.round(mv.odo).toLocaleString('es-ES') + ' km</span>' : '') + '</span><svg class="chev"><use href="#i-chev"/></svg></button>'
      : '<button class="rg-bike empty" type="button" id="pfBike"><span class="rg-bike-ic"><svg><use href="#i-plus"/></svg></span><span><span class="label">Mi moto</span><b>Añade tu moto al garaje</b></span><svg class="chev"><use href="#i-chev"/></svg></button>';
    $('#pfBike').addEventListener('click', function () { showView('garage'); });
    var daysSet = {}; rides.forEach(function (r) { daysSet[new Date(r.start).toDateString()] = 1; });
    var streak = 0, cur = new Date(); cur.setHours(0, 0, 0, 0); if (!daysSet[cur.toDateString()]) cur.setDate(cur.getDate() - 1);
    while (daysSet[cur.toDateString()]) { streak++; cur.setDate(cur.getDate() - 1); }
    $('#profileStreak').innerHTML = '<div class="goal"><span class="label" style="color:var(--color-text)">Racha activa</span><span class="cifra" style="font-size:24px;color:var(--color-accent)">' + streak + (streak === 1 ? ' día' : ' días') + '</span><span class="muted" style="grid-column:1/-1">Mejor racha: ' + ctx.streakBest + (ctx.streakBest === 1 ? ' día' : ' días') + ' · zonas exploradas: ' + ctx.cells + '</span></div>';
    var total = Achievements.LIST.length, nUn = Object.keys(unlocked).filter(function (k) { return Achievements.LIST.some(function (a) { return a.id === k; }); }).length;
    $('#achCount').textContent = nUn + ' / ' + total;
    var cats = $('#achCats'); cats.innerHTML = '';
    Object.keys(Achievements.CATS).forEach(function (c) {
      var all = Achievements.LIST.filter(function (a) { return a.cat === c; }), got = all.filter(function (a) { return unlocked[a.id]; }).length;
      var d = document.createElement('button'); d.type = 'button'; d.className = 'cat'; d.innerHTML = '<div class="n">' + got + '<span class="muted">/' + all.length + '</span></div><span class="label">' + Achievements.CATS[c] + '</span><div class="bar3"><i style="width:' + (all.length ? got / all.length * 100 : 0) + '%"></i></div>';
      d.addEventListener('click', function () { achFilter = c; renderAchList(ctx); $$('#achFilter .pill').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.f === c)); }); });
      cats.appendChild(d);
    });
    var pills = $('#achFilter'); pills.innerHTML = '';
    [['all', 'Todos'], ['done', 'Conseguidos'], ['todo', 'En progreso']].forEach(function (f) { var b = document.createElement('button'); b.type = 'button'; b.className = 'pill'; b.dataset.f = f[0]; b.textContent = f[1]; b.setAttribute('aria-pressed', String(achFilter === f[0])); b.addEventListener('click', function () { achFilter = f[0]; $$('#achFilter .pill').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); renderAchList(ctx); }); pills.appendChild(b); });
    renderAchList(ctx);
  }
  function renderAchList(ctx) {
    var list = $('#achList'); list.innerHTML = '';
    var items = Achievements.LIST.filter(function (a) { if (achFilter === 'done') return unlocked[a.id]; if (achFilter === 'todo') return !unlocked[a.id]; if (achFilter === 'all') return true; return a.cat === achFilter; });
    items.sort(function (a, b) { var ua = unlocked[a.id] ? 1 : 0, ub = unlocked[b.id] ? 1 : 0; if (ua !== ub) return ub - ua; return 0; });
    items.forEach(function (a) {
      var on = !!unlocked[a.id], pr = on ? null : Achievements.progress(a, ctx);
      var d = document.createElement('div'); d.className = 'ach ' + (on ? 'on' : 'locked');
      d.innerHTML = '<span class="ico"><svg><use href="#' + ({ rutas: 'i-map', distancia: 'i-chart', inclinacion: 'i-gauge', rachas: 'i-star', consistencia: 'i-list', exploracion: 'i-compass', especiales: 'i-star', app: 'i-sliders' }[a.cat] || 'i-star') + '"/></svg></span>' +
        '<div class="t">' + a.name + '</div><div class="d">' + a.desc + (on ? ' · ' + fmtDate(unlocked[a.id]) : (pr ? ' · ' + pr.text : '')) + '</div>' + (pr ? '<div class="prog"><i style="width:' + Math.round(pr.value / pr.target * 100) + '%"></i></div>' : '') +
        '<span class="xp">' + (on ? '✓ ' : '+') + a.xp + ' XP</span>';
      list.appendChild(d);
    });
    if (!items.length) list.innerHTML = '<div class="empty">Nada aquí todavía.</div>';
  }
  $('#btnProfile').addEventListener('click', function () { showView('profile'); });
  $('#btnProfileBack').addEventListener('click', function () { showView('map'); });
  var nameTimer = null;
  $('#profileName').addEventListener('input', function (e) { profile.name = e.target.value; renderAvatar(); if (nameTimer) clearTimeout(nameTimer); nameTimer = setTimeout(function () { DB.set('profile', profile); if (window.RGCloud && RGCloud.saveName) RGCloud.saveName(profile.name); }, 900); });
  function setAvatar(d) { if (!d) return; profile.avatar = d; renderAvatar(); DB.set('profile', profile); if (window.RGSync) RGSync.touch('avatar'); }
  if ($('#btnAvatar2')) $('#btnAvatar2').addEventListener('click', function () { $('#btnAvatar').click(); });
  $('#btnAvatar').addEventListener('click', function () { $('#avatarFile').value = ''; $('#avatarFile').click(); });
  $('#avatarFile').addEventListener('change', function (e) { var f = e.target.files && e.target.files[0]; if (!f) return; (window.RGCrop ? RGCrop.open(f) : shrinkImage(f, 256)).then(setAvatar); });

  /* ---------- ajustes ---------- */
  function renderSettings() {
    $('#setVoice').checked = !!settings.voice; $('#setAutoPause').checked = !!settings.autoPause; $('#setAutoStart').checked = !!settings.autoStart; $('#setInvert').checked = !!settings.invert;
    $('#vminVal').innerHTML = settings.vMin + '<small>km/h</small>'; $('#peakVal').textContent = settings.minPeak + '°';
    $$('#themeSeg button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.theme === settings.theme)); });
    $('#versionLine').textContent = 'ReGroupRide v' + APP_VERSION + (Platform.native ? ' · app' : ' · web');
    renderDiag();
    DB.estimateUsage().then(function (u) { if (u) setText('#dgStore', (u.used / 1048576).toFixed(1).replace('.', ',') + ' MB usados'); });
  }
  function applySettings() { saveSettings(); est.setInvert(settings.invert); det.setOptions({ minPeak: settings.minPeak }); applyTheme(); renderSettings(); }
  $('#setVoice').addEventListener('change', function (e) { settings.voice = e.target.checked; applySettings(); if (settings.voice) { Platform.speak('Voz activada'); setFlag('voice'); } });
  $('#setAutoPause').addEventListener('change', function (e) { settings.autoPause = e.target.checked; applySettings(); });
  $('#setAutoStart').addEventListener('change', function (e) { settings.autoStart = e.target.checked; applySettings(); });
  $('#setInvert').addEventListener('change', function (e) { settings.invert = e.target.checked; applySettings(); });
  $('#vminDown').addEventListener('click', function () { settings.vMin = clamp(settings.vMin - 5, 0, 200); applySettings(); });
  $('#vminUp').addEventListener('click', function () { settings.vMin = clamp(settings.vMin + 5, 0, 200); applySettings(); });
  $('#peakDown').addEventListener('click', function () { settings.minPeak = clamp(settings.minPeak - 1, 3, 60); applySettings(); });
  $('#peakUp').addEventListener('click', function () { settings.minPeak = clamp(settings.minPeak + 1, 3, 60); applySettings(); });
  $$('#themeSeg button').forEach(function (b) { b.addEventListener('click', function () { settings.theme = b.dataset.theme; applySettings(); }); });
  $('#btnWipe').addEventListener('click', function () { armOrRun($('#btnWipe'), 'Borrar todos los datos', 'Toca otra vez para borrar', function () { DB.wipe().then(function () { try { localStorage.clear(); } catch (e) {} location.reload(); }); }); });
  function renderDiag() {
    var s = est.state, now = performance.now(), motionFresh = sens.lastMotion && (now - sens.lastMotion) < 2000, f1 = function (x) { return x == null ? '—' : (x > 0 ? '+' : '') + x.toFixed(1) + '°'; };
    setText('#dgRate', (motionFresh ? Math.round(sens.rate) + ' muestras/s' : (sens.listening ? 'sin datos' : 'no iniciado')) + (sens.src === 'native' ? ' · sensores nativos' : ' · navegador'));
    setText('#dgGyro', motionFresh ? (sens.gyro ? 'sí' : 'no (solo acelerómetro)') : '—');
    setText('#dgGain', (Math.abs(s.gain) > 10 ? 'rad/s' : '°/s') + (s.gain < 0 ? ', invertido' : ', normal') + (s.gainConf ? ' · conf ' + Math.round(s.gainConf * 100) + '%' : ' · por defecto'));
    setText('#dgPhi', s.ready ? f1(s.phi) + ' · ref. ' + ({ 'manual': 'manual', 'auto-quick': 'provisional (al abrir)', 'auto-still': 'automática (reposo)', 'auto-ride': 'rodando' }[s.frameKind] || s.frameKind) + (s.confirmed ? ' · medida rodando' : ' · sin confirmar') : 'sin referencia aún'); setText('#dgAcc', calib && motionFresh ? f1(s.phiAcc) : '—'); setText('#dgPhys', f1(s.phiPhys));
    setText('#dgSrc', { gyro: 'giróscopo', phys: 'giróscopo + física', acc: 'giróscopo + acelerómetro', 'acc-still': 'acelerómetro (parado)', 'acc-only': 'solo acelerómetro' }[s.source] || s.source);
    var gpsFresh = sens.lastGps && (now - sens.lastGps) < 5000;
    setText('#dgGps', gpsFresh ? Math.round(sens.speedKmh || 0) + ' km/h · ±' + Math.round(sens.gpsAcc || 0) + ' m' + (gpsMode === 'bg' ? ' · segundo plano' : '') : (sens.gpsError || (gpsMode ? 'buscando' : 'parado')));
  }

  /* ---------- ruta simulada (sin sensores ni GPS) ---------- */
  function stopDemo() {
    if (demoTimer) clearInterval(demoTimer); demoTimer = null; sens.demo = false; sens.speedKmh = null; sens.lastGps = 0; lastMotionT = null; lastNativeTs = null;
    calib = LS.get('inclina.calib', null); est.setFrame(calib && calib.up ? LeanCore.buildFrame(calib.up) : null, calib ? calib.bias : null, calib ? calib.kind || 'manual' : null);
  }
  $('#btnDemo').addEventListener('click', function () {
    if (rec) return;
    showView('map');
    var tilt = 30 * Math.PI / 180, G = LeanCore.G, D2R = Math.PI / 180;
    var X = [0, -1, 0], Y = [Math.sin(tilt), 0, Math.cos(tilt)], Z = [-Math.cos(tilt), 0, Math.sin(tilt)], dot = LeanCore.v3.dot, toPhone = function (b) { return [dot(b, X), dot(b, Y), dot(b, Z)]; };
    var up = toPhone([0, 0, G]); calib = { up: up, bias: [0, 0, 0], at: Date.now(), demo: true }; est.setFrame(LeanCore.buildFrame(up), [0, 0, 0]);
    sens.demo = true; lastMotionT = null; stopGps();
    // carretera de montaña simulada: 60 s, curvas alternas
    var plan = [[3, 0, 0], [4, 60, 0], [1.2, 60, -30], [4, 60, -30], [1.2, 60, 0], [3, 90, 0], [1, 70, 36], [3, 70, 36], [1, 70, 0], [2.5, 70, -20], [2.5, 70, 20], [3, 80, 0], [1.5, 65, -42], [3, 65, -42], [1.5, 65, 0], [4, 50, 0], [2, 0, 0]];
    var seg = 0, segT = 0, phi = 0, last = performance.now(), lat = lastFix ? lastFix.lat : 39.47, lon = lastFix ? lastFix.lon : -0.38, hdg = 20, tAcc = 0, lastFixAt = 0;
    var navLine = (activePlan && activePlan.coords && activePlan.coords.length > 1) ? RGLib.makeLine(activePlan.coords) : null, navAlong = 0;
    if (navLine && lastFix == null) { lat = activePlan.coords[0][1]; lon = activePlan.coords[0][0]; }
    startRide(false);
    toast(navLine ? 'Ruta simulada siguiendo «' + activePlan.name + '». No son datos reales.' : 'Ruta simulada: no son datos reales. Se para sola al acabar.', 'warn');
    demoTimer = setInterval(function () {
      var now = performance.now(), step = (now - last) / 1000; last = now;
      if (navLine) {
        var nv = 22, sp = Math.max(1, Math.min(20, navLine.total / (nv * 80)));
        navAlong += nv * step * sp; if (navAlong >= navLine.total + 30) { stopRide(); return; }
        var q = RGLib.pointAt(navLine, navAlong), q2 = RGLib.pointAt(navLine, navAlong + 20);
        sens.lastGps = now; sens.speedKmh = nv * 3.6; sens.speedMs = nv; sens.gpsAcc = 8; if (navAlong < navLine.total - 25) sens.heading = Geo.bearing(q[1], q[0], q2[1], q2[0]); est.setSpeed(nv, now);
        handleSample(toPhone([0, 0, G]), toPhone([0, 0, 0]), now);
        if (now - lastFixAt >= 150) { lastFixAt = now; var nf = { lat: q[1], lon: q[0], ts: Date.now(), acc: 8, alt: 400, v: nv }; sens.fix = nf; if (rec) recFix(nf, lastFix); lastFix = nf; updatePosition(nf); if (window.RGNav) RGNav.onFix(nf); }
        return;
      }
      if (seg >= plan.length) { stopRide(); return; }
      var p = plan[seg], v = p[1] / 3.6, target = p[2];
      segT += step; if (segT >= p[0]) { seg++; segT = 0; }
      var prevPhi = phi; phi += (target - phi) * Math.min(1, step / 0.25);
      var roll = (phi - prevPhi) / step, yaw = v > 0.5 ? -(G * Math.tan(phi * D2R) / v) / D2R : 0;
      var aBody = v > 0.5 ? [0, 0, G / Math.cos(phi * D2R)] : [0, G * Math.sin(phi * D2R), G * Math.cos(phi * D2R)];
      var acc = toPhone(aBody).map(function (x) { return x + (Math.random() - 0.5) * 1.2; }), rot = toPhone([roll, 0, yaw]).map(function (x) { return x + (Math.random() - 0.5) * 3; });
      hdg += yaw * step; var dM = v * step; lat += dM * Math.cos(hdg * D2R) / 111320; lon += dM * Math.sin(hdg * D2R) / (111320 * Math.cos(lat * D2R));
      sens.lastGps = now; sens.speedKmh = p[1]; sens.speedMs = v; sens.gpsAcc = 8; sens.heading = ((hdg % 360) + 360) % 360; est.setSpeed(v, now);
      handleSample(acc, rot, now);
      tAcc += step;
      if (now - lastFixAt >= 1000) { lastFixAt = now; var fix = { lat: lat, lon: lon, ts: Date.now(), acc: 8, alt: 400 + 60 * Math.sin(tAcc / 20), v: v }; sens.fix = fix; if (rec) recFix(fix, lastFix); lastFix = fix; updatePosition(fix); }
    }, 1000 / 60);
  });

  /* ---------- puente para los módulos de ReGroupRide (rg-app.js) ---------- */
  window.RGApp = {
    stopRide: function () { if (rec) stopRide(); },
    setAvatar: function (d) { setAvatar(d); },
    version: APP_VERSION, toast: toast, settings: settings, saveSettings: saveSettings, showView: showView,
    map: function () { return mapReady ? map : null; }, lastFix: function () { return lastFix; }, leanNow: function () { return est.state.ready && !sens.demo ? Math.abs(live.phi) : (sens.demo ? Math.abs(live.phi) : null); }, recInfo: function () { return rec ? { maxL: rec.maxL, maxR: rec.maxR } : null; }, anyFix: function () { return lastFix || (quickFix ? { lat: quickFix.lat, lon: quickFix.lon, acc: quickFix.acc, ts: Date.now(), approx: true } : (savedFix ? { lat: savedFix.lat, lon: savedFix.lon, acc: 5000, ts: savedFix.t, approx: true } : null)); }, activePlan: function () { return planMode ? null : activePlan; },
    isRec: function () { return !!rec; }, isTrip: function () { return !!(rec && rec.trip); }, isDemo: function () { return !!sens.demo; }, isPlanMode: function () { return planMode; },
    startRide: function () { askAndStart(); }, reloadProfile: reloadProfile, setProfileName: setProfileName, enterPlanMode: enterPlanMode, openLeanFull: function () { openLeanFull(); }, importRecordedGpx: importRecordedGpx,
    plans: function () { return plans.slice(); }, rides: function () { return rides.slice(); }, vehicles: function () { return vehicles.slice(); },
    routeBetween: function (wps) { return routeBetween(wps); },   // [[lat, lon], …] → { coords, dist (km), dur (s), steps, routed }
    previewPlan: function (p) { p.preview = true; showView('map'); followPlan(p, true); },
    // Lo que llevo medido en la ruta en marcha: km, segundos en movimiento e inclinación máxima de cada curva.
    recNow: function () { return rec ? { km: rec.dist || 0, movingS: rec.movingS || 0, peaks: rec.corners.map(function (c) { return Math.abs(c.peak || 0); }) } : null; },
    updatePlan: function (p) { plans = plans.map(function (x) { return x.id === p.id ? p : x; }); if (activePlan && activePlan.id === p.id) activePlan = p; return savePlans().then(function () { syncSoon(); if (currentView === 'rides') renderRides(); }); },
    // guarda (o actualiza) una ruta planificada sin ponerse a seguirla
    savePlan: function (p) { delete p.preview; plans = plans.filter(function (x) { return x.id !== p.id; }); plans.unshift(p); return savePlans().then(function () { syncSoon(); if (currentView === 'rides') renderRides(); return setFlag('plan'); }); },
    // para la copia en la cuenta: añade las rutas recuperadas y guarda los cambios de las que ya estaban
    mergePlans: function (local, fresh, changed) { fresh.forEach(function (f) { if (!plans.some(function (x) { return x.id === f.id; })) plans.push(f); }); if (!changed) return Promise.resolve(); return savePlans().then(function () { if (currentView === 'rides') renderRides(); }); },
    reloadRides: function () { return reloadRides().then(function () { if (currentView === 'rides') renderRides(); }); },
    reloadVehicles: function () { return reloadVehicles().then(function () { if (currentView === 'garage') renderGarage(); }); },
    savePlan: function (p) {   // guarda una ruta en «mis rutas planificadas» sin tocar el mapa ni la ruta activa (la usan los viajes al importar un GPX)
      var i = -1; plans.forEach(function (x, k) { if (x.id === p.id) i = k; });
      if (i >= 0) plans[i] = p; else plans.unshift(p);
      return savePlans().then(function () { syncSoon(); try { renderRides(); } catch (e) {} });
    },
    usePlan: function (p) {   // guarda (o actualiza) una ruta planificada y la deja lista para «Iniciar ruta»
      var i = -1; plans.forEach(function (x, k) { if (x.id === p.id) i = k; });
      if (i >= 0) plans[i] = p; else plans.unshift(p);
      return savePlans().then(function () { syncSoon(); if (planMode) exitPlanMode(); showView('map'); followPlan(p, true); });
    },
    setWaypoints: function (pts, name) {
      if (!planMode) enterPlanMode(); if (!planMode) return false;
      clearPlan(); pts.forEach(function (p) { addWaypoint(p.lat, p.lon, p.name); });
      if (name && !$('#planName').value) $('#planName').value = name;
      if (map && pts.length > 1) { var b = Geo.bounds(pts.map(function (p) { return [0, p.lat, p.lon]; })); if (b) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: { top: 120, bottom: 300, left: 40, right: 70 }, duration: 500 }); }
      else if (map && pts.length === 1) map.easeTo({ center: [pts[0].lon, pts[0].lat], zoom: 13 });
      return true;
    }
  };

  /* ---------- arranque ---------- */
  Platform.onBack(function () {
    if (!$('#lightbox').hidden) { $('#lightbox').hidden = true; return true; }
    if (!$('#leanFull').hidden) { closeLeanFull(); return true; }
    if (window.RGCloud && RGCloud.sheetBack && RGCloud.sheetBack()) return true;
    if (currentView === 'detail') { showView('rides'); return true; }
    if (currentView === 'profile') { showView('map'); return true; }
    if (currentView !== 'map') { showView('map'); return true; }
    if (planMode) { exitPlanMode(); return true; }
    if (parkOpen) { closePark(); return true; }
    return false;
  });
  DB.open().then(function () { return DB.migrateFromLocalStorage(); }).then(function (n) { if (n) toast(n + ' salidas antiguas importadas al historial.', 'ok'); return recoverRide(); })
    .then(reloadVehicles).then(reloadRides).then(loadProfile).then(loadParking).then(loadPlans).then(checkAchievements).then(function () {
      setTimeout(function () { if (!calib && !sens.demo) showNotice('Aún no llegan datos de los sensores de movimiento: el inclinómetro marcará en cuanto lleguen.', 'warn'); }, 2500);
      initMap(); if (!gpsMode) startGps('fg'); render(); Platform.ready(); maintStartupNotice();
    }).catch(function (e) { toast('Error al iniciar la base de datos: ' + (e && e.message ? e.message : e), 'bad'); initMap(); Platform.ready(); });
  if (!gpsMode && !rec) startGps('fg');   // el GPS se pide ya, a la vez que carga lo demás (antes esperaba a la base de datos)
  if (!Platform.native && 'serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});
})();
