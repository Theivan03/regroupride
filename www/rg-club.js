/* ReGroupRide — comunidad: unirse con código, eventos y rutas, tablón, páginas (normas, descuentos, enlaces) y miembros.
   Usa la sesión de rg-app.js (window.RGCloud) y las rutas guardadas de app.js (window.RGApp). */
(function () {
  'use strict';
  var A = window.RGApp, Cl = window.RGCloud, DB = window.DB;
  if (!A || !Cl) return;
  var sb = Cl.sb, esc = Cl.esc, $ = function (s, r) { return (r || document).querySelector(s); }, $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var C = window.Capacitor, native = !!(C && C.isNativePlatform && C.isNativePlatform()), P = native ? (C.Plugins || {}) : {};
  var box = $('#clubBody');
  var L = window.RGLib;
  var S = { user: null, list: [], cid: null, tab: 'events', loaded: false, missing: false, names: {}, evAdmins: {}, v6: null };   // v6: ¿está puesto supabase/06 (plazas y enlace de salida)?
  try { S.cid = localStorage.getItem('rg.club') || null; } catch (e) {}

  function cur() { for (var i = 0; i < S.list.length; i++) if (S.list[i].id === S.cid) return S.list[i]; return S.list[0] || null; }
  function isAdmin() { var c = cur(); return !!(c && c.role === 'admin'); }
  function ok(r) { if (r.error) throw r.error; return r.data; }
  function fail(e) { A.toast(Cl.msg(e), 'bad'); }
  function fmtWhen(iso) { var d = new Date(iso), s = d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\.|,/g, ''); return s.charAt(0).toUpperCase() + s.slice(1) + ' · ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }); }
  function localInput(iso) { var d = iso ? new Date(iso) : new Date(Date.now() + 7 * 864e5), p = function (n) { return String(n).padStart(2, '0'); }; if (!iso) d.setHours(9, 0, 0, 0); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  function copy(text, what) {
    var job = P.Clipboard ? P.Clipboard.write({ string: text }) : (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject());
    Promise.resolve(job).then(function () { A.toast((what || 'Copiado') + '.', 'ok'); }, function () { A.toast(text, 'ok'); });
  }
  function share(text) { if (P.Share) P.Share.share({ text: text }).catch(function () {}); else if (navigator.share) navigator.share({ text: text }).catch(function () {}); else copy(text, 'Invitación copiada'); }
  function openUrl(u) { if (!/^https?:\/\//i.test(u)) u = 'https://' + u; if (window.Platform) Platform.openExternal(u); else window.open(u, '_blank', 'noopener'); }
  function armed(btn, label, run) { if (btn.dataset.armed) { run(); return; } btn.dataset.armed = '1'; var old = btn.innerHTML; btn.textContent = label; setTimeout(function () { delete btn.dataset.armed; btn.innerHTML = old; }, 3500); }
  // Los nombres se recuerdan entre sesiones: solo se piden los que no se conocen (y, sin esperar, los que tienen más de un día).
  var NAMES_AT = {};
  try { var nm0 = JSON.parse(localStorage.getItem('rg.club.names') || '{}'); S.names = nm0.n || {}; NAMES_AT = nm0.t || {}; } catch (e) {}
  function saveNames() { try { var ids = Object.keys(S.names).slice(-400), n = {}, t = {}; ids.forEach(function (id) { n[id] = S.names[id]; t[id] = NAMES_AT[id] || 0; }); localStorage.setItem('rg.club.names', JSON.stringify({ n: n, t: t })); } catch (e) {} }
  function fetchNames(ids) {
    return sb.from('profiles').select('id,name,bike_brand,bike_model,avatar_url,lean_limit').in('id', ids).then(function (r) { (r.data || []).forEach(function (p) { S.names[p.id] = p; NAMES_AT[p.id] = Date.now(); }); saveNames(); });
  }
  function names(ids) {
    var uniq = ids.filter(function (id, i) { return id && ids.indexOf(id) === i; }), need = uniq.filter(function (id) { return !S.names[id]; });
    var old = uniq.filter(function (id) { return S.names[id] && Date.now() - (NAMES_AT[id] || 0) > 864e5; });
    if (old.length) fetchNames(old).catch(function () {});
    return need.length ? fetchNames(need) : Promise.resolve();
  }
  // Lo último que se vio de cada pantalla se guarda en el teléfono: al entrar se enseña al instante y se refresca por detrás.
  var MEM = {}, FLY = {};
  function swr(key, fetch, draw, useCache) {
    var k = 'club:' + S.user.id + ':' + key, shown = null, noop = function () {};
    var paint = function (d) { var j = JSON.stringify(d); if (j === shown) return; shown = j; draw(d); };
    // Dos entradas seguidas a la misma pantalla (doble toque) comparten la misma petición.
    // Tras un cambio (sin memoria) siempre se pide de nuevo.
    var fl = FLY[k]; if (!useCache || !fl || Date.now() - fl.t > 1500) { fl = FLY[k] = { t: Date.now(), p: fetch() }; fl.p.then(function () { if (FLY[k] === fl) delete FLY[k]; }, function () { if (FLY[k] === fl) delete FLY[k]; }); }
    var fresh = fl.p.then(function (d) { MEM[k] = d; try { DB.set(k, d).catch(noop); } catch (e) {} return d; });
    if (!useCache) return fresh.then(paint);
    fresh.catch(noop);
    return Promise.resolve(MEM[k] || (window.DB ? DB.get(k, null) : null)).then(function (d) { if (d) paint(d); }, noop).then(function () { return fresh; }).then(paint);
  }
  function who(id) { var p = S.names[id]; return (p && p.name) || 'Motero'; }
  function ava(id, cls) { var p = S.names[id], u = p && p.avatar_url; return '<span class="rg-ava' + (cls ? ' ' + cls : '') + '">' + (/^https:\/\//.test(u || '') ? '<img src="' + esc(u) + '" alt="" loading="lazy">' : esc(who(id).charAt(0).toUpperCase())) + '</span>'; }
  function bike(id) { var p = S.names[id]; return p ? [p.bike_brand, p.bike_model].filter(Boolean).join(' ') + (p.lean_limit ? ' · margen ' + p.lean_limit + '°' : '') : ''; }

  /* ---------- carga ---------- */
  function load() {
    if (!S.user) { S.list = []; S.loaded = true; return Promise.resolve(); }
    return sb.from('community_members').select('role, communities(id,name,description,join_code,zone,ride_style,listed,join_mode,kind)').eq('user_id', S.user.id).then(function (r) {
      if (r.error) { S.missing = /relation|schema cache|does not exist|not find/i.test(r.error.message || ''); if (!S.missing) throw r.error; S.list = []; }
      else { S.missing = false; S.list = (r.data || []).filter(function (m) { return m.communities && m.communities.kind !== 'trip'; }).map(function (m) { var c = m.communities; return { id: c.id, name: c.name, description: c.description, code: c.join_code, zone: c.zone || '', style: c.ride_style || '', listed: !!c.listed, mode: c.join_mode || 'code', role: m.role }; }); }
      S.loaded = true; if (!cur()) S.cid = null; else S.cid = cur().id;
      if (!r.error) { try { localStorage.setItem('rg.club.list:' + S.user.id, JSON.stringify(S.list)); } catch (e) {} }
      liveSync();
    });
  }
  /* ---------- tiempo real (www/rg-live.js) ---------- */
  // Un canal por comunidad: quien publica, se apunta o inicia una ruta toca el timbre y a los demás les llega al momento.
  function liveSync() { if (window.RGLive) RGLive.only('rg-c-', S.user ? S.list.map(function (c) { return 'rg-c-' + c.id; }) : [], onLive); }
  function ring(cid, p) { if (window.RGLive && cid) RGLive.send('rg-c-' + cid, p); }
  function vis() { return document.visibilityState === 'visible'; }
  function repaint(cid) {
    var c = cur();
    if (!c || c.id !== cid || $('#view-club').hidden || !vis()) return;
    var f = ({ events: paneEvents, routes: paneRoutes, board: paneBoard, pages: panePages, members: paneMembers })[S.tab];
    if (f) f(c, false).catch(function () {});
  }
  // Lo último publicado de ese tipo en esa comunidad (con mi sesión: solo lo que ya podría ver).
  function latest(c, kind) {
    var q = kind === 'event' ? sb.from('events').select('id,title,starts_at,created_by').eq('community_id', c.id).order('created_at', { ascending: false }).limit(1)
      : kind === 'post' ? sb.from('community_posts').select('id,body,author_id').eq('community_id', c.id).order('created_at', { ascending: false }).limit(1)
      : sb.from('community_pages').select('id,title').eq('community_id', c.id).order('updated_at', { ascending: false }).limit(1);
    return q.then(function (r) {
      var x = r && !r.error && r.data && r.data[0]; if (!x) return null;
      if ((x.created_by || x.author_id) === S.user.id) return null;
      return { kind: kind, id: x.id, community: c.name, title: kind === 'post' ? String(x.body || '').slice(0, 160) : x.title, starts_at: x.starts_at ? new Date(x.starts_at).getTime() : 0 };
    }, function () { return null; });
  }
  function onLive(p, topic) {
    var cid = topic.slice(5), c = S.list.filter(function (x) { return x.id === cid; })[0];
    if (!c || !S.user) return;
    var k = p.kind;
    if (k === 'call') {
      if (vis()) { if (window.RGGroup) RGGroup.checkCalls(true); return; }
      // app en segundo plano: el aviso lo pone el teléfono ya
      sb.rpc('ride_calls').then(function (r) {
        var x = (r && r.data || []).filter(function (y) { return y.id === p.id; })[0] || (r && r.data || [])[0];
        if (x && RA && RA.newsNow) RA.newsNow({ items: [{ kind: 'call', id: x.id, community: c.name, title: x.name, by: x.by }], silent: false }).catch(function () {});
      }, function () {});
      return;
    }
    if (k === 'att' || k === 'edit') { inbox(true); repaint(cid); return; }
    if (k !== 'event' && k !== 'post' && k !== 'page') return;
    if (k === 'event') inbox(true);
    repaint(cid);
    latest(c, k).then(function (it) {
      if (!it) return;
      var v = vis();
      if (v) A.toast(c.name + ' · ' + (k === 'event' ? 'Nuevo evento: ' : k === 'post' ? 'Tablón: ' : 'Info: ') + it.title, 'ok');
      if (RA && RA.newsNow) RA.newsNow({ items: [it], silent: v }).catch(function () {});
    });
  }
  function setCid(id) { S.cid = id; try { localStorage.setItem('rg.club', id); } catch (e) {} }
  // La lista de comunidades se enseña de memoria y se comprueba por detrás; solo se repinta si ha cambiado.
  var listAt = 0;
  function show() {
    var key = S.user ? 'rg.club.list:' + S.user.id : null, had = S.loaded;
    if (key && !S.loaded) { try { var c0 = JSON.parse(localStorage.getItem(key) || 'null'); if (c0 && c0.length) { S.list = c0; S.loaded = true; S.missing = false; S.cid = cur() ? cur().id : null; had = true; } } catch (e) {} }
    render();
    if (had && Date.now() - listAt < 60000) return;
    var before = JSON.stringify(S.list);
    load().then(function () {
      listAt = Date.now();
      if (!had || JSON.stringify(S.list) !== before) render();
    }, function (e) { if (!S.loaded) { S.loaded = true; render(); } fail(e); });
  }

  /* ---------- pantalla ---------- */
  function render() {
    if (!box) return;
    if (!sb) { box.innerHTML = '<div class="empty">No se ha podido conectar con el servidor.</div>'; return; }
    if (!S.user) { box.innerHTML = '<div class="club-card"><b>Tu comunidad, en un solo sitio</b><p class="muted">Eventos y rutas, avisos, normas y descuentos. Entra en tu cuenta para unirte con el código que te pase el organizador.</p><button class="btn big primary" id="clLogin" type="button">Entrar o crear cuenta</button></div>'; $('#clLogin').addEventListener('click', function () { Cl.openAuth(false); }); return; }
    if (!S.loaded) { box.innerHTML = '<div class="empty">Cargando…</div>'; return; }
    if (S.missing) { box.innerHTML = '<div class="notice">Las comunidades aún no están activadas en el servidor. Falta ejecutar el archivo 02_comunidades.sql en Supabase.</div>'; return; }
    var c = cur();
    if (!c) { renderJoin(); return; }
    box.innerHTML = '<div class="club-head"><div class="club-title"><b>' + esc(c.name) + '</b>' + (c.zone || c.style ? '<span class="club-zone">' + icn('locate') + esc([c.zone, c.style].filter(Boolean).join(' · ')) + '</span>' : '') + (c.description ? '<span class="muted">' + esc(c.description) + '</span>' : '') + '</div><div class="club-head-act">' + (isAdmin() ? '<button class="btn small" id="clEdit" type="button">' + icn('edit') + 'Editar</button>' : '') + '<button class="btn small" id="clInvite" type="button"><svg><use href="#i-share"/></svg>Invitar</button></div></div>' +
      '<div class="pills-wrap"><div class="pills" id="clPills">' + S.list.map(function (x) { return '<button class="pill" type="button" data-cid="' + x.id + '" aria-pressed="' + (x.id === c.id) + '">' + esc(x.name) + '</button>'; }).join('') + '<button class="pill pill-trips" type="button" id="clTrips" aria-pressed="false">' + icn('route') + 'Mis viajes</button><button class="pill pill-trips" type="button" id="clPhoto" aria-pressed="false">' + icn('camera') + 'Fotógrafos</button><button class="pill" type="button" id="clOther" aria-pressed="false">+ Otra comunidad</button></div><span class="pills-more" aria-hidden="true">›</span></div>' +
      '<div class="seg rg-wide seg-5" id="clTabs">' + [['events', 'Eventos'], ['routes', 'Rutas'], ['board', 'Tablón'], ['pages', 'Info'], ['members', 'Gente']].map(function (t) { return '<button type="button" data-t="' + t[0] + '" aria-pressed="' + (S.tab === t[0]) + '">' + t[1] + '</button>'; }).join('') + '</div><div id="clPane"><div class="empty">Cargando…</div></div>';
    $('#clInvite').addEventListener('click', invite);
    if ($('#clEdit')) $('#clEdit').addEventListener('click', function () { editCommunity(c); });
    $('#clOther').addEventListener('click', renderJoin);
    // la fila de arriba se desliza de lado: una flecha lo indica mientras quede algo por ver
    var pl = $('#clPills'), more = function () { if (pl) pl.parentNode.classList.toggle('more', pl.scrollWidth - pl.clientWidth - pl.scrollLeft > 8); };
    if (pl) { pl.addEventListener('scroll', more, { passive: true }); setTimeout(more, 60); setTimeout(more, 600); var on = pl.querySelector('[aria-pressed=true]'); if (on && on.offsetLeft > pl.clientWidth - 80) pl.scrollLeft = on.offsetLeft - 16; }
    $('#clTrips').addEventListener('click', function () { if (window.RGTrips) RGTrips.list(); });
    $('#clPhoto').addEventListener('click', function () { if (window.RGPhoto) RGPhoto.open('spots'); });
    $$('[data-cid]', box).forEach(function (b) { b.addEventListener('click', function () { setCid(b.dataset.cid); render(); }); });
    $$('#clTabs button', box).forEach(function (b) { b.addEventListener('click', function () { S.tab = b.dataset.t; render(); }); });
    ({ events: paneEvents, routes: paneRoutes, board: paneBoard, pages: panePages, members: paneMembers })[S.tab](c, true).catch(function (e) { var p = $('#clPane'); if (p) p.innerHTML = '<div class="empty">' + esc(Cl.msg(e)) + '</div>'; });
  }
  function renderJoin() {
    box.innerHTML = (S.list.length ? '<button class="btn small" id="clBack" type="button" style="margin-bottom:10px">← Volver a ' + esc(cur().name) + '</button>' : '') + '<div class="club-card"><b>Buscar comunidades</b><p class="muted">Encuentra grupos por nombre o por zona y únete.</p><div class="club-find-box">' + icn('search') + '<input type="text" inputmode="search" enterkeyhint="search" id="clFind" maxlength="40" placeholder="Nombre, pueblo, provincia…" autocomplete="off"></div><div id="clFound" class="club-found"><p class="muted">Cargando…</p></div></div>' +
      '<div class="club-card"><b>Viajes de varios días</b><p class="muted">Organiza una escapada con etapas, alojamiento y gastos, con tu comunidad o entre amigos.</p><button class="btn" id="clTrips2" type="button" style="width:100%">' + icn('route') + 'Mis viajes</button></div>' +
      '<div class="club-card"><b>Fotógrafos en ruta</b><p class="muted">Mira qué fotógrafos están hoy en los puertos y dónde, para pasar por delante y llevarte tus fotos.</p><button class="btn" id="clPhoto2" type="button" style="width:100%">' + icn('camera') + 'Ver fotógrafos</button></div>' +
      '<div class="club-card"><b>Tengo un código</b><p class="muted">Escribe el código que te ha pasado el organizador.</p><div class="plan-link"><input type="text" id="clCode" maxlength="8" placeholder="Código" autocapitalize="characters" autocomplete="off"><button class="btn small primary" id="clJoin" type="button">Unirme</button></div></div>' +
      '<div class="club-card"><b>Crear una comunidad</b><p class="muted">Serás su administrador: podrás crear eventos, publicar avisos e invitar a la gente.</p><input type="text" id="clName" maxlength="60" placeholder="Nombre de la comunidad"><button class="btn" id="clCreate" type="button" style="margin-top:10px;width:100%">Crear comunidad</button></div>';
    if ($('#clBack')) $('#clBack').addEventListener('click', render);
    $('#clTrips2').addEventListener('click', function () { if (window.RGTrips) RGTrips.list(); });
    $('#clPhoto2').addEventListener('click', function () { if (window.RGPhoto) RGPhoto.open('spots'); });
    var findT = 0; $('#clFind').addEventListener('input', function () { clearTimeout(findT); findT = setTimeout(findCommunities, 350); }); findCommunities();
    $('#clJoin').addEventListener('click', function (ev) { var code = $('#clCode').value.trim(); if (code.length < 4) { A.toast('Escribe el código.', 'warn'); return; }
      Cl.busy(ev.currentTarget, function () { return sb.rpc('join_community', { p_code: code }).then(function (r) { if (r.error) throw new Error(/no válido/i.test(r.error.message) ? 'Ese código no existe. Revísalo con el organizador.' : r.error.message); setCid(r.data); A.toast('¡Dentro!', 'ok'); return load().then(render); }); }); });
    $('#clCreate').addEventListener('click', function (ev) { var name = $('#clName').value.trim(); if (name.length < 2) { A.toast('Ponle un nombre.', 'warn'); return; }
      Cl.busy(ev.currentTarget, function () { return sb.rpc('create_community', { p_name: name, p_description: '' }).then(function (r) { setCid(ok(r)); A.toast('Comunidad creada. Invita a la gente con el código.', 'ok'); return load().then(render); }); }); });
  }
  /* ---------- catálogo de rutas de la comunidad: las suben los administradores y cualquiera puede cargarlas ---------- */
  var LEVELS = { facil: 'Fácil', media: 'Media', exigente: 'Exigente' }, RT_COLS = 'id,name,description,kind,level,start_name,dist,dur,created_at,warnings,tips';
  function hm(s) { var m = Math.round((s || 0) / 60), h = Math.floor(m / 60); return h ? h + ' h ' + ('0' + (m % 60)).slice(-2) + ' min' : m + ' min'; }
  function routeCards(rows, admin) {
    return rows.map(function (x) {
      return '<div class="club-card rt-card" data-id="' + x.id + '"><b class="rt-name">' + esc(x.name) + '</b>' +
        '<div class="rt-tags">' + (x.level ? '<span class="rt-tag lv-' + x.level + '">' + LEVELS[x.level] + '</span>' : '') + (x.kind ? '<span class="rt-tag">' + esc(x.kind) + '</span>' : '') + '</div>' +
        '<div class="rt-meta"><span>' + icn('route') + String(+x.dist).replace('.', ',') + ' km</span>' + (x.dur ? '<span>' + icn('clock') + hm(x.dur) + '</span>' : '') + (x.start_name ? '<span>' + icn('locate') + esc(x.start_name) + '</span>' : '') + '</div>' +
        (x.description ? '<p class="rt-desc">' + esc(x.description) + '</p>' : '') +
        (x.warnings ? '<div class="rt-note warn"><b>' + icn('warn') + 'Ojo en esta ruta</b><p>' + esc(x.warnings) + '</p></div>' : '') +
        (x.tips ? '<div class="rt-note tip"><b>' + icn('star') + 'Recomendaciones</b><p>' + esc(x.tips) + '</p></div>' : '') +
        '<div class="rt-acts"><button class="btn small primary" data-rt="see" type="button">' + icn('map') + 'Ver en el mapa</button><button class="btn small" data-rt="save" type="button">' + icn('download') + 'Guardar en mis rutas</button>' +
        (admin ? '<button class="link danger" data-rt="del" type="button">Borrar</button>' : '') + '</div></div>';
    }).join('');
  }
  function wireRoutes(host, rows, after) {
    var full = function (id) { return sb.from('community_routes').select('name,dist,dur,route').eq('id', id).single().then(function (r) { var x = ok(r), rt = x.route || {}; if (!rt.coords || rt.coords.length < 2) throw new Error('Esa ruta no tiene trazado.'); return { id: parseInt(id.replace(/-/g, '').slice(0, 12), 16), name: x.name, wps: rt.wps || [], pois: rt.pois || [], coords: rt.coords, dist: +x.dist || rt.dist || 0, dur: x.dur || rt.dur || 0, routed: true, steps: rt.steps || [], created: Date.now() }; }); };
    $$('[data-rt]', host).forEach(function (b) { b.addEventListener('click', function () {
      var id = b.closest('.rt-card').dataset.id, act = b.dataset.rt;
      if (act === 'del') { armed(b, '¿Seguro? Toca otra vez', function () { sb.from('community_routes').delete().eq('id', id).then(function (r) { ok(r); A.toast('Ruta quitada del catálogo.', 'ok'); if (after) after(); }).catch(fail); }); return; }
      Cl.busy(b, function () { return full(id).then(function (p) {
        if (act === 'save') return A.savePlan(p).then(function () { A.toast('Guardada en tus rutas. La tienes en Rutas → Planificadas.', 'ok'); });
        Cl.closeSheet(); A.previewPlan(p); A.toast('«' + p.name + '» en el mapa. Pulsa «Iniciar ruta» para seguirla.', 'ok');
      }); });
    }); });
  }
  function paneRoutes(c) {
    return sb.from('community_routes').select(RT_COLS).eq('community_id', c.id).order('created_at', { ascending: false }).then(function (r) {
      var rows = ok(r) || [], pane = $('#clPane'); if (!pane || S.tab !== 'routes' || !cur() || cur().id !== c.id) return;
      pane.innerHTML = (isAdmin() ? '<button class="btn big primary club-add" id="rtNew" type="button"><svg><use href="#i-plus"/></svg>Añadir ruta al catálogo</button>' : '') +
        (rows.length ? '<span class="label">' + rows.length + (rows.length === 1 ? ' ruta' : ' rutas') + ' de ' + esc(c.name) + '</span>' + routeCards(rows, isAdmin()) :
          '<div class="empty">Todavía no hay rutas en el catálogo.' + (isAdmin() ? ' Añade las que soléis hacer para que el grupo las tenga a mano.' : ' Los administradores irán subiendo las que suele hacer el grupo.') + '</div>') +
        (isAdmin() && !c.listed ? '<p class="muted rg-small">Ahora mismo solo las ven los miembros. Si activas «Aparecer en el buscador» en Editar, cualquiera con la app podrá ver vuestro catálogo.</p>' : '');
      if ($('#rtNew')) $('#rtNew').addEventListener('click', function () { routeForm(c); });
      wireRoutes(pane, rows, function () { paneRoutes(c); });
    });
  }
  function catalogSheet(cid, name) {
    Cl.sheet('<div class="head"><h1>Rutas de ' + esc(name) + '</h1><button class="btn small icon" id="clX" type="button" aria-label="Cerrar"><svg><use href="#i-close"/></svg></button></div><div id="rtCat"><p class="muted">Cargando…</p></div>');
    $('#clX').addEventListener('click', Cl.closeSheet);
    sb.from('community_routes').select(RT_COLS).eq('community_id', cid).order('created_at', { ascending: false }).then(function (r) {
      var rows = ok(r) || [], host = $('#rtCat'); if (!host) return;
      host.innerHTML = rows.length ? routeCards(rows, false) : '<div class="empty">Esta comunidad todavía no tiene rutas en su catálogo.</div>';
      wireRoutes(host, rows);
    }).catch(function (e) { if ($('#rtCat')) $('#rtCat').innerHTML = '<div class="empty">' + esc(Cl.msg(e)) + '</div>'; });
  }
  function routeForm(c) {
    var plans = A.plans ? A.plans() : [], picked = null;
    Cl.sheet('<div class="head"><h1>Añadir ruta</h1><button class="btn small icon" id="clX" type="button" aria-label="Cerrar"><svg><use href="#i-close"/></svg></button></div>' +
      '<form class="rg-form" id="rtForm"><label>La ruta<select id="rtPlan"><option value="">Elige una de tus rutas…</option>' + plans.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + ' · ' + String(p.dist).replace('.', ',') + ' km</option>'; }).join('') + '</select></label>' +
      '<div class="tr-gpx"><button class="btn small" id="rtGpx" type="button">' + icn('download') + 'O importa un GPX</button><input type="file" id="rtFile" accept=".gpx,application/gpx+xml,application/xml,text/xml" hidden></div>' +
      '<label>Nombre<input id="rtName" required minlength="2" maxlength="80" placeholder="Vuelta a la Carrasqueta"></label>' +
      '<label>Descripción<textarea id="rtDesc" class="note" maxlength="600" placeholder="Cómo es, dónde parar a almorzar, tramos a tener en cuenta…"></textarea></label>' +
      '<div class="tr-two"><label>Dificultad<select id="rtLevel"><option value="">Sin indicar</option><option value="facil">Fácil</option><option value="media">Media</option><option value="exigente">Exigente</option></select></label><label>Tipo<input id="rtKind" maxlength="30" placeholder="Curvas, puerto, costa…"></label></div>' +
      '<label>Sale de<input id="rtStart" maxlength="80" placeholder="Gasolinera, plaza, pueblo…"></label>' +
      '<label>Advertencias: tramos complicados o con cuidado<textarea id="rtWarn" class="note" maxlength="600" placeholder="Gravilla en la bajada del puerto, km 12 con el firme roto, radar de tramo, mucho ciclista los domingos…"></textarea></label>' +
      '<label>Recomendaciones<textarea id="rtTips" class="note" maxlength="600" placeholder="Mejor por la mañana, repostar en el pueblo antes de subir, almuerzo en la venta, mirador para la foto…"></textarea></label>' +
      '<button class="btn big primary" type="submit">Añadir al catálogo</button></form>');
    $('#clX').addEventListener('click', Cl.closeSheet);
    var take = function (r, name) { picked = r; if (!$('#rtName').value.trim()) $('#rtName').value = (name || r.name || '').slice(0, 80); };
    $('#rtPlan').addEventListener('change', function () { var p = plans.filter(function (x) { return String(x.id) === $('#rtPlan').value; })[0]; if (p) take({ name: p.name, wps: p.wps, pois: p.pois || [], coords: p.coords, steps: p.steps || [], dist: p.dist, dur: p.dur }, p.name); else picked = null; });
    $('#rtGpx').addEventListener('click', function () { $('#rtFile').value = ''; $('#rtFile').click(); });
    $('#rtFile').addEventListener('change', function () {
      var file = this.files && this.files[0], b = $('#rtGpx'); if (!file || !window.RGNav || !RGNav.gpxRoute) return;
      var old = b.innerHTML, rd = new FileReader(); b.disabled = true; b.textContent = 'Leyendo el GPX…';
      rd.onload = function () { RGNav.gpxRoute(String(rd.result || ''), file.name).then(function (r) {
        take(r, r.name); $('#rtPlan').value = ''; b.disabled = false; b.innerHTML = icn('check') + esc(r.name) + ' · ' + String(r.dist).replace('.', ',') + ' km';
        if (A.savePlan) A.savePlan({ id: Date.now(), name: r.name, wps: r.wps, pois: r.pois || [], coords: r.coords, dist: r.dist, dur: r.dur, routed: true, steps: r.steps || [], created: Date.now(), gpx: true }).catch(function () {});
      }).catch(function (e) { b.disabled = false; b.innerHTML = old; A.toast(e.message || 'No se pudo importar.', 'bad'); }); };
      rd.readAsText(file);
    });
    $('#rtForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (!picked || !picked.coords || picked.coords.length < 2) { A.toast('Elige una de tus rutas o importa un GPX.', 'warn'); return; }
      Cl.busy(ev.target.querySelector('button[type=submit]'), function () {
        return sb.from('community_routes').insert({ community_id: c.id, name: $('#rtName').value.trim(), description: $('#rtDesc').value.trim(), kind: $('#rtKind').value.trim(), level: $('#rtLevel').value, start_name: $('#rtStart').value.trim(), warnings: $('#rtWarn').value.trim(), tips: $('#rtTips').value.trim(), dist: Math.round((+picked.dist || 0) * 10) / 10, dur: Math.round(+picked.dur || 0), route: picked, created_by: S.user.id }).then(function (r) {
          ok(r); Cl.closeSheet(); A.toast('Ruta añadida al catálogo.', 'ok'); return paneRoutes(c);
        });
      });
    });
  }

  /* ---------- buscador de comunidades y ficha (zona, estilo, cómo se entra) ---------- */
  var MODES = { open: 'Cualquiera puede unirse', request: 'Hay que pedirlo y un administrador acepta', code: 'Solo con el código de invitación' };
  function findCommunities() {
    var inp = $('#clFind'), out = $('#clFound'); if (!inp || !out) return;
    var q = inp.value.trim();
    sb.rpc('community_search', { p_q: q }).then(function (r) {
      if (!$('#clFound') || $('#clFind').value.trim() !== q) return;
      var rows = ok(r) || [];
      out.innerHTML = rows.length ? rows.map(function (x) {
        var btn = x.mine ? '<span class="mstatus ok"><svg><use href="#i-check"/></svg>Ya estás</span>' : x.requested ? '<span class="mstatus soon">Solicitud enviada</span>' :
          x.join_mode === 'open' ? '<button class="btn small primary" data-j="' + x.id + '" type="button">Unirme</button>' : x.join_mode === 'request' ? '<button class="btn small primary" data-j="' + x.id + '" data-ask="1" type="button">Pedir unirme</button>' : '<span class="muted rg-small">Solo con código</span>';
        return '<div class="club-find"><div><b>' + esc(x.name) + '</b><span class="club-zone">' + icn('locate') + esc([x.zone || 'Sin zona', x.style].filter(Boolean).join(' · ')) + '</span><span class="muted rg-small">' + x.members + (x.members === 1 ? ' miembro' : ' miembros') + (x.events_next ? ' · ' + x.events_next + (x.events_next === 1 ? ' evento próximo' : ' eventos próximos') : '') + '</span>' + (x.description ? '<p>' + esc(x.description) + '</p>' : '') + (x.routes ? '<button class="link" data-cat="' + x.id + '" data-name="' + esc(x.name) + '" type="button">Ver sus ' + x.routes + (x.routes === 1 ? ' ruta' : ' rutas') + '</button>' : '') + '</div>' + btn + '</div>';
      }).join('') : '<p class="muted">' + (q ? 'No hay ninguna comunidad con «' + esc(q) + '».' : 'Todavía no hay comunidades en el buscador.') + ' Si la tuya no sale, pídele el código a su organizador.</p>';
      $$('[data-cat]', out).forEach(function (b) { b.addEventListener('click', function () { catalogSheet(b.dataset.cat, b.dataset.name); }); });
      $$('[data-j]', out).forEach(function (b) { b.addEventListener('click', function () {
        Cl.busy(b, function () { return sb.rpc('community_ask', { p_id: b.dataset.j, p_message: '' }).then(function (r2) {
          var res = ok(r2);
          if (res === 'joined') { setCid(b.dataset.j); A.toast('¡Dentro!', 'ok'); return load().then(render); }
          A.toast('Solicitud enviada. Te aviso cuando un administrador la acepte.', 'ok'); findCommunities();
        }); });
      }); });
    }).catch(function (e) { if ($('#clFound')) $('#clFound').innerHTML = '<p class="muted">' + esc(Cl.msg(e)) + '</p>'; });
  }
  function editCommunity(c) {
    Cl.sheet('<div class="head"><h1>Editar comunidad</h1><button class="btn small icon" id="clX" type="button" aria-label="Cerrar"><svg><use href="#i-close"/></svg></button></div>' +
      '<form class="rg-form" id="ceForm"><label>Nombre<input id="ceName" required minlength="2" maxlength="60" value="' + esc(c.name) + '"></label>' +
      '<label>Descripción<textarea id="ceDesc" class="note" maxlength="600" placeholder="Quiénes sois, cuándo soléis salir, qué tipo de rutas hacéis…">' + esc(c.description || '') + '</textarea></label>' +
      '<label>Zona<input id="ceZone" maxlength="60" placeholder="Marina Alta, Alicante" value="' + esc(c.zone) + '"></label>' +
      '<label>Estilo o tipo de motos<input id="ceStyle" maxlength="60" placeholder="Curvas tranquilas, naked y sport, trail…" value="' + esc(c.style) + '"></label>' +
      '<label class="rg-check"><input type="checkbox" id="ceListed"' + (c.listed ? ' checked' : '') + '><span><b>Aparecer en el buscador de comunidades</b><small>Cualquiera con la app podrá encontraros por nombre o zona. Solo se ve esta ficha: el tablón, los eventos y los miembros siguen siendo solo para quien esté dentro.</small></span></label>' +
      '<label>Cómo se entra desde el buscador<select id="ceMode">' + Object.keys(MODES).map(function (k) { return '<option value="' + k + '"' + (c.mode === k ? ' selected' : '') + '>' + MODES[k] + '</option>'; }).join('') + '</select></label>' +
      '<button class="btn big primary" type="submit">Guardar</button></form>');
    $('#clX').addEventListener('click', Cl.closeSheet);
    $('#ceForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      Cl.busy(ev.target.querySelector('button[type=submit]'), function () {
        return sb.from('communities').update({ name: $('#ceName').value.trim(), description: $('#ceDesc').value.trim(), zone: $('#ceZone').value.trim(), ride_style: $('#ceStyle').value.trim(), listed: $('#ceListed').checked, join_mode: $('#ceMode').value }).eq('id', c.id).select('id').then(function (r) {
          if (!ok(r).length) throw new Error('No se ha guardado: no eres administrador de esta comunidad.');
          Cl.closeSheet(); A.toast('Comunidad guardada.', 'ok'); listAt = 0; return load().then(render);
        });
      });
    });
  }
  function invite() {
    var c = cur(), text = 'Únete a «' + c.name + '» en ReGroupRide. En la app, entra en Comunidad y escribe el código ' + c.code + '.';
    Cl.sheet('<div class="head"><h1>Invitar</h1><button class="btn small icon" id="clX" type="button"><svg><use href="#i-close"/></svg></button></div><p class="muted">Pasa este código a quien quieras que entre en «' + esc(c.name) + '». Lo escribe en la pestaña Comunidad.</p><div class="club-code">' + esc(c.code) + '</div><button class="btn" id="clCopy" type="button"><svg><use href="#i-copy"/></svg>Copiar código</button><button class="btn big primary" id="clShare" type="button"><svg><use href="#i-share"/></svg>Compartir invitación</button>' +
      '<button class="btn rg-skip" id="clNew" type="button">Unirme a otra comunidad o crear una</button>');
    $('#clX').addEventListener('click', Cl.closeSheet); $('#clShare').addEventListener('click', function () { share(text); }); $('#clCopy').addEventListener('click', function () { copy(c.code, 'Código copiado'); });
    $('#clNew').addEventListener('click', function () { Cl.closeSheet(); renderJoin(); });
  }

  /* ---------- eventos ---------- */
  // Las plazas y la lista de espera las decide el servidor (supabase/06_plazas_y_salida.sql); aquí se pide y se enseña.
  function takenOf(att, e) { return att.filter(function (x) { return x.event_id === e.id && (x.status === 'going' || x.status === 'offered'); }); }
  function queueOf(att, e) {
    return att.filter(function (x) { return x.event_id === e.id && x.status === 'waiting'; }).sort(function (a, b) {
      return (a.offered_at ? 1 : 0) - (b.offered_at ? 1 : 0) || new Date(a.offered_at || a.joined_at) - new Date(b.offered_at || b.joined_at) || new Date(a.joined_at) - new Date(b.joined_at);
    });
  }
  // Punto de salida: el que puso el organizador o, si no, donde empieza la ruta. Siempre con su enlace de Maps.
  function meetOf(e) {
    var lat = e.meet_lat, lon = e.meet_lon, fromRoute = false, r = e.route;
    if ((lat == null || lon == null) && r && r.coords && r.coords.length) { lat = r.coords[0][1]; lon = r.coords[0][0]; fromRoute = true; }
    var has = lat != null && lon != null, name = e.meet_name || (fromRoute && r.wps && r.wps[0] && r.wps[0][2]) || '';
    return { lat: has ? lat : null, lon: has ? lon : null, name: name, url: e.meet_url || L.mapsPointUrl(has ? lat : null, has ? lon : null, e.meet_name) };
  }
  function deadlineOf(e, a) {   // misma cuenta que el servidor: 12 h o la mitad de lo que falte, lo que sea menos
    if (!a || !a.offered_at) return null;
    var o = new Date(a.offered_at).getTime(), st = new Date(e.starts_at).getTime();
    return o + Math.min(12 * 3600e3, Math.max((st - o) / 2, 600e3));
  }
  /* Portada de los eventos (supabase/11): la foto que se subió o, si no hay, el mapa de donde sale la ruta. */
  var COVERS = {};
  function covers(c, evs) {
    var put = function () {
      evs.forEach(function (e) {
        var card = document.querySelector('.ev[data-ev="' + e.id + '"]'), box = card && card.querySelector('.ev-cover'); if (!box || box.dataset.done) return;
        var img = box.querySelector('.ev-cover-img'), on = function () { box.hidden = false; card.classList.add('has-cover'); }, url = COVERS[e.id];
        if (url) { box.dataset.done = 1; var im = new Image(); im.onload = function () { img.style.backgroundImage = 'url("' + url.replace(/"/g, '') + '")'; on(); }; im.src = url; return; }
        var pt = e.route_start && e.route_start.length > 1 ? [+e.route_start[0], +e.route_start[1]] : (e.meet_lon != null && e.meet_lat != null ? [e.meet_lon, e.meet_lat] : null);
        if (pt && window.RGThumbs) { box.dataset.done = 1; img.addEventListener('rg-thumb', on); RGThumbs.attach(img, 'e' + e.id, [pt]); }
      });
    };
    put();
    COVERS._at = COVERS._at || {};
    if (S.v11 === false || Date.now() - (COVERS._at[c.id] || 0) < 60000) return;      // las portadas, como mucho una vez por minuto
    COVERS._at[c.id] = Date.now();
    sb.from('events').select('id,cover_url').eq('community_id', c.id).then(function (r) {
      if (r.error) { S.v11 = false; return; }
      S.v11 = true; (r.data || []).forEach(function (x) { if (x.cover_url) COVERS[x.id] = x.cover_url; else delete COVERS[x.id]; });
      [].forEach.call(document.querySelectorAll('.ev .ev-cover'), function (b) { if (COVERS[b.parentNode.dataset.ev] && !b.parentNode.classList.contains('has-cover')) delete b.dataset.done; });
      put();
    }, function () {});
  }
  // Foto elegida -> JPEG 16:9 de 1280 px -> almacén «covers». Devuelve su dirección pública (o null si no se puede).
  function uploadCover(file) {
    return new Promise(function (ok) {
      var im = new Image(), u = URL.createObjectURL(file);
      im.onerror = function () { ok(null); };
      im.onload = function () {
        var W = 1280, H = 720, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        var k = Math.max(W / im.width, H / im.height), w = im.width * k, h = im.height * k;
        cv.getContext('2d').drawImage(im, (W - w) / 2, (H - h) / 2, w, h); URL.revokeObjectURL(u);
        cv.toBlob(function (b) {
          if (!b) { ok(null); return; }
          var path = S.user.id + '/' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + '.jpg';
          sb.storage.from('covers').upload(path, b, { contentType: 'image/jpeg', upsert: false }).then(function (r) {
            ok(r.error ? null : sb.storage.from('covers').getPublicUrl(path).data.publicUrl);
          }, function () { ok(null); });
        }, 'image/jpeg', 0.82);
      };
      im.src = u;
    });
  }
  function setStatus(e, mine, status, companion, bike) {
    var row = { status: status, companion: !!companion }; if (bike) row.bike = String(bike).slice(0, 80);
    var q = mine ? sb.from('event_attendees').update(row).eq('event_id', e.id).eq('user_id', S.user.id).select('status')
      : sb.from('event_attendees').insert(Object.assign({ event_id: e.id, user_id: S.user.id }, row)).select('status');
    return q.then(function (r) { var d = ok(r); return d && d[0] ? d[0].status : status; });
  }
  // Una sola petición para la pestaña: los eventos con sus apuntados y sus administradores. La ruta completa de cada
  // evento (decenas de KB) no se baja aquí: solo su nombre, sus km y dónde empieza; el resto, al pulsar «Cargar ruta».
  var EV_COLS = 'id,community_id,title,description,starts_at,meet_name,luma_url,created_by', EV_V6 = ',capacity,meet_url,meet_lat,meet_lon,route_url,trip',
    EV_ROUTE = ',route_name:route->>name,route_dist:route->dist,route_start:route->coords->0,route_wp0:route->wps->0', EV_EMBED = ',event_attendees(*),event_admins(user_id)';
  function fetchEvents(c) {
    var since = new Date(Date.now() - 12 * 3600e3).toISOString();
    var q = function (v6) { return sb.from('events').select(EV_COLS + (v6 ? EV_V6 : '') + EV_ROUTE + EV_EMBED).eq('community_id', c.id).gte('starts_at', since).order('starts_at').limit(40); };
    return q(S.v6 !== false).then(function (r) {
      if (r.error && S.v6 !== false && /capacity|route_url|meet_(url|lat|lon)/i.test(r.error.message || '')) { S.v6 = false; return q(false); }
      if (!r.error && S.v6 !== false) S.v6 = true;
      return r;
    }).then(function (r) {
      // Si el servidor no acepta la consulta combinada (le falta algún archivo SQL), se hace como antes: todo y por separado.
      return r.error ? sb.from('events').select('*').eq('community_id', c.id).gte('starts_at', since).order('starts_at').limit(40) : r;
    }).then(function (r) {
      var rows = ok(r), ids = rows.map(function (e) { return e.id; }), att = [], adm = {}, embedded = rows.length && rows[0].event_attendees !== undefined;
      if (rows.length && rows[0].route !== undefined && !('capacity' in rows[0])) S.v6 = false;
      var evs = rows.map(function (e) {
        var o = {}, k; for (k in e) if (!/^(event_attendees|event_admins|route_name|route_dist|route_start|route_wp0)$/.test(k)) o[k] = e[k];
        if (e.route === undefined) o.route = (e.route_name != null || e.route_start) ? { name: e.route_name || '', dist: e.route_dist || 0, coords: e.route_start ? [e.route_start] : [], wps: e.route_wp0 ? [e.route_wp0] : [], lite: true } : null;
        (e.event_attendees || []).forEach(function (a) { att.push(a); });
        (e.event_admins || []).forEach(function (a) { (adm[e.id] = adm[e.id] || []).push(a.user_id); });
        return o;
      });
      var rest = embedded || !ids.length ? Promise.resolve() : Promise.all([sb.from('event_attendees').select('*').in('event_id', ids), sb.from('event_admins').select('event_id,user_id').in('event_id', ids)]).then(function (x) {
        att = ok(x[0]); (x[1].data || []).forEach(function (a) { (adm[a.event_id] = adm[a.event_id] || []).push(a.user_id); });
      });
      return rest.then(function () { return names(att.map(function (x) { return x.user_id; })); }).then(function () { return { evs: evs, att: att, adm: adm }; });
    });
  }
  function paneEvents(c, useCache) {
    return swr('ev:' + c.id, function () { return fetchEvents(c); }, function (d) { var now = cur(); if (!now || now.id !== c.id) return; S.evAdmins = d.adm || {}; drawEvents(c, d.evs, d.att); }, useCache);
  }
  function drawEvents(c, evs, att) {
    var pane = $('#clPane'); if (!pane || S.tab !== 'events') return;
    pane.innerHTML = (isAdmin() ? '<button class="btn big primary club-add" id="evNew" type="button"><svg><use href="#i-plus"/></svg>Nuevo evento o ruta</button><button class="btn club-add" id="evTrip" type="button">' + icn('route') + 'Nuevo viaje de varios días</button>' : '') + (evs.length ? evs.map(function (e) {
      var going = att.filter(function (x) { return x.event_id === e.id && x.status === 'going'; }), mine = att.filter(function (x) { return x.event_id === e.id && x.user_id === S.user.id; })[0];
      var taken = takenOf(att, e), queue = queueOf(att, e), cap = e.capacity || 0, full = cap > 0 && taken.length >= cap;
      var st = mine ? mine.status : 'no', iGo = st === 'going', people = going.length + going.filter(function (x) { return x.companion; }).length;
      var routeAdm = (S.evAdmins[e.id] || []).indexOf(S.user.id) >= 0, canRun = isAdmin() || routeAdm, m = meetOf(e), pos = queue.map(function (x) { return x.user_id; }).indexOf(S.user.id) + 1, dl = deadlineOf(e, mine);
      // Cuántos hay en lista de espera solo lo ven los administradores; los demás saben si están en ella, nada más.
      var count = cap ? taken.length + ' de ' + cap + (cap === 1 ? ' plaza' : ' plazas') + (queue.length && canRun ? ' · ' + queue.length + ' en lista de espera' : '')
        : (going.length ? going.length + (going.length === 1 ? ' moto' : ' motos') + (people > going.length ? ' · ' + people + ' personas' : '') : 'Nadie apuntado todavía');
      // Tarjeta de evento de la guía: la franja de arriba dice el estado (color, icono y texto) y debajo va lo demás.
      var ic = function (n) { return '<svg><use href="#i-' + n + '"/></svg>'; };
      var strip = st === 'going' ? ['si', 'check', 'Estás apuntado'] : st === 'waiting' ? ['espera', 'clock', 'En lista de espera']
        : st === 'offered' ? ['plaza', 'clock', 'Plaza libre por confirmar'] : ['no', 'info', 'No estás apuntado'];
      var startBtn = canRun && e.route, mineHtml;
      if (st === 'offered') mineHtml = '<div class="ev-offer"><b>Ha quedado una plaza libre para ti</b><span>Confirma si vienes' + (dl ? ' antes del ' + fmtWhen(dl).toLowerCase() : '') + '. Si no puedes, pasa al siguiente de la lista.</span><div class="ev-go"><button class="btn small primary" data-act="confirm" type="button">Sí, voy</button><button class="btn small" data-act="no" type="button">No puedo</button></div></div>';
      else if (st === 'waiting') mineHtml = '<div class="ev-go"><button class="btn small" data-act="no" type="button">' + ic('exit') + 'Salir de la lista</button>';
      else if (iGo) mineHtml = '<button class="btn small ev-ticket" data-act="ticket" type="button">' + ic('qr') + 'Mi entrada (QR)</button><div class="ev-go"><button class="btn small" data-act="comp" type="button" aria-pressed="' + !!mine.companion + '">Con acompañante</button><button class="btn small" data-act="no" type="button">No voy</button>';
      else mineHtml = '<div class="ev-go"><button class="btn' + (startBtn ? ' small' : ' big primary') + '" data-act="go" type="button">' + ic('check') + (full ? 'Apuntarme a la lista de espera' : 'Voy') + '</button>';
      if (st !== 'offered') mineHtml += (e.luma_url ? '<button class="btn small" data-act="luma" type="button">Apuntarse en Luma</button>' : '') + '</div>';
      var countHtml = '<button class="link ev-count" data-act="who" type="button">' + count + '</button>';
      return '<div class="club-card ev" data-ev="' + e.id + '"><div class="ev-cover" hidden><div class="ev-cover-img"></div><span class="ev-cover-when">' + fmtWhen(e.starts_at) + '</span><b>' + esc(e.title) + '</b></div><div class="ev-estado ev-estado--' + strip[0] + '">' + ic(strip[1]) + '<span>' + strip[2] + '</span></div><div class="ev-cuerpo">' +
        '<span class="ev-when">' + fmtWhen(e.starts_at) + '</span><b>' + esc(e.title) + '</b>' +
        (m.url ? '<div class="ev-meet"><button class="link" data-act="meet" type="button">' + ic('gmaps') + '<span>Salida: ' + esc(m.name || 'ver en Maps') + '</span></button>' + (m.lat != null ? '<button class="btn small" data-act="gomeet" type="button">' + ic('compass') + 'Ir al punto de salida</button>' : '') + '</div>'
          : (e.meet_name ? '<span class="muted">Salida: ' + esc(e.meet_name) + '</span>' : '')) + (e.description ? '<p>' + esc(e.description) + '</p>' : '') +
        (e.route ? '<div class="ev-route"><span>' + ic('route') + esc(e.route.name || 'Ruta') + ' · ' + String(e.route.dist || 0).replace('.', ',') + ' km</span><button class="btn small" data-act="route" type="button">Cargar ruta</button></div>' : '') +
        (/^https?:\/\//i.test(e.route_url || '') ? '<div class="ev-route"><span>' + ic('gmaps') + 'Ruta en Google Maps</span><button class="btn small" data-act="rurl" type="button">Abrir</button></div>' : '') +
        (routeAdm && !isAdmin() ? '<div class="ev-admin"><span class="muted rg-small">Eres administrador de esta ruta.</span><button class="link" data-act="edit" type="button">' + ic('edit') + 'Editar</button></div>' : '') +
        (st === 'offered' ? mineHtml + countHtml : countHtml + mineHtml) +
        (startBtn ? '<button class="btn big primary ev-start" data-act="start" type="button">' + ic('play') + 'Iniciar la ruta para los apuntados</button>' : '') +
        ((iGo || st === 'offered') && e.route && !canRun ? '<button class="link" data-act="enter" type="button">¿Ya ha empezado? Entrar en la ruta</button>' : '') +
        (iGo || st === 'waiting' || st === 'offered' || canRun ? '<div class="ev-chat-row"><button class="btn small ev-chat-btn" data-act="chat" type="button">' + ic('people') + 'Chat de los que van</button>' + bellHtml(e.id) + '</div>' : '') +
        (e.trip ? '<button class="btn small primary ev-chat-btn" data-act="trip" type="button">' + ic('route') + 'Ver el viaje: etapas, alojamiento y gastos</button>' : '') +
        (canRun ? '<button class="btn small" data-act="manage" type="button">' + ic('people') + 'Inscritos y llegada</button>' : '') +
        (isAdmin() ? '<div class="ev-admin"><button class="link" data-act="admins" type="button">' + ic('people') + '<span>Administradores<br>de esta ruta' + ((S.evAdmins[e.id] || []).length ? ' (' + S.evAdmins[e.id].length + ')' : '') + '</span></button><button class="link" data-act="edit" type="button">' + ic('edit') + 'Editar</button><button class="link danger" data-act="del" type="button">Borrar</button></div>' : '') + '</div></div>';
    }).join('') : '<div class="empty">No hay eventos ni rutas próximas.' + (isAdmin() ? ' Crea el primero.' : '') + '</div>');
    if ($('#evNew')) $('#evNew').addEventListener('click', function () { eventForm(c, null); });
        if ($('#evTrip')) $('#evTrip').addEventListener('click', function () { if (window.RGTrips) RGTrips.create(c.id); });
    $$('.ev', pane).forEach(function (card) {
      var e = evs.filter(function (x) { return x.id === card.dataset.ev; })[0], mine = att.filter(function (x) { return x.event_id === e.id && x.user_id === S.user.id; })[0];
      var set = function (status, companion, said, bike) {
        return setStatus(e, mine, status, companion, bike).then(function (got) {
          ring(c.id, { kind: 'att', eid: e.id });
          if (got === 'waiting' && (!mine || mine.status !== 'waiting')) { A.toast('Está completo: te he puesto en la lista de espera. Si queda una plaza, te aviso.', 'warn'); setTimeout(closedHelp, 1800); }
          else if (said) A.toast(said, 'ok');
          inbox(true); return paneEvents(c);
        }).catch(fail);
      };
      $$('[data-act]', card).forEach(function (b) { b.addEventListener('click', function () {
        var act = b.dataset.act, st = mine ? mine.status : 'no';
        if (act === 'go') askRideInfo(e, function (bike) { set('going', mine && mine.companion, st === 'going' ? '' : 'Apuntado. Te lo recordaré el día antes y una hora antes.', bike); });
        else if (act === 'confirm') askRideInfo(e, function (bike) { set('going', mine && mine.companion, 'Confirmado: la plaza es tuya.', bike); }, mine && mine.bike);
        else if (act === 'no') set('no', false, st === 'offered' ? 'Vale. La plaza pasa al siguiente de la lista.' : (st === 'waiting' ? 'Has salido de la lista de espera.' : 'Desapuntado.'));
        else if (act === 'comp') set(st, !(mine && mine.companion));
        else if (act === 'luma') openUrl(e.luma_url); else if (act === 'rurl') openUrl(e.route_url); else if (act === 'route') loadRoute(e);
        else if (act === 'meet') openUrl(meetOf(e).url); else if (act === 'gomeet') goMeet(e, b);
        else if (act === 'start') startEvent(e, b); else if (act === 'enter') enterEvent(e, b); else if (act === 'admins') eventAdmins(c, e);
        else if (act === 'trip') { if (window.RGTrips) RGTrips.open(e.id); } else if (act === 'bell') toggleMute(e.id); else if (act === 'chat') chatSheet(e); else if (act === 'who') whoGoes(e, att); else if (act === 'ticket') ticketSheet(e); else if (act === 'manage') manageSheet(e);
        else if (act === 'edit') eventForm(c, e); else if (act === 'del') armed(b, '¿Seguro? Toca otra vez', function () { sb.from('events').delete().eq('id', e.id).then(function (r) { ok(r); A.toast('Evento borrado.', 'ok'); inbox(true); return paneEvents(c); }).catch(fail); });
      }); });
    });
    covers(c, evs);
  }
  // «Ir al punto de salida»: lo pone en el mapa de la app con el camino desde donde estás. «Iniciar ruta» te guía hasta allí.
  function goMeet(e, btn) {
    var m = meetOf(e), label = (m.name || 'Punto de salida').split(',')[0];
    if (m.lat == null) { if (m.url) openUrl(m.url); return; }
    if (A.isRec()) { A.toast('Ya tienes una ruta en marcha. Párala antes de ir al punto de salida.', 'warn'); return; }
    var fix = A.lastFix();
    if (!fix) {
      A.showView('map'); var mp = A.map(); if (mp) mp.easeTo({ center: [m.lon, m.lat], zoom: 15 });
      A.previewPlan({ id: 9e12 + 1, name: 'Salida: ' + label, wps: [[m.lat, m.lon, label]], pois: [], coords: [[m.lon, m.lat], [m.lon, m.lat]], steps: [], dist: 0, dur: 0, routed: false, created: Date.now(), toMeet: true });
      A.toast('Te marco el punto de salida. En cuanto tenga tu ubicación, vuelve a pulsar para ver el camino.', 'warn'); return;
    }
    Cl.busy(btn, function () {
      return A.routeBetween([[fix.lat, fix.lon], [m.lat, m.lon]]).then(function (r) {
        var st = r.steps || []; if (st.length && st[st.length - 1].icon === 'arrive') st[st.length - 1].text = 'llegas al punto de salida';
        A.previewPlan({ id: 9e12 + 1, name: 'Hasta la salida: ' + label, wps: [[fix.lat, fix.lon, ''], [m.lat, m.lon, label]], pois: [], coords: r.coords, steps: st, dist: Math.round(r.dist * 10) / 10, dur: Math.round(r.dur), routed: !!r.routed, created: Date.now(), toMeet: true });
        A.toast('Punto de salida en el mapa' + (r.routed ? ': ' + String(Math.round(r.dist * 10) / 10).replace('.', ',') + ' km' : '') + '. Pulsa «Iniciar ruta» para que te guíe hasta allí.', 'ok');
      });
    });
  }
  // El administrador (de la comunidad o solo de esta ruta) inicia la ruta: se crea el grupo sin códigos, se le carga la ruta,
  // empieza a grabar y a los apuntados les sale «¿Vienes?» en la app.
  function startEvent(e, btn) {
    if (!window.RGGroup) return;
    armed(btn, '¿Empezamos? Toca otra vez', function () {
      Cl.busy(btn, function () { return sb.rpc('event_start', { p_event: e.id }).then(function (r) {
        if (r.error) throw r.error;
        ring(e.community_id, { kind: 'call', id: r.data && r.data.id, eid: e.id });
        return RGGroup.enter(r.data, { start: true }).then(function () { A.toast('Ruta iniciada. A los apuntados les sale el aviso para unirse.', 'ok'); });
      }); });
    });
  }
  function enterEvent(e, btn) {
    if (!window.RGGroup) return;
    Cl.busy(btn, function () { return sb.rpc('ride_calls').then(function (r) {
      if (r.error) throw r.error;
      var c = (r.data || []).filter(function (x) { return x.event_id === e.id; })[0];
      if (!c) { A.toast(RGGroup.state.s && RGGroup.state.s.eventId === e.id ? 'Ya estás dentro de esta ruta.' : 'Todavía no la ha iniciado ningún administrador.', 'warn'); return; }
      return sb.rpc('ride_join_event', { p_id: c.id }).then(function (q) { if (q.error) throw q.error; return RGGroup.enter(q.data, { start: true }); });
    }); });
  }
  // Administradores solo de esta ruta: pueden iniciarla, reciben los avisos y reparten los grupos, sin serlo de la comunidad.
  function eventAdmins(c, e) {
    sb.from('community_members').select('user_id,role').eq('community_id', c.id).then(function (r) {
      var ms = ok(r); return names(ms.map(function (m) { return m.user_id; })).then(function () {
        var cur = S.evAdmins[e.id] || [];
        Cl.sheet('<div class="head"><h1>Administradores de esta ruta</h1><button class="btn small icon" id="clX" type="button"><svg><use href="#i-close"/></svg></button></div><p class="muted">' + esc(e.title) + '. Quien marques podrá iniciar esta ruta, recibirá los avisos de SOS, avería y gasolina y podrá repartir los grupos. No será administrador de la comunidad ni de otras rutas.</p><div class="rg-list">' +
          ms.map(function (m) { var on = cur.indexOf(m.user_id) >= 0; return '<div class="club-person" data-u="' + m.user_id + '">' + ava(m.user_id) + '<div><b>' + esc(who(m.user_id)) + '</b><span class="muted">' + (m.role === 'admin' ? 'Administrador de la comunidad' : esc(bike(m.user_id))) + '</span></div>' +
            (m.role === 'admin' ? '<span class="mstatus ok">Ya puede</span>' : '<button class="btn small' + (on ? ' primary' : '') + '" type="button">' + (on ? 'Admin de la ruta ✓' : 'Hacer admin') + '</button>') + '</div>'; }).join('') + '</div>');
        $('#clX').addEventListener('click', function () { Cl.closeSheet(); paneEvents(c); });
        $$('#rgSheet [data-u] .btn').forEach(function (b) { b.addEventListener('click', function () {
          var uid = b.parentNode.dataset.u, on = (S.evAdmins[e.id] || []).indexOf(uid) >= 0;
          (on ? sb.from('event_admins').delete().eq('event_id', e.id).eq('user_id', uid) : sb.from('event_admins').insert({ event_id: e.id, user_id: uid })).then(function (q) {
            ok(q); S.evAdmins[e.id] = (S.evAdmins[e.id] || []).filter(function (x) { return x !== uid; }); if (!on) S.evAdmins[e.id].push(uid); eventAdmins(c, e);
          }).catch(fail);
        }); });
      });
    }).catch(fail);
  }
  function loadRoute(e) {
    var r = e.route;
    if (r && r.lite) {      // en la lista solo viene el resumen: la ruta entera se pide ahora
      A.toast('Cargando la ruta…', 'ok');
      return sb.from('events').select('route').eq('id', e.id).single().then(function (q) { e.route = ok(q).route; if (e.route) loadRoute(e); else A.toast('Este evento no tiene ruta.', 'warn'); }).catch(fail);
    }
    if (!r || !r.coords || r.coords.length < 2) { A.toast('Este evento no tiene ruta.', 'warn'); return; }
    var p = { id: parseInt(e.id.replace(/-/g, '').slice(0, 12), 16), name: r.name || e.title, wps: r.wps || [], pois: r.pois || [], coords: r.coords, dist: r.dist || 0, dur: r.dur || 0, routed: true, steps: r.steps || [], created: Date.now(), eventId: e.id };
    A.usePlan(p).then(function () { A.toast('Ruta cargada. Pulsa «Iniciar ruta» cuando salgáis.', 'ok'); });
  }
  // Mi entrada: el mismo código QR que sale en la web, para enseñarlo al llegar. El código lo da el servidor.
  var WEB = 'https://regroupride-eventos.netlify.app';
  function qrSvg(text) { try { var q = window.qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); } catch (x) { return ''; } }
  // Al apuntarse: con qué moto viene y un teléfono para que el administrador pueda llamarle.
  // Con una sola moto en el garaje y el teléfono ya puesto no se pregunta nada.
  function askRideInfo(e, then, already) {
    var motos = A.vehicles().filter(function (v) { return (v.type || 'moto') !== 'coche'; }), name = function (v) { return (v.name || [v.make, v.model].filter(Boolean).join(' ') || 'Mi moto').trim(); };
    var phone = Cl.ridePhone ? Cl.ridePhone() : null, needPhone = phone === '';
    if (already && !needPhone) { then(already); return; }
    if (motos.length === 1 && !needPhone) { then(name(motos[0])); return; }
    var main = motos.filter(function (v) { return v.principal; })[0] || motos[0];
    Cl.sheet('<div class="head"><h1>Apuntarme</h1><button class="btn small icon" id="clX" type="button" aria-label="Cerrar"><svg><use href="#i-close"/></svg></button></div><p class="muted" style="text-align:left;margin:0">' + esc(e.title) + '</p><form class="rg-form" id="riForm">' +
      (already ? '' : motos.length > 1 ? '<label>¿Con qué moto vienes?<select id="riBike">' + motos.map(function (v) { return '<option' + (v === main ? ' selected' : '') + '>' + esc(name(v)) + '</option>'; }).join('') + '</select></label>'
        : motos.length === 1 ? '<p style="text-align:left;margin:0">Moto: <b>' + esc(name(motos[0])) + '</b></p>'
        : '<label>¿Con qué moto vienes?<input id="riBikeTxt" required minlength="2" maxlength="80" placeholder="Marca y modelo, p. ej. Zontes 703 RR"></label><p class="muted rg-small" style="text-align:left">Si la añades en Garaje, la próxima vez no te lo pregunto.</p>') +
      (needPhone ? '<label>Tu teléfono<input id="riPhone" type="tel" inputmode="tel" required minlength="9" maxlength="20" pattern="[0-9+ ]{9,20}" autocomplete="tel" placeholder="600 000 000"></label><p class="muted rg-small" style="text-align:left">Solo lo ven los administradores de la ruta, para llamarte si no apareces a la salida.</p>' : '') +
      '<button class="btn big primary" type="submit">Apuntarme</button></form>');
    $('#clX').addEventListener('click', Cl.closeSheet);
    $('#riForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var bike = already || ($('#riBike') ? $('#riBike').value : $('#riBikeTxt') ? $('#riBikeTxt').value.trim() : name(motos[0]));
      Cl.busy(ev.target.querySelector('button[type=submit]'), function () {
        return (needPhone ? Cl.savePhone($('#riPhone').value.trim()) : Promise.resolve()).then(function () { Cl.closeSheet(); then(bike); });
      });
    });
  }
  function icn(n) { return '<svg><use href="#i-' + n + '"/></svg>'; }
  function rpcOk(fn, args) { return sb.rpc(fn, args).then(function (r) { if (r.error) throw r.error; return r.data; }); }
  // Inscritos y llegada (administradores): apuntados de la app y de la web, aprobar, marcar la llegada y leer las entradas.
  var MST = { going: 'Con plaza', offered: 'Plaza ofrecida', waiting: 'En espera', pending: 'Por aprobar', declined: 'Rechazado' }, MORD = ['pending', 'going', 'offered', 'waiting', 'declined'];
  function manageSheet(e, find) {
    find = find || '';
    var shell = function (body) {
      Cl.sheet('<div class="head"><h1>Inscritos</h1><button class="btn small icon" id="clX" type="button" aria-label="Cerrar"><svg><use href="#i-close"/></svg></button></div><p class="muted" style="text-align:left;margin:0">' + esc(e.title) + '</p>' + body);
      $('#clX').addEventListener('click', Cl.closeSheet);
    };
    if ($('#rgSheet').hidden) shell('<p class="muted">Cargando…</p>');
    rpcOk('event_manage', { p_event: e.id }).then(function (d) {
      var rows = d.members.map(function (m) { m.kind = 'm'; return m; }).concat(d.guests.map(function (g) { g.kind = 'g'; return g; }));
      rows.sort(function (a, b) { return MORD.indexOf(a.status) - MORD.indexOf(b.status) || a.joined_at - b.joined_at; });
      var n = function (f) { return rows.filter(f).length; }, again = function () { manageSheet(e, find); };
      shell('<div class="rg-mstats"><div><b>' + n(function (x) { return x.status === 'going' || x.status === 'offered'; }) + (e.capacity ? '<small> / ' + e.capacity + '</small>' : '') + '</b><span>Con plaza</span></div><div><b>' + n(function (x) { return x.status === 'waiting'; }) + '</b><span>En espera</span></div><div><b>' + n(function (x) { return x.status === 'pending'; }) + '</b><span>Por aprobar</span></div><div><b>' + n(function (x) { return x.checked_in; }) + '</b><span>Han llegado</span></div></div>' +
        '<button class="btn big primary" id="mgScan" type="button">' + icn('qr') + 'Leer entradas (QR)</button>' +
        '<div class="rg-form"><input id="mgFind" placeholder="Buscar por nombre, moto o teléfono" value="' + esc(find) + '" autocomplete="off"></div>' +
        '<div class="rg-list" id="mgList"></div><button class="btn small" id="mgWeb" type="button">' + icn('share') + 'Abrir en la web (respuestas y descarga)</button>');
      var list = function () {
        var f = find.toLowerCase(), vis = rows.filter(function (x) { return !f || (x.name + ' ' + (x.phone || '') + ' ' + (x.email || '') + ' ' + (x.bike || '')).toLowerCase().indexOf(f) >= 0; });
        $('#mgList').innerHTML = vis.length ? vis.map(function (x) {
          var b = '';
          if (x.status === 'pending') b = '<button class="btn small primary" data-a="approve" type="button">Aprobar</button><button class="btn small" data-a="decline" type="button">Rechazar</button>';
          else if (x.status === 'going') b = '<button class="btn small' + (x.checked_in ? '' : ' primary') + '" data-a="' + (x.checked_in ? 'uncheck' : 'checkin') + '" type="button">' + (x.checked_in ? 'Quitar llegada' : 'Ha llegado') + '</button>';
          else if (x.kind === 'g') b = '<button class="btn small" data-a="approve" type="button">' + (x.status === 'declined' ? 'Aprobar' : 'Dar plaza') + '</button>';
          return '<div class="club-person rg-mrow" data-i="' + rows.indexOf(x) + '"><span class="rg-ava ' + (x.checked_in ? 'rol-admin' : 'rol-comp') + '">' + esc((x.name || '?').charAt(0).toUpperCase()) + '</span><div><b>' + esc(x.name) + (x.companion ? ' <span class="mstatus">+1</span>' : '') + '</b>' +
            '<span class="muted rg-small">' + MST[x.status] + ' · ' + (x.kind === 'm' ? 'App' : 'Web') + (x.checked_in ? ' · <b>ha llegado</b>' : '') + '</span>' +
            '<span class="rg-small rg-mbike">' + icn('bike') + (x.bike ? esc(x.bike) : '<span class="muted">Moto sin indicar</span>') + '</span>' +
            '<div class="rg-row">' + (x.phone ? '<a class="btn small rg-call" href="tel:' + esc(String(x.phone).replace(/[^0-9+]/g, '')) + '">' + icn('phone') + 'Llamar · ' + esc(x.phone) + '</a>' : '<span class="muted rg-small">Sin teléfono</span>') + b + '</div></div></div>';
        }).join('') : '<div class="empty">' + (rows.length ? 'Nadie coincide con la búsqueda.' : 'Todavía no se ha apuntado nadie.') + '</div>';
        $$('#mgList [data-a]').forEach(function (bt) {
          bt.addEventListener('click', function () {
            var x = rows[+bt.closest('.rg-mrow').dataset.i], a = bt.dataset.a;
            Cl.busy(bt, function () { return (x.kind === 'g' ? rpcOk('guest_set', { p_guest: x.id, p_action: a }) : rpcOk('member_checkin', { p_event: e.id, p_user: x.id, p_on: a === 'checkin' })).then(again); });
          });
        });
      };
      list();
      $('#mgFind').addEventListener('input', function () { find = this.value.trim(); list(); });
      $('#mgWeb').addEventListener('click', function () { openUrl(WEB + '/?m=' + e.id); });
      $('#mgScan').addEventListener('click', function () { scanTickets(e, again); });
    }).catch(function (x) { shell('<div class="notice">' + esc(Cl.msg ? Cl.msg(x) : (x && x.message) || 'No se ha podido cargar la lista.') + '</div>'); });
  }
  // Lector de entradas: la cámara lee el QR y el servidor marca la llegada. Si no hay cámara, se escribe el código.
  var jsqrJob = null;
  function loadJsqr() { return jsqrJob || (jsqrJob = new Promise(function (ok, no) { var sc = document.createElement('script'); sc.src = 'vendor/jsqr.js'; sc.onload = ok; sc.onerror = function () { jsqrJob = null; no(new Error('No se ha podido cargar el lector.')); }; document.head.appendChild(sc); })); }
  function scanTickets(e, done) {
    var el = document.createElement('div'), stream = null, timer = 0, last = '', lastAt = 0, cv = document.createElement('canvas'), n = 0;
    el.className = 'rg-scan';
    el.innerHTML = '<div class="rg-scan-cam"><video playsinline muted></video><i></i></div><div class="rg-scan-r" id="scR">Apunta la cámara al código de la entrada.</div><span class="muted rg-small" id="scN"></span><form id="scF" class="rg-form"><input id="scC" placeholder="…o escribe el código" autocomplete="off" autocapitalize="off"></form><button class="btn big" id="scX" type="button">Terminar</button>';
    document.body.appendChild(el);
    var v = el.querySelector('video'), out = el.querySelector('#scR'), say = function (t, k) { out.textContent = t; out.className = 'rg-scan-r' + (k ? ' ' + k : ''); };
    var check = function (code) {
      code = String(code || '').trim(); if (!code) return; var now = Date.now(); if (code === last && now - lastAt < 4000) return; last = code; lastAt = now;
      rpcOk('event_checkin', { p_event: e.id, p_code: code }).then(function (r) {
        if (r.ok) { if (!r.already) { n++; el.querySelector('#scN').textContent = n + (n === 1 ? ' llegada marcada' : ' llegadas marcadas'); } say((r.already ? 'Ya había llegado: ' : 'Bienvenido, ') + r.name + (r.companion ? ' (+1)' : ''), r.already ? 'warn' : 'ok'); }
        else say((r.name ? r.name + ': ' : '') + r.error, 'bad');
        try { if (navigator.vibrate) navigator.vibrate(r.ok ? 70 : [70, 60, 70]); } catch (x) {}
      }, function (x) { say((x && x.message) || 'No se ha podido comprobar.', 'bad'); });
    };
    var close = function () { clearInterval(timer); if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); if (el.parentNode) el.parentNode.removeChild(el); done(); };
    el.querySelector('#scX').addEventListener('click', close);
    el.querySelector('#scF').addEventListener('submit', function (ev) { ev.preventDefault(); var i = el.querySelector('#scC'); check(i.value); i.value = ''; });
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { say('Aquí no se puede usar la cámara. Escribe el código o marca la llegada en la lista.', 'bad'); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }).then(function (st) {
      stream = st; v.srcObject = st; var pl = v.play(); if (pl && pl.catch) pl.catch(function () {});
      var det = null; try { if ('BarcodeDetector' in window) det = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (x) { det = null; }
      (det ? Promise.resolve() : loadJsqr()).then(function () {
        timer = setInterval(function () {
          if (v.readyState < 2 || !v.videoWidth) return;
          if (det) det.detect(v).then(function (c) { if (c && c[0]) check(c[0].rawValue); }, function () {});
          else { var w = cv.width = 480, h = cv.height = Math.round(480 * v.videoHeight / v.videoWidth) || 480, x = cv.getContext('2d', { willReadFrequently: true }); x.drawImage(v, 0, 0, w, h); var q = window.jsQR(x.getImageData(0, 0, w, h).data, w, h); if (q && q.data) check(q.data); }
        }, 280);
      }, function (x) { say(x.message, 'bad'); });
    }, function () { if (!last) say('No hay permiso para usar la cámara. Dáselo a la app en los ajustes del móvil, o escribe el código.', 'bad'); });
  }
  /* ---------- chat del evento: solo quienes van (apuntados, lista de espera) y los administradores ---------- */
  // Avisos del chat: cada uno los quita o los pone por evento (la campana de la tarjeta y la del propio chat).
  var MUTES = null, BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7 2.5 7h-17S6 15 6 9"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>';
  function muted(id) { return !!(MUTES && MUTES[id]); }
  function bellHtml(id) { var on = !muted(id); return '<button class="ev-bell" data-act="bell" data-bell="' + id + '" type="button" aria-pressed="' + on + '" aria-label="Avisos del chat" title="' + (on ? 'Avisos del chat activados' : 'Avisos del chat silenciados') + '">' + BELL + '</button>'; }
  function paintBells() { $$('[data-bell]').forEach(function (b) { var on = !muted(b.dataset.bell); b.setAttribute('aria-pressed', String(on)); b.title = on ? 'Avisos del chat activados' : 'Avisos del chat silenciados'; }); var t = $('#chMuteTx'); if (t) t.textContent = muted(t.dataset.ev) ? 'Avisos de este chat: silenciados' : 'Avisos de este chat: activados'; }
  function loadMutes() { if (!S.user) return; sb.from('event_chat_mutes').select('event_id').eq('user_id', S.user.id).then(function (r) { if (r.error) return; MUTES = {}; (r.data || []).forEach(function (x) { MUTES[x.event_id] = 1; }); paintBells(); }, function () {}); }
  function toggleMute(id) {
    MUTES = MUTES || {}; var was = muted(id);
    if (was) delete MUTES[id]; else MUTES[id] = 1; paintBells();
    (was ? sb.from('event_chat_mutes').delete().eq('event_id', id).eq('user_id', S.user.id) : sb.from('event_chat_mutes').upsert({ event_id: id, user_id: S.user.id }))
      .then(function (r) { ok(r); A.toast(was ? 'Te avisaré de los mensajes de este chat.' : 'Chat silenciado: no te llegarán avisos de este evento.', 'ok'); })
      .catch(function (er) { if (was) MUTES[id] = 1; else delete MUTES[id]; paintBells(); fail(er); });
  }
  setTimeout(loadMutes, 2500); setInterval(function () { if (MUTES === null) loadMutes(); }, 6000);
  var chatT = 0;
  function chatSheet(e) {
    clearInterval(chatT);
    Cl.sheet('<div class="head"><h1>Chat del evento</h1><button class="btn small icon" id="clX" type="button" aria-label="Cerrar"><svg><use href="#i-close"/></svg></button></div>' +
      '<p class="muted" style="text-align:left;margin:0">' + esc(e.title) + ' · ' + fmtWhen(e.starts_at) + '. Solo lo ven quienes van y los administradores.</p>' +
      '<div class="ev-chat" id="chList"><p class="muted">Cargando…</p></div>' +
      '<form class="ev-chat-form" id="chForm"><input id="chIn" maxlength="1000" autocomplete="off" enterkeyhint="send" placeholder="Escribe un mensaje…" aria-label="Mensaje"><button class="ch-send" type="submit" aria-label="Enviar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button></form>' +
      '<div class="ch-mute"><span id="chMuteTx" data-ev="' + e.id + '"></span>' + bellHtml(e.id).replace(' data-act="bell"', '') + '</div>');
    $('#rgSheet [data-bell]').addEventListener('click', function () { toggleMute(e.id); }); paintBells(); if (MUTES === null) loadMutes();
    $('#clX').addEventListener('click', function () { clearInterval(chatT); Cl.closeSheet(); });
    var last = -1, BK = {};
    sb.from('event_attendees').select('user_id,bike').eq('event_id', e.id).then(function (r) { (r.data || []).forEach(function (x) { if (x.bike) BK[x.user_id] = x.bike; }); last = -1; load(true); }, function () {});
    function bikeOf(id) { var p = S.names[id]; return BK[id] || (p ? [p.bike_brand, p.bike_model].filter(Boolean).join(' ') : ''); }
    function load(force) {
      if (!$('#chList')) { clearInterval(chatT); return Promise.resolve(); }
      return sb.from('event_messages').select('id,user_id,body,created_at').eq('event_id', e.id).order('id', { ascending: false }).limit(200).then(function (r) {
        var rows = ok(r).reverse(), top = rows.length ? rows[rows.length - 1].id : 0; if (top === last && !force) return;
        return names(rows.map(function (x) { return x.user_id; })).catch(function () {}).then(function () {
          var el = $('#chList'); if (!el || el.dataset.ev !== e.id) return;
          var stick = last < 0 || el.scrollHeight - el.scrollTop - el.clientHeight < 80, day = '';
          last = top;
          el.innerHTML = rows.length ? rows.map(function (x) {
            var d = new Date(x.created_at), k = d.toDateString(), me = x.user_id === S.user.id, sep = '';
            if (k !== day) { day = k; sep = '<span class="ev-chat-day">' + d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }) + '</span>'; }
            return sep + '<div class="ev-msg' + (me ? ' me' : '') + '">' + (me ? '' : ava(x.user_id)) + '<div><b>' + esc(who(x.user_id)) + (bikeOf(x.user_id) ? ' <small>· ' + esc(bikeOf(x.user_id)) + '</small>' : '') + '</b><p>' + esc(x.body) + '</p><time>' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) + '</time></div></div>';
          }).join('') : '<p class="muted">Todavía no ha escrito nadie. Rompe el hielo: ¿de dónde sales?</p>';
          if (stick) el.scrollTop = el.scrollHeight;
        });
      }).catch(function (er) { var el = $('#chList'); if (el && last < 0) el.innerHTML = '<p class="muted">' + esc(Cl.msg(er)) + '</p>'; });
    }
    $('#chList').dataset.ev = e.id;
    $('#chForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var inp = $('#chIn'), text = inp.value.trim(); if (!text) return;
      var b = ev.target.querySelector('button'); b.disabled = true;
      sb.from('event_messages').insert({ event_id: e.id, body: text }).then(function (r) { ok(r); inp.value = ''; return load(true); }).catch(fail).then(function () { b.disabled = false; inp.focus(); });
    });
    load(true);
    chatT = setInterval(function () { if (!$('#chList')) { clearInterval(chatT); return; } if (document.visibilityState !== 'hidden') load(false); }, 5000);
  }
  function ticketSheet(e) {
    Cl.sheet('<div class="head"><h1>Mi entrada</h1><button class="btn small icon" id="clX" type="button" aria-label="Cerrar"><svg><use href="#i-close"/></svg></button></div>' +
      '<div class="rg-ticket"><div class="rg-ticket-qr" id="tkQr"><span class="muted">Cargando…</span></div><b>' + esc(e.title) + '</b><span class="muted">' + fmtWhen(e.starts_at) + '</span><span class="muted rg-small">Enseña este código al llegar: el organizador lo lee y marca tu llegada.</span></div>' +
      '<button class="btn" id="tkWeb" type="button">' + icn('share') + 'Compartir el evento</button>');
    $('#clX').addEventListener('click', Cl.closeSheet);
    $('#tkWeb').addEventListener('click', function () { var u = WEB + '/?e=' + e.id; if (navigator.share) navigator.share({ title: e.title, url: u }).catch(function () {}); else openUrl(u); });
    sb.rpc('event_public', { p_id: e.id }).then(function (r) {
      var box = $('#tkQr'); if (!box) return;
      var code = r.data && r.data.ticket, svg = code ? qrSvg(code) : '';
      if (svg) box.innerHTML = svg; else box.innerHTML = '<span class="muted">' + (r.error ? 'No se ha podido cargar la entrada. Revisa la conexión.' : 'La entrada aparece cuando tienes la plaza confirmada.') + '</span>';
    });
  }
  function whoGoes(e, att) {
    var going = att.filter(function (x) { return x.event_id === e.id && x.status === 'going'; }), off = att.filter(function (x) { return x.event_id === e.id && x.status === 'offered'; }), queue = queueOf(att, e);
    var evAd = S.evAdmins[e.id] || [];
    var person = function (g, tag) { var ad = evAd.indexOf(g.user_id) >= 0; return '<div class="club-person">' + ava(g.user_id, ad ? 'rol-admin' : 'rol-comp') + '<div><b>' + esc(who(g.user_id)) + (ad ? ' <span class="mstatus ok">admin</span>' : '') + (g.companion ? ' <span class="mstatus">+1</span>' : '') + (tag ? ' <span class="mstatus">' + tag + '</span>' : '') + '</b><span class="muted">' + esc(bike(g.user_id)) + '</span></div></div>'; };
    Cl.sheet('<div class="head"><h1>Quién viene</h1><button class="btn small icon" id="clX" type="button"><svg><use href="#i-close"/></svg></button></div><p class="muted">' + esc(e.title) + ' · ' + fmtWhen(e.starts_at) + (e.capacity ? ' · ' + e.capacity + (e.capacity === 1 ? ' plaza' : ' plazas') : '') + '</p><div class="rg-list">' +
      (going.length || off.length ? going.map(function (g) { return person(g); }).join('') + off.map(function (g) { return person(g, 'por confirmar'); }).join('') : '<p class="muted">Nadie apuntado todavía.</p>') + '</div>' +
      (queue.length && (isAdmin() || (S.evAdmins[e.id] || []).indexOf(S.user.id) >= 0) ? '<h2 class="rg-h2">Lista de espera</h2><p class="muted rg-small" style="text-align:left">Solo la ven los administradores.</p><div class="rg-list">' + queue.map(function (g, i) { return person(g, 'puesto ' + (i + 1)); }).join('') + '</div>' : ''));
    $('#clX').addEventListener('click', Cl.closeSheet);
  }
  function eventForm(c, e) {
    var plans = A.plans(), keep = e && e.route ? '<option value="keep" selected>' + esc('Mantener: ' + (e.route.name || 'ruta actual')) + '</option>' : '';
    var link0 = e ? (e.meet_url || (e.meet_lat != null ? L.mapsPointUrl(e.meet_lat, e.meet_lon) : '')) : '', v6 = S.v6 !== false;
    Cl.sheet('<div class="head"><h1>' + (e ? 'Editar evento' : 'Nuevo evento') + '</h1><button class="btn small icon" id="clX" type="button"><svg><use href="#i-close"/></svg></button></div><form class="rg-form" id="evForm">' +
      '<label>Nombre<input id="evTitle" required maxlength="120" value="' + esc(e ? e.title : '') + '" placeholder="Ruta del domingo"></label>' +
      '<label>Día y hora de salida<input id="evWhen" type="datetime-local" required value="' + localInput(e && e.starts_at) + '"></label>' +
      '<label>Punto de salida<input id="evMeet" maxlength="120" value="' + esc(e ? e.meet_name : '') + '" placeholder="Gasolinera de…"></label>' +
      (v6 ? '<label>Enlace de Google Maps del punto de salida<input id="evMeetUrl" inputmode="url" maxlength="600" value="' + esc(link0) + '" placeholder="Pega aquí el enlace del sitio"></label>' +
        '<div class="rg-row" style="margin-top:-4px"><button class="btn small" id="evPaste" type="button">Pegar</button><button class="btn small" id="evHere" type="button">Usar donde estoy ahora</button></div>' +
        '<p class="muted rg-small" style="text-align:left">En Google Maps: toca el sitio → Compartir → Copiar enlace. Si lo dejas vacío y el evento lleva ruta, la salida es donde empieza la ruta.</p>' +
        '<label>Plazas (motos)<input id="evCap" type="number" inputmode="numeric" min="1" max="1000" value="' + (e && e.capacity ? e.capacity : '') + '" placeholder="Sin límite"></label>' +
        '<p class="muted rg-small" style="text-align:left">Con límite, quien se apunte cuando esté lleno queda en lista de espera. Si alguien se desapunta, la plaza se ofrece al siguiente y tiene que confirmar.</p>'
        : (isAdmin() ? '<p class="muted rg-small" style="text-align:left">Para poner límite de plazas, lista de espera y enlace de Maps de la salida falta ejecutar <b>supabase/06_plazas_y_salida.sql</b> en Supabase.</p>' : '')) +
      '<label>Descripción<textarea id="evDesc" maxlength="4000" placeholder="Paradas, nivel, normas, lo que quieras contar">' + esc(e ? e.description : '') + '</textarea></label>' +
      '<label>Ruta<select id="evRoute"><option value="">Sin ruta</option>' + keep + plans.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + ' · ' + String(p.dist).replace('.', ',') + ' km</option>'; }).join('') + '</select></label>' +
      '<p class="muted rg-small" style="text-align:left">Salen tus rutas planificadas. Para añadir una, créala en el mapa (pegando el enlace de Google Maps) y guárdala.</p>' +
      (v6 ? '<label>Enlace de la ruta en Google Maps (opcional)<input id="evRouteUrl" inputmode="url" maxlength="600" value="' + esc(e && e.route_url ? e.route_url : '') + '" placeholder="Pega aquí el enlace de la ruta"></label>' : '') +
      '<label>Foto de portada (opcional)<input id="evCover" type="file" accept="image/*"></label>' +
      '<label>Enlace de Luma (opcional)<input id="evLuma" inputmode="url" maxlength="300" value="' + esc(e && e.luma_url ? e.luma_url : '') + '" placeholder="https://luma.com/…"></label>' +
      '<button class="btn big primary" type="submit">' + (e ? 'Guardar cambios' : 'Publicar') + '</button></form>');
    $('#clX').addEventListener('click', Cl.closeSheet);
    if ($('#evPaste')) $('#evPaste').addEventListener('click', function () {
      var job = P.Clipboard ? P.Clipboard.read().then(function (r) { return (r && r.value) || ''; }) : (navigator.clipboard && navigator.clipboard.readText ? navigator.clipboard.readText() : Promise.reject());
      Promise.resolve(job).then(function (t) { var u = L.extractUrl(t) || (L.parseMapsPoint(t) ? t.trim() : ''); if (u) $('#evMeetUrl').value = u; else A.toast('No hay ningún enlace copiado.', 'warn'); }, function () { A.toast('No puedo leer lo copiado: mantén pulsado el campo y elige Pegar.', 'warn'); });
    });
    if ($('#evHere')) $('#evHere').addEventListener('click', function () { var f = A.lastFix(); if (!f) { A.toast('Aún no tengo tu ubicación.', 'warn'); return; } $('#evMeetUrl').value = L.mapsPointUrl(f.lat, f.lon); });
    $('#evForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var row = { community_id: c.id, title: $('#evTitle').value.trim(), starts_at: new Date($('#evWhen').value).toISOString(), meet_name: $('#evMeet').value.trim(), description: $('#evDesc').value.trim(), luma_url: $('#evLuma').value.trim() || null };
      var sel = $('#evRoute').value, route = e ? e.route : null;
      if (sel !== 'keep') { var p = plans.filter(function (x) { return String(x.id) === sel; })[0]; row.route = route = p ? { name: p.name, wps: p.wps, pois: p.pois || [], coords: p.coords, steps: p.steps || [], dist: p.dist, dur: p.dur } : null; }
      var link = v6 ? $('#evMeetUrl').value.trim() : '', cap = v6 ? parseInt($('#evCap').value, 10) : NaN, warn = '';
      var rurl = v6 && $('#evRouteUrl') ? (L.extractUrl($('#evRouteUrl').value) || $('#evRouteUrl').value.trim()) : '';
      if (rurl && !/^https?:\/\//i.test(rurl)) { A.toast('El enlace de la ruta tiene que empezar por https://', 'warn'); return; }
      if (v6 && $('#evCap').value.trim() && !(cap >= 1 && cap <= 1000)) { A.toast('Las plazas tienen que ser un número entre 1 y 1000.', 'warn'); return; }
      Cl.busy(ev.target.querySelector('button[type=submit]'), function () {
        var point = !v6 ? Promise.resolve(null) : (link ? (e && link === link0 && e.meet_lat != null ? Promise.resolve({ url: e.meet_url, lat: e.meet_lat, lon: e.meet_lon }) : window.RGNav.resolvePoint(link)) : Promise.resolve({ url: null, lat: null, lon: null }));
        return point.then(function (pt) {
          if (pt) {
            row.route_url = rurl || null; row.capacity = cap >= 1 ? cap : null; row.meet_url = pt.url || null; row.meet_lat = pt.lat != null ? pt.lat : null; row.meet_lon = pt.lon != null ? pt.lon : null;
            if (pt.url && pt.lat == null) warn = 'El enlace se abrirá en Google Maps, pero no trae coordenadas: no podré marcar la salida en el mapa de la app.';
            if (pt.name && !row.meet_name) row.meet_name = pt.name;
          }
          var save0 = function () { return (e ? sb.from('events').update(row).eq('id', e.id).select('id') : sb.from('events').insert(row)); };
          var cf = $('#evCover') && $('#evCover').files && $('#evCover').files[0];
          var save = function () {
            if (!cf) return save0();
            return uploadCover(cf).then(function (url) { cf = null; if (url) row.cover_url = url; else warn = 'Guardado, pero la foto no se ha podido subir (falta ejecutar supabase/11_push_y_web.sql).'; return save0(); });
          };
          return save().then(function (r) {
            if (r.error && pt && /capacity|route_url|meet_(url|lat|lon)/i.test(r.error.message || '')) {     // el servidor aún no tiene el 06
              S.v6 = false; delete row.capacity; delete row.route_url; delete row.meet_url; delete row.meet_lat; delete row.meet_lon; warn = 'Guardado sin plazas ni enlace de salida: falta ejecutar supabase/06_plazas_y_salida.sql.';
              return save();
            }
            return r;
          }).then(function (r) {
            ok(r);
            if (e && !isAdmin() && r.data && !r.data.length) throw new Error('No se ha podido guardar: para que los administradores de la ruta puedan editar el evento falta ejecutar supabase/10_tiempo_real.sql.');
            Cl.closeSheet(); A.toast(warn || (e ? 'Evento actualizado.' : 'Evento publicado.'), warn ? 'warn' : 'ok');
            ring(c.id, { kind: e ? 'edit' : 'event' }); inbox(true); return paneEvents(c);
          });
        });
      });
    });
  }

  /* ---------- tablón ---------- */
  function paneBoard(c, useCache) {
    return swr('board:' + c.id, function () {
      return sb.from('community_posts').select('id,body,created_at,author_id').eq('community_id', c.id).order('created_at', { ascending: false }).limit(40).then(function (r) {
        var posts = ok(r); return names(posts.map(function (p) { return p.author_id; })).then(function () { return posts; }); });
    }, function (posts) { (function () {
        var pane = $('#clPane'); if (!pane || S.tab !== 'board' || !cur() || cur().id !== c.id) return;
        pane.innerHTML = (isAdmin() ? '<div class="club-card"><span class="label">Aviso para la comunidad</span><textarea class="note" id="poBody" maxlength="4000" placeholder="Escribe un aviso para la comunidad"></textarea><button class="btn big primary" id="poSend" type="button">Publicar aviso</button></div>' : '') +
          (posts.length ? posts.map(function (p) { return '<div class="club-card" data-po="' + p.id + '"><span class="muted">' + esc(who(p.author_id)) + ' · ' + fmtWhen(p.created_at) + '</span><p>' + esc(p.body) + '</p>' + (isAdmin() ? '<button class="link danger" type="button"><svg><use href="#i-trash"/></svg>Borrar</button>' : '') + '</div>'; }).join('') : '<div class="empty">Aún no hay avisos.</div>');
        if ($('#poSend')) $('#poSend').addEventListener('click', function (ev) { var t = $('#poBody').value.trim(); if (!t) return; Cl.busy(ev.currentTarget, function () { return sb.from('community_posts').insert({ community_id: c.id, body: t }).then(function (r) { ok(r); ring(c.id, { kind: 'post' }); return paneBoard(c); }); }); });
        $$('[data-po] .link', pane).forEach(function (b) { b.addEventListener('click', function () { armed(b, '¿Seguro? Toca otra vez', function () { sb.from('community_posts').delete().eq('id', b.parentNode.dataset.po).then(function (r) { ok(r); return paneBoard(c); }).catch(fail); }); }); });
      })(); }, useCache);
  }

  /* ---------- páginas: normas, descuentos, enlaces ---------- */
  function panePages(c, useCache) {
    return swr('pages:' + c.id, function () { return sb.from('community_pages').select('*').eq('community_id', c.id).order('position').order('title').then(ok); }, function (pages) {
      var pane = $('#clPane'); if (!pane || S.tab !== 'pages' || !cur() || cur().id !== c.id) return;
      pane.innerHTML = (isAdmin() ? '<button class="btn big primary club-add" id="pgNew" type="button"><svg><use href="#i-plus"/></svg>Nueva página</button>' : '') +
        (pages.length ? pages.map(function (p) { return '<button class="club-card club-page" type="button" data-pg="' + p.id + '"><i class="club-ic"><svg><use href="#i-info"/></svg></i><span class="club-pg"><b>' + esc(p.title) + '</b><span class="muted">' + esc((p.body || '').slice(0, 90)) + ((p.links || []).length ? ' · ' + p.links.length + (p.links.length === 1 ? ' enlace' : ' enlaces') : '') + '</span></span><svg><use href="#i-chev"/></svg></button>'; }).join('') : '<div class="empty">Aquí irán las normas, los descuentos y los enlaces de la comunidad.</div>');
      if ($('#pgNew')) $('#pgNew').addEventListener('click', function () { pageForm(c, null); });
      $$('[data-pg]', pane).forEach(function (b) { b.addEventListener('click', function () { pageView(c, pages.filter(function (p) { return p.id === b.dataset.pg; })[0]); }); });
    }, useCache);
  }
  function pageView(c, p) {
    Cl.sheet('<div class="head"><h1>' + esc(p.title) + '</h1><button class="btn small icon" id="clX" type="button"><svg><use href="#i-close"/></svg></button></div>' + (p.body ? '<p class="club-body">' + esc(p.body) + '</p>' : '') +
      (p.links || []).map(function (l, i) { return '<div class="club-link"><button class="btn" data-url="' + i + '" type="button"' + (l.url ? '' : ' disabled') + '><svg><use href="#i-link"/></svg>' + esc(l.label || l.url) + '</button>' + (l.code ? '<button class="club-codechip" data-code="' + i + '" type="button"><b>' + esc(l.code) + '</b><span>Copiar código</span></button>' : '') + '</div>'; }).join('') +
      (isAdmin() ? '<div class="ev-admin pg-admin"><button class="link" id="pgEdit" type="button"><svg><use href="#i-edit"/></svg>Editar</button><button class="link danger" id="pgDel" type="button"><svg><use href="#i-trash"/></svg>Borrar</button></div>' : ''));
    $('#clX').addEventListener('click', Cl.closeSheet);
    $$('[data-url]').forEach(function (b) { b.addEventListener('click', function () { openUrl(p.links[+b.dataset.url].url); }); });
    $$('[data-code]').forEach(function (b) { b.addEventListener('click', function () { copy(p.links[+b.dataset.code].code, 'Código copiado'); }); });
    if ($('#pgEdit')) { $('#pgEdit').addEventListener('click', function () { pageForm(c, p); });
      $('#pgDel').addEventListener('click', function (ev) { armed(ev.currentTarget, '¿Seguro? Toca otra vez', function () { sb.from('community_pages').delete().eq('id', p.id).then(function (r) { ok(r); Cl.closeSheet(); return panePages(c); }).catch(fail); }); }); }
  }
  function pageForm(c, p) {
    var linkRow = function (l) { return '<div class="club-linkrow"><input data-f="label" maxlength="60" placeholder="Texto del botón" value="' + esc(l.label || '') + '"><input data-f="url" inputmode="url" maxlength="400" placeholder="Enlace (https://…)" value="' + esc(l.url || '') + '"><input data-f="code" maxlength="40" placeholder="Código de descuento (opcional)" value="' + esc(l.code || '') + '"></div>'; };
    Cl.sheet('<div class="head"><h1>' + (p ? 'Editar página' : 'Nueva página') + '</h1><button class="btn small icon" id="clX" type="button"><svg><use href="#i-close"/></svg></button></div><form class="rg-form" id="pgForm">' +
      '<label>Título<input id="pgTitle" required maxlength="80" value="' + esc(p ? p.title : '') + '" placeholder="Normas, Descuentos, Talleres…"></label>' +
      '<label>Texto<textarea id="pgBody" maxlength="8000" placeholder="Lo que quieras contar">' + esc(p ? p.body : '') + '</textarea></label>' +
      '<span class="label">Enlaces y descuentos</span><div id="pgLinks">' + ((p && p.links) || []).map(linkRow).join('') + '</div><button class="btn" id="pgAdd" type="button">+ Añadir enlace</button>' +
      '<button class="btn big primary" type="submit">' + (p ? 'Guardar cambios' : 'Publicar') + '</button></form>');
    $('#clX').addEventListener('click', Cl.closeSheet);
    $('#pgAdd').addEventListener('click', function () { $('#pgLinks').insertAdjacentHTML('beforeend', linkRow({})); });
    $('#pgForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var links = $$('.club-linkrow').map(function (row) { var o = {}; $$('input', row).forEach(function (i) { o[i.dataset.f] = i.value.trim(); }); return o; }).filter(function (l) { return l.url || l.code || l.label; });
      var row = { community_id: c.id, title: $('#pgTitle').value.trim(), body: $('#pgBody').value.trim(), links: links };
      Cl.busy(ev.target.querySelector('button[type=submit]'), function () { return (p ? sb.from('community_pages').update(row).eq('id', p.id) : sb.from('community_pages').insert(row)).then(function (r) { ok(r); Cl.closeSheet(); A.toast('Página guardada.', 'ok'); ring(c.id, { kind: 'page' }); return panePages(c); }); });
    });
  }

  /* ---------- miembros ---------- */
  function paneMembers(c, useCache) {
    return swr('members:' + c.id, function () {
      return sb.from('community_members').select('user_id,role,joined_at').eq('community_id', c.id).order('joined_at').then(function (r) {
        var ms = ok(r); return names(ms.map(function (m) { return m.user_id; })).then(function () { return ms; }); });
    }, function (ms) { (function () {
        var pane = $('#clPane'); if (!pane || S.tab !== 'members' || !cur() || cur().id !== c.id) return;
        pane.innerHTML = '<div id="clReqs"></div><span class="label">' + ms.length + (ms.length === 1 ? ' miembro' : ' miembros') + '</span><div class="club-card club-people">' + ms.map(function (m) {
          var me = m.user_id === S.user.id;
          return '<div class="club-person" data-u="' + m.user_id + '">' + ava(m.user_id, m.role === 'admin' ? 'rol-admin' : 'rol-comp') + '<div><b>' + esc(who(m.user_id)) + (me ? ' (tú)' : '') + (m.role === 'admin' ? ' <span class="mstatus ok"><svg><use href="#i-check"/></svg>admin</span>' : '') + '</b><span class="muted">' + esc(bike(m.user_id)) + '</span></div>' +
            (isAdmin() && !me ? '<span class="rg-macts"><button class="link" data-act="role" type="button">' + (m.role === 'admin' ? 'Quitar admin' : 'Hacer admin') + '</button><button class="link danger" data-act="kick" type="button">Expulsar</button></span>' : '') + '</div>';
        }).join('') + '</div><button class="btn" id="clLeave" type="button"><svg><use href="#i-exit"/></svg>Salir de esta comunidad</button>';
        $$('[data-act]', pane).forEach(function (b) { b.addEventListener('click', function () {
          var uid = b.closest('.club-person').dataset.u, m = ms.filter(function (x) { return x.user_id === uid; })[0];
          if (b.dataset.act === 'role') sb.from('community_members').update({ role: m.role === 'admin' ? 'member' : 'admin' }).eq('community_id', c.id).eq('user_id', uid).then(function (r) { ok(r); return paneMembers(c); }).catch(fail);
          else armed(b, '¿Seguro?', function () { sb.from('community_members').delete().eq('community_id', c.id).eq('user_id', uid).then(function (r) { ok(r); return paneMembers(c); }).catch(fail); });
        }); });
        if (isAdmin()) sb.from('community_join_requests').select('user_id,message,created_at').eq('community_id', c.id).eq('status', 'pending').order('created_at').then(function (r) {
          var rq = r.data || [], host = $('#clReqs'); if (!host || !rq.length) return;
          names(rq.map(function (x) { return x.user_id; })).catch(function () {}).then(function () {
            if (!$('#clReqs')) return;
            host.innerHTML = '<span class="label">Quieren unirse (' + rq.length + ')</span><div class="club-card club-people">' + rq.map(function (x) {
              return '<div class="club-person" data-u="' + x.user_id + '">' + ava(x.user_id) + '<div><b>' + esc(who(x.user_id)) + '</b><span class="muted">' + esc(x.message || bike(x.user_id)) + '</span></div><span class="rg-macts"><button class="btn small primary" data-rq="1" type="button">Aceptar</button><button class="link danger" data-rq="0" type="button">Rechazar</button></span></div>';
            }).join('') + '</div>';
            $$('[data-rq]', host).forEach(function (b) { b.addEventListener('click', function () {
              b.disabled = true;
              sb.rpc('community_request_answer', { p_id: c.id, p_user: b.closest('.club-person').dataset.u, p_ok: b.dataset.rq === '1' }).then(function (r2) { ok(r2); A.toast(b.dataset.rq === '1' ? 'Aceptado: ya está dentro.' : 'Solicitud rechazada.', 'ok'); return paneMembers(c); }).catch(fail);
            }); });
          });
        }, function () {});
        $('#clLeave').addEventListener('click', function (ev) {
          if (isAdmin() && ms.filter(function (x) { return x.role === 'admin'; }).length === 1 && ms.length > 1) { A.toast('Eres el único administrador: nombra a otro antes de salir.', 'warn'); return; }
          armed(ev.currentTarget, ms.length === 1 ? 'Eres el último: la comunidad se borrará. Toca otra vez' : '¿Seguro? Te quitas también de sus eventos. Toca otra vez', function () { sb.from('community_members').delete().eq('community_id', c.id).eq('user_id', S.user.id).then(function (r) { ok(r); S.cid = null; listAt = 0; inbox(true); return load().then(render); }).catch(fail); });
        });
      })(); }, useCache);
  }

  /* ---------- mis eventos: recordatorios y plazas ofrecidas ----------
     event_inbox() devuelve mis eventos próximos (apuntado, en espera o con plaza ofrecida). Con eso:
     - se programan en el móvil dos recordatorios por evento (un día antes y una hora antes), con el botón «No puedo ir»;
       son notificaciones del propio teléfono, así que saltan aunque la app esté cerrada;
     - en Android los pone el plugin propio (RideAlerts → EventNotices.java): sus botones contestan al servidor por
       detrás, SIN abrir la app, con la clave de cada evento (supabase/07). Sin esa clave, o fuera de Android, se usan
       las notificaciones normales de Capacitor, cuyos botones sí abren la app;
     - si me han ofrecido una plaza, se me pregunta si voy (en pantalla, o con una notificación si la app está en segundo plano).
     - con la app cerrada no hay notificaciones push que avisen de la plaza; por eso, en Android, el teléfono pregunta
       cada 10 minutos por los eventos en los que estoy en lista de espera (RideAlerts.eventWatch + supabase/08) y, si
       me toca, pone el aviso con «Sí, voy» y «No puedo», que contestan sin abrir la app. */
  var LN = P.LocalNotifications || null, IN = { events: [], at: 0, busy: false, pending: [] };
  var RA = native && P.RideAlerts && P.RideAlerts.eventSync ? P.RideAlerts : null, raReady = false;
  function jget(k) { try { return JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch (e) { return {}; } }
  function jset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function nid(evId, k) { return (parseInt(String(evId).replace(/-/g, '').slice(0, 7), 16) || 1) * 4 + k; }   // cabe en un entero de 32 bits
  function hhmm(ms) { return new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }); }
  function inbox(force) {
    if (IN.busy && force) { IN.again = true; return Promise.resolve(); }      // llegó un aviso mientras se consultaba: se repite al acabar
    if (!sb || !S.user || IN.busy || S.v6 === false) return Promise.resolve();
    if (!force && Date.now() - IN.at < 20000) return Promise.resolve();
    IN.busy = true; IN.at = Date.now();
    return sb.rpc('event_inbox').then(function (r) {
      IN.busy = false;
      if (r.error) { if (/could not find|schema cache|does not exist/i.test(r.error.message || '')) S.v6 = false; return; }
      S.v6 = true; IN.events = (r.data && r.data.events) || [];
      remind(); watchWaiting(); newsWatch(); offers(); drain();
      if (IN.again) { IN.again = false; setTimeout(function () { inbox(true); }, 300); }
    }, function () { IN.busy = false; if (IN.again) { IN.again = false; setTimeout(function () { inbox(true); }, 1500); } });
  }
  // Deja programados exactamente los recordatorios que tocan: quita los de eventos que ya no voy o que han cambiado de hora.
  function remind() {
    if (!LN && !RA) return;
    var want = {}, now = Date.now(), had = jget('rg.remind'), drop = [], add = [];
    var going = IN.events.filter(function (e) { return e.status === 'going'; });
    // Android con la clave de cada evento: recordatorios del plugin propio, cuyos botones no abren la app.
    var nativeMode = !!RA && going.every(function (e) { return !!e.key; }), mode = nativeMode ? 'native' : 'ln';
    if (jget('rg.remind.mode').m !== mode) {      // cambio de sistema: se quita lo programado con el otro
      var old = Object.keys(had).map(function (id) { return { id: +id }; });
      if (LN && old.length) { try { LN.cancel({ notifications: old }).catch(function () {}); } catch (x) {} }
      if (RA && mode === 'ln') { try { RA.eventSync({ items: [] }).catch(function () {}); } catch (x) {} }
      had = {}; jset('rg.remind', {}); jset('rg.remind.mode', { m: mode });
    }
    if (nativeMode && !raReady) { raReady = true; try { RA.eventConfig({ url: Cl.cfg.url, apikey: Cl.cfg.key }).catch(function () {}); } catch (x) {} }
    IN.events.forEach(function (e) {
      if (e.status !== 'going') return;
      var key = e.starts_at + '|' + e.title + '|' + (e.meet_name || '');
      remTexts(e).forEach(function (x) {
        var at = e.starts_at - x[0]; if (at < now + 30000) return;
        want[nid(e.id, x[1])] = { key: key, n: { id: nid(e.id, x[1]), title: x[2], body: x[3], schedule: { at: new Date(at), allowWhileIdle: true }, actionTypeId: 'RG_EVENT', extra: { eventId: e.id, title: e.title, kind: 'remind' } },
          nat: { id: nid(e.id, x[1]), at: at, title: x[2], body: x[3], kind: 'remind', key: e.key, eventId: e.id, eventTitle: e.title, cid: e.community_id } };
      });
    });
    if (nativeMode) {      // se manda siempre la lista entera: el teléfono quita lo que sobra y repone lo que falte
      var items = Object.keys(want).map(function (id) { return want[id].nat; }), nx = {}; Object.keys(want).forEach(function (id) { nx[id] = want[id].key; });
      try { RA.eventSync({ items: items }).then(function () { jset('rg.remind', nx); }, function () {}); } catch (x) {}
      return;
    }
    if (!LN) return;
    Object.keys(had).forEach(function (id) { if (!want[id] || want[id].key !== had[id]) drop.push({ id: +id }); });
    Object.keys(want).forEach(function (id) { if (had[id] !== want[id].key) add.push(want[id].n); });
    var next = {}; Object.keys(want).forEach(function (id) { next[id] = want[id].key; });
    Promise.resolve(drop.length ? LN.cancel({ notifications: drop }) : null).catch(function () {}).then(function () { return add.length ? LN.schedule({ notifications: add }) : null; }).then(function () { jset('rg.remind', next); }, function () {});
  }
  // Los dos recordatorios de un evento: [antelación, n.º, título, texto].
  function remTexts(e) {
    return [[24 * 3600e3, 0, 'Mañana: ' + e.title, fmtWhen(e.starts_at) + (e.meet_name ? ' · Salida: ' + e.meet_name : '') + '. Si no puedes ir, desapúntate y tu plaza pasa a otro.'],
            [3600e3, 1, 'En 1 hora: ' + e.title, 'Sales a las ' + hhmm(e.starts_at) + (e.meet_name ? ' desde ' + e.meet_name : '') + '. ¿No llegas? Desapúntate.']];
  }
  // En lista de espera: se le dice al teléfono qué eventos vigilar. Si me toca plaza con la app cerrada, él pone el aviso.
  function watchWaiting() {
    if (!RA || !RA.eventWatch) return;
    var now = Date.now(), items = IN.events.filter(function (e) { return (e.status === 'waiting' || e.status === 'offered') && e.key && e.starts_at > now; }).map(function (e) {
      return { eventId: e.id, key: e.key, eventTitle: e.title, startsAt: e.starts_at, nid: nid(e.id, 2),
        remind: remTexts(e).map(function (x) { return { id: nid(e.id, x[1]), at: e.starts_at - x[0], title: x[2], body: x[3], kind: 'remind', key: e.key, eventId: e.id, eventTitle: e.title, cid: e.community_id }; }) };
    });
    var sig = JSON.stringify(items); if (sig === IN.watchSig) return; IN.watchSig = sig;
    if (items.length && !raReady) { raReady = true; try { RA.eventConfig({ url: Cl.cfg.url, apikey: Cl.cfg.key }).catch(function () {}); } catch (x) {} }
    try { RA.eventWatch({ items: items }).catch(function () {}); } catch (x) {}
  }
  // Novedades de la comunidad (evento, mensaje del tablón o página de info nuevos). No hay push: en Android el teléfono
  // pregunta cada 15 minutos con la clave de novedades de la cuenta (supabase/09) y pone el aviso aunque la app esté cerrada.
  function newsWatch() {
    if (!RA || !RA.newsWatch || !S.user || IN.newsOn) return; IN.newsOn = true;
    try { RA.eventConfig({ url: Cl.cfg.url, apikey: Cl.cfg.key }).catch(function () {}); raReady = true; } catch (x) {}
    sb.rpc('news_key').then(function (r) {
      if (r.error || !r.data) { IN.newsOn = false; return; }                                              // falta supabase/09: sin avisos de novedades
      if (!raReady) { raReady = true; try { RA.eventConfig({ url: Cl.cfg.url, apikey: Cl.cfg.key }).catch(function () {}); } catch (x) {} }
      try { RA.newsWatch({ key: r.data }).catch(function () {}); } catch (x) {}
    }, function () {});
  }
  function forgetReminders() { IN.watchSig = null; IN.newsOn = false; var had = jget('rg.remind'), ids = Object.keys(had).map(function (id) { return { id: +id }; }); if (LN && ids.length) { try { LN.cancel({ notifications: ids }).catch(function () {}); } catch (e) {} } if (RA) { try { RA.eventClear().catch(function () {}); } catch (e) {} } jset('rg.remind', {}); }
  // Plaza ofrecida: una vez por oferta. En pantalla, pregunta; en segundo plano, notificación con «Sí, voy» / «No puedo».
  function offers() {
    var seen = jget('rg.offers'), now = Date.now(), ch = false;
    Object.keys(seen).forEach(function (k) { if (now - (seen[k].at || 0) > 20 * 864e5) { delete seen[k]; ch = true; } });
    IN.events.forEach(function (e) {
      if (e.status !== 'offered') return;
      var k = e.id + ':' + e.offered_at, sn = seen[k] || (seen[k] = { at: now });
      var title = 'Hay una plaza para ti: ' + e.title, body = 'Alguien se ha desapuntado y te toca a ti. ¿Vienes? Contesta antes del ' + fmtWhen(e.deadline).toLowerCase() + '.';
      // La notificación sale siempre, también con la app delante (y si hay otra ventana abierta o se está grabando).
      if (!sn.notified && RA && e.key) {
        sn.notified = 1; ch = true;
        if (!raReady) { raReady = true; try { RA.eventConfig({ url: Cl.cfg.url, apikey: Cl.cfg.key }).catch(function () {}); } catch (x) {} }
        try { RA.eventShow({ item: { id: nid(e.id, 2), at: 0, title: title, body: body, kind: 'offer', key: e.key, eventId: e.id, eventTitle: e.title, offeredAt: e.offered_at || 0, cid: e.community_id } }).catch(function () {}); } catch (x) {}
      } else if (!sn.notified && !RA && LN) {
        sn.notified = 1; ch = true;
        try { LN.schedule({ notifications: [{ id: nid(e.id, 2), title: title, body: body, actionTypeId: 'RG_OFFER', extra: { eventId: e.id, title: e.title, kind: 'offer' } }] }).catch(function () {}); } catch (x) {}
      }
      // Con la app delante, además, la ventana para contestar (si no hay otra abierta ni se está grabando).
      if (document.visibilityState === 'visible' && !sn.asked && !A.isRec() && $('#rgSheet').hidden) { sn.asked = 1; ch = true; offerSheet(e); }
    });
    if (ch) jset('rg.offers', seen);
  }
  function offerSheet(e) {
    Cl.sheet('<span class="rg-plaza"><i></i>Plaza libre</span><h1>Hay una plaza para ti</h1><p class="rg-win-t">' + esc(e.title) + '</p>' +
      '<p class="rg-small">' + fmtWhen(e.starts_at) + (e.meet_name ? ' · Salida: ' + esc(e.meet_name) : '') + '</p>' +
      '<p>Alguien se ha desapuntado y te toca a ti. ¿Vas a venir?</p>' +
      '<button class="btn big primary" id="ofYes" type="button"><svg><use href="#i-check"/></svg>Sí, voy</button><button class="btn big" id="ofNo" type="button">No puedo, que pase al siguiente</button>' +
      '<p class="rg-small">Si no contestas antes del ' + fmtWhen(e.deadline).toLowerCase() + ', la plaza pasa al siguiente y tú vuelves a la lista.</p>', 'win');
    $('#ofYes').addEventListener('click', function (ev) { Cl.busy(ev.currentTarget, function () { return answer(e.id, e.title, true).then(Cl.closeSheet); }); });
    $('#ofNo').addEventListener('click', function (ev) { Cl.busy(ev.currentTarget, function () { return answer(e.id, e.title, false).then(Cl.closeSheet); }); });
  }
  function refresh() { var c = cur(); if (c && S.tab === 'events' && !$('#view-club').hidden) paneEvents(c).catch(function () {}); }
  function answer(evId, title, yes) {
    return sb.from('event_attendees').update({ status: yes ? 'going' : 'no' }).eq('event_id', evId).eq('user_id', S.user.id).select('status').then(function (r) {
      var d = ok(r), got = d && d[0] ? d[0].status : null;
      A.toast(yes ? (got === 'going' ? 'Confirmado: vas a «' + title + '».' : 'La plaza ya no estaba libre: sigues en la lista de espera.') : 'Vale. La plaza pasa al siguiente de la lista.', yes && got !== 'going' ? 'warn' : 'ok');
      if (RA && RA.eventDone) { try { RA.eventDone({ id: nid(evId, 2) }).catch(function () {}); } catch (x) {} }      // contestado aquí: fuera la notificación
      refresh(); return inbox(true);
    });
  }
  // Botones de las notificaciones. Si la app estaba cerrada, se espera a tener la sesión.
  function drain() {
    if (!S.user || !IN.pending.length) return;
    var p = IN.pending.shift(), title = p.title || 'la ruta';
    var job = p.act === 'leave' ? sb.from('event_attendees').update({ status: 'no' }).eq('event_id', p.ev).eq('user_id', S.user.id).then(function (r) { ok(r); A.toast('Te has desapuntado de «' + title + '».', 'ok'); refresh(); return inbox(true); })
      : p.act === 'yes' ? answer(p.ev, title, true) : p.act === 'no' ? answer(p.ev, title, false)
      : p.act === 'tap' ? Promise.resolve().then(function () {
          var e = IN.events.filter(function (x) { return x.id === p.ev; })[0];
          if (e && e.status === 'offered' && $('#rgSheet').hidden) offerSheet(e); else { if (e && e.community_id) setCid(e.community_id); S.tab = 'events'; A.showView('club'); }
        }) : Promise.resolve();
    Promise.resolve(job).catch(fail).then(drain);
  }
  if (LN) {
    try {
      LN.registerActionTypes({ types: [
        { id: 'RG_EVENT', actions: [{ id: 'leave', title: 'No puedo ir', destructive: true }, { id: 'ok', title: 'Allí estaré' }] },
        { id: 'RG_OFFER', actions: [{ id: 'yes', title: 'Sí, voy' }, { id: 'no', title: 'No puedo', destructive: true }] }] });
      LN.addListener('localNotificationActionPerformed', function (a) {
        var x = (a && a.notification && a.notification.extra) || {}; if (!x.eventId) return;
        IN.pending.push({ act: a.actionId, ev: x.eventId, title: x.title, kind: x.kind });
        if (IN.events.length || a.actionId !== 'tap') drain(); else inbox(true);
      });
    } catch (e) {}
  }
  if (RA) {
    try {
      // Un botón pulsado en el aviso ya ha contestado al servidor: aquí solo se pone la pantalla al día.
      RA.addListener('eventAction', function (x) { if (x && x.ok) { refresh(); inbox(true); } else nativePending(); });
    } catch (e) {}
  }
  // Respuestas que el teléfono no pudo enviar (sin conexión): se envían al abrir la app.
  function nativePending() {
    if (!RA || !RA.eventPending) return;
    try { RA.eventPending().then(function (r) { ((r && r.list) || []).forEach(function (p) { IN.pending.push({ act: p.act, ev: p.eventId, title: p.title }); }); drain(); }, function () {}); } catch (e) {}
  }
  setInterval(function () { inbox(false); }, 60000);
  // En lista de espera y con la app delante: se mira cada 30 s por si el aviso en directo no llega (red mala).
  setInterval(function () { if (document.visibilityState === 'visible' && IN.events.some(function (e) { return e.status === 'waiting'; })) inbox(true); }, 30000);

  /* ---------- avisos con la app cerrada: qué los puede frenar en este móvil ---------- */
  function noticeIssues(st) {
    var out = [];
    if (st.notifications === false) out.push(['notif', 'Las notificaciones de ReGroupRide están apagadas.', 'Activar']);
    if (st.exact === false) out.push(['exact', 'Android no deja comprobar cada minuto (alarmas exactas).', 'Permitir']);
    if (st.battery === false) out.push(['battery', 'El ahorro de batería puede retrasar o frenar los avisos.', 'Quitar el límite']);
    return out;
  }
  function closedHelp() {
    if (!RA || !RA.noticeStatus) return;
    try { if (localStorage.getItem('rg.closedAsk')) return; } catch (x) {}
    RA.noticeStatus().then(function (st) {
      var is = noticeIssues(st || {}); if (!is.length || !$('#rgSheet').hidden) return;
      try { localStorage.setItem('rg.closedAsk', '1'); } catch (x) {}
      Cl.sheet('<h1>Para que te avise aunque cierres la app</h1><p>Si queda una plaza te llega una notificación. En este móvil hay algo que puede retrasarla:</p>' +
        is.map(function (x) { return '<div class="rg-nrow"><span>' + x[1] + '</span><button class="btn small" data-w="' + x[0] + '" type="button">' + x[2] + '</button></div>'; }).join('') +
        '<button class="btn rg-skip" id="chNo" type="button">Ahora no</button>');
      $$('#rgSheet [data-w]').forEach(function (b) { b.addEventListener('click', function () { RA.openSetting({ what: b.dataset.w }).catch(function () {}); }); });
      $('#chNo').addEventListener('click', Cl.closeSheet);
    }, function () {});
  }
  function ago(t) { var m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'hace menos de un minuto' : m < 60 ? 'hace ' + m + ' min' : m < 1440 ? 'hace ' + Math.round(m / 60) + ' h' : 'hace ' + Math.round(m / 1440) + ' días'; }
  function renderNotiCard() {
    if (!RA || !RA.noticeStatus) return;
    var box = $('#rgNoti');
    if (!box) { var at = $('#rgPerms'); if (!at) return; box = document.createElement('div'); box.className = 'rg-account'; box.id = 'rgNoti'; at.parentNode.insertBefore(box, at.nextSibling); }
    RA.noticeStatus().then(function (st) {
      st = st || {};
      var is = noticeIssues(st), r = st.lastResult || '', last;
      if (!st.lastCheck) last = 'Aún no ha comprobado nada: empieza al apuntarte en una lista de espera o al entrar en una comunidad.';
      else last = 'Última comprobación ' + ago(st.lastCheck) + ': ' + (r === 'falta08' ? 'falta ejecutar supabase/08_plaza_avisada.sql en Supabase, así que no puede avisar de plazas con la app cerrada.'
        : r === 'sinred' ? 'sin conexión.' : r === 'plaza' ? 'te ha avisado de una plaza.' : /^ok:[1-9]/.test(r) ? 'en lista de espera en ' + r.slice(3) + (r.slice(3) === '1' ? ' evento' : ' eventos') + ', sin plaza todavía.' : 'todo en orden.');
      box.innerHTML = '<span class="label">Avisos con la app cerrada</span><div class="card rg-noti">' +
        (is.length ? is.map(function (x) { return '<div class="rg-nrow"><span>' + x[1] + '</span><button class="btn small" data-w="' + x[0] + '" type="button">' + x[2] + '</button></div>'; }).join('')
          : '<p class="rg-nok"><svg><use href="#i-check"/></svg>Este móvil deja avisar con la app cerrada (comprueba cada minuto).</p>') +
        '<p class="rg-nok' + (st.push ? '' : ' off') + '"><svg><use href="#i-' + (st.push ? 'check' : 'info') + '"/></svg>' + (st.push ? 'Push activado' + (st.configured === false ? ', pero falta terminar de prepararlo: abre la pestaña Comunidad una vez.' : ': los avisos llegan al momento' + (st.lastPush ? ' (último recibido ' + ago(st.lastPush) + ').' : ' (aún no ha recibido ninguno).')) : 'Push sin activar en esta versión: los avisos pueden tardar hasta un minuto o más.') + '</p>' +
        '<p class="muted rg-small">' + last + '</p></div>';
      box.hidden = false;
      $$('[data-w]', box).forEach(function (b) { b.addEventListener('click', function () { RA.openSetting({ what: b.dataset.w }).catch(function () {}); }); });
    }, function () {});
  }
  (function () {
    var v = $('#view-settings'); if (!v || !window.MutationObserver) return;
    new MutationObserver(function () { if (!v.hidden) renderNotiCard(); }).observe(v, { attributes: true, attributeFilter: ['hidden'] });
  })();
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && $('#view-settings') && !$('#view-settings').hidden) renderNotiCard(); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') setTimeout(function () { nativePending(); inbox(true); refresh(); }, 1200); });

  function pushRegister() {
    if (!RA || !RA.pushToken || !S.user) return;
    RA.pushToken().then(function (r) { if (r && r.token) sb.rpc('push_register', { p_token: r.token }).then(function () {}, function () {}); }, function () {});
  }
  Cl.onChange(function (u) {
    var changed = (S.user && S.user.id) !== (u && u.id); S.user = u;
    if (u) setTimeout(pushRegister, 2500);
    if (changed) { S.loaded = false; S.names = {}; IN.events = []; IN.at = 0; if (!u) { forgetReminders(); liveSync(); } else setTimeout(function () { nativePending(); inbox(true); if (!S.loaded) load().catch(function () {}); else liveSync(); }, 1500); if (!$('#view-club').hidden) show(); }
  });
  window.RGClub = { show: show, inbox: inbox, state: S, chat: function (e) { chatSheet(e); }, ring: function (cid, m) { ring(cid, m); }, mine: function () { return IN.events.slice(); } };
})();
