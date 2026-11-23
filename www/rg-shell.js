/* ReGroupRide — la estructura de cinco pestañas: Yo (perfil, estadísticas y ajustes por secciones), Explorar
   (planificar, fotógrafos, rutas de mis comunidades y el botón «Crear»), la campana de avisos y chats, y el resumen
   «Hoy» del mapa en reposo. No guarda nada en el servidor: reúne lo que ya hay en cada módulo. */
(function () {
  'use strict';
  var A = window.RGApp, Cl = window.RGCloud; if (!A || !Cl) return;
  var sb = Cl.sb, $ = function (s, r) { return (r || document).querySelector(s); }, $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function ic(n) { return '<svg><use href="#i-' + n + '"/></svg>'; }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; }
  function head(t) { return '<div class="head"><h1>' + t + '</h1><button class="btn small icon" id="shX" type="button" title="Cerrar">' + ic('close') + '</button></div>'; }
  function openSheet(html) { var s = Cl.sheet(html); $('#shX', s).addEventListener('click', Cl.closeSheet); return s; }
  function when(ms) { var d = new Date(ms), n = new Date(), day = d.toDateString() === n.toDateString() ? 'Hoy' : d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\.|,/g, ''); return day + ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }); }
  function ago(ms) { var m = Math.max(0, Math.round((Date.now() - ms) / 60000)); return m < 1 ? 'ahora' : m < 60 ? 'hace ' + m + ' min' : m < 1440 ? 'hace ' + Math.round(m / 60) + ' h' : 'hace ' + Math.round(m / 1440) + ' d'; }
  function mine() { return (window.RGClub && RGClub.mine ? RGClub.mine() : []).filter(function (e) { return e.starts_at > Date.now() - 6 * 36e5; }).sort(function (a, b) { return a.starts_at - b.starts_at; }); }
  function clubs() { return (window.RGClub && RGClub.state && RGClub.state.list) || []; }

  /* ---------- Yo: estadísticas y ajustes cuelgan de aquí ---------- */
  if ($('#yoStats')) $('#yoStats').addEventListener('click', function () { A.showView('stats'); });
  if ($('#yoSettings')) $('#yoSettings').addEventListener('click', function () { A.showView('settings'); });
  $$('[data-yo]').forEach(function (b) { b.addEventListener('click', function () { A.showView('profile'); }); });

  /* ---------- Ajustes en cinco secciones: cada bloque de la pantalla cae en la suya ---------- */
  var setV = $('#view-settings'), secNow = 'cuenta';
  function secOf(el) {
    if (el.tagName === 'H1' || el.id === 'setSecs' || el.classList.contains('head')) return '';
    var lab = (($('.label', el) || {}).textContent || '').toLowerCase();
    if (el.id === 'rgPerms' || el.id === 'rgNoti' || /fotógraf/.test(lab)) return 'avisos';
    if (el.classList.contains('rg-fields') || el.classList.contains('rg-music-set')) return 'marcha';
    if (el.classList.contains('actions') || /no ves|privacidad/.test(lab)) return 'priv';
    if (el.classList.contains('help') || /quién hace/.test(lab)) return 'ayuda';
    return 'cuenta';
  }
  function secPaint() {
    if (!setV) return;
    Array.prototype.forEach.call(setV.children, function (el) { var s = secOf(el); if (s) el.classList.toggle('rg-sec-off', s !== secNow); });
    $$('#setSecs button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.s === secNow)); });
  }
  if (setV) {
    $$('#setSecs button').forEach(function (b) { b.addEventListener('click', function () { secNow = b.dataset.s; secPaint(); setV.scrollTop = 0; }); });
    // «Ruta simulada» es una herramienta de diagnóstico: va con la ayuda, bajo «Algo no funciona»
    var demo = $('#btnDemo'), diag = $('#diag');
    if (demo && diag) { var hp = diag.parentNode, lb = $('.label', hp); if (lb) lb.textContent = 'Algo no funciona'; var p = document.createElement('p'); p.className = 'muted rg-small'; p.textContent = 'Estos datos sirven para saber si los sensores y el GPS del teléfono responden. Con la ruta simulada pruebas la app sin moverte.'; hp.insertBefore(p, diag); demo.classList.remove('wide'); hp.appendChild(demo); }
    if (window.MutationObserver) new MutationObserver(secPaint).observe(setV, { childList: true });
    document.addEventListener('rg:view', function (e) { if (e.detail === 'settings') secPaint(); });
    secPaint();
  }
  // privacidad: un texto corto para que la sección no quede en un solo botón rojo
  (function () {
    var act = $('#btnWipe'); if (!act) return; act = act.parentNode;
    var box = document.createElement('div'); box.className = 'rg-maker'; box.id = 'rgPrivBox';
    box.innerHTML = '<span class="label">Privacidad</span><p class="muted" style="margin:0">Las rutas que grabas se quedan en este teléfono. Tu posición solo se comparte con tu grupo en vivo mientras ruedas, y con quien tú elijas.</p>';
    act.parentNode.insertBefore(box, act);
  })();

  /* ---------- Explorar ---------- */
  function plan() { A.showView('map'); var b = $('#btnPlan'); if (b && b.getAttribute('aria-pressed') !== 'true') b.click(); }
  if ($('#exPlan')) $('#exPlan').addEventListener('click', plan);
  if ($('#exPhoto')) $('#exPhoto').addEventListener('click', function () { if (window.RGPhoto) RGPhoto.open('spots'); });
  // Un solo botón «Crear»: ruta, salida o viaje
  function plus(ev) {
    var fromClub = !!(ev && ev.currentTarget && ev.currentTarget.id === 'clPlus');
    var cl = clubs(), admin = !!(window.RGClub && RGClub.api && RGClub.api.cur() && RGClub.api.isAdmin());
    var s = openSheet(head('Crear') +
      '<button class="club-card rg-pick" type="button" data-k="plan">' + ic('route') + '<span><b>Una ruta</b><span class="muted">Traza por dónde quieres ir y guárdala.</span></span></button>' +
      '<button class="club-card rg-pick" type="button" data-k="ev">' + ic('cal') + '<span><b>Una salida</b><span class="muted">' + (admin ? 'Día, hora y punto de encuentro para tu comunidad.' : cl.length ? 'Las salidas las publican los administradores de la comunidad.' : 'Antes hay que entrar en una comunidad o crear la tuya.') + '</span></span></button>' +
      '<button class="club-card rg-pick" type="button" data-k="trip">' + ic('map') + '<span><b>Un viaje</b><span class="muted">' + (admin && fromClub ? 'Varios días, publicado en la comunidad, con etapas y gastos.' : 'Varios días entre amigos, con etapas, alojamiento y gastos.') + '</span></span></button>');
    $$('[data-k]', s).forEach(function (b) { b.addEventListener('click', function () {
      var k = b.dataset.k; Cl.closeSheet();
      if (k === 'plan') plan();
      else if (k === 'trip') { if (window.RGTrips) RGTrips.create(admin && fromClub ? RGClub.api.cur().id : null); }
      else if (!window.RGClub || !RGClub.newEvent()) { A.showView('club'); if (cl.length) A.toast('Las salidas las crea un administrador de la comunidad.', 'warn'); }
    }); });
  }
  ['#exPlus', '#clPlus'].forEach(function (id) { var b = $(id); if (b) b.addEventListener('click', plus); });

  // Rutas de los catálogos de mis comunidades, todas juntas y con el mismo buscador
  var CAT = { at: 0, rows: null };
  function catDraw(list, q) {
    var cl = clubs(), nm = {}; cl.forEach(function (c) { nm[c.id] = c.name; });
    q = (q || '').trim().toLowerCase();
    var rows = (CAT.rows || []).filter(function (r) { return !q || (r.name + ' ' + (r.start_name || '') + ' ' + (nm[r.community_id] || '')).toLowerCase().indexOf(q) >= 0; });
    if (!rows.length) { list.innerHTML = '<div class="empty">' + (cl.length ? (q ? 'Ninguna ruta coincide.' : 'Tus comunidades aún no han guardado rutas en su catálogo.') : 'Entra en una comunidad para ver las rutas que comparte.') + '</div>'; return; }
    list.innerHTML = rows.map(function (r) {
      return '<button class="club-card rg-cat" type="button" data-c="' + r.community_id + '"><b>' + esc(r.name) + '</b><span class="muted">' + esc(nm[r.community_id] || 'Comunidad') + (r.start_name ? ' · sale de ' + esc(r.start_name) : '') + '</span>' +
        '<span class="rt-meta">' + (r.dist ? '<span>' + ic('route') + Math.round(r.dist) + ' km</span>' : '') + (r.dur ? '<span>' + ic('clock') + Math.floor(r.dur / 3600) + ' h ' + Math.round(r.dur % 3600 / 60) + ' min</span>' : '') + (r.level ? '<span>' + esc(({ facil: 'Fácil', media: 'Media', exigente: 'Exigente' })[r.level] || r.level) + '</span>' : '') + '</span></button>';
    }).join('');
    $$('[data-c]', list).forEach(function (b) { b.addEventListener('click', function () { if (window.RGClub) RGClub.catalog(b.dataset.c, nm[b.dataset.c] || ''); }); });
  }
  function catalog(list, q) {
    var ids = clubs().map(function (c) { return c.id; });
    if (CAT.rows && Date.now() - CAT.at < 120000) { catDraw(list, q); return; }
    if (!sb || !Cl.user() || !ids.length) { CAT.rows = []; catDraw(list, q); return; }
    list.innerHTML = '<div class="empty">Cargando…</div>';
    sb.from('community_routes').select('id,community_id,name,kind,level,start_name,dist,dur,created_at').in('community_id', ids).order('created_at', { ascending: false }).limit(200).then(function (r) {
      CAT.rows = r.error ? [] : (r.data || []); CAT.at = Date.now(); if ($('#ridesFilters [data-f=catalog]').getAttribute('aria-pressed') === 'true') catDraw(list, q);
    }, function () { list.innerHTML = '<div class="empty">No se ha podido cargar. Revisa la conexión.</div>'; });
  }

  /* ---------- campana: todo lo no leído en un sitio ---------- */
  var B = { key: null, items: [], at: 0, busy: false };
  var PH = { at: 0, n: 0, place: '' };
  function seen() { var v = +store('rg.bell.seen'); if (!v) { v = Date.now() - 2 * 864e5; store('rg.bell.seen', String(v)); } return v; }
  function unread() { var s = seen(), me = Cl.user(); return B.items.filter(function (x) { return x.at > s; }).length; }
  function badge() {
    var n = unread() + mine().filter(function (e) { return e.status === 'offered'; }).length;
    $$('.rg-bell-n').forEach(function (i) { i.hidden = !n; i.textContent = n > 9 ? '9+' : String(n); });
    today();
  }
  function bellLoad(force) {
    if (!sb || !Cl.user() || B.busy) return Promise.resolve();
    if (!force && Date.now() - B.at < 60000) return Promise.resolve();
    B.busy = true; B.at = Date.now();
    var k = B.key ? Promise.resolve(B.key) : sb.rpc('news_key').then(function (r) { if (r.error || !r.data) throw new Error('sin clave'); B.key = r.data; return B.key; });
    return k.then(function (key) { return sb.rpc('community_news', { p_key: key, p_since: new Date(Date.now() - 21 * 864e5).toISOString() }); }).then(function (r) {
      B.busy = false; if (r.error || !r.data) return;
      B.items = (r.data.items || []).slice().sort(function (a, b) { return b.at - a.at; }); badge();
    }, function () { B.busy = false; });
  }
  function itemGo(x) {
    var id = String(x.id || ''), cl = clubs().filter(function (c) { return c.name === x.community; })[0];
    Cl.closeSheet();
    if (x.event) { var e = mine().filter(function (m) { return m.id === x.event; })[0]; if (e && window.RGClub) { RGClub.chat(e); return; } }
    if (/^fb/.test(id)) { Cl.openFeedback(); return; }
    if (/^ph/.test(id)) { if (window.RGPhoto) RGPhoto.open('spots'); return; }
    if (!window.RGClub) return;
    RGClub.goto(cl ? cl.id : null, /^grp-/.test(id) ? 'groups' : x.kind === 'post' ? 'board' : x.kind === 'page' ? 'pages' : /^req|^join/.test(id) ? 'members' : 'events');
  }
  function bellOpen() {
    var s0 = seen(), ev = mine(), cl = clubs();
    var KI = { event: 'cal', post: 'list', page: 'info', note: 'bell', call: 'people' }, KT = { event: 'Nueva salida', post: 'Tablón', page: 'Info' };
    var news = B.items.slice(0, 30).map(function (x, i) {
      return '<button class="rg-bl' + (x.at > s0 ? ' new' : '') + '" type="button" data-i="' + i + '">' + ic(KI[x.kind] || 'bell') + '<span><b>' + esc(x.head || KT[x.kind] || 'Aviso') + '</b><span>' + esc(x.title || '') + '</span><small>' + esc(x.community || '') + ' · ' + ago(x.at) + '</small></span></button>';
    }).join('');
    var offered = ev.filter(function (e) { return e.status === 'offered'; }).map(function (e) { return '<button class="rg-bl new" type="button" data-off="' + e.id + '">' + ic('check') + '<span><b>Tienes una plaza</b><span>' + esc(e.title) + '</span><small>' + esc(e.community || '') + ' · contesta cuanto antes</small></span></button>'; }).join('');
    var chats = ev.filter(function (e) { return e.status !== 'offered'; }).slice(0, 8).map(function (e) { return '<button class="rg-bl" type="button" data-chat="' + e.id + '">' + ic('people') + '<span><b>' + esc(e.title) + '</b><small>Chat de la salida · ' + esc(when(e.starts_at)) + '</small></span></button>'; }).join('') +
      cl.map(function (c) { return '<button class="rg-bl" type="button" data-talk="' + c.id + '">' + ic('list') + '<span><b>' + esc(c.name) + '</b><small>Charlas de la comunidad</small></span></button>'; }).join('');
    var s = openSheet(head('Avisos y chats') +
      (Cl.user() ? '' : '<p class="muted">Entra en tu cuenta para ver tus avisos.</p>') +
      '<span class="label">Avisos</span><div class="rg-bls">' + (offered + news || '<div class="empty">No tienes avisos nuevos.</div>') + '</div>' +
      (chats ? '<span class="label">Chats</span><div class="rg-bls">' + chats + '</div>' : ''));
    $$('[data-i]', s).forEach(function (b) { b.addEventListener('click', function () { itemGo(B.items[+b.dataset.i]); }); });
    $$('[data-off]', s).forEach(function (b) { b.addEventListener('click', function () { Cl.closeSheet(); if (window.RGClub) RGClub.goto(null, 'events'); }); });
    $$('[data-chat]', s).forEach(function (b) { b.addEventListener('click', function () { var e = ev.filter(function (m) { return m.id === b.dataset.chat; })[0]; if (e && window.RGClub) RGClub.chat(e); }); });
    $$('[data-talk]', s).forEach(function (b) { b.addEventListener('click', function () { Cl.closeSheet(); if (window.RGClub) RGClub.goto(b.dataset.talk, 'groups'); }); });
    store('rg.bell.seen', String(Date.now())); badge();
    bellLoad(true);
  }
  $$('#btnBell, [data-bell]').forEach(function (b) { b.addEventListener('click', bellOpen); });
  setInterval(function () { if (document.visibilityState !== 'hidden') bellLoad(false).then(badge); }, 90000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') setTimeout(function () { bellLoad(false); }, 1500); });
  document.addEventListener('rg:view', function (e) { if (e.detail === 'map') { bellLoad(false); today(); } });
  if (Cl.onChange) Cl.onChange(function (u) { B.key = null; B.items = []; B.at = 0; CAT.rows = null; if (u) setTimeout(function () { bellLoad(true); }, 2500); else badge(); });

  /* ---------- «Hoy»: lo que tienes por delante, en el mapa en reposo. Lo que no haya, no sale. ---------- */
  function photoCheck() {
    if (!sb || !Cl.user() || Date.now() - PH.at < 10 * 60000) return; PH.at = Date.now();
    var f = A.anyFix && A.anyFix(); if (!f) { PH.at = Date.now() - 9 * 60000; return; }
    sb.rpc('photo_list', { p_lat: f.lat, p_lon: f.lon }).then(function (r) {
      if (r.error || !r.data) return; var now = Date.now(), end = new Date(); end.setHours(23, 59, 59, 0);
      var near = (r.data.spots || []).filter(function (s) { return s.km != null && s.km <= 40 && s.ends_at > now && s.starts_at < +end; });
      PH.n = near.length; PH.place = near.length ? near[0].place : ''; today();
    }, function () {});
  }
  function today() {
    var el = $('#rgToday'), tot = $('#idleTotals'); if (!el) return;
    var rows = [], ev = mine(), off = ev.filter(function (e) { return e.status === 'offered'; })[0], next = ev.filter(function (e) { return e.status === 'going' || e.status === 'waiting'; })[0];
    if (off) rows.push({ i: 'check', k: 'off', b: 'Tienes una plaza', t: off.title + ' · contesta cuanto antes', hot: 1 });
    if (next) rows.push({ i: 'cal', k: 'ev', b: next.title, t: when(next.starts_at) + (next.meet_name ? ' · ' + next.meet_name : '') + (next.status === 'waiting' ? ' · en espera' : '') });
    var due = []; try { due = (A.maintDue ? A.maintDue() : []).filter(function (x) { return x.st === 'due'; }); } catch (e) {}
    if (due.length) rows.push({ i: 'wrench', k: 'mt', b: due.length === 1 ? 'Mantenimiento vencido' : due.length + ' mantenimientos vencidos', t: due[0].m.name + ' · ' + (due[0].v.name || 'tu moto'), hot: 1 });
    if (PH.n) rows.push({ i: 'camera', k: 'ph', b: PH.n === 1 ? 'Un fotógrafo cerca hoy' : PH.n + ' fotógrafos cerca hoy', t: PH.place });
    (window.RGToday || []).forEach(function (f) { try { var x = f(); if (x) rows.push(x); } catch (e) {} });
    el.hidden = !rows.length; if (tot) tot.hidden = !!rows.length;
    el.innerHTML = rows.length ? '<span class="label">Hoy</span>' + rows.slice(0, 4).map(function (r, i) { return '<button class="rg-td' + (r.hot ? ' hot' : '') + '" type="button" data-n="' + i + '">' + ic(r.i) + '<span><b>' + esc(r.b) + '</b><small>' + esc(r.t || '') + '</small></span>' + ic('chev') + '</button>'; }).join('') : '';
    $$('[data-n]', el).forEach(function (b) { b.addEventListener('click', function () {
      var r = rows[+b.dataset.n]; if (r.go) { r.go(); return; }
      if (r.k === 'mt') A.showView('garage'); else if (r.k === 'ph') { if (window.RGPhoto) RGPhoto.open('spots'); } else if (window.RGClub) RGClub.goto(r.k === 'ev' && next ? next.community_id : null, 'events');
    }); });
  }
  window.RGToday = window.RGToday || [];
  setTimeout(function () { photoCheck(); today(); }, 6000); setInterval(function () { if (document.visibilityState !== 'hidden') { photoCheck(); today(); } }, 60000);

  window.RGShell = { catalog: catalog, bell: bellOpen, refresh: function () { bellLoad(true); today(); }, today: today, plan: plan };
})();
