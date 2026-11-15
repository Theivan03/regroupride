/* ReGroupRide — grupo en vivo: unirse a una ruta con código o QR, ver a todos en el mapa y quién se queda atrás.
   Sin Realtime: cada 15 s una sola llamada (ride_sync) guarda mi posición y trae la del grupo.
   Mi posición solo se envía mientras tengo la ruta en marcha y se borra al pararla, al salir o al terminar el grupo.
   Cuando quien creó el grupo inicia la ruta, a los demás se les inicia sola (si tienen la app abierta).
   Avisos: SOS, avería y gasolina, desde la app o desde la pantalla de bloqueo; al organizador le salta en grande
   (SOS y avería, con alarma). */
(function () {
  'use strict';
  var A = window.RGApp, Cl = window.RGCloud, L = window.RGLib;
  if (!A || !Cl || !L) return;
  var sb = Cl.sb, esc = Cl.esc, $ = function (s, r) { return (r || document).querySelector(s); };
  var C = window.Capacitor, native = !!(C && C.isNativePlatform && C.isNativePlatform()), P = native ? (C.Plugins || {}) : {};
  var EVERY = 15000, FAST = 5000;   // posiciones cada 15 s; el organizador, quien espera la salida y quien espera respuesta a un aviso, cada 5 s
  var RA = native && P.RideAlerts ? P.RideAlerts : null, noop = function () {};
  var KIND = { sos: { t: 'SOS', say: 'pide ayuda', loud: true }, averia: { t: 'Avería', say: 'tiene una avería', loud: true }, gasolina: { t: 'Gasolina', say: 'necesita repostar', loud: false } };
  function speak(t) { if (window.Platform && Platform.canSpeak && Platform.canSpeak()) Platform.speak(t); }
  var G = { s: null, rows: [], rank: null, lastSync: 0, busy: false, wasRec: false, markers: {}, timer: null, sheetOpen: false, skew: 0, alarm: null, bannerKey: '', lastTry: 0 };
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
      G.rows = d.positions || [];
      var riding = {}; G.rows.forEach(function (x) { riding[x.user_id] = x.lat != null; });
      // quien ha avisado y ya no manda posición (ha parado) sigue en el mapa, donde avisó
      G.rows.forEach(function (x) { if (x.lat == null && x.alert && x.alert_lat != null) { x.lat = x.alert_lat; x.lon = x.alert_lon; } });
      G.rank = L.rankGroup(G.rows, me(), Date.now() + G.skew);
      draw(); badge(); if (G.sheetOpen) renderSheet();
      alerts(); checkStart(d.started || 0, d.now || Date.now(), riding);
    }, function () { G.busy = false; });
  }
  // Con la ruta en marcha: cada posición que llega del GPS, como mucho una llamada cada 15 s (también con la pantalla apagada).
  function onFix(fix, nav) {
    if (!G.s || !A.isRec() || A.isDemo()) return;
    retryAlert();
    if (Date.now() - G.lastSync < pace()) return;
    call({ p_lat: fix.lat, p_lon: fix.lon, p_speed: fix.v == null ? null : Math.round(fix.v * 10) / 10, p_along: nav && nav.started ? Math.round(nav.along) : null, p_off: !!(nav && nav.offRoute) });
  }
  function pace() { return (G.s && (G.s.owner || (G.s.myAlert && !G.s.mySeen))) ? FAST : EVERY; }
  // Quien creó el grupo ha iniciado la ruta: se me inicia a mí también. Dos señales: la hora de salida que apunta el servidor
  // (ride_start) y, por si el servidor aún no la tiene, ver que el organizador empieza a mandar posición. Cada salida se
  // atiende una sola vez: si luego paro yo a mano no se me vuelve a poner en marcha; si el organizador para y vuelve a salir, sí.
  function checkStart(at, now, live) {
    if (!G.s || G.s.owner) return;
    var own = G.rows.filter(function (x) { return x.owner; })[0], riding = !!(own && live[own.user_id] && now - own.at < 90000), go = false;
    if (at > (G.s.seen || 0)) { G.s.seen = at; if (now - at < 10 * 60000 || riding) { go = true; G.s.ownRiding = true; } }
    else if (riding && !G.s.ownRiding) { go = true; G.s.ownRiding = true; }
    else if (!riding && G.s.ownRiding && now - (G.s.seen || 0) > 120000) G.s.ownRiding = false;
    save();
    if (!go || A.isRec()) return;
    if (G.sheetOpen) close();
    A.showView('map'); A.toast((own && own.name ? own.name : 'El organizador') + ' ha iniciado la ruta.', 'ok'); speak('Empieza la ruta.');
    A.startRide();
  }
  // Sin ruta en marcha: solo leer, y solo con la app a la vista. Mientras se espera la salida, más a menudo.
  function tick() {
    if (!G.s || A.isRec() || document.visibilityState !== 'visible') return;
    retryAlert();
    var gap = (!G.s.owner && !G.s.ownRiding) ? FAST : pace();
    if (Date.now() - G.lastSync >= gap - 500) call();
  }
  function sync() {
    var rec = A.isRec();
    if (G.s && G.wasRec && !rec) { G.busy = false; call({ p_clear: true }); }   // he parado la ruta: se borra mi posición
    if (G.s && G.s.owner && !G.wasRec && rec && !A.isDemo() && sb) sb.rpc('ride_start', { p_id: G.s.id }).then(function (r) { if (r && r.error) console.warn('ride_start', r.error.message); }, noop);
    G.wasRec = rec;
    if (G.s && !G.timer) G.timer = setInterval(tick, 5000);
    if (!G.s && G.timer) { clearInterval(G.timer); G.timer = null; }
    var ab = $('#btnAlert'); if (ab) { ab.hidden = !G.s; ab.classList.toggle('on', !!(G.s && G.s.myAlert)); }
    if (!G.s && G.alarm) dismiss(false);
    badge(); banner();
  }

  /* ---------- avisos: SOS, avería, gasolina ---------- */
  // Botones en la pantalla de bloqueo (solo en la app de Android), mientras ruedo en grupo.
  function banner() {
    if (!RA) return;
    var on = !!(G.s && A.isRec() && !A.isDemo()), k = on ? 'on:' + (G.s.myAlert || '') + ':' + (G.s.mySeen ? 1 : 0) : '';
    if (k === G.bannerKey) return; G.bannerKey = k;
    if (on) RA.showBanner({ sent: G.s.myAlert || '', label: G.s.myAlert ? KIND[G.s.myAlert].t : '', seen: !!G.s.mySeen }).catch(noop); else RA.hideBanner().catch(noop);
  }
  // Enviar (o cancelar, con kind vacío) mi aviso. Si no hay cobertura se queda pendiente y se reintenta solo.
  function sendAlert(kind, again) {
    if (!G.s || !sb || !me()) return;
    kind = KIND[kind] ? kind : null;
    var fix = A.lastFix();
    G.s.myAlert = kind; G.s.mySeen = false; G.s.alertPending = true; G.lastTry = Date.now(); save(); sync();
    sb.rpc('ride_alert', { p_id: G.s.id, p_kind: kind, p_lat: fix ? fix.lat : null, p_lon: fix ? fix.lon : null }).then(function (r) {
      if (!G.s) return;
      if (r.error) { G.s.myAlert = null; G.s.alertPending = false; save(); sync(); A.toast(Cl.msg(r.error), 'bad'); speak('No se ha podido enviar el aviso.'); return; }
      G.s.alertPending = false; save();
      if (kind) { A.toast('Aviso enviado: ' + KIND[kind].t + '.', 'ok'); speak('Aviso de ' + KIND[kind].t.toLowerCase() + ' enviado.'); } else A.toast('Aviso cancelado.', 'ok');
      G.busy = false; call();
    }, function () { if (!again) { A.toast('Sin cobertura: el aviso se enviará en cuanto haya señal.', 'warn'); speak('Sin cobertura. El aviso se enviará en cuanto haya señal.'); } });
  }
  function retryAlert() { if (G.s && G.s.alertPending && Date.now() - G.lastTry > 8000) sendAlert(G.s.myAlert, true); }
  function done(key) { if (!G.s) return; G.s.done = G.s.done || {}; G.s.done[key] = 1; save(); }
  // Mira los avisos que vienen en la lectura del grupo.
  function alerts() {
    if (!G.s) return;
    var live = {}, mine = null, uid = me();
    G.rows.forEach(function (r) {
      if (r.user_id === uid) { mine = r; return; }
      if (!r.alert || !KIND[r.alert]) return;
      var key = r.user_id + ':' + r.alert_at; live[key] = 1;
      if (G.s.done && G.s.done[key]) return;
      if (G.s.owner || r.owner) { if (!G.alarm || G.alarm.key !== key) raise(r, key); }     // me toca a mí atenderlo
      else { done(key); A.toast(r.name + ': ' + KIND[r.alert].t.toLowerCase() + '. El organizador ya está avisado.', 'warn'); }
    });
    if (G.alarm && !live[G.alarm.key]) { var nm = G.alarm.name; dismiss(false); A.toast(nm + ' ha cancelado el aviso.', 'ok'); }
    if (G.s.done) Object.keys(G.s.done).forEach(function (k) { if (!live[k]) delete G.s.done[k]; });
    if (mine && mine.alert && mine.seen && G.s.myAlert && !G.s.mySeen) { G.s.mySeen = true; save(); banner(); A.toast('El organizador ha visto tu aviso.', 'ok'); speak('El organizador ha visto tu aviso.'); }
  }
  // Me llega un aviso que tengo que atender: pantalla grande y, si es SOS o avería, alarma.
  function raise(r, key) {
    var k = KIND[r.alert], fix = A.lastFix(), d = (fix && r.lat != null) ? L.dist(fix.lat, fix.lon, r.lat, r.lon) : null;
    G.alarm = { key: key, user: r.user_id, name: r.name, kind: r.alert, lat: r.lat, lon: r.lon };
    var where = d == null ? '' : (d < 150 ? 'Está a tu lado.' : 'Está a ' + km(d) + ' de ti.'), text = r.name + ' ' + k.say + '.' + (where ? ' ' + where : '');
    var el = $('#rgAlarm');
    if (el) {
      el.className = 'rg-alarm ' + r.alert; el.hidden = false;
      el.innerHTML = '<div class="rg-alarm-in"><span class="rg-alarm-kind">' + esc(k.t) + '</span><b>' + esc(r.name) + '</b><p>' + esc(cap(k.say) + '. ' + where) + '</p>' +
        (r.lat != null ? '<button class="btn big" id="alMap" type="button">Ver dónde está</button>' : '') + '<button class="btn big" id="alOk" type="button">Entendido</button></div>';
      $('#alOk').addEventListener('click', function () { dismiss(true); });
      if ($('#alMap')) $('#alMap').addEventListener('click', function () { var a = G.alarm; dismiss(true); if (!a) return; if (G.sheetOpen) close(); A.showView('map'); var m = A.map(); if (m) m.flyTo({ center: [a.lon, a.lat], zoom: 14 }); });
    }
    if (RA) RA.alarm({ title: k.t.toUpperCase() + ': ' + r.name, text: text, loud: k.loud }).catch(noop);
    else if (navigator.vibrate) { try { navigator.vibrate(k.loud ? [700, 300, 700, 300, 700] : 300); } catch (e) {} }
    speak(text);
  }
  function cap(t) { return t.charAt(0).toUpperCase() + t.slice(1); }
  // Cerrar el aviso que tengo en pantalla. seen = lo he atendido yo (se le dice a quien avisó).
  function dismiss(seen) {
    var a = G.alarm; G.alarm = null;
    var el = $('#rgAlarm'); if (el) { el.hidden = true; el.innerHTML = ''; }
    if (RA) RA.stopAlarm().catch(noop);
    if (!a || !seen) return;
    done(a.key);
    if (G.s && sb) sb.rpc('ride_alert_seen', { p_id: G.s.id, p_user: a.user }).then(noop, noop);
  }
  function openAlert() {
    if (!G.s) return;
    var cur = G.s.myAlert;
    Cl.sheet(head('Avisar al grupo') + (cur ? '<div class="notice">Aviso enviado: <b>' + esc(KIND[cur].t) + '</b>. ' + (G.s.alertPending ? 'Sin cobertura: se enviará en cuanto haya señal.' : (G.s.mySeen ? 'El organizador lo ha visto.' : 'El organizador aún no lo ha visto.')) + '</div><button class="btn" id="avCancel" type="button">Cancelar el aviso</button>' : '<p class="muted">Le llega al organizador con tu posición. SOS y avería le suenan como una alarma.</p>') +
      '<button class="btn big rg-av sos" data-av="sos" type="button">SOS · Necesito ayuda</button><button class="btn big rg-av averia" data-av="averia" type="button">Avería</button><button class="btn big rg-av gasolina" data-av="gasolina" type="button">Gasolina · Necesito repostar</button>' +
      '<a class="btn" href="tel:112">Llamar al 112</a>');
    $('#grX').addEventListener('click', function () { Cl.closeSheet(); });
    if ($('#avCancel')) $('#avCancel').addEventListener('click', function () { Cl.closeSheet(); sendAlert(null); });
    [].forEach.call(document.querySelectorAll('[data-av]'), function (b) { b.addEventListener('click', function () { Cl.closeSheet(); sendAlert(b.dataset.av); }); });
  }
  if (RA) RA.addListener('action', function (e) { var k = e && e.kind; if (KIND[k]) sendAlert(k); else if (k === 'cancel') sendAlert(null); else if (k === 'ack') dismiss(true); });
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
      var e2 = mk.getElement(), al = alertOf(r.user_id); e2.classList.toggle('alert', !!al); e2.classList.toggle('stale', r.stale); e2.classList.toggle('off', !r.stale && r.off); e2.classList.toggle('behind', !r.stale && !r.off && r.behind); e2.textContent = (r.name || '?').charAt(0).toUpperCase(); e2.title = r.name;
    });
    Object.keys(G.markers).forEach(function (id) { if (!seen[id]) { G.markers[id].remove(); delete G.markers[id]; } });
  }
  function alertOf(id) { var x = G.rows.filter(function (q) { return q.user_id === id; })[0]; return x && KIND[x.alert] ? x.alert : null; }
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
        var al = alertOf(x.user_id);
        var tag = al ? '<span class="mstatus due">' + esc(KIND[al].t) + '</span>' : x.stale ? '<span class="mstatus due">sin señal ' + Math.round(x.age / 60000) + ' min</span>' : (x.off ? '<span class="mstatus due">fuera de ruta</span>' : (x.behind ? '<span class="mstatus soon">se queda atrás</span>' : ''));
        var gap = x.me ? 'tú' : (x.gap == null ? '' : (Math.abs(x.gap) < 150 ? 'contigo' : km(x.gap) + (x.gap > 0 ? ' por delante' : ' por detrás')));
        return '<div class="club-person"><span class="rg-ava' + (al || x.stale || x.off ? ' bad' : (x.behind ? ' warn' : '')) + '">' + esc(x.name.charAt(0).toUpperCase()) + '</span><div><b>' + esc(x.name) + ' ' + tag + '</b><span class="muted">' + gap + '</span></div></div>';
      }).join('') + (waiting.length ? '<p class="muted">Sin iniciar la ruta: ' + waiting.map(function (x) { return esc(x.name); }).join(', ') + '.</p>' : '') + '</div>' +
      '<p class="muted rg-small" style="text-align:left">' + (G.s.owner ? 'Cuando pulses «Iniciar ruta», se les iniciará también a los demás que tengan la app abierta. ' : 'La ruta se te iniciará sola cuando la inicie quien creó el grupo: deja la app abierta en pantalla. ') + 'Tu posición solo se comparte con este grupo mientras tienes la ruta en marcha, y se borra al pararla.</p>' +
      '<button class="btn" id="grAlert" type="button">Avisar al grupo: SOS, avería o gasolina</button>' +
      (G.s.owner ? '<button class="btn danger" id="grEnd" type="button">Terminar el grupo para todos</button>' : '') + '<button class="btn" id="grLeave" type="button">Salir del grupo</button>');
    $('#grX').addEventListener('click', close);
    $('#grAlert').addEventListener('click', function () { G.sheetOpen = false; openAlert(); });
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
        if (rt && rt.coords && rt.coords.length > 1) { close(); return A.usePlan({ id: parseInt(d.id.replace(/-/g, '').slice(0, 12), 16), name: rt.name || d.name, wps: rt.wps || [], coords: rt.coords, dist: rt.dist || 0, dur: rt.dur || 0, routed: true, steps: rt.steps || [], created: Date.now(), groupId: d.id }).then(function () { A.toast('Estás en el grupo. La ruta se iniciará sola cuando salga el organizador.', 'ok'); call(); }); }
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
  var abtn = $('#btnAlert'); if (abtn) abtn.addEventListener('click', openAlert);
  var first = true;   // la primera llamada llega antes de saber si hay sesión guardada
  Cl.onChange(function (u) { if (first) { first = false; return; } if (!u && G.s) { G.s = null; G.rows = []; G.rank = null; save(); draw(); } sync(); if (u && G.s) call(); });
  document.addEventListener('visibilitychange', tick);
  window.RGGroup = { onFix: onFix, sync: sync, redraw: redraw, open: open, openAlert: openAlert, state: G };
  sync();
})();
