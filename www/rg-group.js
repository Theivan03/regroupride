/* ReGroupRide — grupo en vivo: unirse a una ruta con código o QR, ver a todos en el mapa y quién se queda atrás.
   Sin Realtime: cada 15 s una sola llamada (ride_sync) guarda mi posición y trae la del grupo.
   Mi posición solo se envía mientras tengo la ruta en marcha y se borra al pararla, al salir o al terminar el grupo. */
(function () {
  'use strict';
  var A = window.RGApp, Cl = window.RGCloud, L = window.RGLib;
  if (!A || !Cl || !L) return;
  var sb = Cl.sb, esc = Cl.esc, $ = function (s, r) { return (r || document).querySelector(s); };
  var C = window.Capacitor, native = !!(C && C.isNativePlatform && C.isNativePlatform()), P = native ? (C.Plugins || {}) : {};
  var EVERY = 15000;
  var G = { s: null, rows: [], rank: null, lastSync: 0, busy: false, wasRec: false, markers: {}, timer: null, sheetOpen: false, skew: 0 };
  try { G.s = JSON.parse(localStorage.getItem('rg.group') || 'null'); } catch (e) {}
  function save() { try { if (G.s) localStorage.setItem('rg.group', JSON.stringify(G.s)); else localStorage.removeItem('rg.group'); } catch (e) {} }
  function me() { var u = Cl.user(); return u ? u.id : null; }
  function fail(e) { A.toast(Cl.msg(e), 'bad'); }
  function km(m) { return (Math.abs(m) / 1000).toFixed(1).replace('.', ',') + ' km'; }

  /* ---------- sincronizar ---------- */
  function call(args) {
    if (!G.s || !sb || !me() || G.busy) return Promise.resolve();
    G.busy = true; G.lastSync = Date.now();
    return sb.rpc('ride_sync', Object.assign({ p_id: G.s.id }, args || {})).then(function (r) {
      G.busy = false;
      if (r.error) { if (/no estás en este grupo/i.test(r.error.message || '')) { leaveLocal('Ya no estás en el grupo.'); } return; }
      var d = r.data || {};
      if (d.ended) { leaveLocal('El grupo ha terminado.'); return; }
      G.skew = d.now ? d.now - Date.now() : 0;
      G.rows = d.positions || []; G.rank = L.rankGroup(G.rows, me(), Date.now() + G.skew);
      draw(); badge(); if (G.sheetOpen) renderSheet();
    }, function () { G.busy = false; });
  }
  // Con la ruta en marcha: cada posición que llega del GPS, como mucho una llamada cada 15 s (también con la pantalla apagada).
  function onFix(fix, nav) {
    if (!G.s || !A.isRec() || A.isDemo()) return;
    if (Date.now() - G.lastSync < EVERY) return;
    call({ p_lat: fix.lat, p_lon: fix.lon, p_speed: fix.v == null ? null : Math.round(fix.v * 10) / 10, p_along: nav && nav.started ? Math.round(nav.along) : null, p_off: !!(nav && nav.offRoute) });
  }
  // Sin ruta en marcha: solo leer, y solo con la app a la vista.
  function tick() { if (G.s && !A.isRec() && document.visibilityState === 'visible' && Date.now() - G.lastSync >= EVERY - 500) call(); }
  function sync() {
    var rec = A.isRec();
    if (G.s && G.wasRec && !rec) { G.busy = false; call({ p_clear: true }); }   // he parado la ruta: se borra mi posición
    G.wasRec = rec;
    if (G.s && !G.timer) G.timer = setInterval(tick, 5000);
    if (!G.s && G.timer) { clearInterval(G.timer); G.timer = null; }
    badge();
  }
  function leaveLocal(msg) { G.s = null; G.rows = []; G.rank = null; save(); draw(); sync(); if (msg) A.toast(msg, 'warn'); if (G.sheetOpen) renderSheet(); }

  /* ---------- mapa ---------- */
  function draw() {
    var m = A.map(); if (!m || typeof maplibregl === 'undefined') return;
    var seen = {}, list = G.s && G.rank ? G.rank.list : [];
    list.forEach(function (r) {
      if (r.me) return; seen[r.user_id] = 1;
      var mk = G.markers[r.user_id];
      if (!mk) { var el = document.createElement('div'); el.className = 'rider-marker'; el.addEventListener('click', function (e) { e.stopPropagation(); open(); }); mk = G.markers[r.user_id] = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([r.lon, r.lat]).addTo(m); }
      mk.setLngLat([r.lon, r.lat]);
      var e2 = mk.getElement(); e2.classList.toggle('stale', r.stale); e2.classList.toggle('off', !r.stale && r.off); e2.classList.toggle('behind', !r.stale && !r.off && r.behind); e2.textContent = (r.name || '?').charAt(0).toUpperCase(); e2.title = r.name;
    });
    Object.keys(G.markers).forEach(function (id) { if (!seen[id]) { G.markers[id].remove(); delete G.markers[id]; } });
  }
  function redraw() { Object.keys(G.markers).forEach(function (id) { G.markers[id].remove(); }); G.markers = {}; draw(); }
  function badge() {
    var b = $('#btnGroup'); if (!b) return;
    var n = G.s ? (G.rank ? G.rank.total + G.rank.waiting : 1) : 0, bad = G.s && G.rank ? G.rank.behind : 0;
    b.setAttribute('aria-pressed', String(!!G.s)); b.classList.toggle('alert', bad > 0);
    var t = $('#groupCount'); t.hidden = !G.s; t.textContent = bad > 0 ? bad + '!' : String(n);
  }

  /* ---------- hoja del grupo ---------- */
  function qrSvg(text) { try { var q = window.qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 6, margin: 3, scalable: true }); } catch (e) { return ''; } }
  function share(text) { if (P.Share) P.Share.share({ text: text }).catch(function () {}); else if (navigator.share) navigator.share({ text: text }).catch(function () {}); else if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { A.toast('Invitación copiada.', 'ok'); }); }
  function open() { G.sheetOpen = true; renderSheet(); if (G.s) call(); }
  function close() { G.sheetOpen = false; Cl.closeSheet(); }
  function head(t) { return '<div class="head"><h1>' + t + '</h1><button class="btn small icon" id="grX" type="button" title="Cerrar"><svg><use href="#i-close"/></svg></button></div>'; }
  function renderSheet() {
    if (!me()) { G.sheetOpen = false; A.toast('Entra en tu cuenta para rodar en grupo.', 'warn'); Cl.openAuth(false); return; }
    if (!G.s) { renderJoin(); return; }
    var r = G.rank, list = r ? r.list : [], waiting = G.rows.filter(function (x) { return x.lat == null; });
    Cl.sheet(head('Grupo') + '<p class="muted">' + esc(G.s.name) + '</p>' +
      '<div class="grp-code"><div class="grp-qr">' + qrSvg('regroupride:' + G.s.code) + '</div><div><span class="label">Código del grupo</span><b>' + esc(G.s.code) + '</b><button class="btn small primary" id="grShare" type="button">Compartir</button></div></div>' +
      '<span class="label">' + (list.length ? 'En ruta, de delante a atrás' : 'Nadie en marcha todavía') + '</span><div class="rg-list">' + list.map(function (x) {
        var tag = x.stale ? '<span class="mstatus due">sin señal ' + Math.round(x.age / 60000) + ' min</span>' : (x.off ? '<span class="mstatus due">fuera de ruta</span>' : (x.behind ? '<span class="mstatus soon">se queda atrás</span>' : ''));
        var gap = x.me ? 'tú' : (x.gap == null ? '' : (Math.abs(x.gap) < 150 ? 'contigo' : km(x.gap) + (x.gap > 0 ? ' por delante' : ' por detrás')));
        return '<div class="club-person"><span class="rg-ava' + (x.stale || x.off ? ' bad' : (x.behind ? ' warn' : '')) + '">' + esc(x.name.charAt(0).toUpperCase()) + '</span><div><b>' + esc(x.name) + ' ' + tag + '</b><span class="muted">' + gap + '</span></div></div>';
      }).join('') + (waiting.length ? '<p class="muted">Sin iniciar la ruta: ' + waiting.map(function (x) { return esc(x.name); }).join(', ') + '.</p>' : '') + '</div>' +
      '<p class="muted rg-small" style="text-align:left">Tu posición solo se comparte con este grupo mientras tienes la ruta en marcha, y se borra al pararla.</p>' +
      (G.s.owner ? '<button class="btn danger" id="grEnd" type="button">Terminar el grupo para todos</button>' : '') + '<button class="btn" id="grLeave" type="button">Salir del grupo</button>');
    $('#grX').addEventListener('click', close);
    $('#grShare').addEventListener('click', function () { share('Únete al grupo de la ruta «' + G.s.name + '» en ReGroupRide: en el mapa pulsa el botón de grupo y escribe el código ' + G.s.code + '.'); });
    $('#grLeave').addEventListener('click', function (ev) { arm(ev.currentTarget, '¿Seguro? Toca otra vez', function () { var id = G.s.id; leaveLocal(); close(); sb.rpc('ride_leave', { p_id: id }).then(function () { A.toast('Has salido del grupo.', 'ok'); }); }); });
    if ($('#grEnd')) $('#grEnd').addEventListener('click', function (ev) { arm(ev.currentTarget, '¿Seguro? Se borran las posiciones de todos', function () { var id = G.s.id; sb.rpc('ride_end', { p_id: id }).then(function (r) { if (r.error) { fail(r.error); return; } leaveLocal(); close(); A.toast('Grupo terminado.', 'ok'); }); }); });
  }
  function arm(btn, label, run) { if (btn.dataset.armed) { run(); return; } btn.dataset.armed = '1'; var old = btn.textContent; btn.textContent = label; setTimeout(function () { delete btn.dataset.armed; btn.textContent = old; }, 3500); }
  function renderJoin() {
    var p = A.activePlan();
    Cl.sheet(head('Rodar en grupo') + '<p class="muted">Todos los del grupo se ven en el mapa durante la ruta, y se sabe quién se ha quedado atrás o se ha salido.</p>' +
      '<div class="club-card"><b>Unirme a un grupo</b><p class="muted">Escribe el código que te pasen o escanea su QR. La ruta se carga sola.</p><div class="plan-link"><input type="text" id="grCode" maxlength="8" placeholder="Código" autocapitalize="characters" autocomplete="off"><button class="btn small primary" id="grJoin" type="button">Unirme</button></div>' +
      (P.CapacitorBarcodeScanner ? '<button class="btn" id="grScan" type="button" style="width:100%;margin-top:8px">Escanear QR</button>' : '') + '</div>' +
      '<div class="club-card"><b>Crear un grupo</b>' + (p ? '<p class="muted">Para la ruta «' + esc(p.name) + '». Te dará un código y un QR para pasar a los demás.</p><button class="btn primary" id="grCreate" type="button" style="width:100%">Crear grupo para esta ruta</button>' : '<p class="muted">Primero elige la ruta: créala o cárgala y déjala seleccionada en el mapa. Luego vuelve aquí.</p>') + '</div>');
    $('#grX').addEventListener('click', close);
    var join = function (code, btn) {
      code = String(code || '').replace(/^regroupride:/i, '').trim(); if (code.length < 4) { A.toast('Escribe el código.', 'warn'); return; }
      Cl.busy(btn, function () { return sb.rpc('ride_join', { p_code: code }).then(function (r) {
        if (r.error) throw new Error(/no válido/i.test(r.error.message) ? 'Ese código no existe o el grupo ya ha terminado.' : r.error.message);
        var d = r.data; G.s = { id: d.id, code: d.code, name: d.name, owner: !!d.owner }; save(); sync();
        var rt = d.route;
        if (rt && rt.coords && rt.coords.length > 1) { close(); return A.usePlan({ id: parseInt(d.id.replace(/-/g, '').slice(0, 12), 16), name: rt.name || d.name, wps: rt.wps || [], coords: rt.coords, dist: rt.dist || 0, dur: rt.dur || 0, routed: true, steps: rt.steps || [], created: Date.now(), groupId: d.id }).then(function () { A.toast('Estás en el grupo. Pulsa «Iniciar ruta» cuando salgáis.', 'ok'); call(); }); }
        A.toast('Estás en el grupo.', 'ok'); renderSheet(); call();
      }); });
    };
    $('#grJoin').addEventListener('click', function (ev) { join($('#grCode').value, ev.currentTarget); });
    if ($('#grScan')) $('#grScan').addEventListener('click', function (ev) {
      var btn = ev.currentTarget;
      P.CapacitorBarcodeScanner.scanBarcode({ hint: 0, scanInstructions: 'Apunta al QR del grupo', scanButton: false, scanText: ' ', cameraDirection: 1, scanOrientation: 3 }).then(function (r) { if (r && r.ScanResult) join(r.ScanResult, btn); }, function () { A.toast('No se ha podido leer el QR. Escribe el código.', 'warn'); });
    });
    if ($('#grCreate')) $('#grCreate').addEventListener('click', function (ev) {
      Cl.busy(ev.currentTarget, function () { return sb.rpc('ride_create', { p_name: p.name, p_route: { name: p.name, wps: p.wps, coords: p.coords, steps: p.steps || [], dist: p.dist, dur: p.dur } }).then(function (r) {
        if (r.error) throw r.error; var d = r.data; G.s = { id: d.id, code: d.code, name: d.name, owner: true }; save(); sync(); renderSheet(); call(); A.toast('Grupo creado. Pasa el código o el QR.', 'ok');
      }); });
    });
  }

  var btn = $('#btnGroup'); if (btn) btn.addEventListener('click', open);
  var first = true;   // la primera llamada llega antes de saber si hay sesión guardada
  Cl.onChange(function (u) { if (first) { first = false; return; } if (!u && G.s) { G.s = null; G.rows = []; G.rank = null; save(); draw(); } sync(); if (u && G.s) call(); });
  document.addEventListener('visibilitychange', tick);
  window.RGGroup = { onFix: onFix, sync: sync, redraw: redraw, open: open, state: G };
  sync();
})();
