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
  function say(t) { if (A.settings.navVoice !== false && window.Platform && Platform.canSpeak()) Platform.speak(t); }
  function buzz(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
  var EMPTY = { type: 'FeatureCollection', features: [] };

  /* ================= seguir la ruta ================= */
  var ARROW = { 'straight': 0, 'slight right': 40, 'right': 90, 'sharp right': 135, 'uturn': 180, 'sharp left': -135, 'left': -90, 'slight left': -40 };
  function icon(kind) {
    if (kind === 'arrive') return '<svg viewBox="0 0 32 32"><path d="M9 28V5m0 1h14l-3.5 5 3.5 5H9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    if (kind === 'roundabout') return '<svg viewBox="0 0 32 32"><circle cx="16" cy="15" r="6.5" fill="none" stroke="currentColor" stroke-width="3"/><path d="M16 29v-7.5M21 9l5-5m0 0h-5.5M26 4v5.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    if (kind === 'off') return '<svg viewBox="0 0 32 32"><path d="M16 5 3.5 26.5h25z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M16 13v6.5" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="16" cy="23" r="1.7" fill="currentColor"/></svg>';
    var a = ARROW[kind] == null ? 0 : ARROW[kind];
    return '<svg viewBox="0 0 32 32"><g transform="rotate(' + a + ' 16 16)"><path d="M16 27V6m0 0-7.5 7.5M16 6l7.5 7.5" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></g></svg>';
  }

  var nav = { active: false, planId: null, tr: null, rejoin: null, rejoinAt: 0, rejoinBusy: false, last: null, notified: false };
  function plan() { return A.activePlan(); }
  function sync() {
    var p = plan(), on = !!(p && A.isRec() && p.coords && p.coords.length > 1);
    var info = $('#followInfo'), ride = $('#btnRide');
    if (info) info.textContent = p ? (fmtKm((p.dist || 0) * 1000) + (p.dur ? ' · ' + fmtMin(p.dur) : '')) : '';
    if (ride) ride.textContent = p ? 'Iniciar ruta' : 'Grabar ruta';
    if (on && (!nav.active || nav.planId !== p.id)) {
      nav.active = true; nav.planId = p.id; nav.tr = L.Tracker(p.coords, p.steps || []); nav.rejoin = null; nav.rejoinAt = 0; nav.last = null; nav.notified = false;
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
    var t = L.rejoinTarget(fix, nav.tr.line, nav.tr.state.along);
    nav.rejoinAt = Date.now(); nav.rejoinBusy = true;
    var straight = function () { return { coords: [[fix.lon, fix.lat], [t.lon, t.lat]], steps: [], dist: t.off }; };
    var url = 'https://router.project-osrm.org/route/v1/driving/' + fix.lon.toFixed(5) + ',' + fix.lat.toFixed(5) + ';' + t.lon.toFixed(5) + ',' + t.lat.toFixed(5) + '?overview=full&geometries=geojson&steps=true';
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null; if (ctrl) setTimeout(function () { ctrl.abort(); }, 8000);
    var job = (navigator.onLine === false) ? Promise.resolve(straight()) : fetch(url, ctrl ? { signal: ctrl.signal } : {}).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.routes || !j.routes[0]) throw new Error('sin ruta');
      var st = L.stepsFromOsrm(j.routes[0]); if (st.length && st[st.length - 1].icon === 'arrive') st[st.length - 1].text = 'vuelves a la ruta';
      return { coords: j.routes[0].geometry.coordinates, steps: st, dist: j.routes[0].distance };
    }).catch(straight);
    job.then(function (x) {
      nav.rejoinBusy = false;
      if (!nav.active) return;
      var tr = L.Tracker(x.coords, x.steps, { offDist: 70 });
      nav.rejoin = { coords: x.coords, tr: tr, dist: x.dist, last: tr.update(fix, Date.now()) };
      drawRejoin(); renderBanner(nav.last);
      if (!announce && nav.last && !nav.last.started) say('Te llevo a la ruta. ' + L.cap(L.spokenDist(x.dist)) + '.');
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
        if (nx && nx.dist < 2500 && !rj.offRoute) { ico = nx.icon; dist = L.fmtDist(nx.dist); text = L.cap(nx.text); }
        else { ico = r.offRoute ? 'off' : 'straight'; dist = L.fmtDist(rj ? rj.remaining : r.off); text = r.offRoute ? 'para volver a la ruta' : 'hasta la ruta'; }
        sub = r.offRoute ? 'Te has salido de la ruta' : 'Yendo a la ruta';
      } else if (r.finished) { ico = 'arrive'; text = 'Has llegado'; sub = 'Fin de la ruta'; cls = 'ok'; }
      else {
        nx = r.next;
        if (nx) { ico = nx.icon; dist = L.fmtDist(nx.dist); text = L.cap(nx.text); if (nx.name && nx.icon !== 'arrive') sub = nx.name; }
        else { text = 'Sigue la ruta'; }
        sub = (sub ? sub + ' · ' : '') + 'quedan ' + fmtKm(r.remaining);
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
    var m = A.map(), p = plan(), key = p ? p.id + ':' + (p.wps || []).length : '';
    if (!m || typeof maplibregl === 'undefined') return;
    if (key === stopKey) return; stopKey = key;
    stopMk.forEach(function (x) { x.remove(); }); stopMk = [];
    if (!p) return;
    (p.wps || []).forEach(function (w, i) {
      var el = document.createElement('div'), last = i === p.wps.length - 1;
      el.className = 'stop-marker' + (i === 0 ? ' start' : (last ? ' end' : '')); el.textContent = String(i + 1);
      el.addEventListener('click', function (e) { e.stopPropagation(); A.toast((i + 1) + '. ' + ((w[2] || '').split(',')[0] || (i === 0 ? 'Salida' : (last ? 'Llegada' : 'Punto ' + (i + 1)))), 'ok'); });
      stopMk.push(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([w[1], w[0]]).addTo(m));
    });
  }
  /* ---- Google Maps como opción secundaria, por tramos de 9 paradas ---- */
  function openMaps(wps) {
    var legs = L.mapsLegs(wps || []);
    if (!legs.length) return;
    if (legs.length === 1) { Platform.openExternal(legs[0].url); return; }
    var s = sheet('<div class="head"><h1>Abrir en Google Maps</h1><button class="btn small icon" id="rgClose" type="button" title="Cerrar"><svg><use href="#i-close"/></svg></button></div>' +
      '<p class="muted">Google Maps solo admite unas 9 paradas por enlace, así que esta ruta de ' + wps.length + ' puntos va en ' + legs.length + ' tramos. Al acabar uno, vuelve aquí y abre el siguiente. Para llevarla entera, usa «Iniciar ruta» en la app.</p>' +
      legs.map(function (l, i) { return '<button class="btn big" type="button" data-leg="' + i + '">Tramo ' + (i + 1) + ': puntos ' + l.from + ' a ' + l.to + '</button>'; }).join(''));
    $('#rgClose').addEventListener('click', closeSheet);
    s.querySelectorAll('[data-leg]').forEach(function (b) { b.addEventListener('click', function () { Platform.openExternal(legs[+b.dataset.leg].url); }); });
  }
  /* ---- exportar a GPX ---- */
  function exportGpx(p) {
    if (!p || !p.coords || p.coords.length < 2) { A.toast('Esta ruta no tiene trazado.', 'warn'); return; }
    var file = (p.name || 'ruta').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50) || 'ruta';
    Platform.downloadCsv(file + '.gpx', L.planToGpx(p), 'Ruta ' + (p.name || '')).then(function () { if (!native) A.toast('GPX descargado.', 'ok'); }, function (e) { if (!/cancel/i.test(String(e && e.message))) A.toast('No se ha podido compartir el GPX.', 'bad'); });
  }
  window.RGNav = { onFix: onFix, sync: sync, redraw: function () { drawRejoin(); stopKey = ''; drawStops(); if (window.RGGroup) RGGroup.redraw(); }, state: nav, openMaps: openMaps, exportGpx: exportGpx };

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
  function sheet(html) { var s = $('#rgSheet'); s.innerHTML = '<div class="rg-sheet-in">' + html + '</div>'; s.hidden = false; s.scrollTop = 0; return s; }
  function closeSheet() { var s = $('#rgSheet'); s.hidden = true; s.innerHTML = ''; }
  function busy(btn, f) { var old = btn.innerHTML; btn.disabled = true; btn.textContent = 'Un momento…'; return Promise.resolve().then(f).catch(function (e) { A.toast(msg(e), 'bad'); }).then(function () { btn.disabled = false; btn.innerHTML = old; }); }
  var LOGO = '<div class="rg-logo"><span class="rg-mark"><svg viewBox="0 0 32 32"><path d="M7 25C7 15 25 19 25 8.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><circle cx="7" cy="25" r="3.5" fill="currentColor"/><circle cx="25" cy="8.5" r="3.5" fill="currentColor"/><circle cx="16" cy="16.9" r="3.3" fill="var(--color-accent)"/><circle cx="16" cy="16.9" r="2.2" fill="#fff"/></svg></span><b>ReGroup<i>Ride</i></b></div>';

  function openAuth(first) {
    var mode = first ? 'signup' : 'login';
    function draw() {
      var s = sheet(LOGO + '<p class="muted rg-lead">Rutas en grupo, sin perder a nadie.</p>' +
        '<div class="seg rg-wide" id="rgMode"><button type="button" data-m="login" aria-pressed="' + (mode === 'login') + '">Entrar</button><button type="button" data-m="signup" aria-pressed="' + (mode === 'signup') + '">Crear cuenta</button></div>' +
        '<form id="rgAuth" class="rg-form" autocomplete="on">' +
        (mode === 'signup' ? '<label>Tu nombre<input id="rgName" required maxlength="60" autocomplete="name" placeholder="Como te conoce la gente"></label>' : '') +
        '<label>Correo<input id="rgEmail" type="email" required autocomplete="email" inputmode="email"></label>' +
        '<label>Contraseña<input id="rgPass" type="password" required minlength="6" autocomplete="' + (mode === 'login' ? 'current-password' : 'new-password') + '"></label>' +
        '<button class="btn big primary" type="submit">' + (mode === 'login' ? 'Entrar' : 'Crear cuenta') + '</button></form>' +
        (mode === 'login' ? '<button class="link rg-center" id="rgForgot" type="button">He olvidado la contraseña</button>' : '<p class="muted rg-small">Necesitas tener al menos 16 años.</p>') +
        '<button class="btn rg-skip" id="rgSkip" type="button">' + (first ? 'Ahora no' : 'Cerrar') + '</button>' +
        (first ? '<p class="muted rg-small">Puedes usar el mapa, grabar rutas y la inclinación sin cuenta. La cuenta hará falta para las rutas en grupo.</p>' : ''));
      s.querySelectorAll('#rgMode button').forEach(function (b) { b.addEventListener('click', function () { mode = b.dataset.m; draw(); }); });
      $('#rgSkip').addEventListener('click', closeSheet);
      $('#rgAuth').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var email = $('#rgEmail').value.trim(), pass = $('#rgPass').value, name = mode === 'signup' ? $('#rgName').value.trim() : '';
        busy(ev.target.querySelector('button[type=submit]'), function () {
          if (!sb) throw new Error('No se ha podido cargar la conexión con el servidor.');
          var job = mode === 'login' ? sb.auth.signInWithPassword({ email: email, password: pass }) : sb.auth.signUp({ email: email, password: pass, options: { data: { name: name } } });
          return job.then(function (r) {
            if (r.error) throw r.error;
            if (!r.data.session) { A.toast('Cuenta creada. Confirma el correo que te hemos enviado y luego entra.', 'ok'); mode = 'login'; draw(); return; }
            return refresh().then(function () { closeSheet(); A.toast(mode === 'login' ? 'Sesión iniciada.' : '¡Bienvenido, ' + (name || 'motero') + '!', 'ok'); });
          });
        });
      });
      var f = $('#rgForgot'); if (f) f.addEventListener('click', function () {
        var email = $('#rgEmail').value.trim(); if (!email) { A.toast('Escribe tu correo y vuelve a pulsar.', 'warn'); return; }
        sb.auth.resetPasswordForEmail(email).then(function (r) { A.toast(r.error ? msg(r.error) : 'Te hemos enviado un correo para cambiarla.', r.error ? 'bad' : 'ok'); });
      });
    }
    draw();
  }
  function refresh() {
    if (!sb) { renderAccount(); return Promise.resolve(); }
    return sb.auth.getSession().then(function (r) {
      user = (r.data && r.data.session && r.data.session.user) || null; profile = null;
      if (!user) return;
      return sb.from('profiles').select('name').eq('id', user.id).maybeSingle().then(function (p) { profile = p.data || null; });
    }).catch(function () {}).then(renderAccount);
  }
  var authListeners = [];
  function renderAccount() {
    authListeners.forEach(function (f) { try { f(user); } catch (e) {} });
    var box = $('#rgAccount'); if (!box) return;
    if (user) {
      var name = (profile && profile.name) || (user.user_metadata && user.user_metadata.name) || 'Tu cuenta';
      box.innerHTML = '<div class="rg-acc"><span class="rg-ava">' + esc(name.charAt(0).toUpperCase()) + '</span><div><b>' + esc(name) + '</b><span class="muted">' + esc(user.email || '') + '</span></div></div>' +
        '<div class="rg-row"><button class="btn small" id="rgFeedback" type="button">Sugerencias y fallos</button><button class="btn small" id="rgOut" type="button">Cerrar sesión</button></div>';
      $('#rgOut').addEventListener('click', function () { sb.auth.signOut().then(function () { user = null; profile = null; renderAccount(); A.toast('Sesión cerrada.', 'ok'); }); });
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
      '<p class="muted">Cuéntanos qué falla o qué mejorarías. El modelo de móvil y la versión se añaden solos.</p>' +
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
          return '<div class="rg-item"><div class="rg-tags"><span class="mstatus">' + (f.kind === 'fallo' ? 'Fallo' : 'Mejora') + '</span><span class="mstatus ' + (STATUS_CLS[f.status] === 'warn' ? 'soon' : STATUS_CLS[f.status] === 'bad' ? 'due' : STATUS_CLS[f.status]) + '">' + esc(f.status) + '</span><span class="muted">' + new Date(f.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) + '</span></div><p>' + esc(f.message) + '</p>' + (f.admin_note ? '<p class="muted"><b>Respuesta:</b> ' + esc(f.admin_note) + '</p>' : '') + '</div>';
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
  var hudBtn = $('#btnHudInfo'), hudMini = $('#hudMini'), hudTimer = null;
  function hudFill() {
    var sp = $('#hudSpeed'), ln = $('#gaugeMini .num'), km = $('#hudMeta b');
    $('#hmSpeed').textContent = sp ? sp.textContent : '—'; $('#hmLean').textContent = ln ? ln.textContent : '0°'; $('#hmKm').textContent = km ? km.textContent : '';
  }
  function hudApply() {
    var on = !!A.settings.hudInfo; if (!hudBtn) return;
    hudBtn.setAttribute('aria-pressed', String(on)); hudMini.hidden = !on;
    if (on && !hudTimer) { hudFill(); hudTimer = setInterval(function () { if (!$('#hudCard').hidden) hudFill(); }, 400); }
    if (!on && hudTimer) { clearInterval(hudTimer); hudTimer = null; }
  }
  if (hudBtn) {
    hudBtn.addEventListener('click', function () { A.settings.hudInfo = !A.settings.hudInfo; A.saveSettings(); hudApply(); });
    hudMini.addEventListener('click', function () { A.openLeanFull(); });
    hudApply();
  }

  /* ================= permisos ================= */
  // Android solo enseña su ventana de permiso una vez. Antes de cada ruta se comprueba; si falta, se explica y se pide.
  function locState() { return (native && P.Geolocation) ? P.Geolocation.checkPermissions().then(function (s) { return s.location || 'prompt'; }, function () { return 'unknown'; }) : Promise.resolve('granted'); }
  function notifState() { return (native && P.LocalNotifications) ? P.LocalNotifications.checkPermissions().then(function (s) { return s.display || 'prompt'; }, function () { return 'unknown'; }) : Promise.resolve('granted'); }
  function askNotifNow() { return (native && P.LocalNotifications) ? P.LocalNotifications.requestPermissions().then(function (s) { return s.display; }, function () { return 'unknown'; }) : Promise.resolve('granted'); }
  // Si la comprobación falla o tarda, no bloquea: se deja empezar y el propio GPS pedirá el permiso.
  function quick(p, ms, fallback) { return Promise.race([p, new Promise(function (r) { setTimeout(function () { r(fallback); }, ms); })]).catch(function () { return fallback; }); }
  function ensure() {
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
    Promise.all([locState(), notifState()]).then(function (r) {
      var row = function (name, why, st) { var t = PERM_TXT[st] || PERM_TXT.unknown; return '<div class="perm"><div><b>' + name + '</b><span class="muted">' + why + '</span></div><span class="mstatus ' + t[1] + '">' + t[0] + '</span></div>'; };
      box.hidden = false;
      box.innerHTML = '<span class="label">Permisos</span>' + row('Ubicación', 'Para seguir y grabar la ruta.', r[0]) + row('Notificaciones', 'Aviso de «fuera de ruta» y aviso fijo durante la ruta.', r[1]) +
        '<div class="perm"><div><b>Sensores de inclinación</b><span class="muted">Android no pide permiso para usarlos.</span></div><span class="mstatus ok">Disponible</span></div>' +
        ((r[0] !== 'granted' || r[1] !== 'granted') ? '<div class="rg-row"><button class="btn small primary" id="pmFix" type="button">Revisar permisos</button></div>' : '');
      if ($('#pmFix')) $('#pmFix').addEventListener('click', function () {
        if (r[0] !== 'granted') ensure().then(renderPerms);
        else askNotifNow().then(function (n) { if (n !== 'granted' && window.Platform) Platform.openLocationSettings(); renderPerms(); });
      });
    });
  }
  window.RGPerm = { ensure: ensure, render: renderPerms };
  var tabSet = document.querySelector('.tab[data-view="settings"]'); if (tabSet) tabSet.addEventListener('click', renderPerms);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && !$('#view-settings').hidden) renderPerms(); });

  // Indicaciones por voz
  var sw = $('#setNavVoice');
  if (sw) { sw.checked = A.settings.navVoice !== false; sw.addEventListener('change', function () { A.settings.navVoice = sw.checked; A.saveSettings(); if (sw.checked && window.Platform) Platform.speak('Indicaciones activadas'); }); }

  renderAccount();
  refresh().then(function () {
    var seen = false; try { seen = localStorage.getItem('rg.welcomed') === '1'; localStorage.setItem('rg.welcomed', '1'); } catch (e) {}
    if (!user && !seen && sb) openAuth(true);
  });
  if (sb) sb.auth.onAuthStateChange(function (ev, session) { var had = !!user; user = (session && session.user) || null; if (had !== !!user) renderAccount(); });
  sync();
  window.RGCloud = { sb: sb, openAuth: openAuth, openFeedback: openFeedback, user: function () { return user; }, profileName: function () { return (profile && profile.name) || (user && user.user_metadata && user.user_metadata.name) || ''; },
    onChange: function (f) { authListeners.push(f); f(user); }, sheet: sheet, closeSheet: closeSheet, busy: busy, msg: msg, esc: esc };
})();
