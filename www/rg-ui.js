/* ReGroupRide — la organización de la app en cuatro pestañas (Mapa, Rutas, Comunidad, Yo).
   Aquí vive lo que une las piezas: la píldora de estado, las casillas «Con quién» y «Ruta», la pregunta «¿Con quién vas?»
   al iniciar, la hoja «Cerca de ti», los botones «Avisar» y «Gasolina» en marcha, la pestaña Rutas, el detalle de una
   ruta, y Yo con sus cinco accesos (Mi moto, Estadísticas y logros, Seguridad, Ajustes y Ayuda).
   Reglas: una hoja es una decisión corta y nunca va sobre otra; lo que lleva pestañas o listas es pantalla completa;
   cada función vive en un solo sitio. Los módulos de cada cosa (grupo, carretera, garaje…) siguen haciendo el trabajo. */
(function () {
  'use strict';
  var A = window.RGApp, Cl = window.RGCloud; if (!A || !Cl) return;
  var sb = Cl.sb, $ = function (s, r) { return (r || document).querySelector(s); }, $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function ic(n) { return '<svg><use href="#i-' + n + '"/></svg>'; }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; }
  function head(t, cls) { return '<div class="head"><h1>' + t + '</h1><button class="btn small icon' + (cls ? ' ' + cls : '') + '" id="uiX" type="button" title="Cerrar">' + ic('close') + '</button></div>'; }
  function group() { return window.RGGroup && RGGroup.state && RGGroup.state.s ? RGGroup.state.s : null; }
  function contacts() { return window.RGSolo ? RGSolo.contacts() : []; }
  function soloOn() { return !!(window.RGSolo && RGSolo.state.on); }
  var UI = { tripMode: false };

  /* ---------- aviso breve con «Deshacer» ---------- */
  var snackT = 0;
  function snack(text, act, fn, ms) {
    var el = $('#asSnack'); if (!el) { el = document.createElement('div'); el.id = 'asSnack'; el.className = 'as-snack'; document.body.appendChild(el); }
    el.innerHTML = '<span>' + esc(text) + '</span>' + (act ? '<button type="button">' + esc(act) + '</button>' : ''); el.hidden = false;
    clearTimeout(snackT); snackT = setTimeout(function () { el.hidden = true; }, ms || 5000);
    var b = $('button', el); if (b) b.addEventListener('click', function () { clearTimeout(snackT); el.hidden = true; if (fn) fn(); });
  }

  /* ---------- mapa: píldora de estado (en reposo) o de modo (en marcha) ---------- */
  var bootAt = Date.now();
  function whoText(short) {
    var g = group(), cs = contacts();
    if (g) { var n = window.RGGroup ? RGGroup.count() : 0; return 'En grupo' + (short ? '' : ' · ' + (A.isRec() ? n + ' en ruta' : esc(g.code || ''))); }
    return 'Voy solo' + (soloOn() && cs.length ? ' · ' + (A.isRec() ? 'avisa' : 'Avisa') + ' a ' + cs[0].name : '');
  }
  function pill() {
    var el = $('#asStatus'), t = $('#asStatusT'); if (!el || !t) return;
    var rec = A.isRec(), txt, warn = false;
    if (rec) txt = A.isTrip() ? 'Solo midiendo' : whoText(false);
    else {
      var st = A.status(), young = Date.now() - bootAt < 6000;
      if (st.gps === 'bad') { txt = 'Sin GPS' + (st.gpsErr ? ' · ' + st.gpsErr : ''); warn = true; }
      else if ((st.motion === 'bad' || st.motion === 'off') && !young) { txt = 'Sin sensores de movimiento'; warn = true; }
      else if (st.motion === 'nogyro') { txt = 'Sin giróscopo'; warn = true; }
      else if (st.gps === 'wait') txt = 'Buscando GPS…';
      else if (st.gps === 'weak') { txt = 'GPS con poca precisión'; warn = true; }
      else txt = 'Todo listo' + (st.wx && st.wx.t != null ? ' · ' + Math.round(st.wx.t) + '°' : '');
    }
    if (t.textContent !== txt) t.textContent = txt;
    el.classList.toggle('warn', warn); el.classList.toggle('mode', rec);
  }
  if ($('#asStatus')) $('#asStatus').addEventListener('click', function () {
    if (A.isRec()) { if (group()) RGGroup.open(); return; }
    A.showView('help'); setTimeout(function () { var d = $('#helpDiag'); if (d) { d.open = true; d.scrollIntoView({ block: 'start' }); } }, 80);
  });

  /* ---------- mapa en reposo: casillas, y lo que se enseña según el momento ---------- */
  var wasPlan = false, planBack = false, strip = null;
  function sync() {
    var rec = A.isRec(), p = A.activePlan && A.activePlan(), pm = !!(A.isPlanMode && A.isPlanMode()), b = document.body;
    b.classList.toggle('as-rec', rec); b.classList.toggle('as-route', !!p && !rec && !pm); b.classList.toggle('as-drawing', pm);
    var rb = $('#asRideBtns'); if (rb) rb.hidden = !rec;
    var wt = $('#asWhoT'), rt = $('#asRouteT');
    if (wt) { var w = whoText(false); if (wt.innerHTML !== w) wt.innerHTML = w; }
    if (rt) { var r = p ? p.name : 'Sin ruta'; if (rt.textContent !== r) rt.textContent = r; }
    var back = $('#btnPlanBack'); if (back) back.hidden = !pm;
    if (wasPlan && !pm && !planBack) { A.showView('rides'); ruTab('plans'); }      // se ha guardado la ruta dibujada: de vuelta a Planeadas
    wasPlan = pm; planBack = false;
    if (!rec) UI.tripMode = false;
    pill(); groupStrip(rec);
  }
  // En grupo: franja ámbar con quien se queda atrás, se sale de la ruta o se para. Se quita sola.
  function groupStrip(rec) {
    var g = group(), list = g && rec && RGGroup.state.rank ? RGGroup.state.rank.list : [], txt = '';
    for (var i = 0; i < list.length && !txt; i++) { var x = list[i]; if (x.me) continue; if (x.stale) txt = x.name + ' se ha parado'; else if (x.off) txt = x.name + ' se ha salido de la ruta'; else if (x.behind) txt = x.name + ' se ha quedado atrás'; }
    if (!strip) { strip = document.createElement('button'); strip.type = 'button'; strip.className = 'as-strip'; strip.hidden = true; var top = $('#view-map .map-top'); if (top) top.parentNode.insertBefore(strip, top.nextSibling); strip.addEventListener('click', function () { if (group()) RGGroup.open(); }); }
    strip.hidden = !txt; if (txt && strip.dataset.t !== txt) { strip.dataset.t = txt; strip.innerHTML = ic('warn') + '<span>' + esc(txt) + '</span>'; }
  }
  setInterval(sync, 1000); document.addEventListener('rg:view', function () { setTimeout(sync, 0); });
  if ($('#asWho')) $('#asWho').addEventListener('click', function () { who(false); });
  if ($('#asRoute')) $('#asRoute').addEventListener('click', function () { A.showView('rides'); ruTab('plans'); });
  if ($('#btnNear')) $('#btnNear').addEventListener('click', function () { near('gasolina'); });
  if ($('#btnAvisar')) $('#btnAvisar').addEventListener('click', function () { if (group() && window.RGGroup) RGGroup.openAlert(); else if (window.RGRoad) RGRoad.hazard(); });
  if ($('#btnPlanBack')) $('#btnPlanBack').addEventListener('click', function () {
    var out = function () { planBack = true; A.exitPlanMode(); A.showView('rides'); };
    if (!A.planDirty || !A.planDirty()) { out(); return; }
    var s = Cl.sheet(head('¿Salir sin guardar?') + '<p class="muted" style="margin:0;text-align:left">Perderás los puntos que has marcado.</p><button class="btn big primary" id="pbStay" type="button">Seguir dibujando</button><button class="btn big as-danger" id="pbOut" type="button">Salir sin guardar</button>');
    $('#uiX', s).addEventListener('click', Cl.closeSheet); $('#pbStay', s).addEventListener('click', Cl.closeSheet); $('#pbOut', s).addEventListener('click', function () { Cl.closeSheet(); out(); });
  });

  /* ---------- «¿Con quién vas?»: la única pregunta antes de salir ---------- */
  var whoT = 0;
  function who(start, pref, go) {
    clearInterval(whoT);
    if (window.RGSolo && Cl.user()) RGSolo.load(false);
    var last = store('rg.who'), g = group(), sel = pref || (g ? 'grupo' : (last === 'grupo' && g ? 'grupo' : 'solo')), auto = !!(start && last), left = 20;
    function draw() {
      var cs = contacts(), g2 = group();
      var soloTx = cs.length ? 'Si te paras de golpe y no contestas, se avisa a ' + esc(cs.length === 1 ? cs[0].name : cs[0].name + ' y ' + (cs.length - 1) + ' más') + '.' : 'Vigila las paradas bruscas. Añade un contacto para que le llegue el aviso.';
      var grp = '';
      if (sel === 'grupo') {
        grp = g2 ? '<div class="as-grp"><div class="as-grp-qr">' + (window.RGGroup ? RGGroup.qr('regroupride:' + g2.code) : '') + '</div><div class="as-grp-c"><small>Código del grupo</small><b class="cifra">' + esc(g2.code) + '</b><button class="btn small" id="wqShare" type="button">' + ic('share') + 'Pasar el código</button></div></div><button class="as-link danger" id="wqLeave" type="button">Salir de este grupo</button>'
          : '<div class="as-code"><input type="text" id="wqCode" maxlength="8" placeholder="Código del grupo" autocapitalize="characters" autocomplete="off"><button class="btn as-ink" id="wqJoin" type="button">Unirme</button></div><div class="as-two"><button class="btn" id="wqScan" type="button">' + ic('qr') + 'Escanear QR</button><button class="btn" id="wqNew" type="button">' + ic('plus') + 'Crear grupo</button></div>';
      }
      var s = Cl.sheet(head('¿Con quién vas?') +
        '<button class="as-opt' + (sel === 'solo' ? ' on' : '') + '" type="button" data-w="solo"><i></i><span><b>Voy solo</b><small>' + soloTx + '</small></span></button>' +
        '<div class="as-opt-box' + (sel === 'grupo' ? ' on' : '') + '"><button class="as-opt' + (sel === 'grupo' ? ' on' : '') + '" type="button" data-w="grupo"><i></i><span><b>En grupo</b><small>Os veis todos en el mapa y avisa si alguien se queda atrás.</small></span></button>' + grp + '</div>' +
        '<div class="as-rows"><button class="as-row" type="button" id="wqSec">' + ic('shield') + '<span><b>Contactos y enlace para la familia</b><small>' + (cs.length ? cs.length + (cs.length === 1 ? ' contacto' : ' contactos') : 'Sin contactos') + ' · Seguridad</small></span>' + ic('chev') + '</button>' +
        (window.RGSocial ? '<button class="as-row" type="button" id="wqChk">' + ic('check') + '<span><b>Lista antes de salir</b><small>Calzado, guantes, documentación…</small></span>' + ic('chev') + '</button>' : '') + '</div>' +
        (auto ? '<p class="muted rg-small" id="wqCount" style="margin:0">Si no tocas nada, en ' + left + ' s sale como la última vez.</p>' : '') +
        '<button class="btn big primary" id="wqGo" type="button">' + (start ? 'Iniciar ruta' : 'Listo') + '</button>');
      var stop = function () { if (auto) { auto = false; clearInterval(whoT); var c = $('#wqCount'); if (c) c.remove(); } };
      s.firstChild.addEventListener('pointerdown', stop, true);
      $('#uiX', s).addEventListener('click', function () { clearInterval(whoT); Cl.closeSheet(); });
      $$('[data-w]', s).forEach(function (b) { b.addEventListener('click', function () { sel = b.dataset.w; draw(); }); });
      $('#wqSec', s).addEventListener('click', function () { clearInterval(whoT); Cl.closeSheet(); if (window.RGSolo) RGSolo.open(); else A.showView('security'); });
      if ($('#wqChk', s)) $('#wqChk', s).addEventListener('click', function () { clearInterval(whoT); Cl.closeSheet(); RGSocial.checklist(null); });
      var after = function () { if ($('#wqGo')) draw(); };
      if ($('#wqJoin', s)) $('#wqJoin', s).addEventListener('click', function (ev) { if (!needUser()) return; RGGroup.join($('#wqCode').value, ev.currentTarget).then(after); });
      if ($('#wqScan', s)) $('#wqScan', s).addEventListener('click', function (ev) { if (!needUser()) return; RGGroup.scan(ev.currentTarget).then(after); });
      if ($('#wqNew', s)) $('#wqNew', s).addEventListener('click', function (ev) { if (!needUser()) return; RGGroup.create(ev.currentTarget).then(after); });
      if ($('#wqShare', s)) $('#wqShare', s).addEventListener('click', function () { var gg = group(); if (gg) RGGroup.share('Únete al grupo de la ruta «' + gg.name + '» en ReGroupRide: pulsa «Iniciar ruta», elige «En grupo» y escribe el código ' + gg.code + '.'); });
      if ($('#wqLeave', s)) $('#wqLeave', s).addEventListener('click', function () { RGGroup.leave(); sel = 'solo'; draw(); });
      $('#wqGo', s).addEventListener('click', confirm);
    }
    function needUser() { if (Cl.user()) return true; clearInterval(whoT); Cl.closeSheet(); A.toast('Entra en tu cuenta para rodar en grupo.', 'warn'); Cl.openAuth(false); return false; }
    function confirm() {
      clearInterval(whoT);
      if (sel === 'grupo' && !group()) { A.toast('Únete con un código o crea un grupo. Si no, elige «Voy solo».', 'warn'); return; }
      if (sel === 'solo' && group() && window.RGGroup) RGGroup.leave();
      store('rg.who', sel); if (window.RGSolo) RGSolo.setOn(sel === 'solo');
      Cl.closeSheet(); sync(); if (start && go) go();
    }
    draw();
    if (auto) whoT = setInterval(function () { left--; var c = $('#wqCount'); if (!c) { clearInterval(whoT); return; } if (left <= 0) { sel = group() ? 'grupo' : 'solo'; confirm(); } else c.textContent = 'Si no tocas nada, en ' + left + ' s sale como la última vez.'; }, 1000);
  }
  // «Iniciar ruta»: con ruta cargada y lejos de su salida, primero se pregunta por dónde entrar; después, con quién vas.
  function beforeStart(go) {
    var next = function () { who(true, null, go); };
    if (window.RGNav && RGNav.preStart && RGNav.preStart(next)) return;
    next();
  }

  /* ---------- «Cerca de ti»: gasolina, peligros, sitios y fotógrafos ---------- */
  var NEAR = 'gasolina';
  function near(tab) {
    if (!Cl.user()) { Cl.openAuth(false); return; }
    if (Cl.pageOpen && Cl.pageOpen()) Cl.closePages();
    NEAR = tab || NEAR;
    var T = [['gasolina', 'Gasolina'], ['peligros', 'Peligros'], ['sitios', 'Sitios'], ['fotos', 'Fotos']];
    var s = Cl.sheet(head('Cerca de ti') + '<div class="as-tabs" id="nrTabs">' + T.map(function (x) { return '<button type="button" data-t="' + x[0] + '" aria-pressed="' + (x[0] === NEAR) + '">' + x[1] + '</button>'; }).join('') + '</div><div id="nrPane" class="as-col"></div>', 'tall');
    $('#uiX', s).addEventListener('click', Cl.closeSheet);
    $$('#nrTabs button', s).forEach(function (b) { b.addEventListener('click', function () { near(b.dataset.t); }); });
    var el = $('#nrPane', s), none = function () { el.innerHTML = '<div class="empty"><b>No disponible</b>Esta parte no se ha podido cargar.</div>'; };
    if (NEAR === 'gasolina') { if (window.RGRoad) RGRoad.fuelPane(el); else none(); }
    else if (NEAR === 'peligros') { if (window.RGRoad) RGRoad.hazPane(el); else none(); }
    else if (NEAR === 'sitios') { if (window.RGSocial) RGSocial.placesPane(el); else none(); }
    else { if (window.RGPhoto && RGPhoto.pane) RGPhoto.pane(el); else none(); }
  }

  /* ---------- Rutas: Hechas, Planeadas y De otros ---------- */
  var RT = { tab: 'done', done: 'all', others: 'catalog' };
  function legacy(f) { var b = $('#ridesFilters [data-f="' + f + '"]'); if (b) b.click(); }
  function ruTab(t, quiet) {
    if (t) RT.tab = t;
    $$('#ruTabs button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.t === RT.tab)); });
    var sub = $('#ruSub'); if (!sub) return;
    var S = RT.tab === 'done' ? [['all', 'Todas'], ['fav', 'Favoritas'], ['trips', 'Solo medidas']] : RT.tab === 'others' ? [['catalog', 'Mis comunidades'], ['public', 'Públicas']] : [];
    sub.hidden = !S.length; sub.innerHTML = S.map(function (x) { return '<button class="pill" type="button" data-f="' + x[0] + '" aria-pressed="' + (RT[RT.tab] === x[0]) + '">' + x[1] + '</button>'; }).join('');
    $$('button', sub).forEach(function (b) { b.addEventListener('click', function () { RT[RT.tab] = b.dataset.f; ruTab(); }); });
    var inp = $('#ridesSearch'); if (inp) inp.placeholder = RT.tab === 'done' ? 'Buscar por nombre o fecha' : 'Buscar por nombre';
    if (!quiet) legacy(RT.tab === 'plans' ? 'plans' : RT[RT.tab]);
    catalogAdd();
  }
  // En «De otros › Mis comunidades», quien administra una comunidad ve «Añadir ruta al catálogo».
  function catalogAdd() {
    var old = $('#ruCatAdd'); if (old) old.remove();
    if (RT.tab !== 'others' || RT.others !== 'catalog' || !window.RGClub || !RGClub.api) return;
    var mine = (RGClub.state.list || []).filter(function (c) { return c.role === 'admin' || c.role === 'owner'; }); if (!mine.length) return;
    var b = document.createElement('button'); b.type = 'button'; b.id = 'ruCatAdd'; b.className = 'btn'; b.innerHTML = ic('plus') + 'Añadir ruta al catálogo';
    var list = $('#ridesList'); list.parentNode.insertBefore(b, list);
    b.addEventListener('click', function () { RGClub.catalog(mine[0].id, mine[0].name, true); });
  }
  $$('#ruTabs button').forEach(function (b) { b.addEventListener('click', function () { ruTab(b.dataset.t); }); });
  document.addEventListener('rg:view', function (e) { if (e.detail === 'rides') ruTab(null, false); });
  function draw() { A.showView('map'); if (!A.isPlanMode()) A.enterPlanMode(); sync(); }
  if ($('#ruDraw')) $('#ruDraw').addEventListener('click', draw);
  if ($('#ruGen')) $('#ruGen').addEventListener('click', function () { if (window.RGRoutes) RGRoutes.loop(); });

  /* ---------- detalle de una ruta: menú, mapa sin conexión, publicar y aparcamiento ---------- */
  function trackPlan() {
    var r = A.detailRide(), t = A.detailTrack() || []; if (!r || t.length < 2) return null;
    var step = Math.max(1, Math.floor(t.length / 1500)), c = []; for (var i = 0; i < t.length; i += step) c.push([t[i][2], t[i][1]]); var z = t[t.length - 1]; c.push([z[2], z[1]]);
    return { id: 'r' + r.id, name: $('#detailTitle').textContent || 'Ruta', coords: c, dist: r.dist || 0, dur: r.movingS || 0 };
  }
  if ($('#btnDetailMore')) $('#btnDetailMore').addEventListener('click', function () {
    var row = function (id, i, t, cls) { return '<button class="as-row' + (cls ? ' ' + cls : '') + '" type="button" data-b="' + id + '">' + ic(i) + '<span><b>' + t + '</b></span></button>'; };
    var s = Cl.sheet(head(esc($('#detailTitle').textContent || 'Ruta')) + '<div class="as-rows">' + row('btnRename', 'edit', 'Renombrar') + row('btnGmaps', 'gmaps', 'Abrir en Google Maps') + row('btnExportRide', 'download', 'Exportar las curvas (CSV)') + row('btnDeleteRide', 'trash', 'Borrar esta ruta', 'danger') + '</div>');
    $('#uiX', s).addEventListener('click', Cl.closeSheet);
    $$('[data-b]', s).forEach(function (b) { b.addEventListener('click', function () {
      if (b.dataset.b === 'btnDeleteRide') { if (!b.dataset.sure) { b.dataset.sure = '1'; $('b', b).textContent = 'Toca otra vez para borrar'; return; } Cl.closeSheet(); var d = $('#btnDeleteRide'); d.click(); d.click(); return; }
      Cl.closeSheet(); $('#' + b.dataset.b).click();
    }); });
  });
  if ($('#btnOffline')) $('#btnOffline').addEventListener('click', function () { var p = trackPlan(); if (!p) { A.toast('Esta ruta no tiene trazado.', 'warn'); return; } if (window.RGOffline && RGOffline.open) RGOffline.open(p); });
  if ($('#btnPublish')) $('#btnPublish').addEventListener('click', function (ev) {
    var p = trackPlan(), r = A.detailRide(); if (!p || !r) { A.toast('Esta ruta no tiene trazado.', 'warn'); return; }
    if (!Cl.user()) { Cl.openAuth(false); return; }
    var a = p.coords[0], z = p.coords[p.coords.length - 1], plan = { id: r.id, name: p.name, wps: [[a[1], a[0], 'Salida'], [z[1], z[0], 'Llegada']], pois: [], coords: p.coords, steps: [], dist: Math.round(p.dist * 10) / 10, dur: p.dur, routed: true, created: Date.now() };
    var had = (A.plans() || []).filter(function (x) { return x.id === r.id; })[0];
    if (had && had.pub) { A.toast('Ya es pública. La tienes en Rutas › Planeadas para dejarla privada.', 'warn'); return; }
    if (window.RGShell && RGShell.trim) plan = RGShell.trim(plan);
    var s = Cl.sheet(head('Publicar esta ruta') + '<p class="muted" style="margin:0;text-align:left">La verá cualquier motero en Rutas › De otros. Se recorta el principio y el final según tu zona de privacidad (Yo › Seguridad).</p><button class="btn big primary" id="pbGo" type="button">Publicar</button>');
    $('#uiX', s).addEventListener('click', Cl.closeSheet);
    $('#pbGo', s).addEventListener('click', function (e2) { Cl.busy(e2.currentTarget, function () { return A.savePlan(had || plan).then(function () { return window.RGNav ? RGNav.togglePublic(had || plan) : null; }).then(function () { Cl.closeSheet(); }); }); });
  });
  if ($('#detailParkBtn')) $('#detailParkBtn').addEventListener('click', function () { $('#detailPark').hidden = true; A.openPark(); });

  /* ---------- Yo: perfil, cifras en un bloque y cinco accesos ---------- */
  $$('[data-yo]').forEach(function (b) { b.addEventListener('click', function () { A.showView('profile'); }); });
  $$('#yoNav [data-go]').forEach(function (b) { b.addEventListener('click', function () { A.showView(b.dataset.go); }); });
  function yo() {
    var rides = A.rides() || [], km = rides.reduce(function (s, r) { return s + (r.dist || 0); }, 0), n = rides.filter(function (r) { return !r.trip; }).length;
    var days = {}; rides.forEach(function (r) { days[new Date(r.start).toDateString()] = 1; });
    var streak = 0, cur = new Date(); cur.setHours(0, 0, 0, 0); if (!days[cur.toDateString()]) cur.setDate(cur.getDate() - 1);
    while (days[cur.toDateString()]) { streak++; cur.setDate(cur.getDate() - 1); }
    var f = function (v, u, l) { return '<div><b class="cifra">' + v + (u ? '<small>' + u + '</small>' : '') + '</b><span>' + l + '</span></div>'; };
    var el = $('#yoFigs'); if (el) el.innerHTML = f(Math.round(km).toLocaleString('es-ES'), 'km', 'Km totales') + f(n, '', 'Rutas') + f(streak, streak === 1 ? 'día' : 'días', 'Racha');
    var vs = A.vehicles() || [], v = vs.filter(function (x) { return x.principal; })[0] || vs[0], due = [], soon = [];
    try { (A.maintDue ? A.maintDue() : []).forEach(function (x) { if (x.st === 'due') due.push(x); else if (x.st === 'soon') soon.push(x); }); } catch (e) {}
    var docs = window.RGGarage && RGGarage.dueSoon ? RGGarage.dueSoon() : [];
    var bt = $('#yoBikeT'), dot = $('#yoBikeDot');
    if (bt) bt.textContent = v ? v.name + ' · ' + (due.length ? due[0].m.name + ' vencido' : docs.length ? docs[0] : soon.length ? soon[0].m.name + ' pronto' : 'todo al día') : 'Añade tu moto';
    if (dot) dot.hidden = !(due.length || soon.length || docs.length);
    var st = $('#yoSecT'), cs = contacts(); if (st) st.textContent = (soloOn() ? 'Voy solo activado' : 'Voy solo apagado') + ' · ' + (cs.length ? cs.length + (cs.length === 1 ? ' contacto' : ' contactos') : 'sin contactos');
  }
  /* ---------- Mi moto: la ficha larga se parte en Resumen, Taller, Papeles y Gastos ---------- */
  var MT = { tab: 'resumen', v: 0 };
  function moto() {
    var view = $('#view-garage'), host = $('#vehicles'); if (!view || !host) return;
    var cards = $$('.vehicle', host), bar = $('#gaTabs');
    if (!bar) { bar = document.createElement('div'); bar.id = 'gaTabs'; bar.className = 'as-tabs'; host.parentNode.insertBefore(bar, host); }
    var pick = $('#gaPick'); if (!pick) { pick = document.createElement('div'); pick.id = 'gaPick'; pick.className = 'pills'; host.parentNode.insertBefore(pick, bar); }
    bar.hidden = !cards.length; pick.hidden = cards.length < 2;
    if (MT.v >= cards.length) MT.v = 0;
    pick.innerHTML = cards.map(function (c, i) { return '<button class="pill" type="button" data-v="' + i + '" aria-pressed="' + (i === MT.v) + '">' + esc(($('.name', c) || {}).textContent || 'Moto') + '</button>'; }).join('');
    $$('button', pick).forEach(function (b) { b.addEventListener('click', function () { MT.v = +b.dataset.v; moto(); }); });
    bar.innerHTML = [['resumen', 'Resumen'], ['taller', 'Taller'], ['papeles', 'Papeles'], ['gastos', 'Gastos']].map(function (t) { return '<button type="button" data-t="' + t[0] + '" aria-pressed="' + (t[0] === MT.tab) + '">' + t[1] + '</button>'; }).join('');
    $$('button', bar).forEach(function (b) { b.addEventListener('click', function () { MT.tab = b.dataset.t; moto(); }); });
    host.dataset.tab = MT.tab;
    cards.forEach(function (c, i) {
      c.hidden = i !== MT.v; if (i !== MT.v) return;
      var gx = $('.gx', c), g = 'papeles';
      if (gx) Array.prototype.forEach.call(gx.children, function (el) {
        if (el.classList.contains('as-gen')) return;
        var lab = (($('.label', el) || {}).textContent || '').toLowerCase();
        if (el.classList.contains('gx-h')) g = /document/.test(lab) ? 'papeles' : /repost|gasto/.test(lab) ? 'gastos' : 'resumen';
        if (el.classList.contains('gx-stolen')) g = 'resumen';
        el.dataset.g = g;
      });
      $$('.as-gen', c).forEach(function (x) { x.remove(); });
      var add = function (tab, html, where) { var d = document.createElement('div'); d.className = 'as-gen'; d.dataset.g = tab; d.innerHTML = html; (where || gx || c).appendChild(d); return d; };
      var click = function (sel) { return function () { var b = $(sel, c); if (b) b.click(); }; };
      if (gx) {
        // Resumen: estado (taller y papeles) y el botón de repostar
        var ms = $('.mhead .mstatus', c), docs = $$('.gx-row', gx);
        var st = add('resumen', '<div class="as-rows">' + (ms ? '<div class="as-row"><span><b>Taller</b></span><i class="as-tag' + (/al día/.test(ms.textContent) ? '' : ' amber') + '">' + esc(ms.textContent.trim()) + '</i></div>' : '') + docs.map(function (d) { var m = $('.mstatus', d); return '<div class="as-row"><span><b>' + esc(($('b', d) || {}).textContent || '') + '</b><small>' + esc(($('small', d) || {}).textContent || '') + '</small></span>' + (m ? '<i class="as-tag' + (/al día/.test(m.textContent) ? '' : ' amber') + '">' + esc(m.textContent.trim()) + '</i>' : '') + '</div>'; }).join('') + '</div><button class="btn big primary" type="button" data-k="fuel">Apuntar repostaje</button>');
        gx.insertBefore(st, gx.firstChild); $('[data-k=fuel]', st).addEventListener('click', click('[data-gx=fuel]'));
        var f = $('.gx-figs', gx); if (f) { var cp = add('resumen', '<div class="gx-figs">' + f.innerHTML + '</div>'); gx.insertBefore(cp, st.nextSibling); }
        var pa = add('papeles', (docs.length ? '' : '<div class="empty"><b>Sin vencimientos</b>Apunta la ITV, el seguro o el permiso y te aviso 30 y 7 días antes.</div>') + '<p class="muted rg-small" style="text-align:left;margin:0">Avisos a 30 y a 7 días. La foto del documento se queda en este teléfono.</p><button class="btn big primary" type="button" data-k="doc">Añadir vencimiento</button>');
        $('[data-k=doc]', pa).addEventListener('click', click('[data-gx=doc]'));
        var ga = add('gastos', '<button class="btn big primary" type="button" data-k="fuel">Repostaje</button><button class="btn" type="button" data-k="cost">Otro gasto</button>');
        $('[data-k=fuel]', ga).addEventListener('click', click('[data-gx=fuel]')); $('[data-k=cost]', ga).addEventListener('click', click('[data-gx=cost]'));
      }
    });
  }
  var motoT = 0, vh = $('#vehicles');
  if (vh && window.MutationObserver) new MutationObserver(function (m) {
    // lo que pone y quita moto() (los bloques .as-gen) no cuenta: si contara, se repintaría sin parar
    var gen = function (n) { return n.nodeType !== 1 || n.classList.contains('as-gen'); }, all = function (l) { return Array.prototype.every.call(l, gen); };
    if (m.every(function (x) { return (x.target.closest && x.target.closest('.as-gen')) || (all(x.addedNodes) && all(x.removedNodes)); })) return;
    clearTimeout(motoT); motoT = setTimeout(moto, 120);
  }).observe(vh, { childList: true, subtree: true });

  /* ---------- Estadísticas: Cifras, Metas y Logros ---------- */
  var stTab = 'cifras';
  function stats(t) {
    if (t) stTab = t;
    $$('#stTabs button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.t === stTab)); });
    $$('#view-stats [data-pane]').forEach(function (p) { p.hidden = p.dataset.pane !== stTab; });
    var tot = $('#achTotal'); if (tot) { var c = ($('#achCount').textContent || '').split('/'); tot.innerHTML = '<div><b class="cifra">' + esc((c[0] || '0').trim()) + '<small>de ' + esc((c[1] || '').trim()) + '</small></b><span>Conseguidos</span></div><div><b class="cifra">' + esc(($('#profileXp').textContent || '0').replace(/\s*XP/, '')) + '<small>XP</small></b><span>Experiencia</span></div><div><b class="cifra">' + esc((($('#levelPill').textContent || '').match(/\d+/) || ['1'])[0]) + '</b><span>' + esc(($('#levelPill').textContent || '').split('·')[1] || 'Nivel') + '</span></div>'; }
  }
  $$('#stTabs button').forEach(function (b) { b.addEventListener('click', function () { stats(b.dataset.t); }); });

  /* ---------- Ajustes en tres secciones; lo demás se reparte entre Seguridad y Ayuda ---------- */
  var setV = $('#view-settings'), secNow = 'marcha';
  function labelOf(el) { return (($('.label', el) || {}).textContent || '').toLowerCase(); }
  function secOf(el) {
    if (el.id === 'setSecs' || el.classList.contains('head')) return '';
    if (el.dataset && el.dataset.sec) return el.dataset.sec;
    var lab = labelOf(el);
    if (el.id === 'rgPerms' || el.id === 'rgNoti' || /fotógraf/.test(lab)) return 'avisos';
    if (el.classList.contains('rg-fields') || el.classList.contains('rg-music-set')) return 'marcha';
    return 'cuenta';
  }
  function sort() {
    if (!setV) return;
    var help = $('#helpBody'), sec = $('#secBody');
    Array.prototype.slice.call(setV.children).forEach(function (el) {
      var lab = labelOf(el);
      if (el.id === 'rgPrivBox') { el.remove(); return; }
      if (/personas que no ves/.test(lab) && sec) { el.dataset.sec = 'x'; el.classList.add('as-hidden-people'); sec.appendChild(el); return; }
      if (help && (el.id === 'about' || el.classList.contains('help') || /quién hace/.test(lab))) { help.appendChild(el); return; }
    });
    Array.prototype.forEach.call(setV.children, function (el) { var s = secOf(el); if (s) el.classList.toggle('rg-sec-off', s !== secNow); });
    $$('#setSecs button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.s === secNow)); });
  }
  if (setV) {
    $$('#setSecs button').forEach(function (b) { b.addEventListener('click', function () { secNow = b.dataset.s; sort(); }); });
    if (window.MutationObserver) new MutationObserver(function () { sort(); }).observe(setV, { childList: true });
    sort();
  }
  /* ---------- Seguridad ---------- */
  function security() {
    var body = $('#secBody'); if (!body) return;
    var solo = $('#secSolo'); if (!solo) { solo = document.createElement('div'); solo.id = 'secSolo'; solo.className = 'as-col'; body.insertBefore(solo, body.firstChild); }
    if (window.RGSolo && RGSolo.pane) RGSolo.pane(solo); else solo.innerHTML = '';
    var pv = $('#secPriv'); if (!pv) { pv = document.createElement('div'); pv.id = 'secPriv'; pv.className = 'as-col'; body.insertBefore(pv, solo.nextSibling); }
    if (window.RGShell && RGShell.privHtml) { pv.innerHTML = '<span class="label">Zona de privacidad</span><p class="muted" style="margin:0;text-align:left">Recorta el principio y el final de las rutas que publicas, para que no se vea de dónde sales ni dónde acabas.</p>' + RGShell.privHtml(); RGShell.privBind(pv); }
  }
  /* ---------- Ayuda ---------- */
  function help() {
    var nav = $('#helpNav'), body = $('#helpBody'); if (!nav || !body) return;
    sort();
    if (!nav.dataset.ok) {
      nav.dataset.ok = '1';
      var row = function (id, i, t, sub) { return '<button type="button" data-h="' + id + '">' + ic(i) + '<span><b>' + t + '</b><small>' + sub + '</small></span>' + ic('chev') + '</button>'; };
      nav.innerHTML = row('tour', 'play', 'Cómo funciona', 'Repite el recorrido de diez pasos') + row('fb', 'chat', 'Sugerencias y fallos', 'Escríbele a quien hace la app') + row('demo', 'route', 'Ruta simulada', 'Prueba la app sin moverte');
      $$('[data-h]', nav).forEach(function (b) { b.addEventListener('click', function () {
        var k = b.dataset.h;
        if (k === 'tour') { A.showView('map'); if (window.RGTour) RGTour.start(); }
        else if (k === 'fb') Cl.openFeedback();
        else if (k === 'diag') { var d = $('#helpDiag'); if (d) { d.open = !d.open; if (d.open) d.scrollIntoView({ block: 'start' }); } }
        else if (k === 'demo') { var dm = $('#btnDemo'); if (dm) dm.click(); A.showView('map'); }
        else if (k === 'who') { var w = $('#helpWho'); if (w) { w.open = !w.open; if (w.open) w.scrollIntoView({ block: 'start' }); } }
      }); });
    }
    // lo que venía de Ajustes se recoge en bloques plegados
    Array.prototype.slice.call(body.children).forEach(function (el) {
      if (el.tagName === 'DETAILS' || el.id === 'helpVer') return;
      var lab = labelOf(el), fold = function (id, title) { var d = $('#' + id); if (!d) { d = document.createElement('details'); d.id = id; d.className = 'as-fold'; d.innerHTML = '<summary>' + title + '</summary>'; body.appendChild(d); } d.appendChild(el); };
      if ($('#diag', el)) fold('helpDiag', 'Diagnóstico de sensores');
      else if (/quién hace/.test(lab)) fold('helpWho', 'Quién hace la app');
      else if (el.id === 'about') fold('helpAbout', 'Acerca de ReGroupRide');
      else el.hidden = true;                                   // «Cómo funciona» en prosa: ahora es el recorrido
    });
    var ver = $('#helpVer'); if (!ver) { ver = document.createElement('p'); ver.id = 'helpVer'; ver.className = 'muted rg-small'; body.appendChild(ver); }
    ver.textContent = 'ReGroupRide · versión ' + (A.version || '');
  }
  document.addEventListener('rg:view', function (e) {
    var v = e.detail;
    if (v === 'garage') setTimeout(moto, 50); if (v === 'profile') yo(); else if (v === 'stats') setTimeout(function () { stats(); }, 0); else if (v === 'settings') sort(); else if (v === 'security') security(); else if (v === 'help') help();
  });
  setTimeout(function () { yo(); help(); }, 3000);

  /* ---------- idioma y unidades (Ajustes › En marcha) ---------- */
  (function () {
    var I = window.RGI18N; if (!I) return;
    $$('#unitSeg button').forEach(function (b) { b.setAttribute('aria-pressed', String((b.dataset.u === 'mi') === I.mi)); b.addEventListener('click', function () { I.setUnits(b.dataset.u); }); });
    $$('#langSeg button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.l === I.lang)); b.addEventListener('click', function () { I.setLang(b.dataset.l); }); });
  })();

  /* Pestañas de dentro: el contenido nuevo entra desde el lado hacia el que se va.
     La entrada se ata al momento en que el contenido CAMBIA de verdad, no al toque: si se lanzara al tocar, el contenido nuevo
     se vería un instante ya colocado y luego «saltaría» al inicio de la animación (el pantallazo), y lo que llega del servidor
     aparecería de golpe a media entrada. Mientras algo se está cargando, el hueco espera vacío y entra todo junto. */
  var TAB = null;
  function tabPanes(t) {
    var nb = t.id ? document.getElementById(t.id) : t.bar, out = []; if (!nb || !nb.isConnected) return out;
    for (var el = nb.nextElementSibling; el; el = el.nextElementSibling) {
      if (el.hidden || el.classList.contains('as-fixed') || el.classList.contains('as-legacy') || getComputedStyle(el).display === 'none') continue;
      out.push(el);
    }
    return out;
  }
  function tabSig(t) { return tabPanes(t).map(function (e) { return (e.id || e.className) + ':' + e.innerHTML.length + ':' + (e.dataset.tab || ''); }).join('|'); }
  function tabEnd(t) { if (t.obs) t.obs.disconnect(); clearTimeout(t.timer); clearTimeout(t.soft); if (TAB === t) TAB = null; }
  function tabGo(t, force) {
    if (t.done) return; var ps = tabPanes(t); if (!ps.length) return;
    if (!force && ps.some(function (p) { return p.querySelector('.rg-load'); })) {
      if (!t.shown) ps.forEach(function (p) { p.classList.add('rg-tab-wait'); }); t.waiting = true;
      // si lo que falta es solo un trozo (el tiempo, las etapas) y lo principal ya está, no se espera más de 0,3 s
      var rest = ps.reduce(function (n, p) { var c = p.cloneNode(true); Array.prototype.forEach.call(c.querySelectorAll('.rg-load'), function (x) { x.remove(); }); return n + c.textContent.replace(/\s+/g, '').length; }, 0);
      if (rest > 40 && !t.soft) t.soft = setTimeout(function () { tabGo(t, true); }, 300);
      return;
    }
    t.done = true; tabEnd(t);
    $$('.rg-tab-wait').forEach(function (p) { if (ps.indexOf(p) < 0) p.classList.remove('rg-tab-wait'); });
    ps.forEach(function (p) {
      p.classList.remove('rg-tab-l', 'rg-tab-r'); void p.offsetWidth; p.classList.add('rg-tab-' + t.dir); p.classList.remove('rg-tab-wait');
      setTimeout(function () { p.classList.remove('rg-tab-l', 'rg-tab-r'); }, 560);
    });
  }
  document.addEventListener('click', function (ev) {                    // antes de que la pestaña haga nada: se anota cómo está
    var b = ev.target.closest && ev.target.closest('.as-tabs button, #trTabs button, #phTabs button'); if (!b || b.disabled) return;
    var bar = b.parentNode, btns = Array.prototype.slice.call(bar.children), cur = -1, i = btns.indexOf(b);
    btns.forEach(function (x, k) { if (x.getAttribute('aria-pressed') === 'true' || x.getAttribute('aria-selected') === 'true') cur = k; });
    if (i === cur || !bar.parentNode) return;
    if (TAB) { var old = TAB; tabEnd(old); $$('.rg-tab-wait').forEach(function (p) { p.classList.remove('rg-tab-wait'); }); }
    var t = TAB = { bar: bar, id: bar.id, dir: i > cur ? 'l' : 'r', done: false, waiting: false };
    t.sig = tabSig(t);
    if (window.MutationObserver) {
      t.obs = new MutationObserver(function () { if (t.waiting || tabSig(t) !== t.sig) tabGo(t, false); });
      t.obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'data-tab'] });      // todo el documento: hay pantallas que se redibujan enteras al cambiar de pestaña
    }
    // Si a los 0,7 s sigue cargando, se deja ver el «Cargando…» y se sigue esperando: lo que llegue después entrará con su movimiento.
    t.timer = setTimeout(function () {
      $$('.rg-tab-wait').forEach(function (p) { p.classList.remove('rg-tab-wait'); });
      if (!t.waiting || t.done) { tabEnd(t); return; }
      t.shown = true; t.timer = setTimeout(function () { tabEnd(t); }, 9000);
    }, 700);
  }, true);
  document.addEventListener('click', function () {                      // después de que la pestaña haya hecho lo suyo, en el mismo instante
    var t = TAB; if (t && !t.done && (t.waiting || tabSig(t) !== t.sig)) tabGo(t, false);
  });
  /* Deslizar para borrar (Rutas › Hechas y Planeadas): se arrastra la fila hacia la izquierda; al soltarla pasada la mitad del botón
     se quita de la lista y sale «Deshacer» durante 5 segundos. Solo entonces se borra de verdad. */
  (function () {
    var host = $('#view-rides'); if (!host) return;
    var row = null, x0 = 0, y0 = 0, dx = 0, lock = null, pending = null;
    var flush = function () { if (!pending) return; var p = pending; pending = null; clearTimeout(p.t); (p.kind === 'ride' ? A.removeRide(p.id) : A.removePlan(p.id)).catch(function () {}); };
    host.addEventListener('touchstart', function (ev) {
      var r = ev.target.closest('[data-ride],[data-plan]'); if (!r || ev.touches.length !== 1) return;
      row = r; x0 = ev.touches[0].clientX; y0 = ev.touches[0].clientY; dx = 0; lock = null; row.style.transition = 'none';
    }, { passive: true });
    host.addEventListener('touchmove', function (ev) {
      if (!row) return; var t = ev.touches[0], ax = t.clientX - x0, ay = t.clientY - y0;
      if (lock == null) { if (Math.abs(ax) < 8 && Math.abs(ay) < 8) return; lock = Math.abs(ax) > Math.abs(ay) * 1.3 && ax < 0 ? 'x' : 'y'; if (lock === 'x') row.classList.add('as-swiping'); }
      if (lock !== 'x') return;
      dx = Math.min(0, ax); row.style.transform = 'translateX(' + dx + 'px)'; row.classList.toggle('as-swipe-go', dx < -110);
    }, { passive: true });
    var end = function () {
      if (!row) return; var r = row, go = lock === 'x' && dx < -110; row = null;
      r.style.transition = 'transform .2s ease-out, opacity .2s linear';
      if (!go) { r.style.transform = ''; setTimeout(function () { r.classList.remove('as-swiping', 'as-swipe-go'); r.style.transition = ''; }, 220); if (lock === 'x') r.addEventListener('click', function stop(e) { e.stopPropagation(); e.preventDefault(); r.removeEventListener('click', stop, true); }, true); return; }
      flush();                                              // si había otra pendiente, se borra ya
      r.style.transform = 'translateX(-110%)'; r.style.opacity = '0';
      var kind = r.dataset.ride ? 'ride' : 'plan', id = r.dataset.ride || r.dataset.plan;
      setTimeout(function () { r.hidden = true; }, 210);
      pending = { kind: kind, id: kind === 'ride' ? +id : id, t: setTimeout(flush, 5200) };
      snack(kind === 'ride' ? 'Ruta borrada' : 'Ruta planeada borrada', 'Deshacer', function () { if (!pending) return; clearTimeout(pending.t); pending = null; r.hidden = false; r.style.opacity = ''; r.style.transform = ''; r.classList.remove('as-swiping', 'as-swipe-go'); }, 5000);
    };
    host.addEventListener('touchend', end); host.addEventListener('touchcancel', end);
    document.addEventListener('rg:view', flush); window.addEventListener('pagehide', flush);
  })();

  window.RGUI = UI;
  UI.beforeStart = beforeStart; UI.who = who; UI.near = near; UI.snack = snack; UI.draw = draw; UI.sync = sync; UI.ruTab = ruTab; UI.yo = yo;
  sync();
})();
