/* ReGroupRide — comunidad: unirse con código, eventos y rutas, tablón, páginas (normas, descuentos, enlaces) y miembros.
   Usa la sesión de rg-app.js (window.RGCloud) y las rutas guardadas de app.js (window.RGApp). */
(function () {
  'use strict';
  var A = window.RGApp, Cl = window.RGCloud;
  if (!A || !Cl) return;
  var sb = Cl.sb, esc = Cl.esc, $ = function (s, r) { return (r || document).querySelector(s); }, $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var C = window.Capacitor, native = !!(C && C.isNativePlatform && C.isNativePlatform()), P = native ? (C.Plugins || {}) : {};
  var box = $('#clubBody');
  var S = { user: null, list: [], cid: null, tab: 'events', loaded: false, missing: false, names: {} };
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
  function names(ids) {
    var need = ids.filter(function (id, i) { return id && !S.names[id] && ids.indexOf(id) === i; });
    if (!need.length) return Promise.resolve();
    return sb.from('profiles').select('id,name,bike_brand,bike_model').in('id', need).then(function (r) { (r.data || []).forEach(function (p) { S.names[p.id] = p; }); });
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
    });
  }
  function setCid(id) { S.cid = id; try { localStorage.setItem('rg.club', id); } catch (e) {} }
  function show() { render(); load().then(render, function (e) { S.loaded = true; render(); fail(e); }); }

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
      (S.list.length > 1 ? '<div class="pills">' + S.list.map(function (x) { return '<button class="pill" type="button" data-cid="' + x.id + '" aria-pressed="' + (x.id === c.id) + '">' + esc(x.name) + '</button>'; }).join('') + '</div>' : '') +
      '<div class="seg rg-wide" id="clTabs">' + [['events', 'Eventos'], ['board', 'Tablón'], ['pages', 'Info'], ['members', 'Miembros']].map(function (t) { return '<button type="button" data-t="' + t[0] + '" aria-pressed="' + (S.tab === t[0]) + '">' + t[1] + '</button>'; }).join('') + '</div><div id="clPane"><div class="empty">Cargando…</div></div>';
    $('#clInvite').addEventListener('click', invite);
    $$('[data-cid]', box).forEach(function (b) { b.addEventListener('click', function () { setCid(b.dataset.cid); render(); }); });
    $$('#clTabs button', box).forEach(function (b) { b.addEventListener('click', function () { S.tab = b.dataset.t; render(); }); });
    ({ events: paneEvents, board: paneBoard, pages: panePages, members: paneMembers })[S.tab](c).catch(function (e) { var p = $('#clPane'); if (p) p.innerHTML = '<div class="empty">' + esc(Cl.msg(e)) + '</div>'; });
  }
  function renderJoin() {
    box.innerHTML = '<div class="club-card"><b>Unirme a una comunidad</b><p class="muted">Escribe el código que te ha pasado el organizador.</p><div class="plan-link"><input type="text" id="clCode" maxlength="8" placeholder="Código" autocapitalize="characters" autocomplete="off"><button class="btn small primary" id="clJoin" type="button">Unirme</button></div></div>' +
      '<div class="club-card"><b>Crear una comunidad</b><p class="muted">Serás su administrador: podrás crear eventos, publicar avisos e invitar a la gente.</p><input type="text" id="clName" maxlength="60" placeholder="Nombre de la comunidad"><button class="btn" id="clCreate" type="button" style="margin-top:10px;width:100%">Crear comunidad</button></div>';
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
  function paneEvents(c) {
    var since = new Date(Date.now() - 12 * 3600e3).toISOString();
    return sb.from('events').select('*').eq('community_id', c.id).gte('starts_at', since).order('starts_at').limit(40).then(function (r) {
      var evs = ok(r), ids = evs.map(function (e) { return e.id; });
      return (ids.length ? sb.from('event_attendees').select('event_id,user_id,status,companion').in('event_id', ids) : Promise.resolve({ data: [] })).then(function (a) {
        var att = ok(a); return names(att.map(function (x) { return x.user_id; })).then(function () { drawEvents(c, evs, att); });
      });
    });
  }
  function drawEvents(c, evs, att) {
    var pane = $('#clPane'); if (!pane || S.tab !== 'events') return;
    pane.innerHTML = (isAdmin() ? '<button class="btn primary club-add" id="evNew" type="button">+ Nuevo evento o ruta</button>' : '') + (evs.length ? evs.map(function (e) {
      var going = att.filter(function (x) { return x.event_id === e.id && x.status === 'going'; }), mine = att.filter(function (x) { return x.event_id === e.id && x.user_id === S.user.id; })[0];
      var people = going.length + going.filter(function (x) { return x.companion; }).length, iGo = mine && mine.status === 'going';
      return '<div class="club-card ev" data-ev="' + e.id + '"><span class="ev-when">' + fmtWhen(e.starts_at) + '</span><b>' + esc(e.title) + '</b>' +
        (e.meet_name ? '<span class="muted">Salida: ' + esc(e.meet_name) + '</span>' : '') + (e.description ? '<p>' + esc(e.description) + '</p>' : '') +
        (e.route ? '<div class="ev-route"><span><svg><use href="#i-route"/></svg>' + esc(e.route.name || 'Ruta') + ' · ' + String(e.route.dist || 0).replace('.', ',') + ' km</span><button class="btn small" data-act="route" type="button">Cargar ruta</button></div>' : '') +
        '<div class="ev-go"><button class="btn small' + (iGo ? ' primary' : '') + '" data-act="go" type="button">' + (iGo ? 'Voy ✓' : 'Voy') + '</button>' + (iGo ? '<button class="btn small" data-act="comp" type="button" aria-pressed="' + !!mine.companion + '">Con acompañante</button>' : '') + (iGo ? '<button class="btn small" data-act="no" type="button">No voy</button>' : '') +
        (e.luma_url ? '<button class="btn small" data-act="luma" type="button">Apuntarse en Luma</button>' : '') + '</div>' +
        '<button class="link" data-act="who" type="button">' + (going.length ? going.length + (going.length === 1 ? ' moto' : ' motos') + (people > going.length ? ' · ' + people + ' personas' : '') : 'Nadie apuntado todavía') + '</button>' +
        (isAdmin() ? '<div class="ev-admin"><button class="link" data-act="edit" type="button">Editar</button><button class="link danger" data-act="del" type="button">Borrar</button></div>' : '') + '</div>';
    }).join('') : '<div class="empty">No hay eventos ni rutas próximas.' + (isAdmin() ? ' Crea el primero.' : '') + '</div>');
    if ($('#evNew')) $('#evNew').addEventListener('click', function () { eventForm(c, null); });
    $$('.ev', pane).forEach(function (card) {
      var e = evs.filter(function (x) { return x.id === card.dataset.ev; })[0], mine = att.filter(function (x) { return x.event_id === e.id && x.user_id === S.user.id; })[0];
      var set = function (status, companion) { return sb.from('event_attendees').upsert({ event_id: e.id, user_id: S.user.id, status: status, companion: !!companion }, { onConflict: 'event_id,user_id' }).then(function (r) { ok(r); return paneEvents(c); }).catch(fail); };
      $$('[data-act]', card).forEach(function (b) { b.addEventListener('click', function () {
        var act = b.dataset.act;
        if (act === 'go') set('going', mine && mine.companion); else if (act === 'no') set('no', false); else if (act === 'comp') set('going', !(mine && mine.companion));
        else if (act === 'luma') openUrl(e.luma_url); else if (act === 'route') loadRoute(e);
        else if (act === 'who') whoGoes(e, att.filter(function (x) { return x.event_id === e.id && x.status === 'going'; }));
        else if (act === 'edit') eventForm(c, e); else if (act === 'del') armed(b, '¿Seguro? Toca otra vez', function () { sb.from('events').delete().eq('id', e.id).then(function (r) { ok(r); A.toast('Evento borrado.', 'ok'); return paneEvents(c); }).catch(fail); });
      }); });
    });
  }
  function loadRoute(e) {
    var r = e.route; if (!r || !r.coords || r.coords.length < 2) { A.toast('Este evento no tiene ruta.', 'warn'); return; }
    var p = { id: parseInt(e.id.replace(/-/g, '').slice(0, 12), 16), name: r.name || e.title, wps: r.wps || [], coords: r.coords, dist: r.dist || 0, dur: r.dur || 0, routed: true, steps: r.steps || [], created: Date.now(), eventId: e.id };
    A.usePlan(p).then(function () { A.toast('Ruta cargada. Pulsa «Iniciar ruta» cuando salgáis.', 'ok'); });
  }
  function whoGoes(e, going) {
    Cl.sheet('<div class="head"><h1>Quién viene</h1><button class="btn small icon" id="clX" type="button"><svg><use href="#i-close"/></svg></button></div><p class="muted">' + esc(e.title) + ' · ' + fmtWhen(e.starts_at) + '</p><div class="rg-list">' +
      (going.length ? going.map(function (g) { return '<div class="club-person"><span class="rg-ava">' + esc(who(g.user_id).charAt(0).toUpperCase()) + '</span><div><b>' + esc(who(g.user_id)) + (g.companion ? ' <span class="mstatus">+1</span>' : '') + '</b><span class="muted">' + esc(bike(g.user_id)) + '</span></div></div>'; }).join('') : '<p class="muted">Nadie apuntado todavía.</p>') + '</div>');
    $('#clX').addEventListener('click', Cl.closeSheet);
  }
  function eventForm(c, e) {
    var plans = A.plans(), keep = e && e.route ? '<option value="keep" selected>' + esc('Mantener: ' + (e.route.name || 'ruta actual')) + '</option>' : '';
    Cl.sheet('<div class="head"><h1>' + (e ? 'Editar evento' : 'Nuevo evento') + '</h1><button class="btn small icon" id="clX" type="button"><svg><use href="#i-close"/></svg></button></div><form class="rg-form" id="evForm">' +
      '<label>Nombre<input id="evTitle" required maxlength="120" value="' + esc(e ? e.title : '') + '" placeholder="Ruta del domingo"></label>' +
      '<label>Día y hora de salida<input id="evWhen" type="datetime-local" required value="' + localInput(e && e.starts_at) + '"></label>' +
      '<label>Punto de salida<input id="evMeet" maxlength="120" value="' + esc(e ? e.meet_name : '') + '" placeholder="Gasolinera de…"></label>' +
      '<label>Descripción<textarea id="evDesc" maxlength="4000" placeholder="Paradas, nivel, normas, lo que quieras contar">' + esc(e ? e.description : '') + '</textarea></label>' +
      '<label>Ruta<select id="evRoute"><option value="">Sin ruta</option>' + keep + plans.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + ' · ' + String(p.dist).replace('.', ',') + ' km</option>'; }).join('') + '</select></label>' +
      '<p class="muted rg-small" style="text-align:left">Salen tus rutas planificadas. Para añadir una, créala en el mapa (pegando el enlace de Google Maps) y guárdala.</p>' +
      '<label>Enlace de Luma (opcional)<input id="evLuma" inputmode="url" maxlength="300" value="' + esc(e && e.luma_url ? e.luma_url : '') + '" placeholder="https://luma.com/…"></label>' +
      '<button class="btn big primary" type="submit">' + (e ? 'Guardar cambios' : 'Publicar') + '</button></form>');
    $('#clX').addEventListener('click', Cl.closeSheet);
    $('#evForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var row = { community_id: c.id, title: $('#evTitle').value.trim(), starts_at: new Date($('#evWhen').value).toISOString(), meet_name: $('#evMeet').value.trim(), description: $('#evDesc').value.trim(), luma_url: $('#evLuma').value.trim() || null };
      var sel = $('#evRoute').value;
      if (sel !== 'keep') { var p = plans.filter(function (x) { return String(x.id) === sel; })[0]; row.route = p ? { name: p.name, wps: p.wps, coords: p.coords, steps: p.steps || [], dist: p.dist, dur: p.dur } : null; }
      Cl.busy(ev.target.querySelector('button[type=submit]'), function () {
        return (e ? sb.from('events').update(row).eq('id', e.id) : sb.from('events').insert(row)).then(function (r) { ok(r); Cl.closeSheet(); A.toast(e ? 'Evento actualizado.' : 'Evento publicado.', 'ok'); return paneEvents(c); });
      });
    });
  }

  /* ---------- tablón ---------- */
  function paneBoard(c) {
    return sb.from('community_posts').select('id,body,created_at,author_id').eq('community_id', c.id).order('created_at', { ascending: false }).limit(40).then(function (r) {
      var posts = ok(r); return names(posts.map(function (p) { return p.author_id; })).then(function () {
        var pane = $('#clPane'); if (!pane || S.tab !== 'board') return;
        pane.innerHTML = (isAdmin() ? '<div class="club-card"><textarea class="note" id="poBody" maxlength="4000" placeholder="Escribe un aviso para la comunidad"></textarea><button class="btn primary" id="poSend" type="button" style="width:100%;margin-top:10px">Publicar aviso</button></div>' : '') +
          (posts.length ? posts.map(function (p) { return '<div class="club-card" data-po="' + p.id + '"><span class="muted">' + esc(who(p.author_id)) + ' · ' + fmtWhen(p.created_at) + '</span><p>' + esc(p.body) + '</p>' + (isAdmin() ? '<button class="link danger" type="button">Borrar</button>' : '') + '</div>'; }).join('') : '<div class="empty">Aún no hay avisos.</div>');
        if ($('#poSend')) $('#poSend').addEventListener('click', function (ev) { var t = $('#poBody').value.trim(); if (!t) return; Cl.busy(ev.currentTarget, function () { return sb.from('community_posts').insert({ community_id: c.id, body: t }).then(function (r) { ok(r); return paneBoard(c); }); }); });
        $$('[data-po] .link', pane).forEach(function (b) { b.addEventListener('click', function () { armed(b, '¿Seguro? Toca otra vez', function () { sb.from('community_posts').delete().eq('id', b.parentNode.dataset.po).then(function (r) { ok(r); return paneBoard(c); }).catch(fail); }); }); });
      });
    });
  }

  /* ---------- páginas: normas, descuentos, enlaces ---------- */
  function panePages(c) {
    return sb.from('community_pages').select('*').eq('community_id', c.id).order('position').order('title').then(function (r) {
      var pages = ok(r), pane = $('#clPane'); if (!pane || S.tab !== 'pages') return;
      pane.innerHTML = (isAdmin() ? '<button class="btn primary club-add" id="pgNew" type="button">+ Nueva página</button>' : '') +
        (pages.length ? pages.map(function (p) { return '<button class="club-card club-page" type="button" data-pg="' + p.id + '"><b>' + esc(p.title) + '</b><span class="muted">' + esc((p.body || '').slice(0, 90)) + ((p.links || []).length ? ' · ' + p.links.length + (p.links.length === 1 ? ' enlace' : ' enlaces') : '') + '</span></button>'; }).join('') : '<div class="empty">Aquí irán las normas, los descuentos y los enlaces de la comunidad.</div>');
      if ($('#pgNew')) $('#pgNew').addEventListener('click', function () { pageForm(c, null); });
      $$('[data-pg]', pane).forEach(function (b) { b.addEventListener('click', function () { pageView(c, pages.filter(function (p) { return p.id === b.dataset.pg; })[0]); }); });
    });
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
  function paneMembers(c) {
    return sb.from('community_members').select('user_id,role,joined_at').eq('community_id', c.id).order('joined_at').then(function (r) {
      var ms = ok(r); return names(ms.map(function (m) { return m.user_id; })).then(function () {
        var pane = $('#clPane'); if (!pane || S.tab !== 'members') return;
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
          armed(ev.currentTarget, '¿Seguro? Toca otra vez para salir', function () { sb.from('community_members').delete().eq('community_id', c.id).eq('user_id', S.user.id).then(function (r) { ok(r); S.cid = null; return load().then(render); }).catch(fail); });
        });
      });
    });
  }

  Cl.onChange(function (u) { var changed = (S.user && S.user.id) !== (u && u.id); S.user = u; if (changed) { S.loaded = false; S.names = {}; if (!$('#view-club').hidden) show(); } });
  window.RGClub = { show: show };
})();
