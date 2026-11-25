/* ReGroupRide · viajes de varios días: plan por etapas, paradas, alojamiento, presupuesto, pagos y gastos compartidos.
   Un viaje es un evento con la columna «trip» (supabase/23_viajes.sql): hereda inscripción, plazas, chat, avisos y ruta en grupo.
   Los viajes entre amigos viven en un grupo oculto (communities.kind = 'trip') al que se entra con un código. */
(function () {
  'use strict';
  var A = window.RGApp, Cl = window.RGCloud; if (!A || !Cl || !Cl.sb) return;
  var sb = Cl.sb, $ = function (s, r) { return (r || document).querySelector(s); }, $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ok(r) { if (r.error) throw r.error; return r.data; }
  function fail(e) { A.toast(Cl.msg ? Cl.msg(e) : (e && e.message) || 'No se ha podido.', 'bad'); }
  function me() { var u = Cl.user && Cl.user(); return u ? u.id : null; }
  function eur(n) { return (Math.round((+n || 0) * 100) / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; }
  function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : 0; }
  function url(u) { u = String(u || '').trim(); return /^https?:\/\//i.test(u) ? u : ''; }
  var DOW = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'], MON = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function dstr(d) { return DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()]; }
  function dayDate(ev, i) { var d = new Date(ev.starts_at); d.setDate(d.getDate() + i); return d; }
  function ymd(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function head(t) { return '<div class="head"><h1>' + t + '</h1><button class="btn small icon" id="trX" type="button" aria-label="Cerrar"><svg><use href="#i-close"/></svg></button></div>'; }
  function ava(p) { var u = p && p.avatar_url; return '<span class="rg-ava">' + (/^https:\/\//.test(u || '') ? '<img src="' + esc(u) + '" alt="" loading="lazy">' : esc(((p && p.name) || 'M').charAt(0).toUpperCase())) + '</span>'; }
  var STAY = { hotel: 'Hotel', casa: 'Casa o apartamento', camping: 'Camping', otro: 'Otro' };

  var T = null;      // el viaje abierto: { ev, trip, att, names, admin, tab, exp, paid, guests }
  function nm(id) { var p = T.names[id]; return (p && p.name) || 'Motero'; }
  function going() { return T.att.filter(function (a) { return a.status === 'going' || a.status === 'offered'; }); }

  /* ---------- abrir un viaje ---------- */
  function load(id, tab) {
    return Promise.all([
      sb.from('events').select('id,community_id,title,description,starts_at,ends_at,meet_name,meet_url,capacity,trip,communities(name,kind,join_code)').eq('id', id).maybeSingle(),
      sb.from('event_attendees').select('user_id,status,companion,bike,joined_at').eq('event_id', id),
      sb.rpc('can_run_event', { eid: id })
    ]).then(function (r) {
      var ev = ok(r[0]); if (!ev) throw new Error('Esa salida ya no existe o no tienes acceso.');
      var att = ok(r[1]) || [];
      T = { ev: ev, trip: ev.trip || { days: [], budget: [] }, att: att, names: {}, admin: r[2].data === true, tab: tab || 'plan', exp: null, paid: null, guests: [] };
      T.trip.days = T.trip.days || []; T.trip.budget = T.trip.budget || [];
      var ids = att.map(function (a) { return a.user_id; });
      return ids.length ? sb.from('profiles').select('id,name,avatar_url,bike_brand,bike_model').in('id', ids).then(function (p) { (p.data || []).forEach(function (x) { T.names[x.id] = x; }); }) : null;
    });
  }
  function open(id, tab) {
    if (!me()) { Cl.openAuth(false); return; }
    Cl.sheet(head('Salida') + '<p class="muted">Cargando…</p>', 'full'); $('#trX').addEventListener('click', Cl.closeSheet);
    load(id, tab).then(draw).catch(function (e) { Cl.sheet(head('Salida') + '<p class="muted">' + esc(Cl.msg ? Cl.msg(e) : e.message) + '</p>', 'full'); $('#trX').addEventListener('click', Cl.closeSheet); });
  }
  // Dentro de la página de la salida (pestañas Plan y Gastos): las etapas o los gastos se pintan allí mismo, sin abrir otra página.
  function embed(id, what, host, evTab) {
    if (!host) return; host.innerHTML = '<p class="muted">Cargando…</p>';
    load(id, what === 'money' ? 'money' : 'plan').then(function () {
      if (!host.isConnected) return;
      T.embed = evTab || 'plan'; var old = document.getElementById('trPane'); if (old && old !== host) old.removeAttribute('id');
      host.innerHTML = ''; var box = document.createElement('div'); box.id = 'trPane'; host.appendChild(box);
      if (what === 'money') paneMoney();
      else {
        box.innerHTML = planHtml(T.ev, T.trip) || '<div class="empty"><b>Sin etapas todavía</b>' + (T.admin ? 'Añade qué se hace cada día.' : 'El organizador aún no ha puesto el plan de cada día.') + '</div>';
        wirePlan();
        if (T.admin) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.innerHTML = '<svg><use href="#i-edit"/></svg>Editar etapas, alojamiento y gastos previstos'; box.appendChild(b); b.addEventListener('click', edit); }
      }
    }).catch(function (e) { host.innerHTML = '<div class="empty">' + esc(Cl.msg ? Cl.msg(e) : e.message) + '</div>'; });
  }
  function reload(tab) { if (!T) return; if (T.embed && window.RGClub && RGClub.openEvent) { RGClub.openEvent(T.ev.id, (tab || T.tab) === 'money' ? 'gastos' : T.embed); return; } open(T.ev.id, tab || T.tab); }

  function draw() {
    var ev = T.ev, t = T.trip, s = new Date(ev.starts_at), e = ev.ends_at ? new Date(ev.ends_at) : dayDate(ev, Math.max(0, t.days.length - 1)), mine = (T.att.filter(function (a) { return a.user_id === me(); })[0] || {}).status;
    var km = t.days.reduce(function (n, d) { return n + num(d.km); }, 0), nights = t.days.filter(function (d) { return d.stay && d.stay.name; }).length, priv = ev.communities && ev.communities.kind === 'trip';
    var top = head(esc(ev.title)) +
      '<p class="muted tr-sub">' + dstr(s) + (ymd(e) !== ymd(s) ? ' → ' + dstr(e) + ' ' + e.getFullYear() : ' ' + s.getFullYear()) + (priv ? ' · Entre amigos' : ' · ' + esc(ev.communities ? ev.communities.name : '')) + '</p>' +
      '<div class="tr-kpis"><div><b>' + Math.max(t.days.length, 1) + '</b><span>' + (t.days.length === 1 ? 'día' : 'días') + '</span></div><div><b>' + Math.round(km) + '</b><span>km</span></div><div><b>' + nights + '</b><span>' + (nights === 1 ? 'noche' : 'noches') + '</span></div><div><b>' + going().length + (ev.capacity ? '<small>/' + ev.capacity + '</small>' : '') + '</b><span>van</span></div></div>' +
      '<div class="tr-me">' + (mine === 'going' || mine === 'offered' ? '<span class="mstatus ok"><svg><use href="#i-check"/></svg>Vas</span><button class="link danger" data-go="no" type="button">No puedo ir</button>' : mine === 'waiting' ? '<span class="mstatus soon">En lista de espera</span><button class="link danger" data-go="no" type="button">Quitarme</button>' : '<button class="btn primary" data-go="going" type="button">Apuntarme al viaje</button>') +
        (window.RGClub && RGClub.chat && (mine === 'going' || mine === 'waiting' || mine === 'offered' || T.admin) ? '<button class="btn small" id="trChat" type="button"><svg><use href="#i-people"/></svg>Chat</button>' : '') +
        (T.admin ? '<button class="btn small" id="trEdit" type="button"><svg><use href="#i-edit"/></svg>Editar</button>' : '') + '</div>' +
      (priv && T.admin ? '<div class="tr-code"><span>Código para invitar</span><b>' + esc(ev.communities.join_code) + '</b><button class="btn small" id="trShare" type="button"><svg><use href="#i-share"/></svg>Compartir</button></div>' : '') +
      '<div class="seg rg-wide" id="trTabs">' + [['plan', 'Plan'], ['money', 'Gastos'], ['people', 'Gente']].map(function (x) { return '<button type="button" data-t="' + x[0] + '" aria-pressed="' + (T.tab === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div><div id="trPane"></div>';
    Cl.sheet(top, 'full');
    $('#trX').addEventListener('click', Cl.closeSheet);
    $$('#trTabs button').forEach(function (b) { b.addEventListener('click', function () { T.tab = b.dataset.t; $$('#trTabs button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); pane(); }); });
    $$('[data-go]').forEach(function (b) { b.addEventListener('click', function () {
      Cl.busy(b, function () { return sb.from('event_attendees').upsert({ event_id: ev.id, user_id: me(), status: b.dataset.go }).then(function (r) { ok(r); A.toast(b.dataset.go === 'going' ? '¡Apuntado al viaje!' : 'Te has quitado del viaje.', 'ok'); if (window.RGClub && RGClub.inbox) RGClub.inbox(true); reload(); }); });
    }); });
    if ($('#trChat')) $('#trChat').addEventListener('click', function () { RGClub.chat(ev); });
    if ($('#trEdit')) $('#trEdit').addEventListener('click', edit);
    if (T.admin) { var sh = document.querySelector('#rgSheet .rg-sheet-in') || document.getElementById('rgSheet'), del = document.createElement('button'); del.type = 'button'; del.className = 'link danger rg-center tr-del'; del.textContent = 'Borrar esta salida'; sh.appendChild(del);
      del.addEventListener('click', function () {
        if (!del.dataset.sure) { del.dataset.sure = 1; del.textContent = 'Se borra para todos, con sus etapas, gastos y chat. Toca otra vez para borrarlo'; setTimeout(function () { if (del.isConnected) { delete del.dataset.sure; del.textContent = 'Borrar esta salida'; } }, 6000); return; }
        var id = T.ev.id; del.disabled = true;
        sb.rpc('trip_delete', { p_event: id }).then(function (r) { if (r.error) throw r.error; A.toast('Aviso: viaje borrado.', 'ok'); if (window.RGClub && RGClub.inbox) RGClub.inbox(true); list(); }).catch(function (e) { del.disabled = false; A.toast(Cl.msg(e), 'warn'); });
      }); }
    if ($('#trShare')) $('#trShare').addEventListener('click', function () {
      var text = 'Vente a «' + ev.title + '» (' + dstr(s) + '). En ReGroupRide entra en Comunidad → Mis viajes → «Tengo un código» y escribe ' + ev.communities.join_code + '.';
      if (navigator.share) navigator.share({ text: text }).catch(function () {}); else if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { A.toast('Texto copiado.', 'ok'); });
    });
    pane();
  }
  function pane() { ({ plan: panePlan, money: paneMoney, people: panePeople })[T.tab](); }

  /* ---------- plan por días ---------- */
  function planHtml(ev, t) {
    if (!t.days.length) return '<div class="empty">Todavía no hay etapas.' + (T && T.admin ? ' Pulsa «Editar» para añadir los días, las paradas y dónde se duerme.' : ' El organizador las añadirá pronto.') + '</div>';
    return t.days.map(function (d, i) {
      var st = d.stay || {}, r = url(d.route_url);
      return '<div class="tr-day"><div class="tr-day-h"><span class="tr-n">Día ' + (i + 1) + '</span><span class="muted">' + dstr(dayDate(ev, i)) + '</span></div>' +
        '<b class="tr-t">' + esc(d.title || 'Etapa ' + (i + 1)) + '</b>' +
        '<div class="tr-meta">' + (d.start ? '<span><svg><use href="#i-clock"/></svg>Salida ' + esc(d.start) + '</span>' : '') + (num(d.km) ? '<span><svg><use href="#i-route"/></svg>' + Math.round(num(d.km)) + ' km</span>' : '') + (d.from ? '<span><svg><use href="#i-locate"/></svg>' + esc(d.from) + '</span>' : '') + '</div>' +
        (d.route_name ? '<div class="tr-route"><span><svg><use href="#i-route"/></svg>' + esc(d.route_name) + (num(d.route_km) ? ' · ' + String(d.route_km).replace('.', ',') + ' km' : '') + '</span><button class="btn small" data-load="' + esc(d.id) + '" type="button">Cargar ruta</button></div>' +
          (T && T.admin ? '<button class="btn big primary tr-start" data-start="' + esc(d.id) + '" data-n="' + (i + 1) + '" type="button"><svg><use href="#i-play"/></svg>Iniciar la ruta del día ' + (i + 1) + '</button><span class="muted rg-small">A los apuntados les saltará el aviso para unirse, como en cualquier ruta.</span>' : '') : '') +
        (r ? '<a class="btn small" href="' + esc(r) + '" target="_blank" rel="noopener"><svg><use href="#i-gmaps"/></svg>Ver en Maps</a>' : '') +
        ((d.stops || []).length ? '<ul class="tr-stops">' + d.stops.map(function (p) { var pu = url(p.url); return '<li>' + (p.time ? '<time>' + esc(p.time) + '</time>' : '<time></time>') + '<span><b>' + esc(p.name) + '</b>' + (p.note ? '<small>' + esc(p.note) + '</small>' : '') + '</span>' + (pu ? '<a href="' + esc(pu) + '" target="_blank" rel="noopener">Mapa</a>' : '') + '</li>'; }).join('') + '</ul>' : '') +
        (st.name ? '<div class="tr-stay"><span class="label">Dónde dormimos · ' + (STAY[st.kind] || 'Alojamiento') + '</span><b>' + esc(st.name) + '</b>' + (st.address ? '<span class="muted">' + esc(st.address) + '</span>' : '') +
          '<div class="tr-meta">' + (num(st.price) ? '<span>' + eur(st.price) + ' por persona</span>' : '') + (st.checkin ? '<span>Entrada ' + esc(st.checkin) + '</span>' : '') + (st.parking ? '<span>Parking para motos</span>' : '') + '</div>' + (st.note ? '<p>' + esc(st.note) + '</p>' : '') +
          (url(st.url) ? '<a class="btn small" href="' + esc(url(st.url)) + '" target="_blank" rel="noopener">Ver alojamiento</a>' : '') + '</div>' : '') + '</div>';
    }).join('');
  }
  function panePlan() {
    var ev = T.ev, t = T.trip, list = String(t.checklist || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
    var live = T.att.some(function (x) { return x.user_id === me() && (x.status === 'going' || x.status === 'offered'); }) || T.admin;
    $('#trPane').innerHTML = (live && window.RGGroup ? '<button class="btn" id="trEnter" type="button" hidden><svg><use href="#i-play"/></svg>Hay una ruta en marcha: unirme</button>' : '') + (ev.meet_name ? '<div class="tr-day"><span class="label">Punto de salida</span><b class="tr-t">' + esc(ev.meet_name) + '</b><div class="tr-meta"><span><svg><use href="#i-clock"/></svg>' + new Date(ev.starts_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) + '</span></div>' + (url(ev.meet_url) ? '<a class="btn small" href="' + esc(url(ev.meet_url)) + '" target="_blank" rel="noopener">Abrir en Maps</a>' : '') + '</div>' : '') +
      (ev.description ? '<p class="tr-desc">' + esc(ev.description) + '</p>' : '') + planHtml(ev, t) +
      (list.length ? '<div class="tr-day"><span class="label">Qué llevar</span><ul class="tr-check">' + list.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' : '');
    wirePlan();
  }

  function dayRoute(dayId) { return sb.from('trip_routes').select('route').eq('event_id', T.ev.id).eq('day_id', dayId).maybeSingle().then(function (r) { var x = ok(r); if (!x || !x.route || !x.route.coords || x.route.coords.length < 2) throw new Error('Ese día no tiene ruta cargada.'); return x.route; }); }
  function wirePlan() {
    var host = $('#trPane'), ev = T.ev;
    $$('[data-load]', host).forEach(function (b) { b.addEventListener('click', function () {
      Cl.busy(b, function () { return dayRoute(b.dataset.load).then(function (r) {
        var p = { id: parseInt(ev.id.replace(/-/g, '').slice(0, 10), 16) + (parseInt(b.dataset.load, 36) % 9973), name: r.name || ev.title, wps: r.wps || [], pois: r.pois || [], coords: r.coords, dist: r.dist || 0, dur: r.dur || 0, routed: true, steps: r.steps || [], created: Date.now(), eventId: ev.id };
        Cl.closeSheet(); return A.usePlan(p).then(function () { A.toast('Ruta del día cargada. Pulsa «Iniciar ruta» cuando salgáis.', 'ok'); });
      }); });
    }); });
    $$('[data-start]', host).forEach(function (b) { b.addEventListener('click', function () {
      if (!window.RGGroup) return;
      if (!b.dataset.sure) { b.dataset.sure = 1; var t = b.innerHTML; b.textContent = '¿Empezamos el día ' + b.dataset.n + '? Toca otra vez'; setTimeout(function () { if (b.dataset.sure) { delete b.dataset.sure; b.innerHTML = t; } }, 4000); return; }
      delete b.dataset.sure;
      Cl.busy(b, function () { return sb.rpc('event_start_day', { p_event: ev.id, p_day: b.dataset.start }).then(function (r) {
        var d = ok(r); if (window.RGClub && RGClub.ring) RGClub.ring(ev.community_id, { kind: 'call', id: d && d.id, eid: ev.id });
        Cl.closeSheet(); return RGGroup.enter(d, { start: true }).then(function () { A.toast('Ruta iniciada. A los apuntados les sale el aviso para unirse.', 'ok'); });
      }); });
    }); });
    var en = $('#trEnter'); if (en) {
      sb.rpc('ride_calls').then(function (r) { var c = (r.data || []).filter(function (x) { return x.event_id === ev.id; })[0]; if (!c || !$('#trEnter')) return; en.hidden = false; en.textContent = '«' + c.name + '» está en marcha: unirme';
        en.addEventListener('click', function () { Cl.busy(en, function () { return sb.rpc('ride_join_event', { p_id: c.id }).then(function (q) { var d = ok(q); Cl.closeSheet(); return RGGroup.enter(d, { start: true }); }); }); }); }, function () {});
    }
  }

  /* ---------- gente ---------- */
  function panePeople() {
    var g = going(), w = T.att.filter(function (a) { return a.status === 'waiting'; });
    var row = function (a) { var p = T.names[a.user_id] || {}; return '<div class="club-person">' + ava(p) + '<div><b>' + esc(nm(a.user_id)) + (a.user_id === me() ? ' (tú)' : '') + (a.companion ? ' +1' : '') + '</b><span class="muted">' + esc(a.bike || [p.bike_brand, p.bike_model].filter(Boolean).join(' ') || 'Moto sin indicar') + '</span></div></div>'; };
    $('#trPane').innerHTML = '<span class="label">Van ' + g.length + '</span><div class="club-card club-people">' + (g.map(row).join('') || '<p class="muted">Todavía nadie.</p>') + '</div>' +
      (w.length ? '<span class="label">En espera ' + w.length + '</span><div class="club-card club-people">' + w.map(row).join('') + '</div>' : '');
  }

  /* ---------- gastos: presupuesto, pagos al organizador y gastos compartidos ---------- */
  function paneMoney() {
    var host = $('#trPane'); host.innerHTML = '<p class="muted">Cargando…</p>';
    var jobs = [sb.from('trip_expenses').select('id,payer_id,label,amount,split,created_at').eq('event_id', T.ev.id).order('id'), sb.from('trip_paid').select('who,amount,note').eq('event_id', T.ev.id)];
    if (T.admin) jobs.push(sb.rpc('event_manage', { p_event: T.ev.id }));
    Promise.all(jobs).then(function (r) {
      if (r[0].error && /permission|policy|row-level/i.test(r[0].error.message || '')) { host.innerHTML = '<div class="empty">Los gastos los ven quienes van al viaje. Apúntate para verlos.</div>'; return; }
      T.exp = r[0].data || []; T.paid = {}; (r[1].data || []).forEach(function (x) { T.paid[x.who] = x; });
      T.guests = r[2] && r[2].data && r[2].data.guests ? r[2].data.guests.filter(function (x) { return x.status === 'going'; }) : [];
      drawMoney();
    }).catch(function (e) { host.innerHTML = '<div class="empty">' + esc(Cl.msg ? Cl.msg(e) : e.message) + '</div>'; });
  }
  function drawMoney() {
    var t = T.trip, g = going(), n = Math.max(1, g.length + T.guests.length), host = $('#trPane'); if (!host) return;
    var nights = t.days.reduce(function (s, d) { return s + (d.stay ? num(d.stay.price) : 0); }, 0);
    var perP = nights + t.budget.reduce(function (s, b) { return s + (b.per === 'g' ? num(b.amount) / n : num(b.amount)); }, 0);
    var budget = '<div class="tr-day"><span class="label">Presupuesto previsto</span>' + (nights || t.budget.length ? '<div class="tr-rows">' + (nights ? '<div><span>Alojamiento (' + t.days.filter(function (d) { return d.stay && num(d.stay.price); }).length + ' noches)</span><b>' + eur(nights) + '</b></div>' : '') +
      t.budget.map(function (b) { return '<div><span>' + esc(b.label) + (b.per === 'g' ? ' <small>(' + eur(b.amount) + ' entre ' + n + ')</small>' : '') + '</span><b>' + eur(b.per === 'g' ? num(b.amount) / n : b.amount) + '</b></div>'; }).join('') +
      '<div class="tot"><span>Total aproximado por persona</span><b>' + eur(perP) + '</b></div></div>' : '<p class="muted">El organizador todavía no ha puesto gastos previstos.</p>') + '</div>';
    // pagos al organizador
    var dep = num(t.deposit), people = g.map(function (a) { return { who: 'u:' + a.user_id, name: nm(a.user_id) }; }).concat(T.guests.map(function (x) { return { who: 'g:' + x.id, name: x.name + ' (web)' }; }));
    var pays = '<div class="tr-day"><span class="label">Pagos al organizador' + (dep ? ' · señal de ' + eur(dep) : '') + '</span>' + (people.length ? '<div class="tr-rows">' + people.map(function (p) {
      var x = T.paid[p.who], a = x ? num(x.amount) : 0, done = a > 0 && (!dep || a >= dep);
      return '<div data-who="' + p.who + '"><span>' + esc(p.name) + '</span>' + (T.admin ? '<span class="tr-pay"><input type="text" inputmode="decimal" value="' + (a ? String(a).replace('.', ',') : '') + '" placeholder="0" aria-label="Pagado por ' + esc(p.name) + '"><small>€</small><button class="btn small' + (done ? ' primary' : '') + '" type="button">' + (done ? 'Pagado' : 'Guardar') + '</button></span>' : '<b class="' + (done ? 'ok' : a ? '' : 'pend') + '">' + (a ? eur(a) + (done ? ' ✓' : '') : 'Pendiente') + '</b>') + '</div>';
    }).join('') + '</div>' + (T.admin ? '<p class="muted rg-small">Apunta lo que te ha pagado cada uno. La app no cobra: solo lleva la cuenta.</p>' : '') : '<p class="muted">Aún no hay nadie apuntado.</p>') + '</div>';
    // gastos compartidos
    var bal = {}; g.forEach(function (a) { bal[a.user_id] = 0; });
    T.exp.forEach(function (x) { var sp = x.split || []; bal[x.payer_id] = (bal[x.payer_id] || 0) + num(x.amount); sp.forEach(function (u) { bal[u] = (bal[u] || 0) - num(x.amount) / sp.length; }); });
    var total = T.exp.reduce(function (s, x) { return s + num(x.amount); }, 0), pos = [], neg = [], moves = [];
    Object.keys(bal).forEach(function (u) { var v = Math.round(bal[u] * 100) / 100; if (v > 0.009) pos.push([u, v]); else if (v < -0.009) neg.push([u, -v]); });
    pos.sort(function (a, b) { return b[1] - a[1]; }); neg.sort(function (a, b) { return b[1] - a[1]; });
    var i = 0, j = 0; while (i < neg.length && j < pos.length) { var m = Math.min(neg[i][1], pos[j][1]); moves.push([neg[i][0], pos[j][0], m]); neg[i][1] -= m; pos[j][1] -= m; if (neg[i][1] < 0.01) i++; if (pos[j][1] < 0.01) j++; }
    var canAdd = g.some(function (a) { return a.user_id === me(); });
    var shared = '<div class="tr-day"><span class="label">Gastos compartidos' + (total ? ' · ' + eur(total) + ' en total' : '') + '</span>' +
      (T.exp.length ? '<div class="tr-rows">' + T.exp.map(function (x) { return '<div data-x="' + x.id + '"><span>' + esc(x.label) + '<small> · pagó ' + esc(nm(x.payer_id)) + ' · entre ' + (x.split || []).length + '</small></span><b>' + eur(x.amount) + '</b>' + (x.payer_id === me() || T.admin ? '<button class="link danger" data-del="' + x.id + '" type="button" aria-label="Borrar">✕</button>' : '') + '</div>'; }).join('') + '</div>' : '<p class="muted">Gasolina a medias, una cena, el peaje… Cada uno apunta lo que paga y aquí sale quién debe a quién.</p>') +
      (moves.length ? '<span class="label" style="margin-top:12px">Para quedar en paz</span><div class="tr-rows">' + moves.map(function (mv) { return '<div class="' + (mv[0] === me() ? 'mine' : '') + '"><span><b>' + esc(nm(mv[0])) + '</b> paga a <b>' + esc(nm(mv[1])) + '</b></span><b>' + eur(mv[2]) + '</b></div>'; }).join('') + '</div>' : (T.exp.length ? '<p class="muted">Estáis en paz.</p>' : '')) +
      (canAdd ? '<form class="tr-add" id="trExp"><input id="xLabel" maxlength="80" placeholder="Concepto (cena, gasolina…)" required><div class="tr-add-row"><input id="xAmount" type="text" inputmode="decimal" placeholder="Importe €" required><button class="btn primary" type="submit">Apuntar</button></div>' +
        '<details><summary class="muted rg-small">Repartir entre… (por defecto, todos los que van)</summary><div class="tr-split">' + g.map(function (a) { return '<label><input type="checkbox" value="' + a.user_id + '" checked><span>' + esc(nm(a.user_id)) + '</span></label>'; }).join('') + '</div></details></form>' : '<p class="muted rg-small">Para apuntar gastos tienes que estar apuntado al viaje.</p>') + '</div>';
    host.innerHTML = budget + pays + shared;
    $$('[data-who] button', host).forEach(function (b) { b.addEventListener('click', function () {
      var row = b.closest('[data-who]'), a = num($('input', row).value);
      Cl.busy(b, function () { return (a > 0 ? sb.from('trip_paid').upsert({ event_id: T.ev.id, who: row.dataset.who, amount: a, updated_at: new Date().toISOString() }) : sb.from('trip_paid').delete().eq('event_id', T.ev.id).eq('who', row.dataset.who)).then(function (r) { ok(r); paneMoney(); }); });
    }); });
    $$('[data-del]', host).forEach(function (b) { b.addEventListener('click', function () { if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = '¿Borrar?'; setTimeout(function () { delete b.dataset.sure; b.textContent = '✕'; }, 3000); return; } sb.from('trip_expenses').delete().eq('id', b.dataset.del).then(function (r) { ok(r); paneMoney(); }).catch(fail); }); });
    if ($('#trExp')) $('#trExp').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var a = num($('#xAmount').value), split = $$('.tr-split input:checked').map(function (c) { return c.value; });
      if (!(a > 0)) { A.toast('Pon el importe.', 'warn'); return; } if (!split.length) { A.toast('Elige entre quién se reparte.', 'warn'); return; }
      Cl.busy(ev.target.querySelector('button[type=submit]'), function () { return sb.from('trip_expenses').insert({ event_id: T.ev.id, label: $('#xLabel').value.trim(), amount: a, split: split }).then(function (r) { ok(r); A.toast('Gasto apuntado.', 'ok'); paneMoney(); }); });
    });
  }

  /* ---------- editar el viaje (organizadores) ---------- */
  function edit() {
    var ev = T.ev, D = JSON.parse(JSON.stringify(T.trip)), s0 = new Date(ev.starts_at), e0 = ev.ends_at ? new Date(ev.ends_at) : s0;
    var base = { title: ev.title, date: ymd(s0), time: ('0' + s0.getHours()).slice(-2) + ':' + ('0' + s0.getMinutes()).slice(-2), end: ymd(e0), cap: ev.capacity || '', meet: ev.meet_name || '', meet_url: ev.meet_url || '', desc: ev.description || '' };
    D.days = D.days || []; D.budget = D.budget || [];
    var NEW = {}, plans = A.plans ? A.plans() : [];      // rutas elegidas o importadas en esta edición, por día
    function did() { return Math.random().toString(36).slice(2, 10).replace(/[^a-z0-9]/g, 'x').padEnd(8, 'x'); }
    D.days.forEach(function (d) { if (!d.id) d.id = did(); });
    function get(o, path) { return path.reduce(function (x, k) { return x == null ? x : x[k]; }, o); }
    function set(o, path, v) { for (var i = 0; i < path.length - 1; i++) { if (o[path[i]] == null) o[path[i]] = {}; o = o[path[i]]; } o[path[path.length - 1]] = v; }
    function f(label, path, attrs, val) { var v = val !== undefined ? val : get(D, path); return '<label>' + label + '<input data-p="' + path.join('.') + '" value="' + esc(v == null ? '' : v) + '" ' + (attrs || '') + '></label>'; }
    function sync() { $$('#trForm [data-p]').forEach(function (el) { var p = el.dataset.p.split('.'); set(D, p, el.type === 'checkbox' ? el.checked : el.value); }); $$('#trForm [data-b]').forEach(function (el) { base[el.dataset.b] = el.value; }); }
    function paint() {
      Cl.sheet(head('Editar salida de varios días') + '<form class="rg-form" id="trForm">' +
        '<label>Nombre del viaje<input data-b="title" required minlength="2" maxlength="120" value="' + esc(base.title) + '"></label>' +
        '<div class="tr-two"><label>Sale el<input data-b="date" type="date" required value="' + base.date + '"></label><label>Hora<input data-b="time" type="time" required value="' + base.time + '"></label></div>' +
        '<div class="tr-two"><label>Vuelve el<input data-b="end" type="date" required value="' + base.end + '"></label><label>Plazas<input data-b="cap" type="number" min="1" max="500" inputmode="numeric" placeholder="Sin límite" value="' + esc(base.cap) + '"></label></div>' +
        '<label>Punto de salida<input data-b="meet" maxlength="120" placeholder="Gasolinera, plaza…" value="' + esc(base.meet) + '"></label>' +
        '<label>Enlace de Maps del punto de salida<input data-b="meet_url" type="url" maxlength="400" placeholder="https://maps…" value="' + esc(base.meet_url) + '"></label>' +
        '<label>Descripción<textarea data-b="desc" class="note" maxlength="2000" placeholder="De qué va el viaje, ritmo, a quién va dirigido…">' + esc(base.desc) + '</textarea></label>' +
        '<h2 class="tr-h">Etapas</h2>' + D.days.map(function (d, i) {
          d.stops = d.stops || []; d.stay = d.stay || {};
          var dd = new Date(base.date + 'T12:00'); dd.setDate(dd.getDate() + i);
          return '<fieldset class="tr-ed"><legend>Día ' + (i + 1) + (isNaN(dd) ? '' : ' · ' + dstr(dd)) + '<button class="link danger" data-rm="days.' + i + '" type="button">Quitar día</button></legend>' +
            f('Título de la etapa', ['days', i, 'title'], 'maxlength="100" placeholder="Teulada → Cuenca"') +
            '<div class="tr-two">' + f('Hora de salida', ['days', i, 'start'], 'type="time"') + f('Kilómetros', ['days', i, 'km'], 'type="number" min="0" max="2000" inputmode="numeric"') + '</div>' +
            f('Sale de', ['days', i, 'from'], 'maxlength="100" placeholder="Hotel, gasolinera…"') +
            '<label>Ruta de este día (la que seguirá el grupo)<select data-rt="' + d.id + '"><option value="">Sin ruta</option>' + (d.route_name ? '<option value="keep" selected>' + esc((NEW[d.id] && NEW[d.id].name ? 'Elegida: ' : 'Mantener: ') + d.route_name) + '</option>' : '') + plans.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + ' · ' + String(p.dist).replace('.', ',') + ' km</option>'; }).join('') + '</select></label>' +
            '<div class="tr-gpx"><button class="btn small" data-gpx="' + d.id + '" type="button"><svg><use href="#i-download"/></svg>Importar GPX para este día</button><input type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" hidden></div>' +
            f('Enlace de la ruta en Maps (opcional, para la web)', ['days', i, 'route_url'], 'type="url" maxlength="600" placeholder="https://…"') +
            '<span class="label">Paradas</span>' + d.stops.map(function (p, k) { return '<div class="tr-stop-ed"><div class="tr-two"><input data-p="days.' + i + '.stops.' + k + '.name" maxlength="80" placeholder="Parada (almuerzo, mirador…)" value="' + esc(p.name || '') + '"><input data-p="days.' + i + '.stops.' + k + '.time" type="time" value="' + esc(p.time || '') + '" aria-label="Hora"></div><div class="tr-two"><input data-p="days.' + i + '.stops.' + k + '.url" type="url" maxlength="400" placeholder="Enlace de Maps (opcional)" value="' + esc(p.url || '') + '"><button class="link danger" data-rm="days.' + i + '.stops.' + k + '" type="button">Quitar</button></div></div>'; }).join('') +
            '<button class="btn small" data-add="days.' + i + '.stops" type="button">+ Añadir parada</button>' +
            '<span class="label">Dónde se duerme esa noche</span>' + f('Nombre del alojamiento', ['days', i, 'stay', 'name'], 'maxlength="100" placeholder="Vacío si se vuelve a casa"') +
            '<div class="tr-two"><label>Tipo<select data-p="days.' + i + '.stay.kind">' + Object.keys(STAY).map(function (k) { return '<option value="' + k + '"' + (d.stay.kind === k ? ' selected' : '') + '>' + STAY[k] + '</option>'; }).join('') + '</select></label>' + f('Precio por persona €', ['days', i, 'stay', 'price'], 'type="text" inputmode="decimal"') + '</div>' +
            f('Dirección', ['days', i, 'stay', 'address'], 'maxlength="160"') + f('Enlace (reserva o Maps)', ['days', i, 'stay', 'url'], 'type="url" maxlength="600" placeholder="https://…"') +
            '<div class="tr-two">' + f('Hora de entrada', ['days', i, 'stay', 'checkin'], 'type="time"') + '<label class="rg-check"><input type="checkbox" data-p="days.' + i + '.stay.parking"' + (d.stay.parking ? ' checked' : '') + '><span><b>Parking para motos</b></span></label></div>' +
            f('Nota del alojamiento', ['days', i, 'stay', 'note'], 'maxlength="300" placeholder="Desayuno incluido, habitaciones dobles…"') + '</fieldset>';
        }).join('') + '<button class="btn" data-add="days" type="button">+ Añadir día</button>' +
        '<h2 class="tr-h">Gastos previstos</h2><p class="muted rg-small">El alojamiento ya se suma solo con el precio de cada noche.</p>' + D.budget.map(function (b, i) { return '<div class="tr-stop-ed"><div class="tr-two"><input data-p="budget.' + i + '.label" maxlength="60" placeholder="Gasolina, comidas, peajes…" value="' + esc(b.label || '') + '"><input data-p="budget.' + i + '.amount" type="text" inputmode="decimal" placeholder="€" value="' + esc(b.amount || '') + '"></div><div class="tr-two"><select data-p="budget.' + i + '.per"><option value="p"' + (b.per !== 'g' ? ' selected' : '') + '>Por persona</option><option value="g"' + (b.per === 'g' ? ' selected' : '') + '>Total a repartir entre todos</option></select><button class="link danger" data-rm="budget.' + i + '" type="button">Quitar</button></div></div>'; }).join('') +
        '<button class="btn small" data-add="budget" type="button">+ Añadir gasto previsto</button>' +
        f('Señal o pago por adelantado por persona €', ['deposit'], 'type="text" inputmode="decimal" placeholder="Vacío si no hay"') +
        '<label>Qué llevar (una cosa por línea)<textarea data-p="checklist" class="note" maxlength="1500" placeholder="DNI y carné&#10;Seguro y ficha de la moto&#10;Ropa de agua">' + esc(D.checklist || '') + '</textarea></label>' +
        '<button class="btn big primary" type="submit">Guardar viaje</button></form>');
      $('#trX').addEventListener('click', function () { reload(); });
      var setRoute = function (d, r) { NEW[d.id] = r; d.route_name = r ? r.name : ''; d.route_km = r ? r.dist : ''; if (r && !num(d.km)) d.km = Math.round(r.dist); };
      var repaint = function () { var box = $('#rgSheet .rg-sheet-in'), y = box ? box.scrollTop : 0; paint(); box = $('#rgSheet .rg-sheet-in'); if (box) box.scrollTop = y; };
      $$('[data-rt]').forEach(function (sel) { sel.addEventListener('change', function () {
        sync(); var d = D.days.filter(function (x) { return x.id === sel.dataset.rt; })[0], v = sel.value; if (!d || v === 'keep') return;
        if (!v) setRoute(d, null); else { var p = plans.filter(function (x) { return String(x.id) === v; })[0]; if (p) setRoute(d, { name: p.name, wps: p.wps, pois: p.pois || [], coords: p.coords, steps: p.steps || [], dist: p.dist, dur: p.dur }); }
        repaint();
      }); });
      $$('[data-gpx]').forEach(function (b) { var inp = b.parentNode.querySelector('input[type=file]');
        b.addEventListener('click', function () { inp.value = ''; inp.click(); });
        inp.addEventListener('change', function () {
          var file = inp.files && inp.files[0]; if (!file) return; if (!window.RGNav || !RGNav.gpxRoute) { A.toast('No se puede importar aquí.', 'bad'); return; }
          sync(); var d = D.days.filter(function (x) { return x.id === b.dataset.gpx; })[0], rd = new FileReader();
          b.disabled = true; b.textContent = 'Leyendo el GPX…';
          rd.onload = function () { RGNav.gpxRoute(String(rd.result || ''), file.name).then(function (r) {
              setRoute(d, r);
              // también se guarda en «mis rutas», para poder elegirla en otro día o en otro viaje
              var saved = A.savePlan ? A.savePlan({ id: Date.now(), name: r.name, wps: r.wps, pois: r.pois || [], coords: r.coords, dist: r.dist, dur: r.dur, routed: true, steps: r.steps || [], created: Date.now(), gpx: true }) : Promise.resolve();
              return Promise.resolve(saved).catch(function () {}).then(function () { plans = A.plans ? A.plans() : plans; A.toast('Ruta importada (' + String(r.dist).replace('.', ',') + ' km), puesta en este día y guardada en tus rutas.', 'ok'); repaint(); });
            }).catch(function (e) { A.toast(e.message || 'No se pudo importar.', 'bad'); repaint(); }); };
          rd.onerror = function () { A.toast('No se pudo leer el archivo.', 'bad'); repaint(); };
          rd.readAsText(file);
        });
      });
      // Los días del plan van con las fechas: al cambiar la salida o la vuelta se añaden o se quitan días por el final.
      var nDays = function () { var a1 = new Date(base.date + 'T12:00'), b1 = new Date(base.end + 'T12:00'); return isNaN(a1) || isNaN(b1) ? 0 : Math.round((b1 - a1) / 864e5) + 1; };
      $$('#trForm [data-b="date"],#trForm [data-b="end"]').forEach(function (inp) { inp.addEventListener('change', function () {
        var before = base.date; sync();
        if (inp.dataset.b === 'date' && base.date > base.end) { var mv = new Date(base.end + 'T12:00'); mv.setDate(mv.getDate() + Math.round((new Date(base.date + 'T12:00') - new Date(before + 'T12:00')) / 864e5)); base.end = ymd(mv); }
        var n = nDays(); if (n < 1) { A.toast('La vuelta no puede ser antes de la salida.', 'warn'); return; }
        n = Math.min(30, n); var was = D.days.length;
        while (D.days.length < n) D.days.push({ id: did(), stops: [], stay: {} });
        if (D.days.length > n) D.days.length = n;
        if (D.days.length !== was) A.toast('El plan tiene ahora ' + n + (n === 1 ? ' día.' : ' días.'), 'ok');
        repaint();
      }); });
      var fitEnd = function () { var e1 = new Date(base.date + 'T12:00'); if (isNaN(e1) || !D.days.length) return; e1.setDate(e1.getDate() + D.days.length - 1); base.end = ymd(e1); };
      $$('[data-add]').forEach(function (b) { b.addEventListener('click', function () { sync(); var p = b.dataset.add.split('.'), arr = get(D, p); if (!arr) { arr = []; set(D, p, arr); } arr.push(p.length === 1 && p[0] === 'days' ? { id: did(), stops: [], stay: {} } : p[0] === 'budget' ? { per: 'p' } : {}); if (p.length === 1 && p[0] === 'days') fitEnd(); var y = $('#rgSheet .rg-sheet-in') ? $('#rgSheet .rg-sheet-in').scrollTop : 0; paint(); var box = $('#rgSheet .rg-sheet-in'); if (box) box.scrollTop = y; }); });
      $$('[data-rm]').forEach(function (b) { b.addEventListener('click', function () { sync(); var p = b.dataset.rm.split('.'), k = +p.pop(); get(D, p).splice(k, 1); if (p.length === 1 && p[0] === 'days') fitEnd(); var y = $('#rgSheet .rg-sheet-in') ? $('#rgSheet .rg-sheet-in').scrollTop : 0; paint(); var box = $('#rgSheet .rg-sheet-in'); if (box) box.scrollTop = y; }); });
      $('#trForm').addEventListener('submit', function (evn) {
        evn.preventDefault(); sync();
        var st = new Date(base.date + 'T' + (base.time || '09:00')), en = new Date(base.end + 'T23:00');
        if (isNaN(st) || isNaN(en) || en < st) { A.toast('Revisa las fechas: la vuelta no puede ser antes de la salida.', 'warn'); return; }
        D.days.forEach(function (d) { d.km = num(d.km) || ''; d.stops = (d.stops || []).filter(function (p) { return (p.name || '').trim(); }); if (d.stay) d.stay.price = num(d.stay.price) || ''; });
        D.budget = D.budget.filter(function (b) { return (b.label || '').trim() && num(b.amount) > 0; }).map(function (b) { return { label: b.label.trim(), amount: num(b.amount), per: b.per === 'g' ? 'g' : 'p' }; });
        D.deposit = num(D.deposit) || '';
        Cl.busy(evn.target.querySelector('button[type=submit]'), function () {
          return sb.from('events').update({ title: base.title.trim(), description: base.desc.trim(), starts_at: st.toISOString(), ends_at: en.toISOString(), capacity: parseInt(base.cap, 10) > 0 ? parseInt(base.cap, 10) : null, meet_name: base.meet.trim(), meet_url: url(base.meet_url) || null, trip: D }).eq('id', ev.id).select('id').then(function (r) {
            if (!ok(r).length) throw new Error('No se ha guardado: no eres organizador de este viaje.');
            // las rutas de cada día: se suben las nuevas y se quitan las de días borrados o dejados sin ruta
            var jobs = [], keepIds = D.days.filter(function (d) { return d.route_name; }).map(function (d) { return d.id; });
            Object.keys(NEW).forEach(function (k) { if (NEW[k] && keepIds.indexOf(k) >= 0) jobs.push(sb.from('trip_routes').upsert({ event_id: ev.id, day_id: k, route: NEW[k], updated_at: new Date().toISOString() }).then(ok)); });
            jobs.push(sb.from('trip_routes').select('day_id').eq('event_id', ev.id).then(function (q) { var gone = (q.data || []).map(function (x) { return x.day_id; }).filter(function (k) { return keepIds.indexOf(k) < 0; }); return gone.length ? sb.from('trip_routes').delete().eq('event_id', ev.id).in('day_id', gone).then(ok) : null; }));
            return Promise.all(jobs).then(function () { A.toast('Viaje guardado.', 'ok'); reload('plan'); });
          });
        });
      });
    }
    paint();
  }

  /* ---------- mis viajes, crear y unirse ---------- */
  function list() {
    if (!me()) { Cl.openAuth(false); return; }
    Cl.sheet(head('Mis viajes') + '<p class="muted">Cargando…</p>'); $('#trX').addEventListener('click', Cl.closeSheet);
    sb.rpc('my_trips').then(function (r) {
      var rows = ok(r) || [], now = Date.now();
      Cl.sheet(head('Mis viajes') + '<p class="muted" style="text-align:left;margin:0">Escapadas de varios días. Las puedes organizar entre amigos, con un código para invitar, o publicarlas en tu comunidad desde su botón «Crear».</p>' +
        (rows.length ? '<div class="tr-list">' + rows.map(function (x) {
          var s = new Date(x.starts_at), past = (x.ends_at || x.starts_at) < now - 864e5;
          return '<button class="tr-item' + (past ? ' past' : '') + '" data-id="' + x.id + '" type="button"><span class="tr-date"><b>' + s.getDate() + '</b>' + MON[s.getMonth()] + '</span><span class="tr-info"><b>' + esc(x.title) + '</b><small>' + (x.private ? 'Entre amigos' : esc(x.community)) + ' · ' + (x.days || 1) + (x.days === 1 ? ' día' : ' días') + ' · van ' + x.going + '</small></span>' + (x.mine === 'going' || x.mine === 'offered' ? '<span class="mstatus ok"><svg><use href="#i-check"/></svg>Vas</span>' : '') + '</button>';
        }).join('') + '</div>' : '<div class="empty">Todavía no tienes ningún viaje.</div>') +
        '<button class="btn big primary" id="trNew" type="button"><svg><use href="#i-plus"/></svg>Crear un viaje entre amigos</button>' +
        '<div class="club-card"><b>Tengo un código de viaje</b><div class="plan-link"><input type="text" id="trCodeIn" maxlength="8" placeholder="Código" autocapitalize="characters" autocomplete="off"><button class="btn small primary" id="trJoin" type="button">Unirme</button></div></div>');
      $('#trX').addEventListener('click', Cl.closeSheet);
      $$('.tr-item').forEach(function (b) { b.addEventListener('click', function () { open(b.dataset.id); }); });
      $('#trNew').addEventListener('click', function () { create(null); });
      $('#trJoin').addEventListener('click', function (ev) { var c = $('#trCodeIn').value.trim(); if (c.length < 4) { A.toast('Escribe el código.', 'warn'); return; }
        Cl.busy(ev.currentTarget, function () { return sb.rpc('trip_join', { p_code: c }).then(function (r2) { var id = ok(r2); A.toast('¡Dentro del viaje!', 'ok'); if (window.RGClub && RGClub.inbox) RGClub.inbox(true); if (id) open(id); else list(); }); }); });
    }).catch(function (e) { Cl.sheet(head('Mis viajes') + '<p class="muted">' + esc(Cl.msg ? Cl.msg(e) : e.message) + '</p>'); $('#trX').addEventListener('click', Cl.closeSheet); });
  }
  // cid: comunidad donde se crea (administradores). Sin cid: viaje entre amigos, con su grupo oculto y su código.
  // Salida de varios días. Para quién: mi comunidad (si la administro) o entre amigos, con un código para invitar.
  function create(cid, title0) {
    var d1 = new Date(Date.now() + 14 * 864e5), d2 = new Date(d1.getTime() + 2 * 864e5);
    var adm = (window.RGClub && RGClub.state.list || []).filter(function (c) { return c.role === 'admin'; }), com = cid ? adm.filter(function (c) { return c.id === cid; })[0] || adm[0] : null, who = com ? 'com' : 'priv';
    Cl.sheet(head('Nueva salida') + '<form class="rg-form" id="trNewF"><label>Nombre<input id="nT" required minlength="2" maxlength="120" placeholder="Pirineos en tres días" value="' + esc(title0 || '') + '"></label>' +
      '<span class="label">Duración</span><div class="seg" id="nDur"><button type="button" data-d="1" aria-pressed="false"' + (adm.length ? '' : ' disabled') + '>Un día</button><button type="button" data-d="n" aria-pressed="true">Varios días</button></div>' +
      '<div class="tr-two"><label>Sale el<input id="nA" type="date" required value="' + ymd(d1) + '"></label><label>Vuelve el<input id="nB" type="date" required value="' + ymd(d2) + '"></label></div>' +
      '<label>Punto de salida<input id="nM" maxlength="120" placeholder="Gasolinera de…"></label>' +
      '<span class="label">Para quién</span><div class="seg" id="nWho"><button type="button" data-w="com" aria-pressed="' + (who === 'com') + '"' + (adm.length ? '' : ' disabled') + '>Mi comunidad</button><button type="button" data-w="priv" aria-pressed="' + (who === 'priv') + '">Entre amigos</button></div>' +
      '<p class="muted rg-small" id="nWhoT" style="text-align:left;margin:0"></p>' +
      '<label>Plazas<input id="nC" type="number" inputmode="numeric" min="1" max="1000" placeholder="Sin límite"></label>' +
      '<p class="muted rg-small" style="text-align:left;margin:0">Al publicarla se abre para que pongas las etapas de cada día, las paradas, el alojamiento y el presupuesto.</p>' +
      '<div class="as-fixed"><button class="btn big primary" type="submit">Publicar</button></div></form>', 'full');
    var whoTx = function () { $('#nWhoT').textContent = who === 'com' ? 'Se publica en ' + (com ? com.name : 'tu comunidad') + ' y avisa a sus miembros.' : (adm.length ? '' : 'Las salidas de la comunidad las publica un administrador. ') + 'Entre amigos: genera un código para invitar y no avisa a ninguna comunidad.'; cid = who === 'com' && com ? com.id : null; }; whoTx();
    $$('#nWho button').forEach(function (b) { b.addEventListener('click', function () { who = b.dataset.w; $$('#nWho button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); whoTx(); }); });
    $$('#nDur button').forEach(function (b) { b.addEventListener('click', function () { if (b.dataset.d === '1') { Cl.closeSheet(); if (window.RGClub) RGClub.newEvent(); } }); });
    $('#trX').addEventListener('click', Cl.closeSheet);
    $('#trNewF').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var st = new Date($('#nA').value + 'T09:00'), en = new Date($('#nB').value + 'T23:00'), title = $('#nT').value.trim();
      if (isNaN(st) || isNaN(en) || en < st) { A.toast('La vuelta no puede ser antes de la salida.', 'warn'); return; }
      var days = []; for (var i = 0, n = Math.min(30, Math.round((en - st) / 864e5) + 1); i < n; i++) days.push({ id: Math.random().toString(36).slice(2, 10).replace(/[^a-z0-9]/g, 'x').padEnd(8, 'x'), stops: [], stay: {} });
      Cl.busy(ev.target.querySelector('button[type=submit]'), function () {
        var extra = { meet_name: $('#nM').value.trim() || null, capacity: parseInt($('#nC').value, 10) >= 1 ? parseInt($('#nC').value, 10) : null };
        var job = cid ? sb.from('events').insert(Object.assign({ community_id: cid, title: title, description: '', starts_at: st.toISOString(), ends_at: en.toISOString(), created_by: me(), trip: { days: days, budget: [] } }, extra)).select('id').single().then(function (r) { return ok(r).id; })
          : sb.rpc('trip_create_private', { p_title: title, p_starts: st.toISOString(), p_ends: en.toISOString() }).then(function (r) { var o = ok(r); return sb.from('events').update(Object.assign({ trip: { days: days, budget: [] } }, extra)).eq('id', o.event).then(function () { return o.event; }); });
        return job.then(function (id) { Cl.closePages(); if (window.RGClub) { RGClub.inbox(true); RGClub.show(); } T = null; open(id); setTimeout(function () { if (T && T.admin && $('#trEdit')) edit(); }, 1500); });
      });
    });
  }
  window.RGTrips = { open: open, list: list, create: create, embed: embed };
})();
