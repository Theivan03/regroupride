/* ReGroupRide — piezas comunes: la campana (solo avisos), los no leídos de los chats, la línea «Hoy» del mapa,
   las rutas de los catálogos, las fotos y la zona de privacidad. La organización de pantallas está en rg-ui.js. No guarda nada en el servidor: reúne lo que ya hay en cada módulo. */
(function () {
  'use strict';
  var A = window.RGApp, Cl = window.RGCloud; if (!A || !Cl) return;
  var sb = Cl.sb, $ = function (s, r) { return (r || document).querySelector(s); }, $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function ic(n) { return '<svg><use href="#i-' + n + '"/></svg>'; }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; }
  function head(t) { return '<div class="head"><h1>' + t + '</h1><button class="btn small icon" id="shX" type="button" title="Cerrar">' + ic('close') + '</button></div>'; }
  function openSheet(html, kind) { var s = Cl.sheet(html, kind); $('#shX', s).addEventListener('click', Cl.closeSheet); return s; }
  function when(ms) { var d = new Date(ms), n = new Date(), day = d.toDateString() === n.toDateString() ? 'Hoy' : d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\.|,/g, ''); return day + ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }); }
  function ago(ms) { var m = Math.max(0, Math.round((Date.now() - ms) / 60000)); return m < 1 ? 'ahora' : m < 60 ? 'hace ' + m + ' min' : m < 1440 ? 'hace ' + Math.round(m / 60) + ' h' : 'hace ' + Math.round(m / 1440) + ' d'; }
  function mine() { return (window.RGClub && RGClub.mine ? RGClub.mine() : []).filter(function (e) { return e.starts_at > Date.now() - 6 * 36e5; }).sort(function (a, b) { return a.starts_at - b.starts_at; }); }
  function clubs() { return (window.RGClub && RGClub.state && RGClub.state.list) || []; }

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
  function isChat(x) { return /^chat-|^grp-/.test(String(x.id || '')); }
  function unread() { var s = seen(); return B.items.filter(function (x) { return x.at > s && !isChat(x); }).length; }
  function chatSeen() { var v = +store('rg.chat.seen'); if (!v) { v = Date.now() - 864e5; store('rg.chat.seen', String(v)); } return v; }
  function chatUnread() { var s = chatSeen(); return B.items.filter(function (x) { return x.at > s && isChat(x); }); }
  function badge() {
    var n = unread() + mine().filter(function (e) { return e.status === 'offered'; }).length;
    $$('.rg-bell-n').forEach(function (i) { i.hidden = !n; i.textContent = n > 9 ? '9+' : String(n); });
    var cn = chatUnread().length, tn = $('#tabChatN'); if (tn) { tn.hidden = !cn; tn.textContent = cn > 9 ? '9+' : String(cn); }
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
    if (x.event && window.RGClub && RGClub.openEvent) { RGClub.openEvent(x.event, /^chat-/.test(id) ? 'chat' : 'plan'); return; }
    if (/^solo-/.test(id) && x.token) { window.open('https://regroupride-eventos.netlify.app/seguir.html?s=' + x.token, '_blank'); return; }
    if (/^oacc-/.test(id)) { if (window.RGClub) RGClub.goto(null, 'events'); return; }
    if (/^stl-/.test(id)) { if (window.RGGarage) RGGarage.stolen(); return; }
    if (/^fb/.test(id)) { Cl.openFeedback(); return; }
    if (/^ph/.test(id)) { if (window.RGUI) RGUI.near('fotos'); return; }
    if (/^mt-/.test(id)) { A.showView('garage'); return; }
    if (!window.RGClub) return;
    if (x.kind === 'event' && RGClub.openEvent && /^[0-9a-f-]{8,}$/i.test(id)) { RGClub.openEvent(id); return; }
    RGClub.goto(cl ? cl.id : null, /^grp-/.test(id) || x.kind === 'post' ? 'chats' : x.kind === 'page' || /^req|^join/.test(id) ? 'info' : 'events');
  }
  function bellOpen() {
    var s0 = seen(), ev = mine();
    var KI = { event: 'cal', post: 'bell', page: 'info', note: 'bell', call: 'people' }, KT = { event: 'Nueva salida', post: 'Avisos', page: 'Info' };
    var news = B.items.filter(function (x) { return !/^chat-|^grp-/.test(String(x.id || '')); }).slice(0, 30);
    var rows = news.map(function (x, i) {
      return '<button class="as-row' + (x.at > s0 ? ' new' : '') + '" type="button" data-i="' + i + '">' + ic(KI[x.kind] || 'bell') + '<span><b>' + esc(x.head || KT[x.kind] || 'Aviso') + '</b><small>' + esc(x.title || '') + '</small><small>' + esc(x.community || '') + ' · ' + ago(x.at) + '</small></span>' + ic('chev') + '</button>';
    }).join('');
    var offered = ev.filter(function (e) { return e.status === 'offered'; }).map(function (e) { return '<button class="as-row new" type="button" data-off="' + e.id + '">' + ic('check') + '<span><b>Tienes una plaza</b><small>' + esc(e.title) + ' · contesta cuanto antes</small></span>' + ic('chev') + '</button>'; }).join('');
    var s = openSheet(head('Avisos') + (Cl.user() ? '' : '<p class="muted">Entra en tu cuenta para ver tus avisos.</p>') +
      '<div class="as-rows">' + (offered + rows || '<div class="empty"><b>Sin avisos</b>Aquí llegan las salidas nuevas, los avisos de tu comunidad y lo que venza en tu moto.</div>') + '</div>', 'tall');
    $$('[data-i]', s).forEach(function (b) { b.addEventListener('click', function () { itemGo(news[+b.dataset.i]); }); });
    $$('[data-off]', s).forEach(function (b) { b.addEventListener('click', function () { Cl.closeSheet(); var e = ev.filter(function (m) { return m.id === b.dataset.off; })[0]; if (e && window.RGClub && RGClub.openEvent) RGClub.openEvent(e.id); else if (window.RGClub) RGClub.goto(null, 'events'); }); });
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
      PH.n = near.length; PH.place = near.length ? near[0].place : '';
    }, function () {});
  }
  function today() {
    var el = $('#asHoy'); if (!el) return;
    var ev = mine(), off = ev.filter(function (e) { return e.status === 'offered'; })[0], next = ev.filter(function (e) { return e.status === 'going' || e.status === 'waiting'; })[0], e = off || next;
    var busy = !!(A.activePlan && A.activePlan()) || (A.isPlanMode && A.isPlanMode());
    el.hidden = !e || busy; if (!e) { el.innerHTML = ''; el.onclick = null; return; }
    var d = new Date(e.starts_at), isToday = d.toDateString() === new Date().toDateString();
    el.className = 'as-hoy' + (off ? ' hot' : '');
    el.innerHTML = '<span class="as-date"><b>' + d.getDate() + '</b><small>' + d.toLocaleDateString('es-ES', { month: 'short' }).replace('.', '') + '</small></span><span class="as-hoy-t"><b>' + (off ? 'Tienes una plaza · ' : isToday ? 'Hoy · ' : '') + esc(e.title) + '</b><small>' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) + (e.meet_name ? ' · ' + esc(e.meet_name) : '') + (e.status === 'waiting' ? ' · en espera' : '') + '</small></span>' + ic('chev');
    el.onclick = function () { if (window.RGClub && RGClub.openEvent) RGClub.openEvent(e.id); else if (window.RGClub) RGClub.goto(e.community_id, 'events'); };
  }
  window.RGToday = window.RGToday || [];
  setTimeout(function () { photoCheck(); today(); }, 6000); setInterval(function () { if (document.visibilityState !== 'hidden') { photoCheck(); today(); } }, 60000);
  setInterval(function () { if (!$('#view-map').hidden) today(); }, 3000);      // al cargar o quitar una ruta, la línea de «Hoy» se quita o vuelve

  /* ---------- fotos: elegir, reducir y subir a la carpeta de cada uno ---------- */
  function pickPhoto(max, multiple) {
    return new Promise(function (res) {
      var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; if (multiple) inp.multiple = true; inp.style.display = 'none'; document.body.appendChild(inp);
      inp.addEventListener('change', function () {
        var files = Array.prototype.slice.call(inp.files || [], 0, multiple ? 12 : 1); document.body.removeChild(inp);
        Promise.all(files.map(function (f) { return shrink(f, max || 1600); })).then(function (bs) { bs = bs.filter(Boolean); res(multiple ? bs : bs[0] || null); });
      });
      inp.click();
    });
  }
  function shrink(file, max) {
    return new Promise(function (res) {
      var im = new Image(), u = URL.createObjectURL(file);
      im.onload = function () { var k = Math.min(1, max / Math.max(im.width, im.height)), cv = document.createElement('canvas'); cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k); cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height); URL.revokeObjectURL(u); cv.toBlob(function (b) { res(b); }, 'image/jpeg', 0.82); };
      im.onerror = function () { URL.revokeObjectURL(u); res(null); }; im.src = u;
    });
  }
  function upload(blob, tag) {
    var u = Cl.user(); if (!u || !blob) return Promise.reject(new Error('Sin sesión'));
    var path = u.id + '/' + (tag || 'f') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + '.jpg';
    return sb.storage.from('covers').upload(path, blob, { contentType: 'image/jpeg', upsert: false }).then(function (r) { if (r.error) throw r.error; return sb.storage.from('covers').getPublicUrl(path).data.publicUrl; });
  }
  /* ---------- zona de privacidad: lo que publico sale sin los primeros y los últimos metros ---------- */
  function trimM() { var v = store('rg.priv.trim'), n = parseInt(v == null ? '300' : v, 10); return n > 0 ? n : 0; }      // sin tocar nada: 300 m
  function seg(a, b) { var x = (b[0] - a[0]) * Math.PI / 180 * Math.cos((a[1] + b[1]) * Math.PI / 360), y = (b[1] - a[1]) * Math.PI / 180; return Math.sqrt(x * x + y * y) * 6371000; }
  function trim(r) {
    var m = trimM(); if (!m || !r || !r.coords || r.coords.length < 4) return r;
    var c = r.coords, tot = 0, i; for (i = 1; i < c.length; i++) tot += seg(c[i - 1], c[i]);
    var cut = Math.min(m, tot * 0.2), acc = 0, a = 0, b = c.length - 1;
    for (i = 1; i < c.length && acc < cut; i++) { acc += seg(c[i - 1], c[i]); a = i; }
    for (acc = 0, i = c.length - 1; i > a && acc < cut; i--) { acc += seg(c[i], c[i - 1]); b = i - 1; }
    if (b - a < 2) return r;
    var out = Object.assign({}, r), cs = c.slice(a, b + 1), near = function (w) { return seg([w[1], w[0]], c[0]) < cut * 1.5 || seg([w[1], w[0]], c[c.length - 1]) < cut * 1.5; };
    out.coords = cs;
    if (r.wps && r.wps.length) { var mid = r.wps.slice(1, -1).filter(function (w) { return !near(Array.isArray(w) ? w : [w.lat, w.lon]); }), mk = function (p) { var w0 = r.wps[0]; return Array.isArray(w0) ? [p[1], p[0]] : Object.assign({}, w0, { lat: p[1], lon: p[0], name: undefined }); }; out.wps = [mk(cs[0])].concat(mid, [mk(cs[cs.length - 1])]); }
    return out;
  }
  function privHtml() { return '<div class="seg" id="privTrim">' + [[0, 'No'], [300, '300 m'], [500, '500 m'], [1000, '1 km']].map(function (x) { return '<button type="button" data-m="' + x[0] + '" aria-pressed="' + (trimM() === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>'; }
  function privBind(root) { $$('#privTrim button', root).forEach(function (b) { b.addEventListener('click', function () { store('rg.priv.trim', b.dataset.m); $$('#privTrim button', root).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); }); }); }
  window.RGShell = { privHtml: privHtml, privBind: privBind, catalog: catalog, plan: function () { if (window.RGUI) RGUI.draw(); }, trim: trim, pickPhoto: pickPhoto, upload: upload, clubs: clubs, mine: mine, esc: esc, ic: ic, bell: bellOpen, refresh: function () { bellLoad(true); today(); }, today: today, chatUnread: chatUnread, chatSeen: function (now) { if (now) { store('rg.chat.seen', String(Date.now())); badge(); } return chatSeen(); }, items: function () { return B.items; }, load: bellLoad, head: head, openSheet: openSheet, when: when, ago: ago };
})();
