/* ReGroupRide — lo que se añade a la base de Inclina:
   · seguir una ruta dentro de la app (siguiente giro, voz, aviso de fuera de ruta y vuelta a la ruta)
   · importar una ruta desde un enlace de Google Maps
   · cuenta (Supabase) y sugerencias
   Habla con app.js a través de window.RGApp. */
(function () {
  'use strict';
  var A = window.RGApp, L = window.RGLib;
  if (!A || !L) return;
  var $ = function (s) { return document.querySelector(s); };
  var C = window.Capacitor, native = !!(C && C.isNativePlatform && C.isNativePlatform()), P = native ? (C.Plugins || {}) : {};
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtKm(m) { return (m / 1000).toFixed(m >= 100000 ? 0 : 1).replace('.', ',') + ' km'; }
  function fmtMin(s) { var m = Math.round(s / 60), h = Math.floor(m / 60); return h ? h + ' h ' + String(m % 60).padStart(2, '0') + ' min' : m + ' min'; }
  function say(t) { if (A.settings.navVoice === true && window.Platform && Platform.canSpeak()) Platform.speak(t); }   // apagada salvo que se encienda en Ajustes
  function buzz(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
  var EMPTY = { type: 'FeatureCollection', features: [] };

  /* ================= seguir la ruta ================= */
  var ARROW = { 'straight': 0, 'slight right': 40, 'right': 90, 'sharp right': 135, 'uturn': 180, 'sharp left': -135, 'left': -90, 'slight left': -40 };
  function icon(kind) {
    if (kind === 'arrive') return '<svg viewBox="0 0 32 32"><path d="M9 28V5m0 1h14l-3.5 5 3.5 5H9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    if (kind === 'roundabout') return '<svg viewBox="0 0 32 32"><circle cx="16" cy="15" r="6.5" fill="none" stroke="currentColor" stroke-width="3"/><path d="M16 29v-7.5M21 9l5-5m0 0h-5.5M26 4v5.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    if (kind === 'stop') return '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="11.5" fill="none" stroke="currentColor" stroke-width="3"/><path d="M12.500 11v10M19.500 11v10" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>';
    // iconos de la guía (rejilla de 24, trazo de 2,6 en el cartel)
    if (kind === 'off') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.2v.2"/></svg>';
    if (kind === 'right') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 21V12a4 4 0 0 1 4-4h8"/><path d="M15 3.5L19.5 8 15 12.5"/></svg>';
    if (kind === 'left') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21V12a4 4 0 0 0-4-4H5"/><path d="M9 3.5L4.5 8 9 12.5"/></svg>';
    if (kind === 'straight') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V5M6 11l6-6 6 6"/></svg>';
    if (kind === 'uturn') return '<svg viewBox="0 0 32 32"><path d="M9 27V13.5a6.5 6.5 0 0 1 13 0V23m0 0-5.5-5.5M22 23l5.5-5.5" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var a = ARROW[kind] == null ? 0 : ARROW[kind];
    return '<svg viewBox="0 0 32 32"><g transform="rotate(' + a + ' 16 16)"><path d="M16 27V6m0 0-7.5 7.5M16 6l7.5 7.5" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></g></svg>';
  }

  var nav = { active: false, planId: null, tr: null, rejoin: null, rejoinAt: 0, rejoinBusy: false, last: null, notified: false, toStart: false, asked: false };
  // El cartel mide 60 px, pero una indicación muy larga lo hace crecer: los botones del mapa bajan con él.
  if (window.ResizeObserver && $('#navBanner')) new ResizeObserver(function () { var h = $('#navBanner').offsetHeight; if (h) document.documentElement.style.setProperty('--nav-h', h + 'px'); }).observe($('#navBanner'));
  /* Filas de filtros que no caben (Rutas, logros…): se ve que siguen y hay una flecha para avanzar. */
  function scrollHint(el) {
    if (!el || el.parentNode.classList.contains('rg-hint')) return;
    var box = document.createElement('div'); box.className = 'rg-hint'; el.parentNode.insertBefore(box, el); box.appendChild(el);
    var mk = function (cls, label, dir) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'rg-hint-btn ' + cls; b.setAttribute('aria-label', label);
      b.innerHTML = '<svg><use href="#i-chev"/></svg>'; b.addEventListener('click', function () { el.scrollBy({ left: dir * Math.max(140, el.clientWidth * 0.6), behavior: 'smooth' }); });
      box.appendChild(b); return b;
    };
    mk('prev', 'Ver las opciones anteriores', -1); mk('next', 'Ver más opciones', 1);
    var upd = function () {
      var max = el.scrollWidth - el.clientWidth;
      box.classList.toggle('more', max > 4 && el.scrollLeft < max - 4);
      box.classList.toggle('less', el.scrollLeft > 4);
    };
    el.addEventListener('scroll', upd, { passive: true }); window.addEventListener('resize', upd);
    if (window.ResizeObserver) new ResizeObserver(upd).observe(el);
    if (window.MutationObserver) new MutationObserver(upd).observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    upd();
  }
  ['#ridesFilters', '#achFilter'].forEach(function (s) { scrollHint($(s)); });
  function plan() { return A.activePlan(); }
  function sync() {
    var p = plan(), on = !!(p && A.isRec() && !A.isTrip() && p.coords && p.coords.length > 1);
    var info = $('#followInfo'), ride = $('#btnRide');
    if (info) info.textContent = p ? (fmtKm((p.dist || 0) * 1000) + (p.dur ? ' · ' + fmtMin(p.dur) : '')) : '';
    if (ride) { ride.textContent = 'Iniciar ruta'; ride.classList.add('rg-go'); }
    if (on && (!nav.active || nav.planId !== p.id)) {
      nav.active = true; nav.planId = p.id; nav.tr = L.Tracker(p.coords, L.navSteps(p)); nav.rejoin = null; nav.rejoinAt = 0; nav.last = null; nav.notified = false; nav.toStart = false; nav.asked = false;
      askNotif();
      var f = A.lastFix(); if (f) onFix(f); else renderBanner(null);
    } else if (!on && nav.active) {
      nav.active = false; nav.planId = null; nav.tr = null; nav.rejoin = null; nav.last = null; drawRejoin(); renderBanner(null);
    }
    if (!on) renderBanner(null);
    document.body.classList.toggle('rg-rec', A.isRec());
    drawStops();
    if (window.RGGroup) RGGroup.sync();
  }
  function onFix(fix) {
    if (!nav.active || !nav.tr) { if (window.RGGroup) RGGroup.onFix(fix, null); return; }
    if (!nav.asked) askStart(fix);
    var now = Date.now(), r = nav.tr.update(fix, now), i;
    nav.last = r;
    for (i = 0; i < r.events.length; i++) {
      var e = r.events[i];
      if (e.type === 'say') say(e.text);
      else if (e.type === 'off') { offAlert(e.dist); makeRejoin(fix, true); }
      else if (e.type === 'back' || e.type === 'start') { if (nav.rejoin) { nav.rejoin = null; drawRejoin(); } if (e.type === 'back') { say('De vuelta en la ruta'); A.toast('De vuelta en la ruta.', 'ok'); } nav.notified = false; }
      else if (e.type === 'finish') A.toast('Has llegado al final de la ruta.', 'ok');
    }
    // Aún no has llegado a la ruta (sales de casa, o te unes a mitad): te lleva al punto más cercano por delante.
    if (!r.started && r.off > 150 && !nav.rejoin && !nav.rejoinBusy && now - nav.rejoinAt > 20000) makeRejoin(fix, false);
    if (nav.rejoin && (r.offRoute || !r.started)) {
      var rr = nav.rejoin.tr.update(fix, now);
      nav.rejoin.last = rr;
      for (i = 0; i < rr.events.length; i++) if (rr.events[i].type === 'say') say(rr.events[i].text);
      if ((rr.offRoute || (rr.started && rr.off > 150)) && now - nav.rejoinAt > 20000) makeRejoin(fix, false);
    }
    renderBanner(r);
    if (window.RGGroup) RGGroup.onFix(fix, r);
  }
  // Al empezar lejos del punto de salida, cada uno elige: ir primero a la salida (el punto de encuentro) o entrar en la
  // ruta por donde le pille más cerca. Mientras no conteste, se le lleva al punto más cercano, como hasta ahora.
  function askStart(fix) {
    var p = plan(); nav.asked = true;
    if (!p || !p.coords || !p.coords.length) return;
    var d0 = L.dist(fix.lat, fix.lon, p.coords[0][1], p.coords[0][0]);
    if (d0 < 300) return;
    var name = ((p.wps && p.wps[0] && p.wps[0][2]) || '').split(',')[0];
    sheet('<div class="head"><h1>Iniciar ruta</h1><button class="btn small icon" id="tsX" type="button" aria-label="Cerrar"><svg><use href="#i-close"/></svg></button></div><p>Estás a <b>' + L.fmtDist(d0) + '</b> del punto de salida' + (name ? ' (' + esc(name) + ')' : '') + '.</p>' +
      '<button class="btn big" id="tsNear" type="button"><svg><use href="#i-route"/></svg>Entrar por el punto más cercano</button><button class="btn big primary" id="tsStart" type="button"><svg><use href="#i-gmaps"/></svg>Ir al punto de salida</button>' +
      '<p class="muted rg-small" style="text-align:left">«Ir al punto de salida» te lleva hasta donde empieza la ruta y, al llegar, sigue con ella.</p>');
    $('#tsX').addEventListener('click', closeSheet);
    $('#tsNear').addEventListener('click', closeSheet);
    $('#tsStart').addEventListener('click', function () {
      closeSheet(); var q = plan(); if (!nav.active || !q || q.id !== p.id) return;
      nav.toStart = true; nav.tr = L.Tracker(q.coords, L.navSteps(q), { fromStart: true }); nav.rejoin = null; nav.rejoinAt = 0; drawRejoin();
      var f = A.lastFix(); if (f) onFix(f);
    });
  }
  function offAlert(d) {
    buzz([500, 200, 500, 200, 500]);
    say('Te has salido de la ruta. Te marco cómo volver.');
    A.toast('Te has salido de la ruta.', 'bad');
    if (document.visibilityState !== 'visible' && P.LocalNotifications && !nav.notified) {
      nav.notified = true;
      try { P.LocalNotifications.schedule({ notifications: [{ id: 7001, title: 'Te has salido de la ruta', body: 'Estás a ' + L.fmtDist(d) + ' del trazado. Abre ReGroupRide para volver.' }] }); } catch (e) {}
    }
  }
  function askNotif() { if (P.LocalNotifications) { try { P.LocalNotifications.requestPermissions(); } catch (e) {} } }
  function makeRejoin(fix, announce) {
    var p = plan(); if (!p || !nav.tr || nav.rejoinBusy) return;
    var going = nav.toStart && !nav.tr.state.started;      // aún de camino a la salida
    var t = going ? { lat: p.coords[0][1], lon: p.coords[0][0], off: L.dist(fix.lat, fix.lon, p.coords[0][1], p.coords[0][0]) } : L.rejoinTarget(fix, nav.tr.line, nav.tr.state.along);
    nav.rejoinAt = Date.now(); nav.rejoinBusy = true;
    var straight = function () { return { coords: [[fix.lon, fix.lat], [t.lon, t.lat]], steps: [], dist: t.off }; };
    var url = 'https://router.project-osrm.org/route/v1/driving/' + fix.lon.toFixed(5) + ',' + fix.lat.toFixed(5) + ';' + t.lon.toFixed(5) + ',' + t.lat.toFixed(5) + '?overview=full&geometries=geojson&steps=true';
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null; if (ctrl) setTimeout(function () { ctrl.abort(); }, 8000);
    var job = (navigator.onLine === false) ? Promise.resolve(straight()) : fetch(url, ctrl ? { signal: ctrl.signal } : {}).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.routes || !j.routes[0]) throw new Error('sin ruta');
      var st = L.stepsFromOsrm(j.routes[0]); if (st.length && st[st.length - 1].icon === 'arrive') st[st.length - 1].text = going ? 'llegas al punto de salida' : 'vuelves a la ruta';
      return { coords: j.routes[0].geometry.coordinates, steps: st, dist: j.routes[0].distance };
    }).catch(straight);
    job.then(function (x) {
      nav.rejoinBusy = false;
      if (!nav.active) return;
      var tr = L.Tracker(x.coords, x.steps, { offDist: 70 });
      nav.rejoin = { coords: x.coords, tr: tr, dist: x.dist, last: tr.update(fix, Date.now()) };
      drawRejoin(); renderBanner(nav.last);
      if (!announce && nav.last && !nav.last.started) say((going ? 'Te llevo al punto de salida. ' : 'Te llevo a la ruta. ') + L.cap(L.spokenDist(x.dist)) + '.');
    });
  }
  function drawRejoin() {
    var m = A.map(); if (!m || !m.getSource('rejoin')) return;
    var c = nav.active && nav.rejoin ? nav.rejoin.coords : [];
    m.getSource('rejoin').setData(c.length > 1 ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } } : EMPTY);
  }
  var bannerKey = '';
  function renderBanner(r) {
    var b = $('#navBanner'); if (!b) return;
    if (!nav.active) { if (!b.hidden) { b.hidden = true; bannerKey = ''; } return; }
    var cls = '', ico = 'straight', dist = '', text = 'Buscando tu posición…', sub = '';
    if (r) {
      var rj = nav.rejoin && nav.rejoin.last, nx = null;
      if (r.offRoute || !r.started) {
        cls = r.offRoute ? 'off' : 'to';
        nx = rj && rj.next;
        if (nx && nx.dist < 2500 && !rj.offRoute) { ico = nx.icon; dist = L.fmtDist(nx.dist); text = nx.text; }
        else { ico = r.offRoute ? 'off' : 'straight'; dist = L.fmtDist(rj ? rj.remaining : r.off); text = r.offRoute ? 'para volver a la ruta' : (nav.toStart ? 'hasta la salida' : 'hasta la ruta'); }
        sub = r.offRoute ? 'Te has salido de la ruta' : (nav.toStart ? 'Yendo al punto de salida' : 'Yendo a la ruta');
      } else if (r.finished) { ico = 'arrive'; text = 'Has llegado'; sub = 'Fin de la ruta'; cls = 'ok'; }
      else {
        nx = r.next;
        if (nx) { ico = nx.icon; dist = L.fmtDist(nx.dist); text = nx.text; }
        else { text = 'Sigue la ruta'; }
        // cartel pequeño: si la indicación es corta cabe debajo lo que queda de ruta; si es larga (rotondas) ocupa ella las dos líneas
        sub = text.length <= 24 ? 'quedan ' + fmtKm(r.remaining) : '';
      }
    }
    var key = cls + '|' + ico + '|' + dist + '|' + text + '|' + sub;
    if (key === bannerKey && !b.hidden) return; bannerKey = key;
    b.className = 'nav-banner ' + cls; b.hidden = false;
    $('#navIco').innerHTML = icon(ico); $('#navDist').textContent = dist; $('#navText').textContent = text; $('#navSub').textContent = sub;
  }
  /* ---- paradas de la ruta en el mapa (todas, sin límite) ---- */
  var stopMk = [], stopKey = '';
  function drawStops() {
    var m = A.map(), p = plan(), key = p ? p.id + ':' + (p.wps || []).length + ':' + (p.pois || []).length + ':' + (p.wps || []).filter(function (w) { return w[2]; }).length : '';
    if (!m || typeof maplibregl === 'undefined') return;
    if (key === stopKey) return; stopKey = key;
    stopMk.forEach(function (x) { x.remove(); }); stopMk = [];
    if (!p) return;
    (p.wps || []).forEach(function (w, i) {
      var el = document.createElement('div'), last = i === p.wps.length - 1, nm = (w[2] || '').split(',')[0].trim(), kind = (i === 0 || last || !nm) ? '' : (POI[w[3]] ? w[3] : L.stopKind(nm));
      // Las paradas con nombre (reagrupamiento, gasolinera, almuerzo…) se ven con su nombre; los puntos de paso, solo con su número.
      if (kind) { el.className = 'stop-marker named ' + kind; el.innerHTML = '<span class="ico">' + POI[kind][1] + '</span><span class="lbl">' + esc(nm.length > 26 ? nm.slice(0, 25) + '…' : nm) + '</span>'; }
      else { el.className = 'stop-marker' + (i === 0 ? ' start' : (last ? ' end' : '')); el.textContent = String(i + 1); }
      el.addEventListener('click', function (e) { e.stopPropagation(); A.toast((i + 1) + '. ' + (nm || (i === 0 ? 'Salida' : (last ? 'Llegada' : 'Punto ' + (i + 1)))), 'ok'); });
      stopMk.push(new maplibregl.Marker(kind ? { element: el, anchor: 'left', offset: [-15, 0] } : { element: el, anchor: 'center' }).setLngLat([w[1], w[0]]).addTo(m));
    });
    // Puntos marcados aparte en la ruta: gasolineras, sitios para comer, miradores…
    (p.pois || []).forEach(function (q) {
      var el = document.createElement('div'), kind = POI[q[3]] ? q[3] : 'poi';
      el.className = 'poi-marker ' + kind; el.innerHTML = POI[kind][1];
      el.addEventListener('click', function (e) { e.stopPropagation(); A.toast(POI[kind][0] + (q[2] && q[2] !== POI[kind][0] ? ': ' + q[2] : ''), 'ok'); });
      stopMk.push(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([q[1], q[0]]).addTo(m));
    });
  }
  var POI = {
    fuel: ['Gasolinera', '<svg viewBox="0 0 24 24"><path d="M5 20V6a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v14M4 20h11M7.5 8.5h4M14 11h1.5a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 0 3 0V9l-2.5-2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'],
    food: ['Parada para comer', '<svg viewBox="0 0 24 24"><path d="M7 3v8M4.5 3v4.5a2.5 2.5 0 0 0 5 0V3M7 11v10M17 21V3c-2 1.2-3 3.4-3 6.5V13h3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'],
    view: ['Mirador', '<svg viewBox="0 0 24 24"><path d="M3 19 9.5 8l4 6 2.5-3.5L21 19z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="17" cy="6" r="1.6" fill="currentColor"/></svg>'],
    park: ['Aparcamiento', '<svg viewBox="0 0 24 24"><path d="M8 20V4h5a4.5 4.5 0 0 1 0 9H8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'],
    stop: ['Parada', '<svg viewBox="0 0 24 24"><path d="M6 21V4m0 1h11l-2.800 4 2.800 4H6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'],
    poi: ['Punto marcado', '<svg viewBox="0 0 24 24"><path d="M12 21s6-5.6 6-10.5A6 6 0 0 0 6 10.500C6 15.400 12 21 12 21z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="10.500" r="2" fill="currentColor"/></svg>']
  };
  /* ---- Google Maps como opción secundaria, por tramos de 9 paradas ---- */
  function openMaps(wps) {
    var legs = L.mapsLegs(wps || []);
    if (!legs.length) return;
    if (legs.length === 1) { Platform.openExternal(legs[0].url); return; }
    var s = sheet('<div class="head"><h1>Abrir en Google Maps</h1><button class="btn small icon" id="rgClose" type="button" title="Cerrar"><svg><use href="#i-close"/></svg></button></div>' +
      '<p class="muted">Google Maps solo admite unas 9 paradas por enlace, así que esta ruta de ' + wps.length + ' puntos va en ' + legs.length + ' tramos. Al acabar uno, vuelve aquí y abre el siguiente. Para llevarla entera, usa «Iniciar ruta» en la app.</p>' +
      legs.map(function (l, i) { return '<button class="btn big" type="button" data-leg="' + i + '"><svg><use href="#i-gmaps"/></svg>Tramo ' + (i + 1) + ': puntos ' + l.from + ' a ' + l.to + '</button>'; }).join(''));
    $('#rgClose').addEventListener('click', closeSheet);
    s.querySelectorAll('[data-leg]').forEach(function (b) { b.addEventListener('click', function () { Platform.openExternal(legs[+b.dataset.leg].url); }); });
  }
  /* ---- exportar a GPX ---- */
  function exportGpx(p) {
    if (!p || !p.coords || p.coords.length < 2) { A.toast('Esta ruta no tiene trazado.', 'warn'); return; }
    var file = (p.name || 'ruta').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50) || 'ruta';
    Platform.downloadCsv(file + '.gpx', L.planToGpx(p), 'Ruta ' + (p.name || '')).then(function () { if (!native) A.toast('GPX descargado.', 'ok'); }, function (e) { if (!/cancel/i.test(String(e && e.message))) A.toast('No se ha podido compartir el GPX.', 'bad'); });
  }
  /* ---- importar un GPX como ruta a seguir ---- */
  var gpxMode = null, OSRM = 'https://router.project-osrm.org/route/v1/driving/';
  // Indicaciones de giro: se pide a OSRM la ruta pasando por puntos del propio trazado (uno cada 1,5 km) y solo se
  // aprovechan los tramos en los que va por la misma carretera. El trazado que se sigue es siempre el del archivo.
  function gpxSteps(line) {
    var vias = L.viaPoints(line, 1500), CH = 40, i0 = 0, out = { steps: [], ok: 0, bad: 0, dur: 0 };
    var skip = function (part) { out.bad += part.length - 1; out.dur += (part[part.length - 1].along - part[0].along) / 15; };
    if (navigator.onLine === false) { skip(vias); return Promise.resolve(out); }
    function next() {
      if (i0 >= vias.length - 1) return out;
      var start = i0, part = vias.slice(start, start + CH + 1), isEnd = start + CH >= vias.length - 1; i0 += CH;
      var url = OSRM + part.map(function (v) { return v.lon.toFixed(5) + ',' + v.lat.toFixed(5); }).join(';') + '?overview=false&steps=true';
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null; if (ctrl) setTimeout(function () { ctrl.abort(); }, 9000);
      return fetch(url, ctrl ? { signal: ctrl.signal } : {}).then(function (r) { return r.json(); }).then(function (j) {
        if (!j.routes || !j.routes[0]) { skip(part); return; }
        var r = L.trackSteps(j.routes[0], vias, start, line, isEnd);
        out.steps = out.steps.concat(r.steps); out.ok += r.ok; out.bad += r.bad; out.dur += r.dur;
      }, function () { skip(part); }).then(next);
    }
    return Promise.resolve().then(next);
  }
  function gpxAsPlan(g) {
    var simp = Geo.simplify(g.coords.map(function (c) { return [0, c[1], c[0]]; }), 8).map(function (p) { return [p[2], p[1]]; });
    var line = L.makeLine(simp), km = Math.round(line.total / 100) / 10;
    var plan = { id: Date.now(), name: g.name.slice(0, 60), wps: g.wps, pois: g.pois || [], coords: simp, dist: km, dur: Math.round(line.total / 15), routed: true, steps: [], created: Date.now(), gpx: true };
    A.toast('Leyendo la ruta del archivo…');
    return gpxSteps(line).then(function (r) {
      plan.steps = r.steps; if (r.ok) plan.dur = Math.round(r.dur);
      var total = r.ok + r.bad, part = total ? r.ok / total : 0;
      var np = (g.pois || []).length, named = g.wps.filter(function (w, i) { return w[2] && w[3] && i > 0 && i < g.wps.length - 1; }).map(function (w) { return w[2].split(',')[0]; });
      var d = String(km).replace('.', ',') + ' km · ' + fmtMin(plan.dur) + ' · ' + g.wps.length + ' puntos' + (named.length ? ' · ' + named.length + (named.length === 1 ? ' parada con nombre (' : ' paradas con nombre (') + named.slice(0, 3).join(', ') + (named.length > 3 ? '…' : '') + ')' : '') + (np ? ' · ' + np + (np === 1 ? ' punto marcado' : ' puntos marcados') : '');
      offerPlan(plan, d, part === 1 ? 'Con indicaciones de giro.' : (part >= 0.9 ? 'Con indicaciones de giro en casi todo el recorrido.' : (part > 0 ? 'Indicaciones de giro en parte del recorrido; en el resto, sigue la línea.' : 'Sin indicaciones de giro (no había conexión): se sigue la línea del mapa.')), g.title);
    }).catch(function (e) { A.toast('No se pudo importar: ' + (e && e.message || e), 'bad'); });
  }
  // Una ruta recién importada no se impone: se elige entre guardarla sin más o guardarla y empezarla ahora.
  function offerPlan(plan, summary, note, title) {
    sheet('<div class="head"><h1>' + (title || 'Ruta importada') + '</h1></div><form class="rg-form" id="ofForm"><label>Nombre<input id="ofName" maxlength="60" value="' + esc(plan.name) + '"></label></form>' +
      '<p>' + esc(summary) + '</p>' + (note ? '<p class="muted rg-small" style="text-align:left">' + esc(note) + '</p>' : '') +
      '<button class="btn big primary" id="ofSave" type="button">Guardar en mis rutas</button><button class="btn big" id="ofGo" type="button">Guardar y empezarla ahora</button><button class="btn rg-skip" id="ofNo" type="button">Descartar</button>');
    var named = function () { plan.name = $('#ofName').value.trim().slice(0, 60) || plan.name; };
    $('#ofForm').addEventListener('submit', function (e) { e.preventDefault(); });
    $('#ofSave').addEventListener('click', function () { named(); closeSheet(); A.savePlan(plan).then(function () { A.toast('Guardada. La tienes en Rutas → Planificadas.', 'ok'); }); });
    $('#ofGo').addEventListener('click', function () { named(); closeSheet(); A.usePlan(plan).then(function () { A.showView('map'); A.startRide(); }); });
    $('#ofNo').addEventListener('click', function () { closeSheet(); A.toast('Ruta descartada.', 'warn'); });
  }
  // Para los días de un viaje: del archivo GPX a una ruta lista para seguir (con giros si hay conexión), sin guardarla en «mis rutas».
  function gpxRoute(text, fname) {
    var g; try { g = L.gpxToPlan(text); } catch (e) { return Promise.reject(new Error('No se pudo leer el GPX: ' + e.message)); }
    if (!g.name) g.name = String(fname || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim() || 'Ruta GPX';
    if (g.route) return Promise.reject(new Error('Ese archivo solo trae puntos sueltos, sin trazado. Impórtalo desde Rutas, guarda la ruta y elígela aquí.'));
    var simp = Geo.simplify(g.coords.map(function (c) { return [0, c[1], c[0]]; }), 8).map(function (p) { return [p[2], p[1]]; });
    var line = L.makeLine(simp), km = Math.round(line.total / 100) / 10;
    var route = { name: g.name.slice(0, 60), wps: g.wps, pois: g.pois || [], coords: simp, steps: [], dist: km, dur: Math.round(line.total / 15) };
    return gpxSteps(line).then(function (r) { route.steps = r.steps; if (r.ok) route.dur = Math.round(r.dur); return route; }, function () { return route; });
  }
  function gpxPicked(text, fname) {
    var mode = gpxMode, g; gpxMode = null;
    try { g = L.gpxToPlan(text); } catch (e) { A.toast('No se pudo importar: ' + e.message, 'bad'); return; }
    if (!g.name) g.name = String(fname || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim() || 'Ruta GPX';
    if (g.route) {     // solo puntos sueltos: al planificador, que calcula la carretera entre ellos
      A.showView('map');
      if (A.setWaypoints(g.wps.map(function (w) { return { lat: w[0], lon: w[1], name: w[2] }; }), g.name) !== false) A.toast('El archivo trae ' + g.wps.length + ' puntos sin trazado. Revisa la ruta y pulsa «Guardar».', 'ok');
      return;
    }
    if (!g.timed || mode === 'plan') { gpxAsPlan(g); return; }
    sheet('<div class="head"><h1>Importar GPX</h1></div><p>«' + esc(g.name) + '» es un recorrido grabado. ¿Qué quieres hacer con él?</p>' +
      '<button class="btn big primary" id="gxPlan" type="button">Seguirlo como ruta</button><button class="btn" id="gxRec" type="button">Guardarlo en mis rutas grabadas</button><button class="btn rg-skip" id="gxNo" type="button">Cancelar</button>');
    $('#gxPlan').addEventListener('click', function () { closeSheet(); gpxAsPlan(g); });
    $('#gxRec').addEventListener('click', function () { closeSheet(); A.importRecordedGpx(text, fname); });
    $('#gxNo').addEventListener('click', closeSheet);
  }
  if ($('#planGpx')) $('#planGpx').addEventListener('click', function () { gpxMode = 'plan'; var f = $('#gpxFile'); f.value = ''; f.click(); });

  /* ---- medias de cada motero: se suman al guardar cada ruta, no se recalculan ---- */
  function sentIds() { try { return JSON.parse(localStorage.getItem('rg.statsSent') || '{}'); } catch (e) { return {}; } }
  function rideSum(list) {
    var o = { n: 0, km: 0, s: 0, c: 0, lean: 0, max: 0 };
    list.forEach(function (r) {
      var peaks = (r.corners || []).map(function (c) { return Math.abs(c.peak || 0); }).filter(function (x) { return x >= 5 && x <= 70; });
      o.n++; o.km += Math.min(r.dist || 0, 3000); o.s += r.movingS || 0; o.c += peaks.length; peaks.forEach(function (x) { o.lean += x; });
      o.max = Math.max(o.max, Math.min(70, r.maxL || 0, 70), Math.min(70, r.maxR || 0));
    });
    return o;
  }
  // Envía las rutas que aún no se han contado (al guardar una, o todas las antiguas la primera vez que hay sesión).
  function sendStats() {
    if (!sb || !user || !A.rides) return;
    var sent = sentIds(), todo = A.rides().filter(function (r) { return !sent[r.id] && !r.demo && !r.imported && !r.inProgress && (r.dist || 0) >= 2 && (r.movingS || 0) >= 300; });
    if (!todo.length) return;
    var o = rideSum(todo);
    sb.rpc('stats_add', { p_rides: o.n, p_km: Math.round(o.km * 10) / 10, p_moving_s: Math.round(o.s), p_corners: o.c, p_lean_sum: Math.round(o.lean * 10) / 10, p_lean_max: Math.round(o.max * 10) / 10 }).then(function (r) {
      if (r.error) return;
      todo.forEach(function (x) { sent[x.id] = 1; }); try { localStorage.setItem('rg.statsSent', JSON.stringify(sent)); } catch (e) {}
      setTimeout(function () { levelNudge(false); }, 6000);
    }, function () {});
  }
  window.RGStats = { rideSaved: function () { setTimeout(sendStats, 1500); } };

  /* ---- ¿cuadra tu nivel con tus rutas? Se dice con cariño, y solo de vez en cuando ---- */
  function adviceText(adv, cur) {
    var data = 'media de ' + adv.speed + ' km/h en movimiento y ' + adv.lean + '° en curva en ' + adv.rides + ' rutas', sug = '«' + L.LEVELS[adv.suggest] + '»';
    if (adv.dir === 'set') return ['Ya te vamos conociendo', 'Aún no has elegido nivel. Por tus rutas (' + data + '), lo tuyo es ' + sug + '.'];
    if (adv.dir === 'up') return ['Te estás quitando méritos', 'Tienes puesto «' + L.LEVELS[cur] + '», pero tus rutas (' + data + ') son más de ' + sug + '. No seas modesto: así el grupo que te toque irá a tu ritmo.'];
    return ['Entre tú y yo…', 'Tienes puesto «' + L.LEVELS[cur] + '», y nadie te quita lo bailado, pero tus rutas (' + data + ') suenan más a ' + sug + '. No es ninguna deshonra: con el nivel bien puesto te toca un grupo en el que disfrutas en vez de sufrir por seguir el ritmo.'];
  }
  function setLevel(lv) { return sb.from('profiles').update({ level: lv }).eq('id', user.id).then(function (r) { if (r.error) throw r.error; return refresh(); }); }
  // Después de guardar una ruta (o al entrar): si el nivel elegido y los datos no cuadran, se propone cambiarlo.
  // Si dice que no, no se vuelve a sacar el tema en un mes, salvo que los datos cambien de nivel.
  function levelNudge(force) {
    if (!sb || !user || A.isRec() || !$('#rgSheet').hidden) return;
    sb.from('rider_stats').select('*').eq('user_id', user.id).maybeSingle().then(function (q) {
      var cur = profile && profile.level, adv = L.levelAdvice(cur, q.data); if (!adv || A.isRec() || !$('#rgSheet').hidden) return;
      var mem = null; try { mem = JSON.parse(localStorage.getItem('rg.levelNudge') || 'null'); } catch (e) {}
      if (!force && mem && mem.s === adv.suggest && mem.l === (cur || 0) && Date.now() - mem.at < 30 * 86400e3) return;
      try { localStorage.setItem('rg.levelNudge', JSON.stringify({ s: adv.suggest, l: cur || 0, at: Date.now() })); } catch (e) {}
      var t = adviceText(adv, cur);
      sheet('<div class="head"><h1>' + t[0] + '</h1></div><p>' + esc(t[1]) + '</p><p class="muted rg-small" style="text-align:left">El nivel solo lo ven los administradores de las rutas a las que vas, y sirve para repartir los grupos.</p>' +
        '<button class="btn big primary" id="lnYes" type="button">Cambiar a «' + esc(L.LEVELS[adv.suggest]) + '»</button><button class="btn" id="lnNo" type="button">' + (cur ? 'Lo dejo como está' : 'Ahora no') + '</button>');
      $('#lnNo').addEventListener('click', closeSheet);
      $('#lnYes').addEventListener('click', function (ev) { busy(ev.currentTarget, function () { return setLevel(adv.suggest).then(function () { closeSheet(); A.toast('Hecho: ahora eres «' + L.LEVELS[adv.suggest] + '».', 'ok'); }); }); });
    }, function () {});
  }

  /* ---- rutas públicas ---- */
  // Todas las rutas planificadas se guardan en la cuenta. «Pública» solo cambia quién la ve: cualquiera, en «De otros moteros».
  function togglePublic(p) {
    if (!user) { A.toast('Entra en tu cuenta para publicar rutas.', 'warn'); openAuth(false); return Promise.resolve(); }
    if (!p.coords || p.coords.length < 2 || !window.RGSync) return Promise.resolve();
    var want = !p.pub;
    return RGSync.pushPlan(p).then(function () { return sb.from('routes').update({ visibility: want ? 'public' : 'private' }).eq('id', p.cloudId); }).then(function (r) {
      if (r.error) throw r.error;
      p.pub = want; A.toast(want ? 'Ruta publicada: ya la puede ver y seguir cualquiera.' : 'Ruta privada: ya no sale en «De otros moteros». Sigue guardada en tu cuenta.', 'ok');
      return A.updatePlan(p);
    }).catch(function (e) { A.toast(msg(e), 'bad'); });
  }
  // Rutas que otros moteros han hecho públicas. Se pintan dentro de Rutas → «De otros moteros» (o en una hoja).
  var pubBy = null;
  function fetchPlan(x) {
    return sb.from('routes').select('name,plan').eq('id', x.id).single().then(function (q) {
      if (q.error || !q.data || !q.data.plan || !(q.data.plan.coords || []).length) throw (q.error || new Error('Esa ruta ya no está disponible.'));
      var pl = q.data.plan, p = { id: parseInt(x.id.replace(/-/g, '').slice(0, 12), 16), name: q.data.name, wps: pl.wps || [], pois: pl.pois || [], coords: pl.coords, steps: pl.steps || [], dist: pl.dist || Math.round((x.m || 0) / 100) / 10, dur: pl.dur || x.s || 0, routed: true, created: Date.now(), from: x.by };
      if (x.mine) { var own = A.plans().filter(function (y) { return y.cloudId === x.id; })[0]; if (own) p.id = own.id; p.cloudId = x.id; p.pub = true; }
      return p;
    });
  }
  function renderPublic(box, inSheet) {
    if (!sb || !user) { box.innerHTML = '<div class="empty">Entra en tu cuenta para ver las rutas que comparten otros moteros.</div><button class="btn primary wide" type="button" id="pbLogin">Entrar o crear cuenta</button>'; box.querySelector('#pbLogin').addEventListener('click', function () { openAuth(false); }); return; }
    var fix = A.lastFix();
    box.innerHTML = '<div class="empty">Cargando rutas…</div>';
    sb.rpc('routes_public', { p_lat: fix ? fix.lat : null, p_lon: fix ? fix.lon : null, p_limit: 80 }).then(function (r) {
      if (!box.isConnected) return;
      if (r.error) { box.innerHTML = '<div class="notice">' + esc(msg(r.error)) + '</div>'; return; }
      var all = r.data || [], list = pubBy ? all.filter(function (x) { return x.by === pubBy; }) : all;
      if (pubBy && !list.length) { pubBy = null; list = all; }
      box.innerHTML = (pubBy ? '<div class="rg-row" style="margin-bottom:8px"><b>Rutas de ' + esc(pubBy) + '</b><button class="link" id="pbAll" type="button">Ver todas</button></div>' : '<p class="muted rg-small" style="text-align:left;margin:0 0 8px">' + (all.length ? (fix ? 'Rutas públicas de otros moteros. Primero, las que salen más cerca de ti.' : 'Rutas públicas de otros moteros, de la más nueva a la más antigua.') : '') + '</p>') +
        (list.length ? list.map(function (x) {
          var far = fix && x.lat != null ? L.dist(fix.lat, fix.lon, x.lat, x.lon) : null;
          var ln = (x.line || []).filter(function (c) { return c && c.length > 1; });
          return '<div class="club-card ex" data-id="' + x.id + '"><div class="thumb ex-thumb">' + (ln.length > 1 && window.Geo ? Geo.thumbSvg(ln.map(function (c) { return [0, c[1], c[0]]; }), 120, 'currentColor') : '<svg class="ex-pin"><use href="#i-gmaps"/></svg>') + '</div><b>' + esc(x.name) + '</b><span class="muted">' + fmtKm(x.m || 0) + (x.s ? ' · ' + fmtMin(x.s) : '') + (far != null ? ' · sale a ' + L.fmtDist(far) : '') + '</span>' +
            '<span class="muted">' + (x.mine ? 'La has publicado tú' : 'De <button class="link" data-act="by" type="button">' + esc(x.by) + '</button>') + '</span>' +
            '<div class="rg-row"><button class="btn small primary" data-act="see" type="button">Ver en el mapa</button><button class="btn small" data-act="use" type="button">Guardar en mis rutas</button>' + (x.mine ? '' : '<button class="link" data-act="rep" type="button">Denunciar</button>') + '</div></div>';
        }).join('') : '<div class="empty">Todavía no hay rutas públicas. Publica la primera: en «Planificadas», botón «Privada · publicar».</div>');
      if (box.querySelector('#pbAll')) box.querySelector('#pbAll').addEventListener('click', function () { pubBy = null; renderPublic(box, inSheet); });
      [].forEach.call(box.querySelectorAll('.ex'), function (card) {
        var x = list.filter(function (y) { return y.id === card.dataset.id; })[0];
        var ln = (x.line || []).filter(function (c) { return c && c.length > 1; });
        if (window.RGThumbs) RGThumbs.attach(card.querySelector('.ex-thumb'), 'u' + x.id, ln.length > 1 ? ln : (x.lon != null ? [[x.lon, x.lat]] : null));
        card.querySelector('[data-act=see]').addEventListener('click', function (ev) { busy(ev.currentTarget, function () { return fetchPlan(x).then(function (p) { if (inSheet) closeSheet(); A.previewPlan(p); A.toast('«' + p.name + '», de ' + (x.mine ? 'ti' : x.by) + '. Pulsa «Guardar» si te la quieres quedar.', 'ok'); }); }); });
        card.querySelector('[data-act=use]').addEventListener('click', function (ev) { var b = ev.currentTarget; busy(b, function () { return fetchPlan(x).then(function (p) { return A.savePlan(p).then(function () { A.toast('Guardada. La tienes en Rutas → Planificadas.', 'ok'); }); }); }).then(function () { b.textContent = 'Guardada ✓'; b.disabled = true; }); });
        var by = card.querySelector('[data-act=by]'); if (by) by.addEventListener('click', function () { pubBy = x.by; renderPublic(box, inSheet); });
        var rep = card.querySelector('[data-act=rep]');
        if (rep) rep.addEventListener('click', function () {
          if (!rep.dataset.armed) { rep.dataset.armed = '1'; rep.textContent = '¿Denunciar? Toca otra vez'; return; }
          sb.from('feedback').insert({ kind: 'fallo', message: 'Ruta pública denunciada: «' + x.name + '» (' + x.id + '), de ' + x.by, app_version: A.version }).then(function (q) { A.toast(q.error ? msg(q.error) : 'Gracias. La revisaremos.', q.error ? 'bad' : 'ok'); rep.remove(); });
        });
      });
    }, function () { if (box.isConnected) box.innerHTML = '<div class="notice">Sin conexión.</div>'; });
  }
  function explore() {
    sheet('<div class="head"><h1>Rutas de otros moteros</h1><button class="btn small icon" id="exX" type="button"><svg><use href="#i-close"/></svg></button></div><div id="exList"></div>');
    $('#exX').addEventListener('click', closeSheet); renderPublic($('#exList'), true);
  }
  // Una ruta grabada, como ruta para seguir: el mismo camino que un GPX.
  function trackAsPlan(name, coords) {
    var a = coords[0], b = coords[coords.length - 1];
    return gpxAsPlan({ name: name || 'Ruta grabada', title: 'Ruta para seguir', coords: coords, wps: [[a[1], a[0], 'Salida'], [b[1], b[0], 'Llegada']], pois: [] });
  }

  window.RGNav = { gpxRoute: gpxRoute, togglePublic: togglePublic, explore: explore, renderPublic: renderPublic, trackAsPlan: trackAsPlan, gpxPicked: gpxPicked, onFix: onFix, sync: sync, redraw: function () { drawRejoin(); stopKey = ''; drawStops(); if (window.RGGroup) RGGroup.redraw(); }, state: nav, openMaps: openMaps, exportGpx: exportGpx, resolvePoint: function (t) { return resolvePoint(t); } };

  /* ================= importar enlace de Google Maps ================= */
  function readClipboard() {
    if (P.Clipboard) return P.Clipboard.read().then(function (r) { return (r && r.value) || ''; });
    if (navigator.clipboard && navigator.clipboard.readText) return navigator.clipboard.readText();
    return Promise.reject(new Error('sin portapapeles'));
  }
  // Los enlaces cortos (maps.app.goo.gl) no llevan los puntos: hay que preguntar a Google a dónde apuntan.
  // Primero se lee solo la redirección (sin seguirla); si no la da, se sigue y se busca la dirección en la respuesta.
  var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  function header(h, name) { for (var k in (h || {})) if (k.toLowerCase() === name) return h[k]; return ''; }
  function expandShort(url) {
    if (!P.CapacitorHttp) return Promise.reject(new Error('Los enlaces cortos solo se pueden abrir desde la app del móvil. Aquí, pega el enlace largo.'));
    var seen = '';
    function ask(u, follow) { return P.CapacitorHttp.request({ url: u, method: 'GET', headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es' }, disableRedirects: !follow, connectTimeout: 10000, readTimeout: 10000 }); }
    function pick(r) {
      var loc = header(r.headers, 'location'), body = typeof r.data === 'string' ? r.data : '';
      seen = 'estado ' + r.status + (loc ? ', ' + loc.slice(0, 60) : (r.url ? ', ' + String(r.url).slice(0, 60) : ''));
      return L.findMapsUrl(loc) || L.findMapsUrl(r.url) || L.findMapsUrl(body.slice(0, 400000));
    }
    return ask(url, false).then(function (r) {
      var found = pick(r); if (found) return found;
      var loc = header(r.headers, 'location');
      return ask(loc && /^https?:/i.test(loc) ? loc : url, true).then(pick);
    }, function () { return ask(url, true).then(pick); }).then(function (found) {
      if (found) return found;
      throw new Error('No he podido abrir el enlace corto (' + seen + '). Abre el enlace en el navegador y copia la dirección completa.');
    });
  }
  // Punto de salida de un evento a partir de lo que pegue el organizador: { url, lat, lon, name }.
  // El enlace se guarda siempre; las coordenadas, cuando el enlace las lleva o se pueden sacar abriéndolo.
  function resolvePoint(text) {
    var url = L.extractUrl(text), p = L.parseMapsPoint(text);
    if (p) return Promise.resolve({ url: url || L.mapsPointUrl(p.lat, p.lon), lat: p.lat, lon: p.lon, name: p.name || '' });
    if (!url) return Promise.reject(new Error('Eso no es un enlace. En Google Maps: toca el sitio → Compartir → Copiar enlace.'));
    if (!L.isShortLink(url)) return Promise.resolve({ url: url, lat: null, lon: null, name: '' });
    return expandShort(url).then(function (full) { var q = L.parseMapsPoint(full); return q ? { url: url, lat: q.lat, lon: q.lon, name: q.name || '' } : { url: url, lat: null, lon: null, name: '' }; },
      function () { return { url: url, lat: null, lon: null, name: '' }; });
  }
  function importLink(text) {
    var url = L.extractUrl(text);
    if (!url) { A.toast('Pega primero el enlace de la ruta de Google Maps.', 'warn'); return Promise.resolve(); }
    var btn = $('#planImport'); if (btn) btn.disabled = true;
    return Promise.resolve(L.isShortLink(url) ? expandShort(url) : url).then(function (full) {
      var r = L.parseMapsUrl(full);
      if (r.error) throw new Error(r.error === 'short' ? 'No he podido abrir el enlace corto.' : r.error);
      if (!r.points.length) throw new Error('El enlace usa nombres de sitios que no puedo situar (' + r.unresolved.join(', ') + '). Tócalos en el mapa.');
      var names = r.points.filter(function (p) { return p.name && !p.via; }).map(function (p) { return p.name.split(',')[0]; });
      A.setWaypoints(r.points, names.length >= 2 ? (names[0] === names[names.length - 1] ? 'Circular desde ' + names[0] : names[0] + ' – ' + names[names.length - 1]).slice(0, 60) : '');
      A.toast(r.unresolved.length ? 'Leídos ' + r.points.length + ' puntos. Faltan por situar: ' + r.unresolved.join(', ') + '. Tócalos en el mapa.' : 'Ruta leída: ' + r.points.length + ' puntos.', r.unresolved.length ? 'warn' : 'ok');
      var inp = $('#planLink'); if (inp) inp.value = '';
    }).catch(function (e) { A.toast(e && e.message ? e.message : String(e), 'bad'); }).then(function () { if (btn) btn.disabled = false; });
  }
  if ($('#planImport')) $('#planImport').addEventListener('click', function () {
    var v = $('#planLink').value.trim();
    if (v) { importLink(v); return; }
    readClipboard().then(function (t) { if (L.extractUrl(t)) { $('#planLink').value = t.trim(); return importLink(t); } A.toast('Copia el enlace en Google Maps (Compartir → Copiar enlace) y vuelve a pulsar.', 'warn'); })
      .catch(function () { A.toast('Mantén pulsado el campo, pega el enlace y vuelve a pulsar.', 'warn'); });
  });

  /* ================= cuenta y sugerencias (Supabase) ================= */
  var SB_URL = 'https://lpkeaxtzfbuqjkkusjit.supabase.co', SB_KEY = 'sb_publishable_lUo3IlFV8X0pVL5HUfbgNA_VLeizTOw';   // clave pública: la seguridad la ponen las reglas de la base de datos
  var sb = null, user = null, profile = null;
  try { if (window.supabase && window.supabase.createClient) sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }); } catch (e) { sb = null; }
  function msg(e) {
    var m = String((e && e.message) || e || '').toLowerCase();
    if (m.indexOf('invalid login') >= 0) return 'Correo o contraseña incorrectos.';
    if (m.indexOf('already registered') >= 0) return 'Ese correo ya tiene cuenta. Entra con tu contraseña.';
    if (m.indexOf('password should be') >= 0) return 'La contraseña tiene que tener al menos 6 caracteres.';
    if (m.indexOf('not confirmed') >= 0) return 'Confirma tu correo antes de entrar (mira tu bandeja de entrada).';
    if (m.indexOf('logins are disabled') >= 0 || m.indexOf('signups not allowed') >= 0 || m.indexOf('provider is not enabled') >= 0) return 'El registro por correo está desactivado en el servidor.';
    if (m.indexOf('could not find the function') >= 0 || m.indexOf('could not find the table') >= 0) return 'Esta función aún no está activada en el servidor (falta ejecutar un archivo .sql en Supabase).';
    if (m.indexOf('fetch') >= 0 || m.indexOf('network') >= 0) return 'Sin conexión con el servidor. Revisa tu cobertura.';
    return (e && e.message) || String(e);
  }
  // Hoja inferior (formularios y decisiones). kind 'page' = pantalla entera (bienvenida y permisos);
  // kind 'win' = ventana centrada (avisos que piden una respuesta).
  // En Mapa y Comunidad lleva la clase rg-eq, que da más violeta (guía de estética).
  function sheet(html, kind) {
    if (!kind && (/^<div class="rg-logo"/.test(html) || /<h1>(Un permiso más|Falta algo para rodar|Permiso de ubicación)<\/h1>/.test(html))) kind = 'page';
    var s = $('#rgSheet'), v = document.querySelector('.app > .view:not([hidden])'), eq = !!(v && (v.id === 'view-map' || v.id === 'view-club')) && kind !== 'page';
    var still = !s.hidden;      // si ya estaba abierta (se redibuja), no repite la animación de entrada
    s.className = 'rg-sheet' + (kind === 'page' ? ' rg-page' : '') + (kind === 'win' ? ' rg-win' : '') + (eq ? ' rg-eq' : '') + (still ? ' rg-still' : '');
    s.innerHTML = '<div class="rg-sheet-in">' + html + '</div>'; s.hidden = false; s.scrollTop = 0; var inn = s.firstChild; if (inn) inn.scrollTop = 0; return s;
  }
  function closeSheet() { var s = $('#rgSheet'); s.hidden = true; s.innerHTML = ''; }
  // «Atrás» en cualquier hoja: pulsa su botón de cerrar o de cancelar. Lo usan el botón atrás de Android y el toque fuera de la hoja.
  function sheetBack() {
    var s = $('#rgSheet'); if (!s || s.hidden) return false;
    var b = s.querySelector('.head .btn.icon, #rgSkip, #ofNo, #gxNo, #lnNo'); if (b) b.click();
    return true;      // si la hoja pide una respuesta (permisos, avisos), se queda: no se cambia la pantalla de debajo
  }
  document.addEventListener('click', function (ev) { var s = $('#rgSheet'); if (ev.target === s && !s.classList.contains('rg-page') && !s.classList.contains('rg-win')) sheetBack(); });
  // Fondo vivo (líneas que se mueven despacio) detrás de las pantallas que no son el mapa.
  (function () { var b = document.createElement('div'); b.className = 'rg-bg'; b.setAttribute('aria-hidden', 'true'); b.innerHTML = '<i></i><i></i><b></b>'; document.body.insertBefore(b, document.body.firstChild); })();
  // Onda al tocar un botón (solo en los que no van colocados a mano sobre el mapa).
  document.addEventListener('pointerdown', function (ev) {
    var b = ev.target.closest && ev.target.closest('.btn'); if (!b || b.disabled) return;
    var pos = getComputedStyle(b).position; if (pos !== 'static' && pos !== 'relative') return;
    b.classList.add('rg-rip-host'); var r = b.getBoundingClientRect(), sp = document.createElement('span'); sp.className = 'rg-rip'; sp.style.left = (ev.clientX - r.left) + 'px'; sp.style.top = (ev.clientY - r.top) + 'px'; b.appendChild(sp); setTimeout(function () { if (sp.parentNode) sp.parentNode.removeChild(sp); }, 650);
  }, { passive: true });
  function busy(btn, f) { var old = btn.innerHTML; btn.disabled = true; btn.textContent = 'Un momento…'; return Promise.resolve().then(f).catch(function (e) { A.toast(msg(e), 'bad'); }).then(function () { btn.disabled = false; btn.innerHTML = old; }); }
  var LOGO = '<div class="rg-logo"><img class="rg-sym" src="simbolo.svg" alt=""><b>ReGroup<i>Ride</i></b></div>';

  // La cuenta es obligatoria: sin sesión, la pantalla de entrada no se puede cerrar. (Las pruebas automáticas siguen pudiendo entrar sin cuenta.)
  var MUST = !navigator.webdriver; try { if (localStorage.getItem('rg.test.wall')) MUST = true; } catch (e) {}
  function openAuth(first, mode0) {
    var mode = mode0 || (first ? 'signup' : 'login');
    var pic = null;
    function draw() {
      var s = sheet(LOGO + '<p class="muted rg-lead">Rutas en grupo, sin perder a nadie.</p><div id="rgAuthBox" data-mode="' + mode + '">' +
        (window.RGArt ? RGArt.split(mode) : '<div class="seg rg-wide" id="rgMode"><button type="button" data-m="login" aria-pressed="' + (mode === 'login') + '">Entrar</button><button type="button" data-m="signup" aria-pressed="' + (mode === 'signup') + '">Crear cuenta</button></div>') +
        '<form id="rgAuth" class="rg-form" autocomplete="on" data-mode="' + mode + '" style="margin-top:16px">' +
        '<div class="rg-only"><div>' +
          '<button class="rg-pic" id="rgPic" type="button"><span class="rg-ava" id="rgPicAva"><svg width="26" height="26"><use href="#i-camera"/></svg></span><span><b>Tu foto</b><small>Opcional. Es la que verá el grupo.</small></span></button>' +
          '<label>Tu nombre<input id="rgName" maxlength="60" autocomplete="name" placeholder="Como te conoce la gente"></label>' +
          '<label>Teléfono<input id="rgTel" type="tel" inputmode="tel" minlength="9" maxlength="20" pattern="[0-9+ ]{9,20}" autocomplete="tel" placeholder="600 000 000" title="Tu número, con 9 cifras o más"></label>' +
          '<label>¿Cómo vas en moto?<select id="rgLevel">' + levelOptions(3) + '</select></label></div></div>' +
        '<label>Correo<input id="rgEmail" type="email" required autocomplete="email" inputmode="email"></label>' +
        '<label>Contraseña<input id="rgPass" type="password" required minlength="6"></label>' +
        '<button class="btn big primary" type="submit" id="rgGo"></button></form>' +
        '<div class="rg-foot"><button class="link rg-center" id="rgForgot" data-for="login" type="button">He olvidado la contraseña</button><p class="muted rg-small" data-for="signup">El teléfono solo lo ven los administradores de tus rutas y quien pida ayuda. Necesitas tener al menos 16 años.</p></div>' +
        (MUST ? '<p class="muted rg-small rg-center">Para usar ReGroupRide necesitas una cuenta. Es gratis y se crea en un minuto.</p>' :
          '<button class="btn rg-skip" id="rgSkip" type="button">' + (first ? 'Ahora no' : 'Cerrar') + '</button>') + '</div>');
      // Cambiar entre entrar y crear cuenta no redibuja nada: los campos de más se despliegan o se recogen.
      function setMode(m, fx) {
        mode = m; var up = m === 'signup', sp = $('#rgMode');
        $('#rgAuthBox').dataset.mode = m; $('#rgAuth').dataset.mode = m;
        ['#rgName', '#rgTel'].forEach(function (q) { $(q).required = up; });
        ['#rgName', '#rgTel', '#rgLevel', '#rgPic'].forEach(function (q) { $(q).tabIndex = up ? 0 : -1; });
        $('#rgPass').autocomplete = up ? 'new-password' : 'current-password';
        $('#rgGo').textContent = up ? 'Crear cuenta' : 'Entrar';
        sp.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.m === m)); });
        if (sp.classList.contains('rg-split')) { sp.dataset.on = m; if (fx) { sp.classList.remove('sw-login', 'sw-signup'); void sp.offsetWidth; sp.classList.add('sw-' + m); } }
      }
      setMode(mode, false);
      s.querySelectorAll('#rgMode button').forEach(function (b) { b.addEventListener('click', function () { if (b.dataset.m !== mode) setMode(b.dataset.m, true); }); });
      $('#rgPic').addEventListener('click', function () { if (!window.RGCrop) return; RGCrop.pick().then(function (d) { if (!d) return; pic = d; var a = $('#rgPicAva'); if (a) { a.classList.add('has'); a.innerHTML = '<img src="' + d + '" alt="">'; } }); });
      if ($('#rgSkip')) $('#rgSkip').addEventListener('click', function () { try { localStorage.removeItem('rg.wall'); } catch (e) {} closeSheet(); });
      $('#rgAuth').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var email = $('#rgEmail').value.trim(), pass = $('#rgPass').value, name = mode === 'signup' ? $('#rgName').value.trim() : '', lvl = mode === 'signup' ? +$('#rgLevel').value : 0, tel = mode === 'signup' ? $('#rgTel').value.trim() : '';
        busy(ev.target.querySelector('button[type=submit]'), function () {
          if (!sb) throw new Error('No se ha podido cargar la conexión con el servidor.');
          var job = mode === 'login' ? sb.auth.signInWithPassword({ email: email, password: pass }) : sb.auth.signUp({ email: email, password: pass, options: { data: { name: name, phone: tel } } });
          return job.then(function (r) {
            if (r.error) throw r.error;
            if (mode === 'signup' && pic && A.setAvatar) A.setAvatar(pic);
            if (!r.data.session) { A.toast('Cuenta creada. Confirma el correo que te hemos enviado y luego entra.', 'ok'); setMode('login', true); return; }
            var set = lvl ? sb.from('profiles').update({ level: lvl }).eq('id', r.data.session.user.id).then(function () {}, function () {}) : Promise.resolve();
            try { localStorage.removeItem('rg.wall'); } catch (e) {}
            return set.then(refresh).then(function () { closeSheet(); A.toast(mode === 'login' ? 'Sesión iniciada.' : '¡Bienvenido, ' + (name || 'motero') + '!', 'ok'); });
          });
        }).then(function () { var g = $('#rgGo'); if (g) g.textContent = mode === 'signup' ? 'Crear cuenta' : 'Entrar'; });
      });
      $('#rgForgot').addEventListener('click', function () {
        var email = $('#rgEmail').value.trim(); if (!email) { A.toast('Escribe tu correo y vuelve a pulsar.', 'warn'); return; }
        sb.auth.resetPasswordForEmail(email, { redirectTo: 'https://regroupride-eventos.netlify.app/?reset=1' }).then(function (r) { A.toast(r.error ? msg(r.error) : 'Te hemos enviado un correo con un enlace para poner una contraseña nueva. Mira también en spam.', r.error ? 'bad' : 'ok'); });
      });
    }
    draw();
  }
  function refresh() {
    if (!sb) { renderAccount(); return Promise.resolve(); }
    return sb.auth.getSession().then(function (r) {
      user = (r.data && r.data.session && r.data.session.user) || null; profile = null;
      if (!user) return;
      return sb.from('profiles').select('*').eq('id', user.id).maybeSingle().then(function (p) { profile = p.data || null; var n = (profile && profile.name) || (user.user_metadata && user.user_metadata.name) || ''; if (n && A.setProfileName) A.setProfileName(n); }).then(loadPhone);
    }).catch(function () {}).then(renderAccount).then(function () { if (user) setTimeout(sendStats, 4000); });
  }
  function levelOptions(cur) { var o = ''; for (var i = 5; i >= 1; i--) o += '<option value="' + i + '"' + (i === cur ? ' selected' : '') + '>' + esc(L.LEVELS[i] + ' — ' + L.LEVEL_HINT[i]) + '</option>'; return o; }
  // Nivel de motero (para repartir grupos): se elige en el Perfil. El teléfono para las rutas (opcional) va aparte, en Ajustes.
  function openRider() {
    if (!user) { openAuth(false); return; }
    var lvl = profile && profile.level;
    sheet('<div class="head"><h1>Mi nivel de motero</h1><button class="btn small icon" id="rdX" type="button"><svg><use href="#i-close"/></svg></button></div><form class="rg-form" id="rdForm">' +
      '<label>¿Cómo vas en moto?<select id="rdLevel">' + (lvl ? '' : '<option value="" selected>Elige uno</option>') + levelOptions(lvl || 0) + '</select></label>' +
      '<p class="muted rg-small" style="text-align:left">Sirve para repartir los grupos en las rutas. Solo lo ven los administradores de la ruta en la que vayas, junto con tus medias de velocidad e inclinación.</p>' +
      '<div id="rdStats" class="muted rg-small" style="text-align:left"></div><button class="btn big primary" type="submit">Guardar</button></form>');
    $('#rdX').addEventListener('click', closeSheet);
    sb.from('rider_stats').select('*').eq('user_id', user.id).maybeSingle().then(function (q) {
      var st = q.data, el = $('#rdStats'); if (!el || !st || !st.rides) return;
      var adv = L.levelAdvice(lvl, st);
      if (adv) {     // aquí se dice siempre, con un botón para ponerlo
        var tx = adviceText(adv, lvl), box = document.createElement('div'); box.className = 'notice rg-advice';
        box.innerHTML = '<div><b>' + esc(tx[0]) + '</b><span>' + esc(tx[1]) + '</span><button class="btn small" type="button">Poner «' + esc(L.LEVELS[adv.suggest]) + '»</button></div>';
        el.parentNode.insertBefore(box, el);
        box.querySelector('button').addEventListener('click', function () { $('#rdLevel').value = String(adv.suggest); box.remove(); A.toast('Puesto. Pulsa «Guardar» para confirmarlo.', 'ok'); });
      }
      el.textContent = 'Tus medias en ' + st.rides + (st.rides === 1 ? ' ruta' : ' rutas') + ': ' + (st.moving_s > 600 ? Math.round(st.km / (st.moving_s / 3600)) + ' km/h en movimiento' : 'velocidad sin datos') + (st.corners >= 5 ? ' · ' + Math.round(st.lean_sum / st.corners) + '° de media en curva' : '') + '.';
    }, function () {});
    $('#rdForm').addEventListener('submit', function (ev) {
      ev.preventDefault(); var lv = +$('#rdLevel').value || null;
      busy(ev.target.querySelector('button[type=submit]'), function () {
        return sb.from('profiles').update({ level: lv }).eq('id', user.id).then(function (a) { if (a.error) throw a.error; return refresh(); }).then(function () { closeSheet(); A.toast('Nivel guardado.', 'ok'); });
      });
    });
  }
  // Teléfono para las rutas: solo lo ven otros administradores y quien pida ayuda.
  var ridePhone = null;   // null = aún no se sabe · '' = sin teléfono
  function loadPhone() {
    if (!user) { ridePhone = null; return Promise.resolve(); }
    return sb.from('profile_private').select('*').eq('id', user.id).maybeSingle().then(function (r) {
      var d = r.data || {}; ridePhone = 'ride_phone' in d ? (d.ride_phone || '') : null;
      // El teléfono que se dio al crear la cuenta se guarda solo, la primera vez que hay sesión.
      var tel = user && user.user_metadata && user.user_metadata.phone;
      if (ridePhone === '' && tel) return sb.from('profile_private').update({ ride_phone: tel }).eq('id', user.id).then(function (b) { if (!b.error) ridePhone = tel; }, function () {});
    }, function () { ridePhone = null; });
  }
  // Cambiar el nombre en Perfil cambia el de la cuenta.
  function saveName(n) {
    n = (n || '').trim(); if (!sb || !user || !n || (profile && profile.name === n)) return;
    sb.from('profiles').update({ name: n }).eq('id', user.id).then(function (r) { if (!r.error) { if (profile) profile.name = n; renderAccount(); } }, function () {});
  }
  // Cerrar sesión: se sube lo pendiente, se vacía el móvil (cada cuenta, lo suyo) y se vuelve a la pantalla de entrada.
  function signOut(force, btn) {
    if (A.isRec()) { A.toast('Para la ruta antes de cerrar sesión.', 'warn'); return; }
    var Sy = window.RGSync;
    var job = function () {
      return (force || !Sy ? Promise.resolve(true) : Sy.flush()).then(function (ok) {
        if (!ok) {
          sheet('<h1>No se ha podido subir todo</h1><p>Falta algo por guardar en tu cuenta' + (navigator.onLine === false ? ' porque no hay conexión' : '') + '. Si cierras sesión ahora, lo que no esté subido se borra de este móvil.</p>' +
            '<button class="btn big primary" id="soRetry" type="button">Reintentar</button><button class="btn big danger" id="soForce" type="button">Cerrar sesión y perderlo</button><button class="btn rg-skip" id="soNo" type="button">Cancelar</button>', 'win');
          $('#soRetry').addEventListener('click', function (ev) { signOut(false, ev.currentTarget); });
          $('#soForce').addEventListener('click', function (ev) { signOut(true, ev.currentTarget); });
          $('#soNo').addEventListener('click', closeSheet);
          return;
        }
        try { var RAp = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.RideAlerts; if (RAp && RAp.pushToken) RAp.pushToken().then(function (r) { if (r && r.token) sb.rpc('push_unregister', { p_token: r.token }).then(function () {}, function () {}); }, function () {}); } catch (e) {}
        try { var RAl = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.RideAlerts; if (RAl && RAl.eventClear) RAl.eventClear().catch(function () {}); } catch (e) {}
        return sb.auth.signOut().then(function () {}, function () {}).then(function () { return Sy ? Sy.wipeLocal() : null; }).then(function () { try { localStorage.setItem('rg.wall', '1'); } catch (e) {} location.reload(); });
      });
    };
    if (btn) busy(btn, job); else job();
  }
  function openPhone() {
    if (!user) { openAuth(false); return; }
    sb.from('profile_private').select('*').eq('id', user.id).maybeSingle().then(function (r) {
      var priv = r.data || {}, hasPhone = 'ride_phone' in priv;
      sheet('<div class="head"><h1>Teléfono para las rutas</h1><button class="btn small icon" id="rdX" type="button"><svg><use href="#i-close"/></svg></button></div><form class="rg-form" id="rdForm">' +
        '<label>Teléfono<input id="rdPhone" type="tel" inputmode="tel" required minlength="9" maxlength="20" pattern="[0-9+ ]{9,20}" autocomplete="tel" value="' + esc(priv.ride_phone || '') + '" placeholder="600 000 000"' + (hasPhone ? '' : ' disabled') + '></label>' +
        '<p class="muted rg-small" style="text-align:left">Lo ven los administradores de tus rutas y quien pida ayuda, para poder llamarte. Nadie más.</p>' +
        '<button class="btn big primary" type="submit"' + (hasPhone ? '' : ' disabled') + '>Guardar</button></form>');
      $('#rdX').addEventListener('click', closeSheet);
      $('#rdForm').addEventListener('submit', function (ev) {
        ev.preventDefault(); var ph = $('#rdPhone').value.trim(); if (!hasPhone) return;
        busy(ev.target.querySelector('button[type=submit]'), function () {
          return sb.from('profile_private').update({ ride_phone: ph }).eq('id', user.id).then(function (b) { if (b.error) throw b.error; ridePhone = ph; renderAccount(); closeSheet(); A.toast('Teléfono guardado.', 'ok'); });
        });
      });
    });
  }
  var authListeners = [];
  function renderAccount() {
    authListeners.forEach(function (f) { try { f(user); } catch (e) {} });
    // Perfil: el nivel de motero (cómo vas en moto), que es lo que usan los administradores para repartir grupos
    var pl = $('#rgRiderLevel'), lv = user && profile && profile.level;
    if (pl) {
      pl.innerHTML = '<button class="rg-level" id="rgRider" type="button"><span>' + (lv ? esc(L.LEVELS[lv]) : 'Elige tu nivel de motero') + '</span><small>' + (user ? (lv ? esc(L.LEVEL_HINT[lv]) + ' · tocar para cambiarlo' : 'Cómo vas en moto: sirve para repartir los grupos en las rutas') : 'Entra con tu cuenta para elegirlo') + '</small></button>';
      $('#rgRider').addEventListener('click', openRider);
    }
    var box = $('#rgAccount'); if (!box) return;
    if (user) {
      var name = (profile && profile.name) || (user.user_metadata && user.user_metadata.name) || 'Tu cuenta';
      box.innerHTML = '<div class="rg-acc"><span class="rg-ava">' + (profile && /^https:\/\//.test(profile.avatar_url || '') ? '<img src="' + esc(profile.avatar_url) + '" alt="">' : esc(name.charAt(0).toUpperCase())) + '</span><div><b>' + esc(name) + '</b><span class="muted">' + esc(user.email || '') + '</span></div></div>' +
        '<button class="rg-level" id="rgPhone" type="button"><span>' + (ridePhone ? esc(ridePhone) : 'Teléfono para las rutas') + '</span><small>' + (ridePhone ? 'Teléfono para las rutas · tocar para cambiarlo' : 'Falta tu teléfono · para que puedan llamarte en una ruta') + '</small></button>' +
        '<div class="rg-row"><button class="btn small" id="rgFeedback" type="button"><svg><use href="#i-info"/></svg>Sugerencias y fallos</button><button class="btn small" id="rgOut" type="button"><svg><use href="#i-exit"/></svg>Cerrar sesión</button></div>';
      $('#rgPhone').addEventListener('click', openPhone);
      $('#rgOut').addEventListener('click', function (ev) { signOut(false, ev.currentTarget); });
    } else {
      box.innerHTML = '<div class="rg-acc"><span class="rg-ava">?</span><div><b>Sin cuenta</b><span class="muted">Entra para las rutas en grupo y para enviarnos sugerencias.</span></div></div>' +
        '<div class="rg-row"><button class="btn small primary" id="rgLogin" type="button">Entrar o crear cuenta</button><button class="btn small" id="rgFeedback" type="button">Sugerencias y fallos</button></div>';
      $('#rgLogin').addEventListener('click', function () { openAuth(false); });
    }
    $('#rgFeedback').addEventListener('click', openFeedback);
  }
  function deviceInfo() {
    var out = { app_version: A.version, platform: native ? C.getPlatform() : 'web' };
    if (!P.Device) return Promise.resolve(out);
    return P.Device.getInfo().then(function (d) { out.model = ((d.manufacturer || '') + ' ' + (d.model || '')).trim(); out.os = d.operatingSystem; out.os_version = d.osVersion; out.webview = d.webViewVersion; return out; }).catch(function () { return out; });
  }
  var STATUS_CLS = { 'recibido': '', 'en curso': 'warn', 'hecho': 'ok', 'descartado': 'bad' };
  function openFeedback() {
    if (!user) { A.toast('Entra en tu cuenta para enviar sugerencias: así podemos contestarte.', 'warn'); openAuth(false); return; }
    var kind = 'fallo';
    var s = sheet('<div class="head"><h1>Sugerencias y fallos</h1><button class="btn small icon" id="rgClose" type="button" title="Cerrar"><svg><use href="#i-close"/></svg></button></div>' +
      '<p class="muted">Cuéntame qué falla o qué mejorarías. Me llega al momento y te contesto aquí mismo. El modelo de móvil y la versión se añaden solos.</p>' +
      '<div class="seg rg-wide" id="rgKind"><button type="button" data-k="fallo" aria-pressed="true">Algo falla</button><button type="button" data-k="mejora" aria-pressed="false">Una mejora</button></div>' +
      '<div class="rg-form"><label>¿Qué ha pasado o qué propones?<textarea id="rgMsg" class="note" maxlength="4000" placeholder="Cuanto más concreto, mejor: qué pantalla, qué tocaste, qué esperabas…"></textarea></label>' +
      '<button class="btn big primary" id="rgSend" type="button">Enviar</button></div>' +
      '<span class="label">Lo que has enviado</span><div id="rgMine" class="rg-list"><p class="muted">Cargando…</p></div>');
    $('#rgClose').addEventListener('click', closeSheet);
    s.querySelectorAll('#rgKind button').forEach(function (b) { b.addEventListener('click', function () { kind = b.dataset.k; s.querySelectorAll('#rgKind button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); }); });
    function load() {
      sb.from('feedback').select('id,kind,message,status,admin_note,created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(30).then(function (r) {
        var box = $('#rgMine'); if (!box) return;
        if (r.error) { box.innerHTML = '<p class="muted">' + esc(msg(r.error)) + '</p>'; return; }
        box.innerHTML = r.data.length ? r.data.map(function (f) {
          return '<div class="rg-item"><div class="rg-tags"><span class="mstatus">' + (f.kind === 'fallo' ? 'Fallo' : 'Mejora') + '</span><span class="mstatus ' + (STATUS_CLS[f.status] === 'warn' ? 'soon' : STATUS_CLS[f.status] === 'bad' ? 'due' : STATUS_CLS[f.status]) + '">' + esc(f.status) + '</span><span class="muted">' + new Date(f.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) + '</span></div><p>' + esc(f.message) + '</p>' + (f.admin_note ? '<div class="rg-reply"><b>Ivan, de ReGroupRide</b><p>' + esc(f.admin_note) + '</p></div>' : '') + '</div>';
        }).join('') : '<p class="muted">Todavía no has enviado nada.</p>';
      });
    }
    $('#rgSend').addEventListener('click', function (ev) {
      var text = $('#rgMsg').value.trim(); if (text.length < 3) { A.toast('Escribe un poco más.', 'warn'); return; }
      busy(ev.currentTarget, function () {
        return deviceInfo().then(function (d) { return sb.from('feedback').insert({ kind: kind, message: text, device: d, app_version: d.app_version }); }).then(function (r) {
          if (r.error) throw r.error; $('#rgMsg').value = ''; A.toast('Enviado. ¡Gracias!', 'ok'); load();
        });
      });
    });
    load();
  }

  /* ================= pantalla de ruta: poco intrusiva ================= */
  // Menú lateral plegado en un solo botón: se abre al tocarlo y se cierra al tocar fuera o al elegir una opción.
  var ctrls = $('#mapCtrls'), more = $('#btnMore');
  function setMenu(open) { if (!ctrls) return; ctrls.classList.toggle('open', open); more.setAttribute('aria-expanded', String(open)); }
  if (more) {
    more.addEventListener('click', function (e) { e.stopPropagation(); setMenu(!ctrls.classList.contains('open')); });
    ctrls.addEventListener('click', function (e) { if (e.target.closest('button') && e.target.closest('button') !== more) setMenu(false); });
    document.addEventListener('pointerdown', function (e) { if (ctrls.classList.contains('open') && !ctrls.contains(e.target)) setMenu(false); }, true);
  }
  // Velocidad e inclinación: una tira pequeña que se enseña con el botón de al lado de «Parar».
  var hudBtn = $('#btnHudInfo');
  // Se enseña el panel de siempre (inclinación en vivo, máxima y última de cada lado, velocidad) en tamaño reducido.
  // Es el mismo que se actualiza en cada lectura del sensor, no una copia.
  function hudApply() { var on = !!A.settings.hudInfo; hudBtn.setAttribute('aria-pressed', String(on)); document.body.classList.toggle('rg-hud', on); }
  if (hudBtn) { hudBtn.addEventListener('click', function () { A.settings.hudInfo = !A.settings.hudInfo; A.saveSettings(); hudApply(); }); hudApply(); }

  /* ================= permisos ================= */
  // Android solo enseña su ventana de permiso una vez. Antes de cada ruta se comprueba; si falta, se explica y se pide.
  function locState() { return (native && P.Geolocation) ? P.Geolocation.checkPermissions().then(function (s) { return s.location || 'prompt'; }, function () { return 'unknown'; }) : Promise.resolve('granted'); }
  function notifState() { return (native && P.LocalNotifications) ? P.LocalNotifications.checkPermissions().then(function (s) { return s.display || 'prompt'; }, function () { return 'unknown'; }) : Promise.resolve('granted'); }
  function askNotifNow() { return (native && P.LocalNotifications) ? P.LocalNotifications.requestPermissions().then(function (s) { return s.display; }, function () { return 'unknown'; }) : Promise.resolve('granted'); }
  // Si la comprobación falla o tarda, no bloquea: se deja empezar y el propio GPS pedirá el permiso.
  function quick(p, ms, fallback) { return Promise.race([p, new Promise(function (r) { setTimeout(function () { r(fallback); }, ms); })]).catch(function () { return fallback; }); }
  // En la app de Android: al abrirla (y al volver a ella, y al iniciar una ruta) se comprueba todo lo que hace falta.
  //  1) Permisos que falten (ubicación, notificaciones, cámara): Android enseña sus ventanas, una tras otra.
  //  2) Ubicación del teléfono apagada: sale la ventana del sistema para encenderla con un toque.
  //  3) Lo que siga faltando (porque Android ya no deja preguntar) se explica, con un botón para abrir los ajustes.
  var SYS = native && P.RideAlerts && P.RideAlerts.system ? P.RideAlerts : null, permBusy = false, permAt = 0;
  var NEED = [['location', 'Ubicación', 'Para seguir la ruta, grabarla y que el grupo te vea.'], ['notifications', 'Notificaciones', 'Avisos del grupo, «fuera de ruta» y los botones de SOS en la pantalla de bloqueo.'], ['camera', 'Cámara', 'Solo para leer el QR de un grupo.']];
  function sysState() { return SYS ? quick(SYS.system(), 3000, null) : Promise.resolve(null); }
  function turnOn() {
    return SYS.enableLocation().then(function (r) {
      if (r && r.on) return true;
      return new Promise(function (resolve) {      // la ventana es del sistema: se mira cada segundo si ya la han encendido
        var n = 0, done = false, t0 = Date.now();
        var end = function (v) { if (done) return; done = true; clearInterval(t); window.removeEventListener('focus', back); resolve(v); };
        var look = function (last) { sysState().then(function (s) { if (s && s.locationOn) end(true); else if (last || ++n > 12) end(false); }); };
        var back = function () { if (Date.now() - t0 > 1200) setTimeout(function () { look(true); }, 900); };     // han cerrado la ventana
        var t = setInterval(function () { look(false); }, 1000);
        window.addEventListener('focus', back);
      });
    }, function () { return false; });
  }
  function checkAll(quiet) {
    if (!SYS) return oldEnsure();
    if (permBusy) return Promise.resolve(true);
    permBusy = true;
    return sysState().then(function (s) {
      if (!s) return true;
      var missing = NEED.filter(function (n) { return s[n[0]] !== 'granted'; });
      var asked = missing.length ? SYS.requestAll().then(function (r) { return r || s; }, function () { return sysState().then(function (x) { return x || s; }); }) : Promise.resolve(s);
      return asked.then(function (s2) {
        var on = !s2.locationOn ? turnOn() : Promise.resolve(true);
        return on.then(function (isOn) {
          s2.locationOn = isOn;
          var still = NEED.filter(function (n) { return s2[n[0]] !== 'granted'; });
          if ((still.length || !isOn || s2.fullScreen === false) && !quiet) showMissing(s2, still);
          renderPerms();
          return s2.location === 'granted' && isOn;
        });
      });
    }).catch(function () { return true; }).then(function (ok) { permBusy = false; permAt = Date.now(); return ok; });
  }
  var missT = 0;
  function showMissing(s, still) {
    if (!$('#rgSheet').hidden) { clearTimeout(missT); missT = setTimeout(function () { permAt = 0; checkAll(false); }, 5000); return; }      // hay otra ventana abierta (la de entrada, por ejemplo): se vuelve a mirar enseguida
    var noFull = s.fullScreen === false, onlyFull = noFull && !still.length && s.locationOn;
    var rows = still.map(function (n) { return '<div class="perm"><div><b>' + n[1] + '</b><span class="muted">' + n[2] + '</span></div><span class="mstatus due">Falta</span></div>'; }).join('') +
      (s.locationOn ? '' : '<div class="perm"><div><b>Ubicación del teléfono</b><span class="muted">Está apagada: sin ella la app no sabe dónde estás.</span></div><span class="mstatus due">Apagada</span></div>') +
      (noFull ? '<div class="perm"><div><b>Alarma sobre la pantalla de bloqueo</b><span class="muted">Para que un SOS o una avería del grupo se te abra en grande, como una llamada, aunque el móvil esté bloqueado.</span></div><span class="mstatus due">Falta</span></div>' : '');
    // Este permiso Android no lo da con una ventana: hay que activar un interruptor en una pantalla suya. El botón lleva directo a ella.
    sheet('<div class="head"><h1>' + (onlyFull ? 'Un permiso más' : 'Falta algo para rodar') + '</h1></div><p>' + (onlyFull ? 'Solo queda esto para que los avisos del grupo te lleguen como deben:' : 'ReGroupRide necesita esto para funcionar bien:') + '</p>' + rows +
      (s.locationOn ? '' : '<button class="btn big primary" id="pmOn" type="button">Encender la ubicación</button>') +
      (still.length ? '<p class="muted rg-small" style="text-align:left">Android ya no deja volver a preguntar por lo que has denegado. Se activa en los ajustes del teléfono: Permisos.</p><button class="btn big' + (s.locationOn ? ' primary' : '') + '" id="pmApp" type="button">Abrir los ajustes de la app</button>' : '') +
      (noFull ? '<button class="btn big' + (onlyFull ? ' primary' : '') + '" id="pmFullNow" type="button">Permitir la alarma a pantalla completa</button><p class="muted rg-small" style="text-align:left">Se abre una pantalla de Android: activa el interruptor de ReGroupRide y vuelve atrás.</p>' : '') +
      '<button class="btn rg-skip" id="pmLater" type="button">Ahora no</button>');
    $('#pmLater').addEventListener('click', closeSheet);
    if ($('#pmOn')) $('#pmOn').addEventListener('click', function () { closeSheet(); permAt = 0; checkAll(false); });
    if ($('#pmApp')) $('#pmApp').addEventListener('click', function () { closeSheet(); permAt = 0; SYS.openAppSettings(); });
    if ($('#pmFullNow')) $('#pmFullNow').addEventListener('click', function () { closeSheet(); permAt = 0; SYS.openFullScreenSettings(); });
  }
  function ensure() { return SYS ? checkAll(false).then(function (ok) { if (!ok) A.toast('Sin ubicación no se puede seguir ni grabar la ruta.', 'warn'); return ok; }) : oldEnsure(); }
  if (SYS) {
    setTimeout(function () { checkAll(false); }, 1800);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && Date.now() - permAt > 12000) setTimeout(function () { checkAll(false); }, 600); });
  }
  function oldEnsure() {
    return quick(locState(), 3000, 'unknown').then(function (st) {
      if (st === 'granted' || st === 'unknown') { notifState().then(function (n) { if (n !== 'granted' && n !== 'denied') askNotifNow(); }); return true; }
      return new Promise(function (resolve) { explain(st === 'denied', resolve); });
    });
  }
  function explain(denied, done) {
    sheet('<div class="head"><h1>Permiso de ubicación</h1></div>' +
      '<p>ReGroupRide necesita tu ubicación para seguir la ruta, avisarte si te sales y grabar el recorrido.</p>' +
      '<p class="muted">Con la ruta en marcha sigue funcionando con la pantalla apagada, y verás un aviso fijo mientras tanto. Al parar la ruta deja de usarse. Los sensores de inclinación no necesitan permiso en Android.</p>' +
      (denied ? '<div class="notice">El permiso está denegado y Android ya no deja volver a preguntar. Ábrelo en los ajustes del teléfono: Permisos → Ubicación → «Permitir solo con la app en uso».</div><button class="btn big primary" id="pmSet" type="button">Abrir ajustes del teléfono</button><button class="btn" id="pmRe" type="button">Ya lo he activado</button>'
              : '<button class="btn big primary" id="pmAsk" type="button">Dar permiso</button>') +
      '<button class="btn rg-skip" id="pmNo" type="button">Ahora no</button>');
    var finish = function (ok) { closeSheet(); if (!ok) A.toast('Sin permiso de ubicación no se puede seguir ni grabar la ruta.', 'warn'); renderPerms(); done(ok); };
    $('#pmNo').addEventListener('click', function () { finish(false); });
    if ($('#pmAsk')) $('#pmAsk').addEventListener('click', function () {
      P.Geolocation.requestPermissions({ permissions: ['location'] }).then(function (s) { return s.location; }, function () { return 'denied'; }).then(function (st) {
        if (st === 'granted') { askNotifNow().then(function () { finish(true); }); } else explain(true, done);
      });
    });
    if ($('#pmSet')) $('#pmSet').addEventListener('click', function () { if (window.Platform) Platform.openLocationSettings(); });
    if ($('#pmRe')) $('#pmRe').addEventListener('click', function () { locState().then(function (st) { if (st === 'granted') finish(true); else A.toast('Todavía no está activado.', 'warn'); }); });
  }
  var PERM_TXT = { granted: ['Concedido', 'ok'], denied: ['Denegado', 'due'], prompt: ['Sin pedir todavía', 'soon'], 'prompt-with-rationale': ['Sin conceder', 'soon'], unknown: ['No se puede comprobar', ''] };
  function renderPerms() {
    var box = $('#rgPerms'); if (!box) return;
    if (!native) { box.hidden = true; return; }
    var RA = P.RideAlerts, full = RA ? RA.status().then(function (x) { return x && x.fullScreen === false ? 'denied' : 'granted'; }, function () { return 'unknown'; }) : Promise.resolve(null);
    Promise.all([locState(), notifState(), full, sysState()]).then(function (r) {
      var sy = r[3]; if (sy) { r[0] = sy.location; r[1] = sy.notifications; }
      var row = function (name, why, st) { var t = PERM_TXT[st] || PERM_TXT.unknown; return '<div class="perm"><div><b>' + name + '</b><span class="muted">' + why + '</span></div><span class="mstatus ' + t[1] + '">' + t[0] + '</span></div>'; };
      box.hidden = false;
      box.innerHTML = '<span class="label">Permisos</span>' + row('Ubicación', 'Para seguir y grabar la ruta.', r[0]) +
        (sy ? '<div class="perm"><div><b>Ubicación del teléfono</b><span class="muted">Tiene que estar encendida.</span></div><span class="mstatus ' + (sy.locationOn ? 'ok">Encendida' : 'due">Apagada') + '</span></div>' : '') +
        row('Notificaciones', 'Aviso de «fuera de ruta» y aviso fijo durante la ruta.', r[1]) + (sy ? row('Cámara', 'Solo para leer el QR de un grupo.', sy.camera) : '') +
        (r[2] ? row('Alarma sobre la pantalla de bloqueo', 'Para que un SOS o una avería del grupo se abra en grande, como una llamada.', r[2]) : '') +
        (r[2] === 'denied' ? '<div class="rg-row"><button class="btn small" id="pmFull" type="button">Permitir la alarma a pantalla completa</button></div>' : '') +
        '<div class="perm"><div><b>Sensores de inclinación</b><span class="muted">Android no pide permiso para usarlos.</span></div><span class="mstatus ok">Disponible</span></div>' +
        ((r[0] !== 'granted' || r[1] !== 'granted' || (sy && (!sy.locationOn || sy.camera !== 'granted'))) ? '<div class="rg-row"><button class="btn small primary" id="pmFix" type="button">Revisar permisos</button></div>' : '');
      if ($('#pmFull')) $('#pmFull').addEventListener('click', function () { RA.openFullScreenSettings(); });
      if ($('#pmFix') && SYS) { $('#pmFix').addEventListener('click', function () { permAt = 0; checkAll(false); }); return; }
      if ($('#pmFix')) $('#pmFix').addEventListener('click', function () {
        if (r[0] !== 'granted') ensure().then(renderPerms);
        else askNotifNow().then(function (n) { if (n !== 'granted' && window.Platform) Platform.openLocationSettings(); renderPerms(); });
      });
    });
  }
  window.RGPerm = { ensure: ensure, render: renderPerms };
  var tabSet = document.querySelector('.tab[data-view="settings"]'); if (tabSet) tabSet.addEventListener('click', renderPerms);
  // El consejo de nivel sale al guardar una ruta y al entrar en Ajustes, nunca en mitad de otra cosa.
  if (tabSet) tabSet.addEventListener('click', function () { setTimeout(function () { levelNudge(false); }, 900); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && !$('#view-settings').hidden) renderPerms(); });

  // Indicaciones por voz
  var sw = $('#setNavVoice');
  if (sw) { sw.checked = A.settings.navVoice === true; sw.addEventListener('change', function () { A.settings.navVoice = sw.checked; A.saveSettings(); if (sw.checked && window.Platform) Platform.speak('Indicaciones activadas'); }); }

  // Sin sesión guardada: la pantalla de entrada se pone ya, sin esperar al servidor ni enseñar antes el mapa.
  var GATE = document.documentElement.classList;
  if (GATE.contains('rg-gate')) {
    if (MUST && sb) { var w0 = false, s0 = false; try { w0 = !!localStorage.getItem('rg.wall'); s0 = localStorage.getItem('rg.welcomed') === '1'; } catch (e) {} openAuth(true, (w0 || s0) ? 'login' : 'signup'); }
    GATE.remove('rg-gate');
  }
  renderAccount();
  refresh().then(function () {
    var seen = false; try { seen = localStorage.getItem('rg.welcomed') === '1'; localStorage.setItem('rg.welcomed', '1'); } catch (e) {}
    var wall = false; try { wall = !!localStorage.getItem('rg.wall'); } catch (e) {}
    if (user) { try { localStorage.removeItem('rg.wall'); } catch (e) {} if ($('#rgAuthBox')) closeSheet(); }
    else if (sb && (MUST || !seen || wall) && !$('#rgAuthBox')) openAuth(true, (wall || seen) ? 'login' : 'signup');      // primera vez, o se acaba de cerrar sesión
  });
  if (sb) sb.auth.onAuthStateChange(function (ev, session) { var had = !!user; user = (session && session.user) || null; if (had !== !!user) renderAccount(); if (MUST && had && !user && $('#rgSheet').hidden) openAuth(true, 'login'); });
  sync();
  window.RGCloud = { sb: sb, cfg: { url: SB_URL, key: SB_KEY }, openAuth: openAuth, openFeedback: openFeedback, user: function () { return user; }, profile: function () { return profile; }, openRider: openRider, saveName: saveName, signOut: signOut, profileName: function () { return (profile && profile.name) || (user && user.user_metadata && user.user_metadata.name) || ''; },
    onChange: function (f) { authListeners.push(f); f(user); }, sheet: sheet, closeSheet: closeSheet, sheetBack: sheetBack, ridePhone: function () { return ridePhone; },
    savePhone: function (ph) { return sb.from('profile_private').update({ ride_phone: ph }).eq('id', user.id).then(function (b) { if (b.error) throw b.error; ridePhone = ph; renderAccount(); }); }, busy: busy, msg: msg, esc: esc };
})();
