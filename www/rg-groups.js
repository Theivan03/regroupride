/* ReGroupRide · grupos dentro de la comunidad (charla o rutas compartidas), reportes y «no ver más a alguien».
   supabase/29_grupos_y_reportes.sql */
(function () {
  'use strict';
  var A = window.RGApp, Cl = window.RGCloud; if (!A || !Cl || !Cl.sb) return;
  var sb = Cl.sb, $ = function (s, r) { return (r || document).querySelector(s); }, $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ok(r) { if (r.error) throw r.error; return r.data; }
  function fail(e) { A.toast(Cl.msg ? Cl.msg(e) : (e && e.message) || 'No se ha podido.', 'bad'); }
  function me() { var u = Cl.user && Cl.user(); return u ? u.id : null; }
  function api() { return window.RGClub && RGClub.api; }
  function head(t) { return '<div class="head"><h1>' + t + '</h1><button class="btn small icon" id="grX" type="button" aria-label="Cerrar"><svg><use href="#i-close"/></svg></button></div>'; }
  var WRITE = { all: 'Escriben todos', admins: 'Solo escriben los administradores', owner: 'Solo escribe quien creó la comunidad' };
  var BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7 2.5 7h-17S6 15 6 9"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>';

  /* ---------- personas ocultas: sus mensajes no se me enseñan ---------- */
  var HID = null;
  function loadHides() { if (!me()) return Promise.resolve(); return sb.from('user_hides').select('hidden_id').eq('user_id', me()).then(function (r) { if (!r.error) { HID = {}; (r.data || []).forEach(function (x) { HID[x.hidden_id] = 1; }); } }, function () {}); }
  function hidden(id) { return !!(HID && HID[id]); }
  setTimeout(loadHides, 4000);

  /* ---------- reportar ---------- */
  var REASONS = [['acoso', 'Acoso, insultos o amenazas'], ['temeraria', 'Conducción temeraria o peligrosa'], ['spam', 'Spam o publicidad'], ['suplantacion', 'Se hace pasar por otra persona'], ['otro', 'Otro motivo']];
  // o = { target, name, kind: 'persona' | 'mensaje' | 'ruta' | 'fotografo', excerpt, place, back }
  function report(o) {
    if (!me()) { Cl.openAuth(false); return; }
    Cl.sheet(head('Reportar') + '<p class="muted" style="text-align:left;margin:0">Vas a reportar a <b>' + esc(o.name || 'esta persona') + '</b>. Lo revisa el creador de la app; la otra persona no sabrá quién ha sido.</p>' +
      (o.excerpt ? '<div class="rt-note warn"><b>Lo que reportas</b><p>' + esc(o.excerpt) + '</p></div>' : '') +
      '<form class="rg-form" id="rpForm"><label>Motivo<select id="rpReason">' + REASONS.map(function (x) { return '<option value="' + x[0] + '">' + x[1] + '</option>'; }).join('') + '</select></label>' +
      '<label>Cuéntanos qué ha pasado<textarea id="rpDetail" class="note" maxlength="1000" required minlength="5" placeholder="Qué ha hecho, cuándo y dónde. Cuanto más concreto, mejor."></textarea></label>' +
      '<label class="rg-check"><input type="checkbox" id="rpHide" checked><span><b>No ver más a esta persona</b><small>Sus mensajes dejarán de aparecerte. Puedes deshacerlo en Ajustes.</small></span></label>' +
      '<button class="btn big primary" type="submit">Enviar reporte</button></form>');
    $('#grX').addEventListener('click', function () { if (o.back) o.back(); else Cl.closeSheet(); });
    $('#rpForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var hide = $('#rpHide').checked;
      Cl.busy(ev.target.querySelector('button[type=submit]'), function () {
        return sb.rpc('report_send', { p_target: o.target, p_kind: o.kind || 'persona', p_reason: $('#rpReason').value, p_detail: $('#rpDetail').value.trim(), p_excerpt: o.excerpt || '', p_place: o.place || '' }).then(function (r) {
          ok(r);
          var after = function () { Cl.sheet(head('Reporte enviado') + '<p class="muted">Gracias. Lo revisamos cuanto antes.' + (hide ? ' Ya no verás los mensajes de esta persona.' : '') + '</p><button class="btn big primary" id="rpOk" type="button">Vale</button>'); var end = function () { if (o.back) o.back(); else Cl.closeSheet(); }; $('#grX').addEventListener('click', end); $('#rpOk').addEventListener('click', end); };
          if (hide && o.target) return sb.from('user_hides').upsert({ user_id: me(), hidden_id: o.target }).then(function () { HID = HID || {}; HID[o.target] = 1; after(); }, after);
          after();
        });
      });
    });
  }

  /* ---------- lista de grupos de la comunidad ---------- */
  function pane(c, host) {
    var P = api(); if (!P) return Promise.resolve();
    return sb.rpc('groups_list', { p_community: c.id }).then(function (r) {
      var rows = ok(r) || []; if (!host.isConnected) return;
      host.innerHTML = (P.isAdmin() ? '<button class="btn big primary club-add" id="grNew" type="button"><svg><use href="#i-plus"/></svg>Nuevo grupo</button>' : '') +
        (rows.length ? rows.map(function (g) {
          var d = g.last ? new Date(g.last.at) : null;
          return '<button class="gr-item" data-id="' + g.id + '" type="button"><span class="gr-ico">' + (g.kind === 'routes' ? '<svg><use href="#i-route"/></svg>' : '<svg><use href="#i-people"/></svg>') + '</span><span class="gr-info"><b>' + esc(g.name) + (g.is_private ? ' <small class="rt-tag">Privado</small>' : '') + '</b>' +
            '<small>' + (g.last ? esc(g.last.name) + ': ' + esc(g.last.body) : (g.description ? esc(g.description) : 'Todavía no hay mensajes')) + '</small></span><span class="gr-side">' + (d ? '<time>' + (d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : d.getDate() + '/' + (d.getMonth() + 1)) + '</time>' : '') + (g.muted ? '<i class="gr-muted" title="Silenciado">' + BELL + '</i>' : '') + '</span></button>';
        }).join('') : '<div class="empty">Todavía no hay grupos.' + (P.isAdmin() ? ' Crea uno para avisos, para charlar o para que la gente comparta sus rutas.' : ' Los administradores pueden crear grupos para charlar o compartir rutas.') + '</div>');
      if ($('#grNew')) $('#grNew').addEventListener('click', function () { form(c, null); });
      $$('.gr-item', host).forEach(function (b) { b.addEventListener('click', function () { openGroup(c, rows.filter(function (x) { return x.id === b.dataset.id; })[0]); }); });
    });
  }

  /* ---------- crear o editar un grupo ---------- */
  function form(c, g) {
    var P = api();
    Cl.sheet(head(g ? 'Editar grupo' : 'Nuevo grupo') + '<form class="rg-form" id="gfForm">' +
      (g ? '' : '<label>Tipo de grupo<select id="gfKind"><option value="chat">Charla: mensajes de texto</option><option value="routes">Rutas: cada uno comparte las suyas</option></select></label>') +
      '<label>Nombre<input id="gfName" required minlength="2" maxlength="50" placeholder="Quedadas entre semana" value="' + esc(g ? g.name : '') + '"></label>' +
      '<label>Descripción (opcional)<input id="gfDesc" maxlength="140" value="' + esc(g ? g.description : '') + '"></label>' +
      '<label>Quién puede escribir<select id="gfWrite">' + Object.keys(WRITE).map(function (k) { return '<option value="' + k + '"' + ((g ? g.can_write : 'all') === k ? ' selected' : '') + '>' + WRITE[k] + '</option>'; }).join('') + '</select></label>' +
      '<label class="rg-check"><input type="checkbox" id="gfPriv"' + (g && g.is_private ? ' checked' : '') + '><span><b>Grupo privado</b><small>Solo lo ven los administradores y los miembros que elijas aquí abajo.</small></span></label>' +
      '<div id="gfMembers" hidden><span class="label">Quién está en el grupo</span><div class="tr-split" id="gfList"><span class="muted">Cargando…</span></div></div>' +
      '<button class="btn big primary" type="submit">' + (g ? 'Guardar' : 'Crear grupo') + '</button>' + (g ? '<button class="link danger rg-center" id="gfDel" type="button">Borrar este grupo y sus mensajes</button>' : '') + '</form>');
    var back = function () { if (g) openGroup(c, g); else Cl.closeSheet(); };
    $('#grX').addEventListener('click', back);
    var loaded = false, cur = {};
    function members() {
      $('#gfMembers').hidden = !$('#gfPriv').checked; if (!$('#gfPriv').checked || loaded) return; loaded = true;
      Promise.all([sb.from('community_members').select('user_id,role').eq('community_id', c.id), g ? sb.from('group_members').select('user_id').eq('group_id', g.id) : Promise.resolve({ data: [] })]).then(function (r) {
        var ms = ok(r[0]) || []; (r[1].data || []).forEach(function (x) { cur[x.user_id] = 1; });
        return P.names(ms.map(function (m) { return m.user_id; })).catch(function () {}).then(function () {
          $('#gfList').innerHTML = ms.filter(function (m) { return m.role !== 'admin'; }).map(function (m) { return '<label><input type="checkbox" value="' + m.user_id + '"' + (cur[m.user_id] ? ' checked' : '') + '><span>' + esc(P.who(m.user_id)) + '</span></label>'; }).join('') || '<span class="muted">Aún no hay más miembros. Los administradores lo ven siempre.</span>';
        });
      }).catch(fail);
    }
    $('#gfPriv').addEventListener('change', members); members();
    if ($('#gfDel')) $('#gfDel').addEventListener('click', function () { var b = this; if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = '¿Seguro? Se borran todos sus mensajes. Toca otra vez'; return; } sb.from('community_groups').delete().eq('id', g.id).then(function (r) { ok(r); Cl.closeSheet(); if (window.RGClub && RGClub.show) RGClub.show(); }).catch(fail); });
    $('#gfForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var id = g ? g.id : (window.crypto && crypto.randomUUID ? crypto.randomUUID() : null), priv = $('#gfPriv').checked;
      var row = { name: $('#gfName').value.trim(), description: $('#gfDesc').value.trim(), can_write: $('#gfWrite').value, is_private: priv };
      Cl.busy(ev.target.querySelector('button[type=submit]'), function () {
        var job = g ? sb.from('community_groups').update(row).eq('id', id) : sb.from('community_groups').insert(Object.assign({ id: id, community_id: c.id, kind: $('#gfKind').value, created_by: me() }, row));
        return job.then(function (r) {
          ok(r);
          if (!priv || !loaded) return;
          var want = {}; $$('#gfList input:checked').forEach(function (x) { want[x.value] = 1; });
          var add = Object.keys(want).filter(function (u) { return !cur[u]; }), del = Object.keys(cur).filter(function (u) { return !want[u]; }), jobs = [];
          if (add.length) jobs.push(sb.from('group_members').insert(add.map(function (u) { return { group_id: id, user_id: u }; })).then(ok));
          if (del.length) jobs.push(sb.from('group_members').delete().eq('group_id', id).in('user_id', del).then(ok));
          return Promise.all(jobs);
        }).then(function () { Cl.closeSheet(); if (window.RGClub && RGClub.show) RGClub.show(); });
      });
    });
  }

  /* ---------- un grupo abierto ---------- */
  var timer = 0;
  function openGroup(c, g) {
    var P = api(); clearInterval(timer);
    var routes = g.kind === 'routes', last = -1, muted = !!g.muted, bikes = {};
    Cl.sheet(head(esc(g.name)) + '<p class="muted gr-sub">' + (routes ? 'Grupo de rutas · ' : '') + WRITE[g.can_write] + (g.is_private ? ' · Privado' : '') + (g.description ? ' · ' + esc(g.description) : '') + '</p>' +
      '<div class="gr-bar"><button class="ev-bell" id="grBell" type="button" aria-pressed="' + !muted + '" aria-label="Avisos del grupo">' + BELL + '</button><span class="muted rg-small" id="grBellTx"></span>' + (P.isAdmin() ? '<button class="btn small" id="grEdit" type="button"><svg><use href="#i-edit"/></svg>Editar</button>' : '') + '</div>' +
      (g.pinned ? '<div class="rt-note tip gr-pin"><b>Fijado</b><p>' + esc(g.pinned) + '</p></div>' : '') +
      '<div class="ev-chat" id="grList" data-g="' + g.id + '"><p class="muted">Cargando…</p></div>' +
      (g.writes ? (routes ? '<button class="btn big primary" id="grShare" type="button"><svg><use href="#i-route"/></svg>Compartir una ruta</button>'
        : '<form class="ev-chat-form" id="grForm"><input id="grIn" maxlength="1500" autocomplete="off" enterkeyhint="send" placeholder="Escribe un mensaje…" aria-label="Mensaje"><button class="ch-send" type="submit" aria-label="Enviar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button></form>')
        : '<p class="muted rg-small rg-center">En este grupo ' + (g.can_write === 'admins' ? 'solo escriben los administradores.' : 'solo escribe quien creó la comunidad.') + '</p>'));
    $('#grX').addEventListener('click', function () { clearInterval(timer); Cl.closeSheet(); if (window.RGClub && RGClub.show) RGClub.show(); });
    var bellTx = function () { $('#grBell').setAttribute('aria-pressed', String(!muted)); $('#grBellTx').textContent = muted ? 'Avisos silenciados' : 'Avisos activados'; }; bellTx();
    $('#grBell').addEventListener('click', function () { muted = !muted; g.muted = muted; bellTx(); (muted ? sb.from('group_mutes').upsert({ group_id: g.id, user_id: me() }) : sb.from('group_mutes').delete().eq('group_id', g.id).eq('user_id', me())).then(ok).catch(function (e) { muted = !muted; g.muted = muted; bellTx(); fail(e); }); });
    if ($('#grEdit')) $('#grEdit').addEventListener('click', function () { clearInterval(timer); form(c, g); });
    function bikeOf(id) { var p = P.S.names[id]; return p ? [p.bike_brand, p.bike_model].filter(Boolean).join(' ') : ''; }
    function load(force) {
      if (!$('#grList') || $('#grList').dataset.g !== g.id) { clearInterval(timer); return Promise.resolve(); }
      return sb.from('group_messages').select('id,user_id,body,route_name,route_km,created_at').eq('group_id', g.id).order('id', { ascending: false }).limit(150).then(function (r) {
        var rows = ok(r).reverse().filter(function (x) { return !hidden(x.user_id); }), top = rows.length ? rows[rows.length - 1].id : 0; if (top === last && !force) return;
        return P.names(rows.map(function (x) { return x.user_id; })).catch(function () {}).then(function () {
          var el = $('#grList'); if (!el || el.dataset.g !== g.id) return;
          var stick = last < 0 || el.scrollHeight - el.scrollTop - el.clientHeight < 80, day = ''; last = top;
          el.innerHTML = rows.length ? rows.map(function (x) {
            var d = new Date(x.created_at), k = d.toDateString(), mine = x.user_id === me(), sep = '';
            if (k !== day) { day = k; sep = '<span class="ev-chat-day">' + d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }) + '</span>'; }
            var rt = x.route_name ? '<div class="gr-route"><b><svg><use href="#i-route"/></svg>' + esc(x.route_name) + '</b><span>' + String(+x.route_km || 0).replace('.', ',') + ' km</span><div class="rt-acts"><button class="btn small primary" data-r="see" type="button">Ver en el mapa</button><button class="btn small" data-r="save" type="button">Guardar</button>' + (P.isAdmin() ? '<button class="btn small" data-r="cat" type="button">Al catálogo</button>' : '') + '</div></div>' : '';
            return sep + '<div class="ev-msg' + (mine ? ' me' : '') + '" data-id="' + x.id + '" data-u="' + x.user_id + '">' + (mine ? '' : P.ava(x.user_id)) + '<div><b>' + esc(P.who(x.user_id)) + (bikeOf(x.user_id) ? ' <small>· ' + esc(bikeOf(x.user_id)) + '</small>' : '') + '</b>' + rt + (x.body ? '<p>' + esc(x.body) + '</p>' : '') +
              '<time>' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) + '<button class="gr-more" data-m="1" type="button" aria-label="Más">⋯</button></time>' +
              '<div class="gr-acts" hidden>' + (mine || P.isAdmin() ? '<button class="link danger" data-m="del" type="button">Borrar</button>' : '') + (P.isAdmin() && x.body ? '<button class="link" data-m="pin" type="button">Fijar</button>' : '') + (mine ? '' : '<button class="link danger" data-m="rep" type="button">Reportar</button><button class="link" data-m="hide" type="button">No ver más</button>') + '</div></div></div>';
          }).join('') : '<p class="muted">' + (routes ? 'Nadie ha compartido una ruta todavía. Sé el primero.' : 'Todavía no ha escrito nadie.') + '</p>';
          if (stick) el.scrollTop = el.scrollHeight;
          wire(el, rows);
        });
      }).catch(function (e) { var el = $('#grList'); if (el && last < 0) el.innerHTML = '<p class="muted">' + esc(Cl.msg ? Cl.msg(e) : e.message) + '</p>'; });
    }
    function fullRoute(id) { return sb.from('group_messages').select('route,route_name,route_km').eq('id', id).single().then(function (r) { var x = ok(r), rt = x.route || {}; if (!rt.coords || rt.coords.length < 2) throw new Error('Esa ruta no tiene trazado.'); return { id: Date.now(), name: x.route_name || rt.name || 'Ruta', wps: rt.wps || [], pois: rt.pois || [], coords: rt.coords, dist: +x.route_km || rt.dist || 0, dur: rt.dur || 0, routed: true, steps: rt.steps || [], created: Date.now(), raw: rt }; }); }
    function wire(el, rows) {
      var by = function (n) { var m = n.closest('.ev-msg'); return rows.filter(function (x) { return String(x.id) === m.dataset.id; })[0]; };
      $$('[data-m]', el).forEach(function (b) { b.addEventListener('click', function () {
        var x = by(b), a = b.dataset.m, box = b.closest('.ev-msg').querySelector('.gr-acts');
        if (a === '1') { box.hidden = !box.hidden; return; }
        if (a === 'del') { sb.from('group_messages').delete().eq('id', x.id).then(function (r) { ok(r); load(true); }).catch(fail); }
        else if (a === 'pin') { sb.from('community_groups').update({ pinned: x.body.slice(0, 300) }).eq('id', g.id).then(function (r) { ok(r); g.pinned = x.body.slice(0, 300); clearInterval(timer); openGroup(c, g); }).catch(fail); }
        else if (a === 'rep') { clearInterval(timer); report({ target: x.user_id, name: P.who(x.user_id), kind: x.route_name ? 'ruta' : 'mensaje', excerpt: x.route_name ? 'Ruta: ' + x.route_name + (x.body ? ' — ' + x.body : '') : x.body, place: c.name + ' · ' + g.name, back: function () { openGroup(c, g); } }); }
        else if (a === 'hide') { sb.from('user_hides').upsert({ user_id: me(), hidden_id: x.user_id }).then(function (r) { ok(r); HID = HID || {}; HID[x.user_id] = 1; load(true); }).catch(fail); }
      }); });
      $$('[data-r]', el).forEach(function (b) { b.addEventListener('click', function () {
        var x = by(b), a = b.dataset.r;
        Cl.busy(b, function () { return fullRoute(x.id).then(function (p) {
          if (a === 'save') return A.savePlan(p).then(function () { b.textContent = 'Guardada'; });
          if (a === 'cat') return sb.from('community_routes').insert({ community_id: c.id, name: p.name.slice(0, 80), description: x.body || '', dist: Math.round(p.dist * 10) / 10, dur: Math.round(p.dur), route: p.raw, created_by: me() }).then(function (r) { ok(r); b.textContent = 'En el catálogo'; });
          clearInterval(timer); Cl.closeSheet(); A.previewPlan(p);
        }); });
      }); });
    }
    if ($('#grForm')) $('#grForm').addEventListener('submit', function (ev) {
      ev.preventDefault(); var inp = $('#grIn'), text = inp.value.trim(); if (!text) return;
      var b = ev.target.querySelector('button'); b.disabled = true;
      sb.from('group_messages').insert({ group_id: g.id, body: text }).then(function (r) { ok(r); inp.value = ''; return load(true); }).catch(fail).then(function () { b.disabled = false; inp.focus(); });
    });
    if ($('#grShare')) $('#grShare').addEventListener('click', function () { clearInterval(timer); shareRoute(c, g); });
    P.names([]).catch(function () {}); load(true);
    timer = setInterval(function () { if (!$('#grList')) { clearInterval(timer); return; } if (document.visibilityState !== 'hidden') load(false); }, 5000);
  }

  /* ---------- compartir una ruta en un grupo de rutas ---------- */
  function shareRoute(c, g) {
    var plans = A.plans ? A.plans() : [], picked = null;
    Cl.sheet(head('Compartir una ruta') + '<form class="rg-form" id="srForm"><label>La ruta<select id="srPlan"><option value="">Elige una de tus rutas…</option>' + plans.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + ' · ' + String(p.dist).replace('.', ',') + ' km</option>'; }).join('') + '</select></label>' +
      '<div class="tr-gpx"><button class="btn small" id="srGpx" type="button"><svg><use href="#i-download"/></svg>O importa un GPX</button><input type="file" id="srFile" accept=".gpx,application/gpx+xml,application/xml,text/xml" hidden></div>' +
      '<label>Comentario (opcional)<textarea id="srText" class="note" maxlength="600" placeholder="Por qué te gusta, dónde parar, a qué estar atento…"></textarea></label><button class="btn big primary" type="submit">Compartir</button></form>');
    $('#grX').addEventListener('click', function () { openGroup(c, g); });
    $('#srPlan').addEventListener('change', function () { var p = plans.filter(function (x) { return String(x.id) === $('#srPlan').value; })[0]; picked = p ? { name: p.name, wps: p.wps, pois: p.pois || [], coords: p.coords, steps: p.steps || [], dist: p.dist, dur: p.dur } : null; });
    $('#srGpx').addEventListener('click', function () { $('#srFile').value = ''; $('#srFile').click(); });
    $('#srFile').addEventListener('change', function () {
      var file = this.files && this.files[0], b = $('#srGpx'); if (!file || !window.RGNav || !RGNav.gpxRoute) return;
      var old = b.innerHTML, rd = new FileReader(); b.disabled = true; b.textContent = 'Leyendo el GPX…';
      rd.onload = function () { RGNav.gpxRoute(String(rd.result || ''), file.name).then(function (r) { picked = r; $('#srPlan').value = ''; b.disabled = false; b.innerHTML = '<svg><use href="#i-check"/></svg>' + esc(r.name) + ' · ' + String(r.dist).replace('.', ',') + ' km'; }).catch(function (e) { b.disabled = false; b.innerHTML = old; A.toast(e.message || 'No se pudo importar.', 'bad'); }); };
      rd.readAsText(file);
    });
    $('#srForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (!picked || !picked.coords || picked.coords.length < 2) { A.toast('Elige una de tus rutas o importa un GPX.', 'warn'); return; }
      Cl.busy(ev.target.querySelector('button[type=submit]'), function () {
        return sb.from('group_messages').insert({ group_id: g.id, body: $('#srText').value.trim(), route: picked, route_name: String(picked.name || 'Ruta').slice(0, 80), route_km: Math.round((+picked.dist || 0) * 10) / 10 }).then(function (r) { ok(r); openGroup(c, g); });
      });
    });
  }

  /* ---------- Ajustes: personas que no veo ---------- */
  var about = document.getElementById('about');
  if (about) {
    var box = document.createElement('div'); box.className = 'rg-maker'; box.hidden = true;
    about.parentNode.insertBefore(box, about);
    var paint = function () {
      var ids = HID ? Object.keys(HID) : []; box.hidden = !ids.length; if (!ids.length) return;
      sb.from('profiles').select('id,name').in('id', ids).then(function (r) {
        var nm = {}; (r.data || []).forEach(function (p) { nm[p.id] = p.name; });
        box.innerHTML = '<span class="label">Personas que no ves</span>' + ids.map(function (id) { return '<div class="rg-row" style="justify-content:space-between"><span>' + esc(nm[id] || 'Motero') + '</span><button class="btn small" data-un="' + id + '" type="button">Volver a ver</button></div>'; }).join('');
        $$('[data-un]', box).forEach(function (b) { b.addEventListener('click', function () { sb.from('user_hides').delete().eq('user_id', me()).eq('hidden_id', b.dataset.un).then(function () { delete HID[b.dataset.un]; paint(); }, function () {}); }); });
      }, function () {});
    };
    setTimeout(function () { loadHides().then(paint); }, 5000); setInterval(paint, 30000);
  }
  window.RGGroups = { pane: pane, report: report, hidden: hidden };
})();
