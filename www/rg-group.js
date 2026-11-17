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
  function speak(t) { if (A.settings.navVoice === true && window.Platform && Platform.canSpeak && Platform.canSpeak()) Platform.speak(t); }   // la voz viene apagada: se enciende en Ajustes
  var G = { s: null, rows: [], rank: null, lastSync: 0, busy: false, wasRec: false, markers: {}, timer: null, sheetOpen: false, skew: 0, alarm: null, bannerKey: '', lastTry: 0, admin: false, groups: null, groupsAt: 0, lastPace: 0, autoStart: 0, pop: null, callsAt: 0, callsOff: false };
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
      G.admin = d.admin != null ? !!d.admin : !!G.s.owner; G.groups = d.groups || null; G.groupsAt = d.groups_at || 0;
      var riding = {}; G.rows.forEach(function (x) { riding[x.user_id] = x.lat != null; });
      // quien ha avisado y ya no manda posición (ha parado) sigue en el mapa, donde avisó
      G.rows.forEach(function (x) { if (x.lat == null && x.alert && x.alert_lat != null) { x.lat = x.alert_lat; x.lon = x.alert_lon; } });
      G.rank = L.rankGroup(G.rows, me(), Date.now() + G.skew);
      draw(); badge(); if (G.sheetOpen) renderSheet();
      alerts(); checkStart(d.started || 0, d.now || Date.now(), riding); groupsCheck();
    }, function () { G.busy = false; });
  }
  // Con la ruta en marcha: cada posición que llega del GPS, como mucho una llamada cada 15 s (también con la pantalla apagada).
  function onFix(fix, nav) {
    if (!G.s || !A.isRec() || A.isDemo()) return;
    retryAlert();
    sendPace();
    if (Date.now() - G.lastSync < pace()) return;
    call({ p_lat: fix.lat, p_lon: fix.lon, p_speed: fix.v == null ? null : Math.round(fix.v * 10) / 10, p_along: nav && nav.started ? Math.round(nav.along) : null, p_off: !!(nav && nav.offRoute) });
  }
  function amAdmin() { return !!(G.s && (G.admin || G.s.owner)); }
  function row(id) { return G.rows.filter(function (q) { return q.user_id === id; })[0] || null; }
  function nameOf(id) { var x = row(id); return x ? x.name : 'Un administrador'; }
  function pace() { return (G.s && (amAdmin() || (G.s.myAlert && !G.s.mySeen))) ? FAST : EVERY; }
  // Medición durante la ruta: cada dos minutos se apunta mi velocidad media en movimiento y mi inclinación media en curva
  // de lo que llevo de ruta. Sirve, junto con el nivel y el historial, para repartir los grupos.
  function sendPace() {
    if (!G.s || !sb || Date.now() - G.lastPace < 120000 || !A.recNow) return;
    var n = A.recNow(); if (!n || n.movingS < 120 || n.km < 1) return;
    G.lastPace = Date.now();
    var pk = n.peaks.filter(function (x) { return x >= 5 && x <= 70; }), lean = pk.length ? pk.reduce(function (a, b) { return a + b; }, 0) / pk.length : 0;
    sb.rpc('ride_pace', { p_id: G.s.id, p_speed: Math.round(n.km / (n.movingS / 3600) * 10) / 10, p_lean: Math.round(lean * 10) / 10, p_min: Math.round(n.movingS / 6) / 10 }).then(noop, noop);
  }
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
    G.autoStart = Date.now(); A.startRide();
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
    // Un administrador inicia a mano: se les inicia a los demás. (Si a mí me la ha iniciado otro, no la reenvío.)
    if (G.s && !G.wasRec && rec && !A.isDemo() && sb) {
      var auto = Date.now() - G.autoStart < 30000; G.autoStart = 0;
      if (amAdmin() && !auto) sb.rpc('ride_start', { p_id: G.s.id }).then(function (r) { if (r && r.error) console.warn('ride_start', r.error.message); }, noop);
    }
    G.wasRec = rec;
    if (G.s && !G.timer) G.timer = setInterval(tick, 5000);
    if (!G.s && G.timer) { clearInterval(G.timer); G.timer = null; }
    var ab = $('#btnAlert'); if (ab) { ab.hidden = !G.s; ab.classList.toggle('on', !!(G.s && G.s.myAlert)); var abt = ab.querySelector('span'); if (abt) abt.textContent = (G.s && G.s.myAlert) ? 'Aviso enviado' : 'Avisar'; }
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
  //  · Si me toca a mí (soy el administrador más cercano): pantalla grande y, en SOS y avería, alarma.
  //  · Si soy otro administrador: un aviso sencillo con quién va y un botón para llamarle. Si pasa un minuto sin que nadie
  //    lo atienda, me salta la alarma a mí también.
  //  · Si no soy administrador: un mensaje.
  function alerts() {
    if (!G.s) return;
    var live = {}, mine = null, uid = me(), now = Date.now() + G.skew, modern = G.rows.some(function (r) { return 'alert_to' in r; });
    G.s.done = G.s.done || {};
    G.rows.forEach(function (r) {
      if (r.user_id === uid) { mine = r; return; }
      if (!r.alert || !KIND[r.alert]) return;
      var key = r.user_id + ':' + r.alert_at, st = G.s.done[key] || 0; live[key] = 1;
      var toMe = modern ? (r.alert_to ? r.alert_to === uid : (amAdmin() || !!r.admin)) : !!(G.s.owner || r.owner);
      var late = !r.seen && now - r.alert_at > 60000;
      if (r.seen && r.seen_by && r.seen_by !== uid) {      // ya lo ha atendido otro
        if (G.alarm && G.alarm.key === key) { dismiss(false); A.toast(nameOf(r.seen_by) + ' se encarga del aviso de ' + r.name + '.', 'ok'); }
        else if (!st && amAdmin()) A.toast(r.name + ': ' + KIND[r.alert].t.toLowerCase() + '. Se encarga ' + nameOf(r.seen_by) + '.', 'warn');
        if (st < 2) { G.s.done[key] = 2; save(); }
        return;
      }
      if (st === 2) return;
      if (toMe || (amAdmin() && late)) { if (!G.alarm || G.alarm.key !== key || G.alarm.mode !== 'alarm') raise(r, key, 'alarm', !toMe); }
      else if (amAdmin()) { if (!st && (!G.alarm || G.alarm.key !== key)) raise(r, key, 'notice', false); }
      else if (!st) { G.s.done[key] = 2; save(); A.toast(r.name + ': ' + KIND[r.alert].t.toLowerCase() + '. Los administradores ya están avisados.', 'warn'); }
    });
    if (G.alarm && !live[G.alarm.key]) { var nm = G.alarm.name; dismiss(false); A.toast(nm + ' ha cancelado el aviso.', 'ok'); }
    Object.keys(G.s.done).forEach(function (k) { if (!live[k]) delete G.s.done[k]; });
    if (mine && mine.alert && mine.seen && G.s.myAlert && !G.s.mySeen) { G.s.mySeen = true; save(); banner(); var who = mine.seen_by ? nameOf(mine.seen_by) : 'El organizador'; A.toast(who + ' ha visto tu aviso.', 'ok'); speak(who + ' ha visto tu aviso.'); }
  }
  function tel(n) { return String(n || '').replace(/[^0-9+]/g, ''); }
  // Me llega un aviso. mode 'alarm': me toca atenderlo (pantalla grande; SOS y avería, con alarma).
  // mode 'notice': soy administrador pero le toca a otro que está más cerca: aviso sencillo, con botón para llamarle.
  function raise(r, key, mode, escalated) {
    var k = KIND[r.alert], fix = A.lastFix(), uid = me(), d = (fix && r.lat != null) ? L.dist(fix.lat, fix.lon, r.lat, r.lon) : null;
    var where = d == null ? '' : (d < 150 ? 'Está a tu lado.' : 'Está a ' + km(d) + ' de ti.');
    var to = r.alert_to && r.alert_to !== uid ? row(r.alert_to) : null, lead;
    G.alarm = { key: key, user: r.user_id, name: r.name, kind: r.alert, lat: r.lat, lon: r.lon, mode: mode };
    if (mode === 'alarm') lead = cap(k.say) + '. ' + where + (escalated ? ' Nadie lo ha atendido todavía.' : (r.alert_to === uid ? ' Eres el administrador más cercano.' : ''));
    else {
      var dn = to && to.lat != null && r.lat != null ? L.dist(to.lat, to.lon, r.lat, r.lon) : null;
      lead = cap(k.say) + '. Le ha saltado a ' + (to ? to.name : 'otro administrador') + ', que es quien está más cerca' + (dn != null ? ' (a ' + km(dn) + ')' : '') + '.';
    }
    var phone = mode === 'notice' && to && to.phone ? tel(to.phone) : '', el = $('#rgAlarm');
    if (el) {
      el.className = 'rg-alarm ' + r.alert + (mode === 'notice' ? ' quiet' : ''); el.hidden = false;
      var icn = '<i class="rg-alarm-ic"><svg><use href="#i-' + (r.alert === 'averia' ? 'wrench' : r.alert === 'gasolina' ? 'fuel' : 'warn') + '"/></svg></i>';
      var mapBtn = r.lat != null ? '<button class="btn big" id="alMap" type="button">' + (mode === 'alarm' ? '' : '<svg><use href="#i-eye"/></svg>') + 'Ver dónde está</button>' : '';
      if (mode === 'alarm') el.innerHTML = '<div class="rg-alarm-in">' + icn + '<span class="rg-alarm-kind">' + esc(k.t) + '</span><b>' + esc(r.name) + '</b><p>' + esc(lead.trim()) + '</p>' +
        '<div class="rg-alarm-acts">' + mapBtn + '<button class="btn big" id="alOk" type="button"><svg><use href="#i-check"/></svg>Entendido, me encargo</button></div></div>';
      else el.innerHTML = '<div class="rg-alarm-in">' + icn + '<b>' + esc(k.t) + ' · ' + esc(r.name) + '</b><p>' + esc(lead.trim()) + '</p>' +
        (phone ? '<a class="btn big rg-call" href="tel:' + phone + '"><svg><use href="#i-phone"/></svg>Llamar a ' + esc(to.name) + ' · ' + esc(to.phone) + '</a>' : (to ? '<p class="rg-alarm-small">' + esc(to.name) + ' no ha puesto su teléfono en la app.</p>' : '')) +
        mapBtn + '<button class="btn big" id="alOk" type="button">Entendido</button></div>';
      var how = mode === 'alarm' ? 'seen' : 'ok';
      $('#alOk').addEventListener('click', function () { dismiss(how); });
      if ($('#alMap')) $('#alMap').addEventListener('click', function () { var a = G.alarm; dismiss(how); if (!a) return; if (G.sheetOpen) close(); A.showView('map'); var m = A.map(); if (m) m.flyTo({ center: [a.lon, a.lat], zoom: 14 }); });
    }
    var loud = mode === 'alarm' && k.loud, text = r.name + ' ' + k.say + '. ' + (mode === 'alarm' ? where : 'Se encarga ' + (to ? to.name : 'otro administrador') + '.');
    if (RA) RA.alarm({ title: k.t.toUpperCase() + ': ' + r.name, text: text.trim(), loud: loud, phone: phone, phoneLabel: to ? 'Llamar a ' + to.name : 'Llamar' }).catch(noop);
    else if (navigator.vibrate) { try { navigator.vibrate(loud ? [700, 300, 700, 300, 700] : 300); } catch (e) {} }
    speak(text);
  }
  function cap(t) { return t.charAt(0).toUpperCase() + t.slice(1); }
  // Cerrar el aviso que tengo en pantalla y parar la alarma. how: 'seen' = me encargo yo (se le dice a quien avisó y a los
  // demás administradores); 'ok' = enterado, pero le toca a otro; false = se cierra solo (cancelado o atendido por otro).
  function dismiss(how) {
    var a = G.alarm; G.alarm = null;
    var el = $('#rgAlarm'); if (el) { el.hidden = true; el.innerHTML = ''; }
    if (RA) RA.stopAlarm().catch(noop);
    try { if (navigator.vibrate) navigator.vibrate(0); } catch (e) {}
    if (!a || !how || !G.s) return;
    G.s.done = G.s.done || {}; G.s.done[a.key] = how === 'seen' ? 2 : 1; save();
    if (how === 'seen' && sb) sb.rpc('ride_alert_seen', { p_id: G.s.id, p_user: a.user }).then(noop, noop);
  }
  function openAlert() {
    if (!G.s) return;
    var cur = G.s.myAlert, mine = row(me()), to = mine && mine.alert_to ? row(mine.alert_to) : null, by = mine && mine.seen_by ? row(mine.seen_by) : null, who = by || to;
    var state = G.s.alertPending ? 'Sin cobertura: se enviará en cuanto haya señal.' : (G.s.mySeen ? (by ? esc(by.name) : 'Un administrador') + ' lo ha visto y se encarga.' : 'Le ha saltado a ' + (to ? esc(to.name) + ', el administrador más cercano' : 'los administradores') + '. Aún no lo ha visto.');
    var btns = function (small) {
      return '<button class="btn ' + (small ? 'small' : 'big') + ' rg-av sos" data-av="sos" type="button"><svg><use href="#i-warn"/></svg>SOS · Necesito ayuda</button><button class="btn ' + (small ? 'small' : 'big') + ' rg-av averia" data-av="averia" type="button"><svg><use href="#i-wrench"/></svg>Avería</button>' +
        '<button class="btn ' + (small ? 'small' : 'big') + ' rg-av gasolina" data-av="gasolina" type="button"><svg><use href="#i-fuel"/></svg>' + (small ? 'Gasolina' : 'Gasolina · Necesito repostar') + '</button><a class="btn ' + (small ? 'small' : 'big') + ' rg-av" href="tel:112"><svg><use href="#i-phone"/></svg>Llamar al 112</a>';
    };
    Cl.sheet(head(cur ? 'Aviso enviado' : 'Avisar al grupo') + (cur ? '<div class="notice rg-nota-av">Aviso enviado: <b>' + esc(KIND[cur].t) + '</b>. ' + state + '</div>' +
        (who && who.phone ? '<a class="btn big rg-call" href="tel:' + tel(who.phone) + '"><svg><use href="#i-phone"/></svg>Llamar a ' + esc(who.name) + ' · ' + esc(who.phone) + '</a>' : '') + '<button class="btn rg-skip" id="avCancel" type="button">Cancelar el aviso</button>' +
        '<span class="label">Enviar otro aviso</span><div class="rg-av-grid">' + btns(true) + '</div>'
      : '<p class="muted">Le salta al administrador que esté más cerca de ti, con tu posición; el resto de administradores se enteran. SOS y avería suenan como una alarma.</p><div class="rg-av-col">' + btns(false) + '</div>'));
    $('#grX').addEventListener('click', function () { Cl.closeSheet(); });
    if ($('#avCancel')) $('#avCancel').addEventListener('click', function () { Cl.closeSheet(); sendAlert(null); });
    [].forEach.call(document.querySelectorAll('[data-av]'), function (b) { b.addEventListener('click', function () { Cl.closeSheet(); sendAlert(b.dataset.av); }); });
  }

  /* ---------- ventanas que hay que ver sí o sí: reparto por grupos y «¿vienes a la ruta?» ---------- */
  function pop(cls, html, wire) {
    var el = $('#rgPop'); if (!el) return;
    el.className = 'rg-alarm rg-pop ' + cls; el.innerHTML = '<div class="rg-alarm-in">' + html + '</div>'; el.hidden = false; G.pop = cls; if (wire) wire(el);
  }
  function unpop() { var el = $('#rgPop'); if (el) { el.hidden = true; el.innerHTML = ''; } G.pop = null; }
  // Reparto por grupos que ha enviado un administrador: a cada uno le sale el suyo, una vez.
  function groupsCheck() {
    if (!G.s || !G.groups || !G.groupsAt || G.groupsAt <= (G.s.groupsSeen || 0) || G.pop) return;
    G.s.groupsSeen = G.groupsAt; save(); showGroups(true);
  }
  function showGroups(announce) {
    var gs = G.groups || [], uid = me(), mine = null;
    gs.forEach(function (g) { if ((g.members || []).some(function (m) { return m.id === uid; })) mine = g; });
    var who = function (m, g) { return esc(m.name) + (m.id === uid ? ' <small>tú</small>' : (m.id === g.guide ? ' <small>guía</small>' : '')); };
    var html = '<span class="rg-pop-kind">Grupos de salida</span>' + (mine ? '<b>Vas en el grupo ' + mine.n + ' de ' + gs.length + '</b><p>' + (mine.n === 1 ? 'Salís los primeros.' : 'Salís después del grupo ' + (mine.n - 1) + '.') +
        (mine.guide ? ' Guía: ' + (mine.guide === uid ? 'tú' : esc(nameOf(mine.guide))) + '.' : '') + '</p>' : '<b>Reparto por grupos</b><p>No estás en ningún grupo: habla con un administrador.</p>') +
      '<div class="rg-groups">' + gs.map(function (g) { return '<div class="rg-grp' + (g === mine ? ' me' : '') + '"><span>Grupo ' + g.n + (g === mine ? ' · el tuyo' : '') + '</span>' + (g.members || []).map(function (m) { return '<i' + (m.id === g.guide ? ' class="guide"' : '') + '>' + who(m, g) + '</i>'; }).join('') + '</div>'; }).join('') + '</div>' +
      '<button class="btn big primary" id="gpOk" type="button">Entendido</button>';
    pop('groups', html, function () { $('#gpOk').addEventListener('click', unpop); });
    if (announce && mine) { speak('Vas en el grupo ' + mine.n + ' de ' + gs.length + '.'); try { if (navigator.vibrate) navigator.vibrate([300, 150, 300]); } catch (e) {} }
  }
  // Organizar por grupos (administradores): se elige de cuántos y la app los reparte por ritmo.
  function openGroups() {
    var size = G.s.groupSize || 5;
    function draw() {
      var gs = L.makeGroups(G.rows, size), blind = 0; gs.forEach(function (g) { g.members.forEach(function (m) { if (!m.known) blind++; }); });
      Cl.sheet(head('Organizar por grupos') + '<p class="muted">La app reparte por ritmo, del grupo más rápido al más tranquilo, con lo que sabe de cada uno: el nivel que eligió, sus medias de otras rutas y lo medido hoy. Si hay administradores, cada grupo lleva uno de guía.</p>' +
        '<div class="rg-step"><span>Motos por grupo</span><button class="btn small" id="ogLess" type="button" aria-label="Menos"><svg><use href="#i-minus"/></svg></button><b>' + size + '</b><button class="btn small" id="ogMore" type="button" aria-label="Más"><svg><use href="#i-plus"/></svg></button></div>' +
        '<div class="rg-groups">' + gs.map(function (g) { return '<div class="rg-grp"><span>Grupo ' + g.n + ' · ' + g.members.length + '</span>' + g.members.map(function (m) { return '<i' + (m.id === g.guide ? ' class="guide"' : '') + '>' + esc(m.name) + ' <small>' + (m.known ? String(m.score).replace('.', ',') : 'sin datos') + '</small></i>'; }).join('') + '</div>'; }).join('') + '</div>' +
        (blind ? '<p class="muted rg-small" style="text-align:left">' + blind + (blind === 1 ? ' persona no tiene' : ' personas no tienen') + ' nivel ni rutas guardadas: van como nivel medio. La nota va de 1 (tranquilo) a 5 (muy rápido).</p>' : '<p class="muted rg-small" style="text-align:left">La nota va de 1 (tranquilo) a 5 (muy rápido).</p>') +
        '<button class="btn big primary" id="ogSend" type="button"><svg><use href="#i-share"/></svg>Enviar a todos</button>' + (G.groups ? '<button class="btn" id="ogClear" type="button">Retirar el reparto</button>' : ''));
      $('#grX').addEventListener('click', function () { Cl.closeSheet(); });
      $('#ogLess').addEventListener('click', function () { size = Math.max(2, size - 1); draw(); });
      $('#ogMore').addEventListener('click', function () { size = Math.min(20, size + 1); draw(); });
      $('#ogSend').addEventListener('click', function (ev) {
        G.s.groupSize = size; save();
        var out = gs.map(function (g) { return { n: g.n, guide: g.guide, members: g.members.map(function (m) { return { id: m.id, name: m.name }; }) }; });
        Cl.busy(ev.currentTarget, function () { return sb.rpc('ride_groups', { p_id: G.s.id, p_groups: out }).then(function (r) { if (r.error) throw r.error; Cl.closeSheet(); A.toast('Reparto enviado: a cada uno le sale su grupo.', 'ok'); G.busy = false; return call(); }); });
      });
      if ($('#ogClear')) $('#ogClear').addEventListener('click', function () { sb.rpc('ride_groups', { p_id: G.s.id, p_groups: null }).then(function (r) { if (r.error) { fail(r.error); return; } Cl.closeSheet(); A.toast('Reparto retirado.', 'ok'); G.busy = false; call(); }); });
    }
    draw();
  }
  // Administradores de esta ruta: quién puede iniciarla, atender avisos y repartir grupos.
  function openAdmins() {
    Cl.sheet(head('Administradores de la ruta') + '<p class="muted">Pueden iniciar la ruta para todos, reciben los avisos de SOS, avería y gasolina y pueden repartir los grupos. Solo vale para esta ruta.</p><div class="rg-list">' +
      G.rows.map(function (x) { return '<div class="club-person" data-u="' + x.user_id + '"><span class="rg-ava">' + esc((x.name || '?').charAt(0).toUpperCase()) + '</span><div><b>' + esc(x.name) + (x.admin ? ' <span class="mstatus ok">Admin</span>' : '') + '</b><span class="muted">' + (x.owner ? 'Inició la ruta' : '') + '</span></div>' +
        (x.owner || x.user_id === me() ? '' : '<button class="link" type="button">' + (x.admin ? 'Quitar admin' : 'Hacer admin') + '</button>') + '</div>'; }).join('') + '</div>');
    $('#grX').addEventListener('click', function () { Cl.closeSheet(); });
    [].forEach.call(document.querySelectorAll('#rgSheet [data-u] .link'), function (b) { b.addEventListener('click', function () {
      var id = b.parentNode.dataset.u, x = row(id);
      sb.rpc('ride_set_admin', { p_id: G.s.id, p_user: id, p_on: !(x && x.admin) }).then(function (r) { if (r.error) { fail(r.error); return; } G.busy = false; return call().then(openAdmins); });
    }); });
  }
  // Entrar en un grupo (por código, al iniciar la ruta de un evento o al decir «sí» a una llamada) y cargar su ruta.
  function enter(d, opts) {
    opts = opts || {};
    G.s = { id: d.id, code: d.code, name: d.name, owner: !!d.owner, eventId: d.event_id || null, free: !(d.route && d.route.coords && d.route.coords.length > 1) }; G.rows = []; G.rank = null; G.admin = !!d.owner; save(); sync();
    var rt = d.route, job = Promise.resolve();
    if (rt && rt.coords && rt.coords.length > 1) job = A.usePlan({ id: parseInt(d.id.replace(/-/g, '').slice(0, 12), 16), name: rt.name || d.name, wps: rt.wps || [], pois: rt.pois || [], coords: rt.coords, dist: rt.dist || 0, dur: rt.dur || 0, routed: true, steps: rt.steps || [], created: Date.now(), groupId: d.id });
    return job.then(function () { G.busy = false; var c = call(); if (opts.start && !A.isRec()) A.startRide(); return c; });
  }
  // «¿Vienes a la ruta?»: rutas de evento que un administrador ha iniciado y a las que estoy apuntado.
  function declined() { try { return JSON.parse(localStorage.getItem('rg.calls.no') || '{}'); } catch (e) { return {}; } }
  function checkCalls(force) {
    if (!sb || !me() || G.s || G.pop || G.callsOff || document.visibilityState !== 'visible') return Promise.resolve([]);
    if (!force && Date.now() - G.callsAt < 8000) return Promise.resolve([]);
    G.callsAt = Date.now();
    return sb.rpc('ride_calls').then(function (r) {
      if (r.error) { if (/could not find|schema cache/i.test(r.error.message || '')) G.callsOff = true; return []; }
      var no = declined(), list = (r.data || []).filter(function (c) { return force || !no[c.id]; });
      if (list.length && !G.s && !G.pop) askCall(list[0]);
      return r.data || [];
    }, function () { return []; });
  }
  function askCall(c) {
    pop('call', '<span class="rg-pop-kind">Empieza la ruta</span><b>' + esc(c.name) + '</b><p>' + esc(c.by) + ' ha iniciado la ruta. ¿Vienes?</p><button class="btn big primary" id="clYes" type="button"><svg><use href="#i-check"/></svg>Sí, voy</button><button class="btn big" id="clNo" type="button">No voy</button>', function () {
      $('#clYes').addEventListener('click', function (ev) {
        Cl.busy(ev.currentTarget, function () { return sb.rpc('ride_join_event', { p_id: c.id }).then(function (r) { if (r.error) throw r.error; unpop(); return enter(r.data, { start: true }); }); });
      });
      $('#clNo').addEventListener('click', function () { var no = declined(); no[c.id] = Date.now(); Object.keys(no).forEach(function (k) { if (Date.now() - no[k] > 36 * 3600e3) delete no[k]; }); try { localStorage.setItem('rg.calls.no', JSON.stringify(no)); } catch (e) {} unpop(); A.toast('Vale. Si cambias de idea, entra desde el evento en Comunidad.', 'ok'); });
    });
    speak(c.by + ' ha iniciado la ruta ' + c.name + '. ¿Vienes?'); try { if (navigator.vibrate) navigator.vibrate([400, 200, 400]); } catch (e) {}
    if (RA) RA.alarm({ title: 'Empieza la ruta: ' + c.name, text: c.by + ' ha iniciado la ruta. ¿Vienes?', loud: false }).catch(noop);
  }
  setInterval(function () { checkCalls(false); }, 20000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') setTimeout(function () { checkCalls(false); }, 1200); });

  if (RA) RA.addListener('action', function (e) { var k = e && e.kind; if (KIND[k]) sendAlert(k); else if (k === 'cancel') sendAlert(null); else if (k === 'ack') dismiss(G.alarm && G.alarm.mode === 'alarm' ? 'seen' : 'ok'); });
  function leaveLocal(msg) { G.s = null; G.rows = []; G.rank = null; G.groups = null; G.admin = false; if (G.pop === 'groups') unpop(); save(); draw(); sync(); if (msg) A.toast(msg, 'warn'); if (G.sheetOpen) renderSheet(); }

  /* ---------- mapa ---------- */
  function draw() {
    var m = A.map(); if (!m || typeof maplibregl === 'undefined') return;
    var seen = {}, list = G.s && G.rank ? G.rank.list : [];
    list.forEach(function (r) {
      if (r.me) return; seen[r.user_id] = 1;
      var mk = G.markers[r.user_id];
      if (!mk) { var el = document.createElement('div'); el.className = 'rider-marker'; el.addEventListener('click', function (e) { e.stopPropagation(); open(); }); mk = G.markers[r.user_id] = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([r.lon, r.lat]).addTo(m); }
      mk.setLngLat([r.lon, r.lat]);
      var e2 = mk.getElement(), al = alertOf(r.user_id); var rw = row(r.user_id); e2.classList.toggle('admin', !!(rw && (rw.admin || rw.owner))); e2.classList.toggle('alert', !!al); e2.classList.toggle('stale', r.stale); e2.classList.toggle('off', !r.stale && r.off); e2.classList.toggle('behind', !r.stale && !r.off && r.behind); e2.textContent = (r.name || '?').charAt(0).toUpperCase(); e2.title = r.name;
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
      '<div class="grp-code"><div class="grp-qr">' + qrSvg('regroupride:' + G.s.code) + '</div><div><span class="label">Código del grupo</span><b>' + esc(G.s.code) + '</b><button class="btn small primary" id="grShare" type="button"><svg><use href="#i-share"/></svg>Compartir</button></div></div>' +
      '<span class="label">' + (list.length ? (G.s.free ? 'En marcha' : 'En ruta, de delante a atrás') : 'Nadie en marcha todavía') + '</span><div class="rg-list">' + list.map(function (x) {
        var al = alertOf(x.user_id);
        var tag = al ? '<span class="mstatus due"><svg><use href="#i-warn"/></svg>' + esc(KIND[al].t) + '</span>' : x.stale ? '<span class="mstatus due"><svg><use href="#i-sens"/></svg>sin señal ' + Math.round(x.age / 60000) + ' min</span>' : (x.off ? '<span class="mstatus soon"><svg><use href="#i-warn"/></svg>fuera de ruta</span>' : (x.behind ? '<span class="mstatus soon"><svg><use href="#i-warn"/></svg>se queda atrás</span>' : ''));
        var fx = A.lastFix && A.lastFix(), far = (x.gap == null || G.s.free) && fx && x.lat != null ? window.Geo.dist(fx.lat, fx.lon, x.lat, x.lon) : null;
        var gap = x.me ? 'tú' : (far != null ? (far < 150 ? 'contigo' : 'a ' + km(far) + ' de ti') : (x.gap == null ? '' : (Math.abs(x.gap) < 150 ? 'contigo' : km(x.gap) + (x.gap > 0 ? ' por delante' : ' por detrás'))));
        var rw = row(x.user_id), adm = rw && rw.admin ? ' <span class="mstatus ok"><svg><use href="#i-check"/></svg>admin</span>' : '';
        return '<div class="club-person"><span class="rg-ava' + (al || x.stale || x.off ? ' bad' : (x.behind ? ' warn' : '')) + '">' + esc(x.name.charAt(0).toUpperCase()) + '</span><div><b>' + esc(x.name) + adm + ' ' + tag + '</b><span class="muted">' + gap + '</span></div></div>';
      }).join('') + (waiting.length ? '<p class="muted">Sin iniciar la ruta: ' + waiting.map(function (x) { return esc(x.name); }).join(', ') + '.</p>' : '') + '</div>' +
      '<p class="muted rg-small" style="text-align:left">' + (amAdmin() ? 'Cuando pulses «Iniciar ruta», se les iniciará también a los demás que tengan la app abierta. ' : 'La ruta se te iniciará sola cuando la inicie un administrador: deja la app abierta en pantalla. ') + 'Tu posición solo se comparte con este grupo mientras tienes la ruta en marcha, y se borra al pararla.</p>' +
      (amAdmin() ? '<button class="btn big primary" id="grGroups" type="button">Organizar por grupos</button>' : '') + (G.groups ? '<button class="btn" id="grSeeGroups" type="button">Ver los grupos de salida</button>' : '') +
      '<button class="btn rg-btn-aviso" id="grAlert" type="button"><svg><use href="#i-warn"/></svg>Avisar al grupo: SOS, avería o gasolina</button>' + (amAdmin() ? '<button class="btn" id="grAdmins" type="button">Administradores de la ruta</button>' : '') +
      (G.s.owner ? '<button class="btn danger" id="grEnd" type="button">Terminar el grupo para todos</button>' : '') + '<button class="btn rg-skip" id="grLeave" type="button"><svg><use href="#i-exit"/></svg>Salir del grupo</button>');
    $('#grX').addEventListener('click', close);
    $('#grAlert').addEventListener('click', function () { G.sheetOpen = false; openAlert(); });
    if ($('#grGroups')) $('#grGroups').addEventListener('click', function () { G.sheetOpen = false; openGroups(); });
    if ($('#grSeeGroups')) $('#grSeeGroups').addEventListener('click', function () { close(); showGroups(false); });
    if ($('#grAdmins')) $('#grAdmins').addEventListener('click', function () { G.sheetOpen = false; openAdmins(); });
    $('#grShare').addEventListener('click', function () { share('Únete al grupo de la ruta «' + G.s.name + '» en ReGroupRide: en el mapa pulsa el botón de grupo y escribe el código ' + G.s.code + '.'); });
    $('#grLeave').addEventListener('click', function (ev) { arm(ev.currentTarget, '¿Seguro? Toca otra vez', function () { var id = G.s.id; leaveLocal(); close(); sb.rpc('ride_leave', { p_id: id }).then(function () { A.toast('Has salido del grupo.', 'ok'); }); }); });
    if ($('#grEnd')) $('#grEnd').addEventListener('click', function (ev) { arm(ev.currentTarget, '¿Seguro? Se borran las posiciones de todos', function () { var id = G.s.id; sb.rpc('ride_end', { p_id: id }).then(function (r) { if (r.error) { fail(r.error); return; } leaveLocal(); close(); A.toast('Grupo terminado.', 'ok'); }); }); });
  }
  function arm(btn, label, run) { if (btn.dataset.armed) { run(); return; } btn.dataset.armed = '1'; var old = btn.innerHTML; btn.textContent = label; setTimeout(function () { delete btn.dataset.armed; btn.innerHTML = old; }, 3500); }
  function renderJoin() {
    var p = A.activePlan();
    Cl.sheet(head('Rodar en grupo') + '<p class="muted">Todos los del grupo se ven en el mapa durante la ruta, y se sabe quién se ha quedado atrás o se ha salido.</p>' +
      '<div class="club-card"><b>Unirme a un grupo</b><p class="muted">Escribe el código que te pasen o escanea su QR. La ruta se carga sola.</p><div class="plan-link"><input type="text" id="grCode" maxlength="8" placeholder="Código" autocapitalize="characters" autocomplete="off"><button class="btn small primary" id="grJoin" type="button">Unirme</button></div>' +
      (P.CapacitorBarcodeScanner ? '<button class="btn" id="grScan" type="button"><svg><use href="#i-qr"/></svg>Escanear QR</button>' : '') + '</div>' +
      '<div class="club-card"><b>Crear un grupo</b>' + (p ? '<p class="muted">Para la ruta «' + esc(p.name) + '». Te dará un código y un QR para pasar a los demás.</p><button class="btn big primary" id="grCreate" type="button">Crear grupo para esta ruta</button><button class="btn rg-skip" id="grFree" type="button">Crear grupo sin ruta</button>'
        : '<p class="muted">Sin ruta marcada: os veis todos en el mapa y cada uno sabe por dónde va. Te dará un código y un QR para pasar a los demás.</p><button class="btn big primary" id="grFree" type="button">Crear grupo</button>') + '</div>');
    $('#grX').addEventListener('click', close);
    var join = function (code, btn) {
      code = String(code || '').replace(/^regroupride:/i, '').trim(); if (code.length < 4) { A.toast('Escribe el código.', 'warn'); return; }
      Cl.busy(btn, function () { return sb.rpc('ride_join', { p_code: code }).then(function (r) {
        if (r.error) throw new Error(/no válido/i.test(r.error.message) ? 'Ese código no existe o el grupo ya ha terminado.' : r.error.message);
        close(); return enter(r.data).then(function () { A.toast('Estás en el grupo. La ruta se iniciará sola cuando salga un administrador.', 'ok'); });
      }); });
    };
    $('#grJoin').addEventListener('click', function (ev) { join($('#grCode').value, ev.currentTarget); });
    if ($('#grScan')) $('#grScan').addEventListener('click', function (ev) {
      var btn = ev.currentTarget;
      P.CapacitorBarcodeScanner.scanBarcode({ hint: 0, scanInstructions: 'Apunta al QR del grupo', scanButton: false, scanText: ' ', cameraDirection: 1, scanOrientation: 3 }).then(function (r) { if (r && r.ScanResult) join(r.ScanResult, btn); }, function () { A.toast('No se ha podido leer el QR. Escribe el código.', 'warn'); });
    });
    var create = function (ev, free) {
      var nm = free ? 'Salida de ' + (Cl.profileName() || 'grupo') : p.name;
      Cl.busy(ev.currentTarget, function () { return sb.rpc('ride_create', { p_name: nm, p_route: free ? null : { name: p.name, wps: p.wps, pois: p.pois || [], coords: p.coords, steps: p.steps || [], dist: p.dist, dur: p.dur } }).then(function (r) {
        if (r.error) throw r.error; var d = r.data; G.s = { id: d.id, code: d.code, name: d.name, owner: true, free: !!free }; save(); sync(); renderSheet(); call(); A.toast('Grupo creado. Pasa el código o el QR.', 'ok');
      }); });
    };
    if ($('#grCreate')) $('#grCreate').addEventListener('click', function (ev) { create(ev, false); });
    if ($('#grFree')) $('#grFree').addEventListener('click', function (ev) { create(ev, true); });
  }

  var btn = $('#btnGroup'); if (btn) btn.addEventListener('click', open);
  var abtn = $('#btnAlert'); if (abtn) abtn.addEventListener('click', openAlert);
  var first = true;   // la primera llamada llega antes de saber si hay sesión guardada
  Cl.onChange(function (u) { if (u) setTimeout(function () { checkCalls(false); }, 2500); if (first) { first = false; return; } if (!u && G.s) { G.s = null; G.rows = []; G.rank = null; save(); draw(); } sync(); if (u && G.s) call(); });
  document.addEventListener('visibilitychange', tick);
  window.RGGroup = { onFix: onFix, sync: sync, redraw: redraw, open: open, openAlert: openAlert, enter: enter, checkCalls: checkCalls, state: G };
  sync();
})();
