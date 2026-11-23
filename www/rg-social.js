/* ReGroupRide — comunidad viva (supabase/32): álbum de fotos de cada salida, canal de voz y lista «antes de salir»
   (campos sueltos de la salida, events.extra), sitios moteros propuestos por las comunidades y retos de kilómetros
   o salidas. Los retos nunca miden velocidad ni inclinación. */
(function () {
  'use strict';
  var A = window.RGApp, Cl = window.RGCloud; if (!A || !Cl || !Cl.sb) return;
  var sb = Cl.sb, $ = function (s, r) { return (r || document).querySelector(s); }, $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function ic(n) { return '<svg><use href="#i-' + n + '"/></svg>'; }
  function head(t) { return '<div class="head"><h1>' + t + '</h1><button class="btn small icon" id="scX" type="button" title="Cerrar">' + ic('close') + '</button></div>'; }
  function jget(k) { try { return JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch (e) { return {}; } }
  function jset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function me() { var u = Cl.user(); return u ? u.id : null; }
  function big(src) { var lb = $('#lightbox'), li = $('#lightboxImg'); if (lb && li) { li.src = src; lb.hidden = false; } }
  function url(v) { v = (v || '').trim(); return /^https?:\/\/\S+$/i.test(v) ? v.slice(0, 400) : ''; }
  var BASE = ['Calzado cerrado (obligatorio en cualquier vía)', 'Guantes (obligatorios en carretera)', 'Casco abrochado y visera limpia', 'Permiso, seguro e ITV en vigor', 'Presión de los neumáticos', 'Depósito lleno', 'Móvil cargado y en el soporte'];

  /* ---------- campos sueltos de la salida: voz, galería y lista del organizador ---------- */
  window.RGEventExtra = {
    form: function (e) {
      var x = (e && e.extra) || {};
      return '<label>Canal de voz (enlace)<input id="exVoice" type="url" inputmode="url" maxlength="400" value="' + esc(x.voice || '') + '" placeholder="Discord, Telegram, WhatsApp… (opcional)"></label>' +
        '<label>Galería del fotógrafo (enlace)<input id="exGal" type="url" inputmode="url" maxlength="400" value="' + esc(x.gallery || '') + '" placeholder="Se puede añadir después de la salida"></label>' +
        '<label>Lista antes de salir (una cosa por línea)<textarea id="exCheck" rows="3" maxlength="600" placeholder="Chaleco de la comunidad&#10;Dinero para el almuerzo">' + esc((x.check || []).join('\n')) + '</textarea></label>';
    },
    read: function (e) {
      var x = Object.assign({}, (e && e.extra) || {}), v = $('#exVoice'), g = $('#exGal'), c = $('#exCheck'); if (!v) return x;
      x.voice = url(v.value) || undefined; x.gallery = url(g.value) || undefined;
      var list = c.value.split('\n').map(function (t) { return t.trim().slice(0, 80); }).filter(Boolean).slice(0, 12); x.check = list.length ? list : undefined;
      return JSON.parse(JSON.stringify(x));
    }
  };
  // en cada tarjeta de salida: voz, álbum y lista
  function cards(root) {
    $$('.ev-x[data-evx]', root).forEach(function (el) {
      if (el.dataset.done) return; el.dataset.done = '1'; var e = window.RGClub && RGClub.ev(el.dataset.evx); if (!e) return; var x = e.extra || {};
      el.innerHTML = (x.voice ? '<button class="btn small" data-x="voice" type="button">' + ic('phone') + 'Canal de voz</button>' : '') + '<button class="btn small" data-x="album" type="button">' + ic('image') + 'Álbum</button><button class="btn small" data-x="check" type="button">' + ic('check') + 'Antes de salir</button>';
      el.addEventListener('click', function (ev) { var b = ev.target.closest('[data-x]'); if (!b) return; if (b.dataset.x === 'voice') window.open(x.voice, '_blank'); else if (b.dataset.x === 'album') album(e); else checklist(e); });
    });
  }
  var cb = $('#clubBody'), deb = 0;
  if (cb && window.MutationObserver) new MutationObserver(function () { clearTimeout(deb); deb = setTimeout(function () { cards(cb); }, 200); }).observe(cb, { childList: true, subtree: true });

  /* ---------- lista antes de salir ---------- */
  function checklist(e) {
    var own = (e && e.extra && e.extra.check) || [], day = new Date().toDateString(), st = jget('rg.check'); if (st.day !== day) st = { day: day, on: {} };
    var row = function (t, k) { return '<label class="rg-check"><input type="checkbox" data-c="' + esc(k) + '"' + (st.on[k] ? ' checked' : '') + '><span><b>' + esc(t) + '</b></span></label>'; };
    var s = Cl.sheet(head('Antes de salir') + (own.length ? '<span class="label">Lo que pide el organizador' + (e ? ' · ' + esc(e.title) : '') + '</span>' + own.map(function (t, i) { return row(t, 'o' + (e ? e.id : '') + i); }).join('') : '') +
      '<span class="label">Lo de siempre</span>' + BASE.map(function (t, i) { return row(t, 'b' + i); }).join('') + '<p class="muted rg-small" style="text-align:left">Desde el 1 de octubre de 2026 el calzado cerrado es obligatorio en cualquier vía y los guantes, en carretera. La lista se vacía cada día.</p>');
    $('#scX', s).addEventListener('click', Cl.closeSheet);
    $$('[data-c]', s).forEach(function (c) { c.addEventListener('change', function () { st.on[c.dataset.c] = c.checked; jset('rg.check', st); }); });
  }
  var solo = $('#btnSolo') || $('#idleCard .idle-actions');
  if (solo) { var b = document.createElement('button'); b.type = 'button'; b.className = 'link rg-check-link'; b.id = 'btnCheck'; b.innerHTML = ic('check') + 'Lista antes de salir'; solo.parentNode.insertBefore(b, solo.id === 'btnSolo' ? solo.nextSibling : solo); b.addEventListener('click', function () { checklist(null); }); }

  /* ---------- álbum de la salida ---------- */
  function album(e) {
    var x = e.extra || {}, s = Cl.sheet(head('Álbum') + '<p style="margin:0;text-align:left"><b>' + esc(e.title) + '</b><br><span class="muted">Las fotos de todos los que fueron, en un solo sitio.</span></p>' +
      (x.gallery ? '<a class="btn" href="' + esc(x.gallery) + '" target="_blank" rel="noopener">' + ic('camera') + 'Galería del fotógrafo</a>' : '') +
      '<button class="btn primary" id="alAdd" type="button">' + ic('plus') + 'Añadir fotos</button><div class="al-grid" id="alGrid"><div class="empty">Cargando…</div></div>');
    $('#scX', s).addEventListener('click', Cl.closeSheet);
    var load = function () {
      sb.from('event_photos').select('id,user_id,url,created_at').eq('event_id', e.id).order('created_at', { ascending: false }).limit(200).then(function (r) {
        var el = $('#alGrid'); if (!el) return; var rows = r.error ? [] : (r.data || []);
        el.innerHTML = rows.length ? rows.map(function (p) { return '<div class="al-ph"><img loading="lazy" alt="" src="' + esc(p.url) + '">' + (p.user_id === me() ? '<button class="al-del" data-del="' + p.id + '" type="button" title="Quitar">' + ic('trash') + '</button>' : '') + '</div>'; }).join('') : '<div class="empty">Todavía no hay fotos. Sube las tuyas después de la salida.</div>';
        $$('img', el).forEach(function (im) { im.addEventListener('click', function () { big(im.src); }); });
        $$('[data-del]', el).forEach(function (b) { b.addEventListener('click', function (ev) { ev.stopPropagation(); sb.from('event_photos').delete().eq('id', b.dataset.del).then(load); }); });
      });
    };
    $('#alAdd', s).addEventListener('click', function (ev) {
      var btn = ev.currentTarget; if (!window.RGShell) return;
      RGShell.pickPhoto(1600, true).then(function (bs) {
        if (!bs || !bs.length) return;
        Cl.busy(btn, function () { return bs.reduce(function (p, b) { return p.then(function () { return RGShell.upload(b, 'album'); }).then(function (u) { return sb.from('event_photos').insert({ event_id: e.id, url: u }); }).then(function (r) { if (r.error) throw r.error; }); }, Promise.resolve()).then(load); }).catch(function (x) { A.toast(Cl.msg(x), 'warn'); load(); });
      });
    });
    load();
  }

  /* ---------- sitios moteros ---------- */
  var PK = { bar: ['Bar o restaurante', '🍴'], mirador: ['Mirador', '🏞️'], taller: ['Taller', '🔧'], alojamiento: ['Alojamiento', '🛏️'], otro: ['Otro', '📍'] }, PL = { kind: '', rows: [], marks: [] };
  function places() {
    if (!Cl.user()) { Cl.openAuth(false); return; }
    var f = A.anyFix && A.anyFix();
    var s = Cl.sheet(head('Sitios moteros') + '<p class="muted" style="margin:0;text-align:left">Bares, miradores, talleres y alojamientos que recomiendan las comunidades, con sitio para dejar la moto.</p>' +
      '<div class="pills" id="plK"><button class="pill" type="button" data-k="" aria-pressed="' + (!PL.kind) + '">Todos</button>' + Object.keys(PK).map(function (k) { return '<button class="pill" type="button" data-k="' + k + '" aria-pressed="' + (PL.kind === k) + '">' + PK[k][1] + ' ' + PK[k][0].split(' ')[0] + '</button>'; }).join('') + '</div>' +
      '<div class="rd-list" id="plL"><div class="empty">' + (f ? 'Buscando…' : 'Hace falta tu ubicación para saber qué tienes cerca.') + '</div></div><button class="btn primary" id="plAdd" type="button">' + ic('plus') + 'Proponer un sitio</button>');
    $('#scX', s).addEventListener('click', Cl.closeSheet); $('#plAdd', s).addEventListener('click', function () { placeForm(null); });
    $$('#plK button', s).forEach(function (b) { b.addEventListener('click', function () { PL.kind = b.dataset.k; places(); }); });
    if (!f) return;
    sb.rpc('places_near', { p_lat: f.lat, p_lon: f.lon, p_km: 150 }).then(function (r) {
      var el = $('#plL'); if (!el) return; PL.rows = r.error ? [] : (r.data || []); marks();
      var rows = PL.rows.filter(function (x) { return !PL.kind || x.kind === PL.kind; });
      el.innerHTML = rows.length ? rows.map(function (x, i) { var k = PK[x.kind] || PK.otro; return '<div class="club-card pl-card"><b>' + k[1] + ' ' + esc(x.name) + '</b><span class="muted">' + k[0] + ' · a ' + String(x.km).replace('.', ',') + ' km · recomendado por ' + esc(x.community) + '</span>' + (x.note ? '<span>' + esc(x.note) + '</span>' : '') +
        '<span class="rt-meta">' + (x.parking ? '<span>' + ic('park') + 'aparcamiento para motos</span>' : '') + (x.discount ? '<span>' + ic('star') + esc(x.discount) + '</span>' : '') + '</span><div class="rg-row"><button class="btn small primary" data-go="' + i + '" type="button">' + ic('gmaps') + 'Cómo llegar</button>' + (x.mine ? '<button class="btn small" data-ed="' + i + '" type="button">' + ic('edit') + 'Editar</button>' : '') + '</div></div>'; }).join('') : '<div class="empty">Aún no hay sitios recomendados a menos de 150 km. Propón el primero.</div>';
      $$('[data-go]', el).forEach(function (b) { b.addEventListener('click', function () { var x = rows[+b.dataset.go]; window.open('https://www.google.com/maps/dir/?api=1&destination=' + x.lat + ',' + x.lon, '_blank'); }); });
      $$('[data-ed]', el).forEach(function (b) { b.addEventListener('click', function () { placeForm(rows[+b.dataset.ed]); }); });
    }, function () { var el = $('#plL'); if (el) el.innerHTML = '<div class="empty">No se ha podido cargar.</div>'; });
  }
  function marks() {
    var map = A.map && A.map(); if (!map || !window.maplibregl) return; PL.marks.forEach(function (m) { m.remove(); }); PL.marks = [];
    PL.rows.slice(0, 60).forEach(function (x) { var el = document.createElement('div'); el.className = 'rd-mk pl'; el.textContent = (PK[x.kind] || PK.otro)[1]; el.title = x.name; el.addEventListener('click', function (ev) { ev.stopPropagation(); PL.kind = ''; places(); }); PL.marks.push(new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([x.lon, x.lat]).addTo(map)); });
  }
  function placeForm(x) {
    var cl = (window.RGShell ? RGShell.clubs() : []); if (!cl.length) { A.toast('Para proponer un sitio hay que estar en una comunidad.', 'warn'); return; }
    var f = A.lastFix && A.lastFix(), map = A.map && A.map(), ctr = map ? map.getCenter() : null;
    var s = Cl.sheet(head(x ? 'Editar sitio' : 'Proponer un sitio') + '<form class="rg-form" id="plF"><label>Nombre<input id="plN" required minlength="2" maxlength="80" value="' + esc(x ? x.name : '') + '"></label>' +
      '<div class="tr-two"><label>Tipo<select id="plT">' + Object.keys(PK).map(function (k) { return '<option value="' + k + '"' + (x && x.kind === k ? ' selected' : '') + '>' + PK[k][0] + '</option>'; }).join('') + '</select></label><label>Comunidad<select id="plC">' + cl.map(function (c) { return '<option value="' + c.id + '"' + (x && x.community_id === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></label></div>' +
      '<label>Por qué lo recomiendas<input id="plNo" maxlength="300" value="' + esc(x ? x.note || '' : '') + '" placeholder="Buen almuerzo, vistas, trato…"></label><label>Descuento o ventaja para moteros<input id="plD" maxlength="120" value="' + esc(x ? x.discount || '' : '') + '" placeholder="Opcional"></label>' +
      '<label class="rg-check"><input type="checkbox" id="plP"' + (x && x.parking ? ' checked' : '') + '><span><b>Se puede dejar la moto a la vista</b></span></label>' +
      (x ? '' : '<label>Dónde está<select id="plW">' + (f ? '<option value="me">Donde estoy ahora</option>' : '') + (ctr ? '<option value="map">En el centro del mapa</option>' : '') + '</select></label><p class="muted rg-small" style="text-align:left">Para marcar otro punto, mueve antes el mapa hasta dejarlo en el centro.</p>') +
      '<button class="btn big primary" type="submit">Guardar</button>' + (x ? '<button class="link danger rg-center" id="plDel" type="button">Quitar este sitio</button>' : '') + '</form>');
    $('#scX', s).addEventListener('click', places);
    if ($('#plDel', s)) $('#plDel', s).addEventListener('click', function () { sb.from('biker_places').delete().eq('id', x.id).then(places); });
    $('#plF', s).addEventListener('submit', function (ev) {
      ev.preventDefault(); var row = { name: $('#plN').value.trim(), kind: $('#plT').value, community_id: $('#plC').value, note: $('#plNo').value.trim() || null, discount: $('#plD').value.trim() || null, parking: $('#plP').checked };
      if (!x) { var w = $('#plW') && $('#plW').value, p = w === 'me' ? f : (ctr ? { lat: ctr.lat, lon: ctr.lng } : null); if (!p) { A.toast('No sé dónde está: espera a que el GPS te sitúe.', 'warn'); return; } row.lat = p.lat; row.lon = p.lon; }
      Cl.busy(ev.submitter || $('#plF button[type=submit]'), function () { return (x ? sb.from('biker_places').update(row).eq('id', x.id) : sb.from('biker_places').insert(row)).then(function (r) { if (r.error) throw r.error; places(); }); }).catch(function (e) { A.toast(Cl.msg(e), 'warn'); });
    });
  }
  var rowEx = $('#exRow');
  if (rowEx) { var pb = document.createElement('button'); pb.className = 'btn'; pb.type = 'button'; pb.id = 'exPlaces'; pb.innerHTML = ic('star') + 'Sitios moteros'; rowEx.appendChild(pb); pb.addEventListener('click', places); }

  /* ---------- retos de comunidad ---------- */
  function ymd(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function myValue(ch) { var a = new Date(ch.starts_on + 'T00:00:00').getTime(), b = new Date(ch.ends_on + 'T23:59:59').getTime(), rs = (A.rides() || []).filter(function (r) { return !r.trip && r.start >= a && r.start <= b; }); return ch.kind === 'km' ? Math.round(rs.reduce(function (s, r) { return s + (r.dist || 0); }, 0) * 10) / 10 : rs.length; }
  function challenges(c, admin) {
    var s = Cl.sheet(head('Retos') + '<p class="muted" style="margin:0;text-align:left">Kilómetros o salidas entre los miembros de ' + esc(c.name) + '. Cuenta lo que grabas con la app; nunca la velocidad ni la inclinación.</p><div id="chL" class="rd-list"><div class="empty">Cargando…</div></div>' + (admin ? '<button class="btn primary" id="chNew" type="button">' + ic('plus') + 'Nuevo reto</button>' : ''));
    $('#scX', s).addEventListener('click', Cl.closeSheet);
    if ($('#chNew', s)) $('#chNew', s).addEventListener('click', function () { chForm(c); });
    var today = ymd(new Date());
    sb.from('challenges').select('id,title,kind,goal,starts_on,ends_on').eq('community_id', c.id).gte('ends_on', ymd(new Date(Date.now() - 20 * 864e5))).order('ends_on').then(function (r) {
      var list = r.error ? [] : (r.data || []), el = $('#chL'); if (!el) return;
      if (!list.length) { el.innerHTML = '<div class="empty">No hay retos en marcha.' + (admin ? ' Crea el primero.' : '') + '</div>'; return; }
      var live = list.filter(function (ch) { return ch.starts_on <= today && ch.ends_on >= today; });
      Promise.all(live.map(function (ch) { return sb.from('challenge_progress').upsert({ challenge_id: ch.id, value: myValue(ch), updated_at: new Date().toISOString() }, { onConflict: 'challenge_id,user_id' }); })).catch(function () {}).then(function () {
        return sb.from('challenge_progress').select('challenge_id,user_id,value').in('challenge_id', list.map(function (x) { return x.id; }));
      }).then(function (pr) {
        var prog = (pr && pr.data) || [], ids = prog.map(function (p) { return p.user_id; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
        return (ids.length ? sb.from('profiles').select('id,name').in('id', ids) : Promise.resolve({ data: [] })).then(function (pf) {
          var nm = {}; ((pf && pf.data) || []).forEach(function (p) { nm[p.id] = p.name; }); var el2 = $('#chL'); if (!el2) return;
          el2.innerHTML = list.map(function (ch) {
            var rows = prog.filter(function (p) { return p.challenge_id === ch.id && +p.value > 0; }).sort(function (a, b) { return b.value - a.value; }), unit = ch.kind === 'km' ? ' km' : (' ' + 'salidas'), mine = rows.filter(function (p) { return p.user_id === me(); })[0], total = rows.reduce(function (s2, p) { return s2 + (+p.value); }, 0);
            return '<div class="club-card ch-card"><b>' + esc(ch.title) + '</b><span class="muted">' + new Date(ch.starts_on + 'T12:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) + ' – ' + new Date(ch.ends_on + 'T12:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) + (ch.ends_on < today ? ' · terminado' : '') + (ch.goal ? ' · objetivo de cada uno: ' + ch.goal + unit : '') + '</span>' +
              (ch.goal && mine ? '<span class="bar3"><i style="width:' + Math.min(100, Math.round(mine.value / ch.goal * 100)) + '%"></i></span>' : '') +
              '<span class="ch-tot">Entre todos: <b>' + Math.round(total) + unit + '</b></span><ol class="ch-rank">' + rows.slice(0, 10).map(function (p) { return '<li' + (p.user_id === me() ? ' class="me"' : '') + '><span>' + esc(nm[p.user_id] || 'Motero') + '</span><b>' + String(Math.round(p.value * 10) / 10).replace('.', ',') + unit + '</b></li>'; }).join('') + '</ol>' + (rows.length ? '' : '<span class="muted rg-small" style="text-align:left">Nadie ha sumado todavía.</span>') +
              (admin ? '<button class="link danger" data-chdel="' + ch.id + '" type="button">Borrar reto</button>' : '') + '</div>';
          }).join('');
          $$('[data-chdel]', el2).forEach(function (b) { b.addEventListener('click', function () { sb.from('challenges').delete().eq('id', b.dataset.chdel).then(function () { challenges(c, admin); }); }); });
        });
      });
    });
  }
  function chForm(c) {
    var d = new Date(), a = new Date(d.getFullYear(), d.getMonth(), 1), b = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    var s = Cl.sheet(head('Nuevo reto') + '<form class="rg-form" id="chF"><label>Nombre<input id="chT" required minlength="2" maxlength="80" placeholder="Kilómetros de ' + d.toLocaleDateString('es-ES', { month: 'long' }) + '"></label>' +
      '<div class="tr-two"><label>Qué cuenta<select id="chK"><option value="km">Kilómetros</option><option value="salidas">Salidas</option></select></label><label>Objetivo (opcional)<input id="chG" type="number" min="1" max="100000" inputmode="numeric" placeholder="500"></label></div>' +
      '<div class="tr-two"><label>Empieza<input id="chA" type="date" required value="' + ymd(a) + '"></label><label>Termina<input id="chB" type="date" required value="' + ymd(b) + '"></label></div><button class="btn big primary" type="submit">Crear reto</button></form>');
    $('#scX', s).addEventListener('click', function () { challenges(c, true); });
    $('#chF', s).addEventListener('submit', function (ev) { ev.preventDefault(); Cl.busy(ev.submitter || $('#chF button'), function () { return sb.from('challenges').insert({ community_id: c.id, title: $('#chT').value.trim(), kind: $('#chK').value, goal: parseInt($('#chG').value, 10) || null, starts_on: $('#chA').value, ends_on: $('#chB').value }).then(function (r) { if (r.error) throw r.error; challenges(c, true); }); }).catch(function (e) { A.toast(Cl.msg(e), 'warn'); }); });
  }
  window.RGSocial = { challenges: challenges, places: places, album: album, checklist: checklist };
})();
