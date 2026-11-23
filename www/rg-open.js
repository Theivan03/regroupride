/* ReGroupRide — salidas abiertas cerca de mí (supabase/30) y el tiempo previsto en cada salida (Open-Meteo).
   Una salida abierta la marca el organizador; quien no es de la comunidad pide sitio y un administrador lo acepta. */
(function () {
  'use strict';
  var A = window.RGApp, Cl = window.RGCloud; if (!A || !Cl || !Cl.sb) return;
  var sb = Cl.sb, $ = function (s, r) { return (r || document).querySelector(s); }, $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var RA = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.RideAlerts;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function ic(n) { return '<svg><use href="#i-' + n + '"/></svg>'; }
  function jget(k) { try { return JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch (e) { return {}; } }
  function jset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function when(ms) { var d = new Date(ms); return d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\.|,/g, '') + ' · ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }); }
  function head(t) { return '<div class="head"><h1>' + t + '</h1><button class="btn small icon" id="opX" type="button" title="Cerrar">' + ic('close') + '</button></div>'; }

  /* ---------- salidas abiertas ---------- */
  var O = { km: 150, rows: [] }, ST = { pending: 'Solicitud enviada · falta que el organizador la acepte', going: '¡Tienes plaza!', waiting: 'Estás en la lista de espera', declined: 'El organizador no ha podido aceptarla', no: 'Te has borrado' };
  function open() {
    if (!Cl.user()) { Cl.openAuth(false); return; }
    var f = A.anyFix && A.anyFix();
    var s = Cl.sheet(head('Salidas abiertas cerca') + '<p class="muted" style="margin:0;text-align:left">Salidas que sus organizadores han abierto a moteros de fuera de su comunidad. Pide sitio y te contestarán.</p>' +
      '<div class="pills" id="opKm">' + [50, 150, 300].map(function (k) { return '<button class="pill" type="button" data-k="' + k + '" aria-pressed="' + (k === O.km) + '">' + k + ' km</button>'; }).join('') + '</div><div id="opList" class="op-list"><div class="empty">' + (f ? 'Buscando…' : 'Hace falta tu ubicación para saber qué tienes cerca. Abre el mapa y espera a que te sitúe.') + '</div></div>');
    $('#opX', s).addEventListener('click', Cl.closeSheet);
    $$('#opKm button', s).forEach(function (b) { b.addEventListener('click', function () { O.km = +b.dataset.k; open(); }); });
    if (!f) return;
    sb.rpc('open_events_near', { p_lat: f.lat, p_lon: f.lon, p_km: O.km }).then(function (r) {
      var el = $('#opList'); if (!el) return;
      if (r.error) { el.innerHTML = '<div class="empty">' + esc(Cl.msg(r.error)) + '</div>'; return; }
      O.rows = r.data || []; list(el); refresh();
    }, function () { var el = $('#opList'); if (el) el.innerHTML = '<div class="empty">No se ha podido cargar. Revisa la conexión.</div>'; });
  }
  function list(el) {
    var req = jget('rg.open.req');
    if (!O.rows.length) { el.innerHTML = '<div class="empty">No hay salidas abiertas a menos de ' + O.km + ' km. Prueba con más distancia o vuelve otro día.</div>'; return; }
    el.innerHTML = O.rows.map(function (e) {
      var left = e.capacity ? Math.max(0, e.capacity - (e.taken || 0)) : null, q = req[e.id];
      return '<div class="club-card op-card"><span class="ev-when">' + esc(when(e.starts_at)) + '</span><b>' + esc(e.title) + '</b>' +
        '<span class="muted">' + esc(e.community) + ([e.zone, e.style].filter(Boolean).length ? ' · ' + esc([e.zone, e.style].filter(Boolean).join(' · ')) : '') + '</span>' +
        '<span class="rt-meta"><span>' + ic('locate') + 'a ' + e.km + ' km' + (e.meet_name ? ' · ' + esc(e.meet_name) : '') + '</span>' + (left != null ? '<span>' + ic('people') + (left ? 'quedan ' + left + (left === 1 ? ' plaza' : ' plazas') : 'completa: lista de espera') + '</span>' : '') + (e.has_route ? '<span>' + ic('route') + 'con ruta</span>' : '') + '</span>' +
        '<span class="ev-wx" data-wx="' + e.meet_lat + ',' + e.meet_lon + ',' + e.starts_at + '" hidden></span>' +
        (e.description ? '<p class="op-desc">' + esc(e.description) + '</p>' : '') +
        (e.mine ? '<button class="btn" data-go="' + e.id + '" type="button">Es de tu comunidad: verla allí</button>'
          : q && q.status && q.status !== 'no' ? '<div class="op-st op-' + q.status + '">' + ic(q.status === 'going' ? 'check' : 'clock') + '<span>' + (ST[q.status] || q.status) + '</span></div>'
          : '<button class="btn primary" data-ask="' + e.id + '" type="button">Pedir sitio</button>') + '</div>';
    }).join('');
    $$('[data-ask]', el).forEach(function (b) { b.addEventListener('click', function () { askForm(O.rows.filter(function (e) { return e.id === b.dataset.ask; })[0]); }); });
    $$('[data-go]', el).forEach(function (b) { b.addEventListener('click', function () { Cl.closeSheet(); if (window.RGClub) RGClub.goto(null, 'events'); }); });
    wxFill(el);
  }
  // el estado de mis solicitudes: se vuelve a preguntar con los mismos datos (el servidor devuelve cómo está)
  function refresh() {
    var req = jget('rg.open.req'), u = Cl.user(); if (!u) return;
    O.rows.forEach(function (e) {
      var q = req[e.id]; if (!q || !q.phone) return;
      sb.rpc('event_register', { p_event: e.id, p_name: q.name, p_email: u.email, p_phone: q.phone, p_companion: !!q.comp, p_answers: {}, p_bike: q.bike }).then(function (r) {
        if (r.error || !r.data || r.data.status === q.status) return; q.status = r.data.status; var all = jget('rg.open.req'); all[e.id] = q; jset('rg.open.req', all); var el = $('#opList'); if (el) list(el);
      }, function () {});
    });
  }
  function askForm(e) {
    if (!e) return; var u = Cl.user(), v = (A.vehicles() || []).filter(function (x) { return x.principal; })[0] || (A.vehicles() || [])[0];
    var bike = v ? [v.make, v.model].filter(Boolean).join(' ') || v.name || '' : '', ph = (Cl.ridePhone && Cl.ridePhone()) || '';
    var s = Cl.sheet(head('Pedir sitio') + '<p style="margin:0;text-align:left"><b>' + esc(e.title) + '</b><br><span class="muted">' + esc(when(e.starts_at)) + ' · ' + esc(e.community) + '</span></p>' +
      '<form class="rg-form" id="opF"><label>Tu nombre<input id="opN" required minlength="2" maxlength="60" value="' + esc((Cl.profileName && Cl.profileName()) || '') + '"></label>' +
      '<label>Teléfono<input id="opP" type="tel" inputmode="tel" required maxlength="20" value="' + esc(ph) + '"></label>' +
      '<label>Con qué moto vienes<input id="opB" required minlength="2" maxlength="80" value="' + esc(bike) + '" placeholder="Marca y modelo"></label>' +
      '<label class="rg-check"><input type="checkbox" id="opC"><span><b>Voy con acompañante</b></span></label>' +
      '<p class="muted rg-small" style="text-align:left">El organizador verá tu nombre, tu teléfono y tu moto para decidir. ' + (e.approval ? 'Te avisaremos aquí cuando conteste.' : '') + '</p>' +
      '<button class="btn big primary" type="submit">Enviar solicitud</button></form>');
    $('#opX', s).addEventListener('click', open);
    $('#opF', s).addEventListener('submit', function (ev) {
      ev.preventDefault(); var q = { name: $('#opN').value.trim(), phone: $('#opP').value.replace(/[^0-9+]/g, ''), bike: $('#opB').value.trim(), comp: $('#opC').checked };
      Cl.busy(ev.submitter || $('#opF button'), function () {
        return sb.rpc('event_register', { p_event: e.id, p_name: q.name, p_email: u.email, p_phone: q.phone, p_companion: q.comp, p_answers: {}, p_bike: q.bike }).then(function (r) {
          if (r.error) { if (/Falta contestar/i.test(r.error.message || '')) { A.toast('Esta salida pide más datos: se abre su página para apuntarte.', 'warn'); window.open('https://regroupride-eventos.netlify.app/?e=' + e.id, '_blank'); return; } throw r.error; }
          q.status = r.data.status; q.code = r.data.code; var all = jget('rg.open.req'); all[e.id] = q; jset('rg.open.req', all); open();
        });
      }).catch(function (x) { A.toast(Cl.msg(x), 'warn'); });
    });
  }
  var row = $('#exRow');
  if (row) { var b = document.createElement('button'); b.className = 'btn'; b.type = 'button'; b.id = 'exOpen'; b.innerHTML = ic('people') + 'Salidas cerca'; row.insertBefore(b, row.firstChild); b.addEventListener('click', open); }

  /* ---------- el tiempo de la salida ---------- */
  var WX = {};
  function wxGet(lat, lon, ts) {
    var h0 = Math.floor(ts / 36e5) * 36e5, key = (+lat).toFixed(2) + ',' + (+lon).toFixed(2) + ',' + h0, c = WX[key];
    if (c && Date.now() - c.at < 45 * 60000) return c.p;
    if (ts < Date.now() - 2 * 36e5 || ts > Date.now() + 15 * 864e5) return Promise.resolve(null);
    var iso = function (t) { return new Date(t).toISOString().slice(0, 13) + ':00'; };
    var p = fetch('https://api.open-meteo.com/v1/forecast?latitude=' + (+lat).toFixed(3) + '&longitude=' + (+lon).toFixed(3) + '&hourly=temperature_2m,precipitation_probability,precipitation,wind_gusts_10m&wind_speed_unit=kmh&timezone=UTC&start_hour=' + iso(h0) + '&end_hour=' + iso(h0 + 4 * 36e5))
      .then(function (r) { return r.json(); }).then(function (d) {
        var h = d && d.hourly; if (!h || !h.time || !h.time.length) return null;
        var mx = function (a) { return Math.max.apply(null, (a || [0]).filter(function (x) { return x != null; }).concat([0])); }, t = (h.temperature_2m || []).filter(function (x) { return x != null; });
        var o = { temp: t.length ? Math.round(t.reduce(function (s, x) { return s + x; }, 0) / t.length) : null, prob: Math.round(mx(h.precipitation_probability)), mm: Math.round((h.precipitation || []).reduce(function (s, x) { return s + (x || 0); }, 0) * 10) / 10, gust: Math.round(mx(h.wind_gusts_10m)) };
        o.bad = o.prob >= 55 || o.mm >= 1 || o.gust >= 55; o.why = [o.prob >= 55 || o.mm >= 1 ? 'lluvia' : '', o.gust >= 55 ? 'viento fuerte' : ''].filter(Boolean).join(' y ');
        return o;
      }).catch(function () { delete WX[key]; return null; });
    WX[key] = { at: Date.now(), p: p }; return p;
  }
  function wxFill(root) {
    $$('[data-wx]', root || document).forEach(function (el) {
      if (el.dataset.done) return; el.dataset.done = '1'; var a = el.dataset.wx.split(',');
      wxGet(a[0], a[1], +a[2]).then(function (o) {
        if (!o) return; el.hidden = false; el.classList.toggle('bad', !!o.bad);
        el.innerHTML = ic('weather') + '<span>' + (o.temp != null ? o.temp + '° · ' : '') + 'lluvia ' + o.prob + ' %' + (o.mm >= 0.5 ? ' (' + String(o.mm).replace('.', ',') + ' mm)' : '') + ' · rachas ' + o.gust + ' km/h' + (o.bad ? ' · ojo: ' + o.why : '') + '</span>';
        el.title = 'Previsión en el punto de salida, de la hora de salida a cuatro horas después (Open-Meteo)';
      });
    });
  }
  var cb = $('#clubBody'), deb = 0;
  if (cb && window.MutationObserver) new MutationObserver(function () { clearTimeout(deb); deb = setTimeout(function () { wxFill(cb); }, 250); }).observe(cb, { childList: true, subtree: true });
  // aviso el día antes: lluvia o viento fuerte en una salida a la que voy
  var soon = [];
  function dayBefore() {
    var ev = (window.RGClub && RGClub.mine ? RGClub.mine() : []).filter(function (e) { var d = e.starts_at - Date.now(); return (e.status === 'going' || e.status === 'waiting') && d > 2 * 36e5 && d < 36 * 36e5 && e.meet_lat != null; });
    var told = jget('rg.wx.told'); soon = [];
    ev.forEach(function (e) {
      wxGet(e.meet_lat, e.meet_lon, e.starts_at).then(function (o) {
        if (!o || !o.bad) return; soon.push({ e: e, o: o }); if (window.RGShell) RGShell.today();
        if (told[e.id]) return; told[e.id] = Date.now(); jset('rg.wx.told', told);
        try { if (RA && RA.newsNow) RA.newsNow({ items: [{ kind: 'note', id: 'wx-' + e.id, community: e.community || 'ReGroupRide', head: 'Previsión de ' + o.why + ' en «' + e.title + '»', title: 'Lluvia ' + o.prob + ' % y rachas de ' + o.gust + ' km/h a la hora de la salida. Prepara el equipo o háblalo en el chat.' }], silent: false }).catch(function () {}); } catch (x) {}
      });
    });
  }
  (window.RGToday = window.RGToday || []).push(function () { var x = soon[0]; return x && x.e.starts_at > Date.now() ? { i: 'weather', hot: 1, b: 'Previsión de ' + x.o.why, t: x.e.title + ' · lluvia ' + x.o.prob + ' % · rachas ' + x.o.gust + ' km/h', go: function () { if (window.RGClub) RGClub.goto(x.e.community_id, 'events'); } } : null; });
  setTimeout(dayBefore, 15000); setInterval(function () { if (document.visibilityState !== 'hidden') dayBefore(); }, 30 * 60000);
  window.RGOpen = { open: open, wx: wxGet, fill: wxFill };
})();
