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
  function armed(btn, label, run) { if (btn.dataset.armed) { run(); return; } btn.dataset.armed = '1'; var old = btn.textContent; btn.textContent = label; setTimeout(function () { delete btn.dataset.armed; btn.textContent = old; }, 3500); }
  // Los nombres se recuerdan entre sesiones: solo se piden los que no se conocen (y, sin esperar, los que tienen más de un día).
  var NAMES_AT = {};
  try { var nm0 = JSON.parse(localStorage.getItem('rg.club.names') || '{}'); S.names = nm0.n || {}; NAMES_AT = nm0.t || {}; } catch (e) {}
  function saveNames() { try { var ids = Object.keys(S.names).slice(-400), n = {}, t = {}; ids.forEach(function (id) { n[id] = S.names[id]; t[id] = NAMES_AT[id] || 0; }); localStorage.setItem('rg.club.names', JSON.stringify({ n: n, t: t })); } catch (e) {} }
  function fetchNames(ids) {
    return sb.from('profiles').select('id,name,bike_brand,bike_model').in('id', ids).then(function (r) { (r.data || []).forEach(function (p) { S.names[p.id] = p; NAMES_AT[p.id] = Date.now(); }); saveNames(); });
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
  function bike(id) { var p = S.names[id]; return p ? [p.bike_brand, p.bike_model].filter(Boolean).join(' ') : ''; }

  /* ---------- carga ---------- */
  function load() {
    if (!S.user) { S.list = []; S.loaded = true; return Promise.resolve(); }
    return sb.from('community_members').select('role, communities(id,name,description,join_code)').eq('user_id', S.user.id).then(function (r) {
      if (r.error) { S.missing = /relation|schema cache|does not exist|not find/i.test(r.error.message || ''); if (!S.missing) throw r.error; S.list = []; }
      else { S.missing = false; S.list = (r.data || []).filter(function (m) { return m.communities; }).map(function (m) { var c = m.communities; return { id: c.id, name: c.name, description: c.description, code: c.join_code, role: m.role }; }); }
      S.loaded = true; if (!cur()) S.cid = null; else S.cid = cur().id;
      if (!r.error) { try { localStorage.setItem('rg.club.list:' + S.user.id, JSON.stringify(S.list)); } catch (e) {} }
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
    box.innerHTML = '<div class="club-head"><div class="club-title"><b>' + esc(c.name) + '</b>' + (c.description ? '<span class="muted">' + esc(c.description) + '</span>' : '') + '</div><button class="btn small" id="clInvite" type="button">Invitar</button></div>' +
      '<div class="pills">' + S.list.map(function (x) { return '<button class="pill" type="button" data-cid="' + x.id + '" aria-pressed="' + (x.id === c.id) + '">' + esc(x.name) + '</button>'; }).join('') + '<button class="pill" type="button" id="clOther" aria-pressed="false">+ Otra comunidad</button></div>' +
      '<div class="seg rg-wide" id="clTabs">' + [['events', 'Eventos'], ['board', 'Tablón'], ['pages', 'Info'], ['members', 'Miembros']].map(function (t) { return '<button type="button" data-t="' + t[0] + '" aria-pressed="' + (S.tab === t[0]) + '">' + t[1] + '</button>'; }).join('') + '</div><div id="clPane"><div class="empty">Cargando…</div></div>';
    $('#clInvite').addEventListener('click', invite);
    $('#clOther').addEventListener('click', renderJoin);
    $$('[data-cid]', box).forEach(function (b) { b.addEventListener('click', function () { setCid(b.dataset.cid); render(); }); });
    $$('#clTabs button', box).forEach(function (b) { b.addEventListener('click', function () { S.tab = b.dataset.t; render(); }); });
    ({ events: paneEvents, board: paneBoard, pages: panePages, members: paneMembers })[S.tab](c, true).catch(function (e) { var p = $('#clPane'); if (p) p.innerHTML = '<div class="empty">' + esc(Cl.msg(e)) + '</div>'; });
  }
  function renderJoin() {
    box.innerHTML = (S.list.length ? '<button class="btn small" id="clBack" type="button" style="margin-bottom:10px">← Volver a ' + esc(cur().name) + '</button>' : '') + '<div class="club-card"><b>Unirme a ' + (S.list.length ? 'otra' : 'una') + ' comunidad</b><p class="muted">Escribe el código que te ha pasado el organizador.</p><div class="plan-link"><input type="text" id="clCode" maxlength="8" placeholder="Código" autocapitalize="characters" autocomplete="off"><button class="btn small primary" id="clJoin" type="button">Unirme</button></div></div>' +
      '<div class="club-card"><b>Crear una comunidad</b><p class="muted">Serás su administrador: podrás crear eventos, publicar avisos e invitar a la gente.</p><input type="text" id="clName" maxlength="60" placeholder="Nombre de la comunidad"><button class="btn" id="clCreate" type="button" style="margin-top:10px;width:100%">Crear comunidad</button></div>';
    if ($('#clBack')) $('#clBack').addEventListener('click', render);
    $('#clJoin').addEventListener('click', function (ev) { var code = $('#clCode').value.trim(); if (code.length < 4) { A.toast('Escribe el código.', 'warn'); return; }
      Cl.busy(ev.currentTarget, function () { return sb.rpc('join_community', { p_code: code }).then(function (r) { if (r.error) throw new Error(/no válido/i.test(r.error.message) ? 'Ese código no existe. Revísalo con el organizador.' : r.error.message); setCid(r.data); A.toast('¡Dentro!', 'ok'); return load().then(render); }); }); });
    $('#clCreate').addEventListener('click', function (ev) { var name = $('#clName').value.trim(); if (name.length < 2) { A.toast('Ponle un nombre.', 'warn'); return; }
      Cl.busy(ev.currentTarget, function () { return sb.rpc('create_community', { p_name: name, p_description: '' }).then(function (r) { setCid(ok(r)); A.toast('Comunidad creada. Invita a la gente con el código.', 'ok'); return load().then(render); }); }); });
  }
  function invite() {
    var c = cur(), text = 'Únete a «' + c.name + '» en ReGroupRide. En la app, entra en Comunidad y escribe el código ' + c.code + '.';
    Cl.sheet('<div class="head"><h1>Invitar</h1><button class="btn small icon" id="clX" type="button"><svg><use href="#i-close"/></svg></button></div><p class="muted">Pasa este código a quien quieras que entre en «' + esc(c.name) + '». Lo escribe en la pestaña Comunidad.</p><div class="club-code">' + esc(c.code) + '</div><button class="btn big primary" id="clShare" type="button">Compartir invitación</button><button class="btn" id="clCopy" type="button">Copiar código</button>' +
      '<button class="btn" id="clNew" type="button">Unirme a otra comunidad o crear una</button>');
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
  function setStatus(e, mine, status, companion) {
    var q = mine ? sb.from('event_attendees').update({ status: status, companion: !!companion }).eq('event_id', e.id).eq('user_id', S.user.id).select('status')
      : sb.from('event_attendees').insert({ event_id: e.id, user_id: S.user.id, status: status, companion: !!companion }).select('status');
    return q.then(function (r) { var d = ok(r); return d && d[0] ? d[0].status : status; });
  }
  // Una sola petición para la pestaña: los eventos con sus apuntados y sus administradores. La ruta completa de cada
  // evento (decenas de KB) no se baja aquí: solo su nombre, sus km y dónde empieza; el resto, al pulsar «Cargar ruta».
  var EV_COLS = 'id,community_id,title,description,starts_at,meet_name,luma_url,created_by', EV_V6 = ',capacity,meet_url,meet_lat,meet_lon',
    EV_ROUTE = ',route_name:route->>name,route_dist:route->dist,route_start:route->coords->0,route_wp0:route->wps->0', EV_EMBED = ',event_attendees(*),event_admins(user_id)';
  function fetchEvents(c) {
    var since = new Date(Date.now() - 12 * 3600e3).toISOString();
    var q = function (v6) { return sb.from('events').select(EV_COLS + (v6 ? EV_V6 : '') + EV_ROUTE + EV_EMBED).eq('community_id', c.id).gte('starts_at', since).order('starts_at').limit(40); };
    return q(S.v6 !== false).then(function (r) {
      if (r.error && S.v6 !== false && /capacity|meet_(url|lat|lon)/i.test(r.error.message || '')) { S.v6 = false; return q(false); }
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
    pane.innerHTML = (isAdmin() ? '<button class="btn primary club-add" id="evNew" type="button">+ Nuevo evento o ruta</button>' : '') + (evs.length ? evs.map(function (e) {
      var going = att.filter(function (x) { return x.event_id === e.id && x.status === 'going'; }), mine = att.filter(function (x) { return x.event_id === e.id && x.user_id === S.user.id; })[0];
      var taken = takenOf(att, e), queue = queueOf(att, e), cap = e.capacity || 0, full = cap > 0 && taken.length >= cap;
      var st = mine ? mine.status : 'no', iGo = st === 'going', people = going.length + going.filter(function (x) { return x.companion; }).length;
      var routeAdm = (S.evAdmins[e.id] || []).indexOf(S.user.id) >= 0, canRun = isAdmin() || routeAdm, m = meetOf(e), pos = queue.map(function (x) { return x.user_id; }).indexOf(S.user.id) + 1, dl = deadlineOf(e, mine);
      var count = cap ? taken.length + ' de ' + cap + (cap === 1 ? ' plaza' : ' plazas') + (queue.length ? ' · ' + queue.length + ' en lista de espera' : '')
        : (going.length ? going.length + (going.length === 1 ? ' moto' : ' motos') + (people > going.length ? ' · ' + people + ' personas' : '') : 'Nadie apuntado todavía');
      var mineHtml;
      if (st === 'offered') mineHtml = '<div class="ev-offer"><b>Ha quedado una plaza libre para ti</b><span>Confirma si vienes' + (dl ? ' antes del ' + fmtWhen(dl).toLowerCase() : '') + '. Si no puedes, pasa al siguiente de la lista.</span><div class="ev-go"><button class="btn small primary" data-act="confirm" type="button">Sí, voy</button><button class="btn small" data-act="no" type="button">No puedo</button></div></div>';
      else if (st === 'waiting') mineHtml = '<div class="ev-go"><span class="ev-wait">En lista de espera' + (pos ? ' · puesto ' + pos + ' de ' + queue.length : '') + '</span><button class="btn small" data-act="no" type="button">Salir de la lista</button>';
      else mineHtml = '<div class="ev-go"><button class="btn small' + (iGo ? ' primary' : '') + '" data-act="go" type="button">' + (iGo ? 'Voy ✓' : (full ? 'Apuntarme a la lista de espera' : 'Voy')) + '</button>' + (iGo ? '<button class="btn small" data-act="comp" type="button" aria-pressed="' + !!mine.companion + '">Con acompañante</button>' : '') + (iGo ? '<button class="btn small" data-act="no" type="button">No voy</button>' : '');
      if (st !== 'offered') mineHtml += (e.luma_url ? '<button class="btn small" data-act="luma" type="button">Apuntarse en Luma</button>' : '') + '</div>';
      return '<div class="club-card ev" data-ev="' + e.id + '"><span class="ev-when">' + fmtWhen(e.starts_at) + '</span><b>' + esc(e.title) + '</b>' +
        (m.url ? '<div class="ev-meet"><button class="link" data-act="meet" type="button"><svg><use href="#i-gmaps"/></svg><span>Salida: ' + esc(m.name || 'ver en Maps') + '</span></button>' + (m.lat != null ? '<button class="btn small" data-act="gomeet" type="button">Ir al punto de salida</button>' : '') + '</div>'
          : (e.meet_name ? '<span class="muted">Salida: ' + esc(e.meet_name) + '</span>' : '')) + (e.description ? '<p>' + esc(e.description) + '</p>' : '') +
        (e.route ? '<div class="ev-route"><span><svg><use href="#i-route"/></svg>' + esc(e.route.name || 'Ruta') + ' · ' + String(e.route.dist || 0).replace('.', ',') + ' km</span><button class="btn small" data-act="route" type="button">Cargar ruta</button></div>' : '') +
        (canRun && e.route ? '<button class="btn primary ev-start" data-act="start" type="button">Iniciar la ruta para los apuntados</button>' : '') +
        (routeAdm && !isAdmin() ? '<span class="muted rg-small">Eres administrador de esta ruta.</span>' : '') + mineHtml +
        '<button class="link" data-act="who" type="button">' + count + '</button>' +
        ((iGo || st === 'offered') && e.route && !canRun ? '<button class="link" data-act="enter" type="button">¿Ya ha empezado? Entrar en la ruta</button>' : '') +
        (isAdmin() ? '<div class="ev-admin"><button class="link" data-act="admins" type="button">Administradores de esta ruta' + ((S.evAdmins[e.id] || []).length ? ' (' + S.evAdmins[e.id].length + ')' : '') + '</button><button class="link" data-act="edit" type="button">Editar</button><button class="link danger" data-act="del" type="button">Borrar</button></div>' : '') + '</div>';
    }).join('') : '<div class="empty">No hay eventos ni rutas próximas.' + (isAdmin() ? ' Crea el primero.' : '') + '</div>');
    if ($('#evNew')) $('#evNew').addEventListener('click', function () { eventForm(c, null); });
    $$('.ev', pane).forEach(function (card) {
      var e = evs.filter(function (x) { return x.id === card.dataset.ev; })[0], mine = att.filter(function (x) { return x.event_id === e.id && x.user_id === S.user.id; })[0];
      var set = function (status, companion, said) {
        return setStatus(e, mine, status, companion).then(function (got) {
          if (got === 'waiting' && (!mine || mine.status !== 'waiting')) A.toast('Está completo: te he puesto en la lista de espera. Si queda una plaza, te aviso.', 'warn');
          else if (said) A.toast(said, 'ok');
          inbox(true); return paneEvents(c);
        }).catch(fail);
      };
      $$('[data-act]', card).forEach(function (b) { b.addEventListener('click', function () {
        var act = b.dataset.act, st = mine ? mine.status : 'no';
        if (act === 'go') set('going', mine && mine.companion, st === 'going' ? '' : 'Apuntado. Te lo recordaré el día antes y una hora antes.');
        else if (act === 'confirm') set('going', mine && mine.companion, 'Confirmado: la plaza es tuya.');
        else if (act === 'no') set('no', false, st === 'offered' ? 'Vale. La plaza pasa al siguiente de la lista.' : (st === 'waiting' ? 'Has salido de la lista de espera.' : 'Desapuntado.'));
        else if (act === 'comp') set(st, !(mine && mine.companion));
        else if (act === 'luma') openUrl(e.luma_url); else if (act === 'route') loadRoute(e);
        else if (act === 'meet') openUrl(meetOf(e).url); else if (act === 'gomeet') goMeet(e, b);
        else if (act === 'start') startEvent(e, b); else if (act === 'enter') enterEvent(e, b); else if (act === 'admins') eventAdmins(c, e);
        else if (act === 'who') whoGoes(e, att);
        else if (act === 'edit') eventForm(c, e); else if (act === 'del') armed(b, '¿Seguro? Toca otra vez', function () { sb.from('events').delete().eq('id', e.id).then(function (r) { ok(r); A.toast('Evento borrado.', 'ok'); inbox(true); return paneEvents(c); }).catch(fail); });
      }); });
    });
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
          ms.map(function (m) { var on = cur.indexOf(m.user_id) >= 0; return '<div class="club-person" data-u="' + m.user_id + '"><span class="rg-ava">' + esc(who(m.user_id).charAt(0).toUpperCase()) + '</span><div><b>' + esc(who(m.user_id)) + '</b><span class="muted">' + (m.role === 'admin' ? 'Administrador de la comunidad' : esc(bike(m.user_id))) + '</span></div>' +
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
  function whoGoes(e, att) {
    var going = att.filter(function (x) { return x.event_id === e.id && x.status === 'going'; }), off = att.filter(function (x) { return x.event_id === e.id && x.status === 'offered'; }), queue = queueOf(att, e);
    var person = function (g, tag) { return '<div class="club-person"><span class="rg-ava">' + esc(who(g.user_id).charAt(0).toUpperCase()) + '</span><div><b>' + esc(who(g.user_id)) + (g.companion ? ' <span class="mstatus">+1</span>' : '') + (tag ? ' <span class="mstatus">' + tag + '</span>' : '') + '</b><span class="muted">' + esc(bike(g.user_id)) + '</span></div></div>'; };
    Cl.sheet('<div class="head"><h1>Quién viene</h1><button class="btn small icon" id="clX" type="button"><svg><use href="#i-close"/></svg></button></div><p class="muted">' + esc(e.title) + ' · ' + fmtWhen(e.starts_at) + (e.capacity ? ' · ' + e.capacity + (e.capacity === 1 ? ' plaza' : ' plazas') : '') + '</p><div class="rg-list">' +
      (going.length || off.length ? going.map(function (g) { return person(g); }).join('') + off.map(function (g) { return person(g, 'por confirmar'); }).join('') : '<p class="muted">Nadie apuntado todavía.</p>') + '</div>' +
      (queue.length ? '<h2 class="rg-h2">Lista de espera</h2><div class="rg-list">' + queue.map(function (g, i) { return person(g, 'puesto ' + (i + 1)); }).join('') + '</div>' : ''));
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
      if (v6 && $('#evCap').value.trim() && !(cap >= 1 && cap <= 1000)) { A.toast('Las plazas tienen que ser un número entre 1 y 1000.', 'warn'); return; }
      Cl.busy(ev.target.querySelector('button[type=submit]'), function () {
        var point = !v6 ? Promise.resolve(null) : (link ? (e && link === link0 && e.meet_lat != null ? Promise.resolve({ url: e.meet_url, lat: e.meet_lat, lon: e.meet_lon }) : window.RGNav.resolvePoint(link)) : Promise.resolve({ url: null, lat: null, lon: null }));
        return point.then(function (pt) {
          if (pt) {
            row.capacity = cap >= 1 ? cap : null; row.meet_url = pt.url || null; row.meet_lat = pt.lat != null ? pt.lat : null; row.meet_lon = pt.lon != null ? pt.lon : null;
            if (pt.url && pt.lat == null) warn = 'El enlace se abrirá en Google Maps, pero no trae coordenadas: no podré marcar la salida en el mapa de la app.';
            if (pt.name && !row.meet_name) row.meet_name = pt.name;
          }
          var save = function () { return (e ? sb.from('events').update(row).eq('id', e.id) : sb.from('events').insert(row)); };
          return save().then(function (r) {
            if (r.error && pt && /capacity|meet_(url|lat|lon)/i.test(r.error.message || '')) {     // el servidor aún no tiene el 06
              S.v6 = false; delete row.capacity; delete row.meet_url; delete row.meet_lat; delete row.meet_lon; warn = 'Guardado sin plazas ni enlace de salida: falta ejecutar supabase/06_plazas_y_salida.sql.';
              return save();
            }
            return r;
          }).then(function (r) { ok(r); Cl.closeSheet(); A.toast(warn || (e ? 'Evento actualizado.' : 'Evento publicado.'), warn ? 'warn' : 'ok'); inbox(true); return paneEvents(c); });
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
        pane.innerHTML = (isAdmin() ? '<div class="club-card"><textarea class="note" id="poBody" maxlength="4000" placeholder="Escribe un aviso para la comunidad"></textarea><button class="btn primary" id="poSend" type="button" style="width:100%;margin-top:10px">Publicar aviso</button></div>' : '') +
          (posts.length ? posts.map(function (p) { return '<div class="club-card" data-po="' + p.id + '"><span class="muted">' + esc(who(p.author_id)) + ' · ' + fmtWhen(p.created_at) + '</span><p>' + esc(p.body) + '</p>' + (isAdmin() ? '<button class="link danger" type="button">Borrar</button>' : '') + '</div>'; }).join('') : '<div class="empty">Aún no hay avisos.</div>');
        if ($('#poSend')) $('#poSend').addEventListener('click', function (ev) { var t = $('#poBody').value.trim(); if (!t) return; Cl.busy(ev.currentTarget, function () { return sb.from('community_posts').insert({ community_id: c.id, body: t }).then(function (r) { ok(r); return paneBoard(c); }); }); });
        $$('[data-po] .link', pane).forEach(function (b) { b.addEventListener('click', function () { armed(b, '¿Seguro? Toca otra vez', function () { sb.from('community_posts').delete().eq('id', b.parentNode.dataset.po).then(function (r) { ok(r); return paneBoard(c); }).catch(fail); }); }); });
      })(); }, useCache);
  }

  /* ---------- páginas: normas, descuentos, enlaces ---------- */
  function panePages(c, useCache) {
    return swr('pages:' + c.id, function () { return sb.from('community_pages').select('*').eq('community_id', c.id).order('position').order('title').then(ok); }, function (pages) {
      var pane = $('#clPane'); if (!pane || S.tab !== 'pages' || !cur() || cur().id !== c.id) return;
      pane.innerHTML = (isAdmin() ? '<button class="btn primary club-add" id="pgNew" type="button">+ Nueva página</button>' : '') +
        (pages.length ? pages.map(function (p) { return '<button class="club-card club-page" type="button" data-pg="' + p.id + '"><b>' + esc(p.title) + '</b><span class="muted">' + esc((p.body || '').slice(0, 90)) + ((p.links || []).length ? ' · ' + p.links.length + (p.links.length === 1 ? ' enlace' : ' enlaces') : '') + '</span></button>'; }).join('') : '<div class="empty">Aquí irán las normas, los descuentos y los enlaces de la comunidad.</div>');
      if ($('#pgNew')) $('#pgNew').addEventListener('click', function () { pageForm(c, null); });
      $$('[data-pg]', pane).forEach(function (b) { b.addEventListener('click', function () { pageView(c, pages.filter(function (p) { return p.id === b.dataset.pg; })[0]); }); });
    }, useCache);
  }
  function pageView(c, p) {
    Cl.sheet('<div class="head"><h1>' + esc(p.title) + '</h1><button class="btn small icon" id="clX" type="button"><svg><use href="#i-close"/></svg></button></div>' + (p.body ? '<p class="club-body">' + esc(p.body) + '</p>' : '') +
      (p.links || []).map(function (l, i) { return '<div class="club-link"><button class="btn" data-url="' + i + '" type="button"' + (l.url ? '' : ' disabled') + '>' + esc(l.label || l.url) + '</button>' + (l.code ? '<button class="club-codechip" data-code="' + i + '" type="button"><b>' + esc(l.code) + '</b><span>Copiar código</span></button>' : '') + '</div>'; }).join('') +
      (isAdmin() ? '<div class="ev-admin"><button class="link" id="pgEdit" type="button">Editar</button><button class="link danger" id="pgDel" type="button">Borrar</button></div>' : ''));
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
      Cl.busy(ev.target.querySelector('button[type=submit]'), function () { return (p ? sb.from('community_pages').update(row).eq('id', p.id) : sb.from('community_pages').insert(row)).then(function (r) { ok(r); Cl.closeSheet(); A.toast('Página guardada.', 'ok'); return panePages(c); }); });
    });
  }

  /* ---------- miembros ---------- */
  function paneMembers(c, useCache) {
    return swr('members:' + c.id, function () {
      return sb.from('community_members').select('user_id,role,joined_at').eq('community_id', c.id).order('joined_at').then(function (r) {
        var ms = ok(r); return names(ms.map(function (m) { return m.user_id; })).then(function () { return ms; }); });
    }, function (ms) { (function () {
        var pane = $('#clPane'); if (!pane || S.tab !== 'members' || !cur() || cur().id !== c.id) return;
        pane.innerHTML = '<span class="label">' + ms.length + (ms.length === 1 ? ' miembro' : ' miembros') + '</span>' + ms.map(function (m) {
          var me = m.user_id === S.user.id;
          return '<div class="club-person" data-u="' + m.user_id + '"><span class="rg-ava">' + esc(who(m.user_id).charAt(0).toUpperCase()) + '</span><div><b>' + esc(who(m.user_id)) + (me ? ' (tú)' : '') + (m.role === 'admin' ? ' <span class="mstatus ok">Admin</span>' : '') + '</b><span class="muted">' + esc(bike(m.user_id)) + '</span></div>' +
            (isAdmin() && !me ? '<button class="link" data-act="role" type="button">' + (m.role === 'admin' ? 'Quitar admin' : 'Hacer admin') + '</button><button class="link danger" data-act="kick" type="button">Expulsar</button>' : '') + '</div>';
        }).join('') + '<button class="btn danger" id="clLeave" type="button" style="margin-top:14px">Salir de esta comunidad</button>';
        $$('[data-act]', pane).forEach(function (b) { b.addEventListener('click', function () {
          var uid = b.parentNode.dataset.u, m = ms.filter(function (x) { return x.user_id === uid; })[0];
          if (b.dataset.act === 'role') sb.from('community_members').update({ role: m.role === 'admin' ? 'member' : 'admin' }).eq('community_id', c.id).eq('user_id', uid).then(function (r) { ok(r); return paneMembers(c); }).catch(fail);
          else armed(b, '¿Seguro?', function () { sb.from('community_members').delete().eq('community_id', c.id).eq('user_id', uid).then(function (r) { ok(r); return paneMembers(c); }).catch(fail); });
        }); });
        $('#clLeave').addEventListener('click', function (ev) {
          if (isAdmin() && ms.filter(function (x) { return x.role === 'admin'; }).length === 1 && ms.length > 1) { A.toast('Eres el único administrador: nombra a otro antes de salir.', 'warn'); return; }
          armed(ev.currentTarget, '¿Seguro? Toca otra vez para salir', function () { sb.from('community_members').delete().eq('community_id', c.id).eq('user_id', S.user.id).then(function (r) { ok(r); S.cid = null; listAt = 0; return load().then(render); }).catch(fail); });
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
     Lo que NO puede hacer sin notificaciones push: avisar de una plaza ofrecida con la app cerrada. */
  var LN = P.LocalNotifications || null, IN = { events: [], at: 0, busy: false, pending: [] };
  var RA = native && P.RideAlerts && P.RideAlerts.eventSync ? P.RideAlerts : null, raReady = false;
  function jget(k) { try { return JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch (e) { return {}; } }
  function jset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function nid(evId, k) { return (parseInt(String(evId).replace(/-/g, '').slice(0, 7), 16) || 1) * 4 + k; }   // cabe en un entero de 32 bits
  function hhmm(ms) { return new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }); }
  function inbox(force) {
    if (!sb || !S.user || IN.busy || S.v6 === false) return Promise.resolve();
    if (!force && Date.now() - IN.at < 20000) return Promise.resolve();
    IN.busy = true; IN.at = Date.now();
    return sb.rpc('event_inbox').then(function (r) {
      IN.busy = false;
      if (r.error) { if (/could not find|schema cache|does not exist/i.test(r.error.message || '')) S.v6 = false; return; }
      S.v6 = true; IN.events = (r.data && r.data.events) || [];
      remind(); offers(); drain();
    }, function () { IN.busy = false; });
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
      [[24 * 3600e3, 0, 'Mañana: ' + e.title, fmtWhen(e.starts_at) + (e.meet_name ? ' · Salida: ' + e.meet_name : '') + '. Si no puedes ir, desapúntate y tu plaza pasa a otro.'],
       [3600e3, 1, 'En 1 hora: ' + e.title, 'Sales a las ' + hhmm(e.starts_at) + (e.meet_name ? ' desde ' + e.meet_name : '') + '. ¿No llegas? Desapúntate.']].forEach(function (x) {
        var at = e.starts_at - x[0]; if (at < now + 30000) return;
        want[nid(e.id, x[1])] = { key: key, n: { id: nid(e.id, x[1]), title: x[2], body: x[3], schedule: { at: new Date(at), allowWhileIdle: true }, actionTypeId: 'RG_EVENT', extra: { eventId: e.id, title: e.title, kind: 'remind' } },
          nat: { id: nid(e.id, x[1]), at: at, title: x[2], body: x[3], kind: 'remind', key: e.key, eventId: e.id, eventTitle: e.title } };
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
  function forgetReminders() { var had = jget('rg.remind'), ids = Object.keys(had).map(function (id) { return { id: +id }; }); if (LN && ids.length) { try { LN.cancel({ notifications: ids }).catch(function () {}); } catch (e) {} } if (RA) { try { RA.eventClear().catch(function () {}); } catch (e) {} } jset('rg.remind', {}); }
  // Plaza ofrecida: una vez por oferta. En pantalla, pregunta; en segundo plano, notificación con «Sí, voy» / «No puedo».
  function offers() {
    var seen = jget('rg.offers'), now = Date.now(), ch = false;
    Object.keys(seen).forEach(function (k) { if (now - (seen[k].at || 0) > 20 * 864e5) { delete seen[k]; ch = true; } });
    IN.events.forEach(function (e) {
      if (e.status !== 'offered') return;
      var k = e.id + ':' + e.offered_at, sn = seen[k] || (seen[k] = { at: now });
      if (document.visibilityState === 'visible') {
        if (sn.asked || A.isRec() || !$('#rgSheet').hidden) return;
        sn.asked = 1; ch = true; offerSheet(e);
      } else if (RA && e.key && !sn.notified) {
        sn.notified = 1; ch = true;
        if (!raReady) { raReady = true; try { RA.eventConfig({ url: Cl.cfg.url, apikey: Cl.cfg.key }).catch(function () {}); } catch (x) {} }
        try { RA.eventShow({ item: { id: nid(e.id, 2), at: 0, title: 'Hay una plaza para ti: ' + e.title, body: 'Alguien se ha desapuntado y eres el siguiente. ¿Vienes? Contesta antes del ' + fmtWhen(e.deadline).toLowerCase() + '.', kind: 'offer', key: e.key, eventId: e.id, eventTitle: e.title } }).catch(function () {}); } catch (x) {}
      } else if (LN && !sn.notified) {
        sn.notified = 1; ch = true;
        try { LN.schedule({ notifications: [{ id: nid(e.id, 2), title: 'Hay una plaza para ti: ' + e.title, body: 'Alguien se ha desapuntado y eres el siguiente. ¿Vienes? Contesta antes del ' + fmtWhen(e.deadline).toLowerCase() + '.', actionTypeId: 'RG_OFFER', extra: { eventId: e.id, title: e.title, kind: 'offer' } }] }).catch(function () {}); } catch (x) {}
      }
    });
    if (ch) jset('rg.offers', seen);
  }
  function offerSheet(e) {
    Cl.sheet('<div class="head"><h1>Hay una plaza para ti</h1></div><p><b>' + esc(e.title) + '</b><br>' + fmtWhen(e.starts_at) + (e.meet_name ? ' · Salida: ' + esc(e.meet_name) : '') + '</p>' +
      '<p>Alguien se ha desapuntado y eres el siguiente de la lista de espera. ¿Vas a venir?</p>' +
      '<button class="btn big primary" id="ofYes" type="button">Sí, voy</button><button class="btn big" id="ofNo" type="button">No puedo, que pase al siguiente</button>' +
      '<p class="muted rg-small" style="text-align:left">Si no contestas antes del ' + fmtWhen(e.deadline).toLowerCase() + ', la plaza pasa al siguiente y tú vuelves a la lista.</p>');
    $('#ofYes').addEventListener('click', function (ev) { Cl.busy(ev.currentTarget, function () { return answer(e.id, e.title, true).then(Cl.closeSheet); }); });
    $('#ofNo').addEventListener('click', function (ev) { Cl.busy(ev.currentTarget, function () { return answer(e.id, e.title, false).then(Cl.closeSheet); }); });
  }
  function refresh() { var c = cur(); if (c && S.tab === 'events' && !$('#view-club').hidden) paneEvents(c).catch(function () {}); }
  function answer(evId, title, yes) {
    return sb.from('event_attendees').update({ status: yes ? 'going' : 'no' }).eq('event_id', evId).eq('user_id', S.user.id).select('status').then(function (r) {
      var d = ok(r), got = d && d[0] ? d[0].status : null;
      A.toast(yes ? (got === 'going' ? 'Confirmado: vas a «' + title + '».' : 'La plaza ya no estaba libre: sigues en la lista de espera.') : 'Vale. La plaza pasa al siguiente de la lista.', yes && got !== 'going' ? 'warn' : 'ok');
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
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') setTimeout(function () { nativePending(); inbox(true); refresh(); }, 1200); });

  Cl.onChange(function (u) {
    var changed = (S.user && S.user.id) !== (u && u.id); S.user = u;
    if (changed) { S.loaded = false; S.names = {}; IN.events = []; IN.at = 0; if (!u) forgetReminders(); else setTimeout(function () { nativePending(); inbox(true); }, 2000); if (!$('#view-club').hidden) show(); }
  });
  window.RGClub = { show: show, inbox: inbox, state: S, mine: function () { return IN.events.slice(); } };
})();
