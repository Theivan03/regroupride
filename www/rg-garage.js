/* ReGroupRide — garaje: vencimientos (ITV, seguro, permiso…) con recordatorio y foto del documento, repostajes y
   gastos con consumo real, autonomía de la moto y aviso de moto robada (supabase/32).
   Los datos van dentro de cada vehículo (se copian con la cuenta); las fotos de documentos se quedan en el teléfono. */
(function () {
  'use strict';
  var A = window.RGApp, Cl = window.RGCloud; if (!A || !Cl) return;
  var sb = Cl.sb, $ = function (s, r) { return (r || document).querySelector(s); }, $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var P = (window.Capacitor && Capacitor.Plugins) || {}, RA = P.RideAlerts, LN = P.LocalNotifications;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function ic(n) { return '<svg><use href="#i-' + n + '"/></svg>'; }
  function jget(k) { try { return JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch (e) { return {}; } }
  function jset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function head(t) { return '<div class="head"><h1>' + t + '</h1><button class="btn small icon" id="gxX" type="button" title="Cerrar">' + ic('close') + '</button></div>'; }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function veh(id) { return (A.vehicles() || []).filter(function (v) { return String(v.id) === String(id); })[0]; }
  function ymd(d) { d = new Date(d); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function dmy(s) { return new Date(s + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, ''); }
  function days(s) { var t = new Date(); t.setHours(12, 0, 0, 0); return Math.round((new Date(s + 'T12:00:00') - t) / 864e5); }
  function n1(v) { return String(Math.round(v * 10) / 10).replace('.', ','); }
  function eur(v) { return (Math.round(v * 100) / 100).toFixed(2).replace('.', ',') + ' €'; }
  var DOC = { itv: 'ITV', seguro: 'Seguro', permiso: 'Permiso de conducir', circ: 'Impuesto de circulación', otro: 'Otro' };

  /* fotos de documentos: solo en este teléfono */
  var dbp = null;
  function pdb() { if (!dbp) dbp = new Promise(function (res, rej) { var r = indexedDB.open('rg-docs', 1); r.onupgradeneeded = function () { r.result.createObjectStore('photos'); }; r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); return dbp; }
  function pget(id) { return pdb().then(function (d) { return new Promise(function (res) { var q = d.transaction('photos').objectStore('photos').get(id); q.onsuccess = function () { res(q.result || null); }; q.onerror = function () { res(null); }; }); }).catch(function () { return null; }); }
  function pput(id, blob) { return pdb().then(function (d) { return new Promise(function (res) { var t = d.transaction('photos', 'readwrite'); if (blob) t.objectStore('photos').put(blob, id); else t.objectStore('photos').delete(id); t.oncomplete = res; t.onerror = res; }); }).catch(function () {}); }

  /* ---------- cálculo de consumo ---------- */
  function stats(v) {
    var f = (v.fuel || []).slice().sort(function (a, b) { return a.at - b.at; }), c = v.costs || [], y = new Date().getFullYear();
    var full = f.filter(function (x) { return x.full && x.odo > 0; }), l100 = null, e100 = null;
    if (full.length >= 2) { var a = full[0], b = full[full.length - 1], km = b.odo - a.odo, between = f.filter(function (x) { return x.at > a.at && x.at <= b.at; }); if (km > 20) { l100 = between.reduce(function (s, x) { return s + (x.l || 0); }, 0) / km * 100; e100 = between.reduce(function (s, x) { return s + (x.eur || 0); }, 0) / km * 100; } }
    var yr = function (arr) { return arr.filter(function (x) { return new Date(x.at).getFullYear() === y; }).reduce(function (s, x) { return s + (x.eur || 0); }, 0); };
    return { l100: l100, e100: e100, fuelY: yr(f), costY: yr(c), n: f.length + c.length };
  }

  /* ---------- bloque en cada vehículo ---------- */
  function paint() {
    $$('.v-x[data-vx]').forEach(function (el) {
      var v = veh(el.dataset.vx); if (!v) return; var odo = +el.dataset.odo || 0, docs = (v.docs || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }), st = stats(v);
      el.innerHTML = '<div class="gx"><div class="gx-h"><span class="label">Documentos y vencimientos</span><button class="link" data-gx="doc" type="button">' + ic('plus') + 'Añadir</button></div>' +
        (docs.length ? docs.map(function (d) { var n = days(d.date), cl = n < 0 ? 'late' : n <= 30 ? 'soon' : 'ok'; return '<button class="gx-row" type="button" data-doc="' + d.id + '"><span><b>' + esc(d.kind === 'otro' ? d.name || 'Documento' : DOC[d.kind]) + '</b><small>vence el ' + dmy(d.date) + '</small></span><span class="mstatus ' + cl + '">' + (n < 0 ? 'vencido' : n === 0 ? 'hoy' : n <= 60 ? 'en ' + n + ' d' : 'al día') + '</span></button>'; }).join('') : '<p class="muted rg-small gx-empty">Apunta cuándo vencen la ITV y el seguro y te avisamos un mes antes.</p>') +
        '<div class="gx-h"><span class="label">Repostajes y gastos</span><span><button class="link" data-gx="fuel" type="button">' + ic('fuel') + 'Repostaje</button><button class="link" data-gx="cost" type="button">' + ic('plus') + 'Gasto</button></span></div>' +
        (st.n ? '<div class="gx-figs"><div><b>' + (st.l100 != null ? n1(st.l100) : '—') + '</b><small>l/100 km</small></div><div><b>' + (st.e100 != null ? n1(st.e100) : '—') + '</b><small>€/100 km</small></div><div><b>' + Math.round(st.fuelY) + '</b><small>€ gasolina este año</small></div><div><b>' + Math.round(st.costY) + '</b><small>€ otros gastos</small></div></div><button class="link gx-all" data-gx="log" type="button">Ver todo el historial</button>'
          : '<p class="muted rg-small gx-empty">Apunta cada repostaje con el depósito lleno y sabrás el consumo real y lo que te cuesta cada kilómetro.</p>') +
        '<div class="gx-h"><span class="label">Autonomía</span><button class="link" data-gx="range" type="button">' + (v.range ? v.range + ' km · cambiar' : 'Indicar') + '</button></div>' +
        (v.type === 'coche' ? '' : '<button class="link danger gx-stolen" data-gx="stolen" type="button">' + ic('warn') + 'Me han robado esta moto</button>') + '</div>';
      el.querySelector('.gx').addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-gx],[data-doc]'); if (!b) return;
        if (b.dataset.doc) docForm(v, (v.docs || []).filter(function (d) { return d.id === b.dataset.doc; })[0]);
        else if (b.dataset.gx === 'doc') docForm(v, null); else if (b.dataset.gx === 'fuel') fuelForm(v, odo); else if (b.dataset.gx === 'cost') costForm(v); else if (b.dataset.gx === 'log') logSheet(v);
        else if (b.dataset.gx === 'range') rangeForm(v); else if (b.dataset.gx === 'stolen') stolenForm(v);
      });
    });
  }
  document.addEventListener('rg:garage', paint);
  function save(v) { return A.saveVehicle(v).then(function () { Cl.closeSheet(); remind(); if (window.RGShell) RGShell.today(); }); }

  /* ---------- documentos ---------- */
  function docForm(v, d) {
    var isNew = !d; d = d || { id: uid(), kind: 'itv', date: ymd(Date.now() + 365 * 864e5), name: '' };
    var s = Cl.sheet(head(isNew ? 'Nuevo vencimiento' : 'Vencimiento') + '<form class="rg-form" id="dcF"><label>Qué es<select id="dcK">' + Object.keys(DOC).map(function (k) { return '<option value="' + k + '"' + (d.kind === k ? ' selected' : '') + '>' + DOC[k] + '</option>'; }).join('') + '</select></label>' +
      '<label id="dcNL"' + (d.kind === 'otro' ? '' : ' hidden') + '>Nombre<input id="dcN" maxlength="40" value="' + esc(d.name || '') + '" placeholder="Qué documento es"></label>' +
      '<label>Vence el<input id="dcD" type="date" required value="' + esc(d.date) + '"></label>' +
      '<div class="gx-photo" id="dcP"><span class="muted rg-small">Foto del documento (se queda en este teléfono)</span></div><button class="btn" id="dcPick" type="button">' + ic('camera') + 'Hacer o elegir foto</button>' +
      '<button class="btn big primary" type="submit">Guardar</button>' + (isNew ? '' : '<button class="link danger rg-center" id="dcDel" type="button">Quitar este vencimiento</button>') + '</form>');
    var blob = undefined, show = function (b) { var box = $('#dcP'); if (!box) return; box.innerHTML = b ? '<img alt="Foto del documento" src="' + URL.createObjectURL(b) + '"><button class="link danger" id="dcPx" type="button">Quitar foto</button>' : '<span class="muted rg-small">Foto del documento (se queda en este teléfono)</span>'; if ($('#dcPx')) $('#dcPx').addEventListener('click', function () { blob = null; show(null); }); if (b) box.querySelector('img').addEventListener('click', function () { var lb = $('#lightbox'), im = $('#lightboxImg'); if (lb && im) { im.src = box.querySelector('img').src; lb.hidden = false; } }); };
    pget(d.id).then(function (b) { if (b && blob === undefined) show(b); });
    $('#gxX', s).addEventListener('click', Cl.closeSheet);
    $('#dcK', s).addEventListener('change', function (e) { $('#dcNL').hidden = e.target.value !== 'otro'; });
    $('#dcPick', s).addEventListener('click', function () { if (window.RGShell) RGShell.pickPhoto(1800).then(function (b) { if (b) { blob = b; show(b); } }); });
    if ($('#dcDel', s)) $('#dcDel', s).addEventListener('click', function () { v.docs = (v.docs || []).filter(function (x) { return x.id !== d.id; }); pput(d.id, null); save(v); });
    $('#dcF', s).addEventListener('submit', function (ev) {
      ev.preventDefault(); d.kind = $('#dcK').value; d.name = $('#dcN').value.trim(); d.date = $('#dcD').value; if (!d.date) return;
      v.docs = (v.docs || []).filter(function (x) { return x.id !== d.id; }).concat([d]);
      var told = jget('rg.docs.told'); delete told[d.id]; jset('rg.docs.told', told);
      (blob !== undefined ? pput(d.id, blob) : Promise.resolve()).then(function () { save(v); });
    });
  }
  // recordatorios: al abrir la app (30 días, 7 días y vencido) y programados en el teléfono para cuando toque
  function allDocs() { var out = []; (A.vehicles() || []).forEach(function (v) { (v.docs || []).forEach(function (d) { out.push({ v: v, d: d, n: days(d.date), t: d.kind === 'otro' ? d.name || 'Documento' : DOC[d.kind] }); }); }); return out.sort(function (a, b) { return a.n - b.n; }); }
  function remind() {
    var told = jget('rg.docs.told'), ch = false, add = [], ids = jget('rg.docs.ln'), next = {};
    allDocs().forEach(function (x) {
      var th = x.n < 0 ? 0 : x.n <= 7 ? 7 : x.n <= 30 ? 30 : null, was = told[x.d.id];
      if (th != null && (was == null || was > th)) {
        told[x.d.id] = th; ch = true; var body = x.t + ' de ' + (x.v.name || 'tu moto') + (x.n < 0 ? ': venció el ' + dmy(x.d.date) + '.' : x.n === 0 ? ': vence hoy.' : ': vence en ' + x.n + ' días (' + dmy(x.d.date) + ').');
        try { if (RA && RA.newsNow) RA.newsNow({ items: [{ kind: 'note', id: 'doc-' + x.d.id + '-' + th, community: 'Garaje', head: x.n < 0 ? 'Documento vencido' : 'Vencimiento cerca', title: body }], silent: false }).catch(function () {}); else A.toast('Aviso del garaje · ' + body, 'warn'); } catch (e) {}
      }
      [30, 7, 0].forEach(function (k) { var at = new Date(x.d.date + 'T10:00:00').getTime() - k * 864e5; if (at < Date.now() + 36e5) return; var h = 0, key = x.d.id + ':' + k + ':' + x.d.date; for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0; var id = 700000000 + Math.abs(h) % 90000000; next[id] = 1; if (!ids[id]) add.push({ id: id, title: k ? 'Vencimiento cerca' : 'Vence hoy', body: x.t + ' de ' + (x.v.name || 'tu moto') + (k ? ': vence en ' + k + ' días.' : ': vence hoy.'), schedule: { at: new Date(at), allowWhileIdle: true } }); });
    });
    if (ch) jset('rg.docs.told', told);
    if (LN) { var drop = Object.keys(ids).filter(function (id) { return !next[id]; }).map(function (id) { return { id: +id }; }); try { Promise.resolve(drop.length ? LN.cancel({ notifications: drop }) : null).catch(function () {}).then(function () { return add.length ? LN.schedule({ notifications: add }) : null; }).then(function () { jset('rg.docs.ln', next); }, function () {}); } catch (e) {} }
  }
  (window.RGToday = window.RGToday || []).push(function () { var x = allDocs().filter(function (q) { return q.n <= 30; })[0]; return x ? { i: 'cal', hot: x.n <= 7 ? 1 : 0, b: x.t + (x.n < 0 ? ' vencido' : x.n === 0 ? ' vence hoy' : ' vence en ' + x.n + ' días'), t: (x.v.name || 'Tu moto') + ' · ' + dmy(x.d.date), go: function () { A.showView('garage'); } } : null; });
  setTimeout(remind, 9000);

  /* ---------- repostajes, gastos y autonomía ---------- */
  function fuelForm(v, odo) {
    var s = Cl.sheet(head('Repostaje') + '<form class="rg-form" id="fuF"><div class="tr-two"><label>Litros<input id="fuL" type="number" step="0.01" min="0.5" max="200" inputmode="decimal" required></label><label>Importe (€)<input id="fuE" type="number" step="0.01" min="0" max="1000" inputmode="decimal" required></label></div>' +
      '<div class="tr-two"><label>Odómetro (km)<input id="fuO" type="number" step="1" min="0" inputmode="numeric" value="' + (odo || '') + '"></label><label>Fecha<input id="fuD" type="date" value="' + ymd(Date.now()) + '"></label></div>' +
      '<label class="rg-check"><input type="checkbox" id="fuFull" checked><span><b>Depósito lleno</b><small>El consumo se calcula entre dos repostajes a tope.</small></span></label><button class="btn big primary" type="submit">Guardar</button></form>');
    $('#gxX', s).addEventListener('click', Cl.closeSheet);
    $('#fuF', s).addEventListener('submit', function (ev) { ev.preventDefault(); var l = parseFloat($('#fuL').value), e = parseFloat($('#fuE').value); if (!(l > 0) || !(e >= 0)) return; v.fuel = (v.fuel || []).concat([{ id: uid(), at: new Date(($('#fuD').value || ymd(Date.now())) + 'T12:00:00').getTime(), l: l, eur: e, odo: parseInt($('#fuO').value, 10) || 0, full: $('#fuFull').checked }]); save(v); });
  }
  function costForm(v) {
    var s = Cl.sheet(head('Gasto') + '<form class="rg-form" id="coF"><label>Concepto<input id="coN" required maxlength="50" placeholder="Neumáticos, seguro, revisión…" list="coL"><datalist id="coL"><option>Neumáticos</option><option>Seguro</option><option>Revisión</option><option>ITV</option><option>Equipación</option><option>Peaje</option></datalist></label>' +
      '<div class="tr-two"><label>Importe (€)<input id="coE" type="number" step="0.01" min="0" max="100000" inputmode="decimal" required></label><label>Fecha<input id="coD" type="date" value="' + ymd(Date.now()) + '"></label></div><button class="btn big primary" type="submit">Guardar</button></form>');
    $('#gxX', s).addEventListener('click', Cl.closeSheet);
    $('#coF', s).addEventListener('submit', function (ev) { ev.preventDefault(); var e = parseFloat($('#coE').value); if (!(e >= 0)) return; v.costs = (v.costs || []).concat([{ id: uid(), at: new Date(($('#coD').value || ymd(Date.now())) + 'T12:00:00').getTime(), name: $('#coN').value.trim(), eur: e }]); save(v); });
  }
  function logSheet(v) {
    var rows = (v.fuel || []).map(function (x) { return { at: x.at, id: x.id, k: 'fuel', t: 'Repostaje · ' + n1(x.l) + ' l' + (x.full ? '' : ' (parcial)'), s: (x.odo ? x.odo + ' km · ' : '') + (x.l ? (x.eur / x.l).toFixed(3) + ' €/l' : ''), e: x.eur }; }).concat((v.costs || []).map(function (x) { return { at: x.at, id: x.id, k: 'costs', t: x.name, s: '', e: x.eur }; })).sort(function (a, b) { return b.at - a.at; });
    var st = stats(v), s = Cl.sheet(head('Repostajes y gastos') + '<p style="margin:0;text-align:left"><b>' + esc(v.name) + '</b><br><span class="muted">' + (st.l100 != null ? 'Consumo medio ' + n1(st.l100) + ' l/100 km · ' + n1(st.e100) + ' €/100 km' : 'Hacen falta dos repostajes a tope con el odómetro para calcular el consumo.') + '</span></p>' +
      '<div class="rd-list">' + rows.map(function (r) { return '<div class="gx-log"><span><b>' + esc(r.t) + '</b><small>' + new Date(r.at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) + (r.s ? ' · ' + esc(String(r.s).replace('.', ',')) : '') + '</small></span><b>' + eur(r.e) + '</b><button class="btn small icon" data-del="' + r.k + ':' + r.id + '" type="button" title="Borrar">' + ic('trash') + '</button></div>'; }).join('') + '</div>');
    $('#gxX', s).addEventListener('click', Cl.closeSheet);
    $$('[data-del]', s).forEach(function (b) { b.addEventListener('click', function () { var a = b.dataset.del.split(':'); v[a[0]] = (v[a[0]] || []).filter(function (x) { return x.id !== a[1]; }); A.saveVehicle(v).then(function () { logSheet(v); }); }); });
  }
  function rangeForm(v) {
    var s = Cl.sheet(head('Autonomía') + '<form class="rg-form" id="raF"><label>Kilómetros con un depósito<input id="raN" type="number" min="40" max="900" step="5" inputmode="numeric" value="' + (v.range || '') + '" placeholder="Por ejemplo, 280"></label><p class="muted rg-small" style="text-align:left">Rodando, cuando lleves tres cuartos de esa distancia desde el último repostaje apuntado, la app te avisa y te dice la gasolinera más barata que tienes cerca.</p><button class="btn big primary" type="submit">Guardar</button></form>');
    $('#gxX', s).addEventListener('click', Cl.closeSheet);
    $('#raF', s).addEventListener('submit', function (ev) { ev.preventDefault(); var n = parseInt($('#raN').value, 10); v.range = n >= 40 ? n : null; save(v); });
  }

  /* ---------- moto robada ---------- */
  function stolenForm(v) {
    if (!sb || !Cl.user()) { Cl.openAuth(false); return; }
    var f = A.anyFix && A.anyFix(), photo = null;
    var s = Cl.sheet(head('Moto robada') + '<p class="muted" style="margin:0;text-align:left">La ficha llega a la gente de tus comunidades y a los moteros de la zona. Denúncialo también a la policía: la app no sustituye a la denuncia.</p>' +
      '<form class="rg-form" id="stF"><label>Moto<input id="stB" required minlength="2" maxlength="80" value="' + esc([v.make, v.model].filter(Boolean).join(' ') || v.name || '') + '"></label><div class="tr-two"><label>Matrícula<input id="stP" maxlength="12" autocapitalize="characters" placeholder="1234 ABC"></label><label>Color<input id="stC" maxlength="30"></label></div>' +
      '<label>Dónde y cuándo ha sido<input id="stZ" required minlength="2" maxlength="80" placeholder="Teulada, anoche en la calle Mayor"></label><label>Algo que la distinga<input id="stN" maxlength="300" placeholder="Escape, pegatinas, golpes…"></label>' +
      '<label>Teléfono para avisarte<input id="stT" type="tel" maxlength="20" value="' + esc((Cl.ridePhone && Cl.ridePhone()) || '') + '"></label>' +
      '<div class="gx-photo" id="stPh"></div><button class="btn" id="stPick" type="button">' + ic('camera') + 'Añadir una foto de la moto</button><button class="btn big primary" type="submit">Enviar el aviso</button></form>');
    $('#gxX', s).addEventListener('click', Cl.closeSheet);
    $('#stPick', s).addEventListener('click', function () { if (window.RGShell) RGShell.pickPhoto(1400).then(function (b) { if (!b) return; photo = b; $('#stPh').innerHTML = '<img alt="" src="' + URL.createObjectURL(b) + '">'; }); });
    $('#stF', s).addEventListener('submit', function (ev) {
      ev.preventDefault();
      Cl.busy(ev.submitter || $('#stF button[type=submit]'), function () {
        return (photo ? RGShell.upload(photo, 'robo') : Promise.resolve(null)).then(function (url) {
          return sb.rpc('stolen_report', { p_bike: $('#stB').value, p_plate: $('#stP').value, p_color: $('#stC').value, p_zone: $('#stZ').value, p_lat: f ? f.lat : null, p_lon: f ? f.lon : null, p_note: $('#stN').value, p_photo: url, p_phone: $('#stT').value });
        }).then(function (r) { if (r.error) throw r.error; A.toast('Aviso enviado a tus comunidades y a los moteros de la zona.', 'ok'); stolenList(); });
      }).catch(function (e) { A.toast(Cl.msg(e), 'warn'); });
    });
  }
  function stolenList() {
    if (!sb || !Cl.user()) { Cl.openAuth(false); return; }
    var f = A.anyFix && A.anyFix(), s = Cl.sheet(head('Motos robadas') + '<p class="muted" style="margin:0;text-align:left">Avisos de moteros de tus comunidades y de tu zona. Si ves una, llama a su dueño o a la policía; no te la juegues.</p><button class="btn primary" id="stAdd" type="button">' + ic('warn') + 'Avisar de que me han robado la moto</button><div class="rd-list" id="stL"><div class="empty">Cargando…</div></div>');
    $('#stAdd', s).addEventListener('click', stolenNew);
    $('#gxX', s).addEventListener('click', Cl.closeSheet);
    sb.rpc('stolen_near', { p_lat: f ? f.lat : null, p_lon: f ? f.lon : null }).then(function (r) {
      var el = $('#stL'); if (!el) return; var rows = r.error ? [] : (r.data || []);
      el.innerHTML = rows.length ? rows.map(function (x) {
        return '<div class="club-card st-card">' + (x.photo_url ? '<img alt="" loading="lazy" src="' + esc(x.photo_url) + '">' : '') + '<b>' + esc(x.bike) + '</b><span class="muted">' + esc([x.color, x.plate].filter(Boolean).join(' · ')) + '</span><span>' + esc(x.zone) + (x.km != null ? ' · a ' + x.km + ' km' : '') + '</span>' + (x.note ? '<span class="muted">' + esc(x.note) + '</span>' : '') +
          '<span class="muted rg-small" style="text-align:left">Avisado por ' + esc(x.name) + ' el ' + new Date(x.at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) + '</span><div class="rg-row">' + (x.mine ? '<button class="btn" data-found="' + x.id + '" type="button">' + ic('check') + 'Ya ha aparecido</button>' : (x.phone ? '<a class="btn primary" href="tel:' + esc(x.phone) + '">' + ic('phone') + 'Llamar a ' + esc(x.name) + '</a>' : '')) + '</div></div>';
      }).join('') : '<div class="empty">No hay avisos de motos robadas cerca. Ojalá siga así.</div>';
      $$('[data-found]', el).forEach(function (b) { b.addEventListener('click', function () { sb.from('stolen_bikes').update({ found_at: new Date().toISOString() }).eq('id', b.dataset.found).then(function () { stolenList(); }); }); });
      $$('.st-card img', el).forEach(function (im) { im.addEventListener('click', function () { var lb = $('#lightbox'), li = $('#lightboxImg'); if (lb && li) { li.src = im.src; lb.hidden = false; } }); });
    }, function () { var el = $('#stL'); if (el) el.innerHTML = '<div class="empty">No se ha podido cargar.</div>'; });
  }
  // a la vista en el garaje: ver los avisos de la zona o avisar de un robo
  var gs = $('#garageSummary');
  if (gs) { var st = document.createElement('div'); st.className = 'st-bar'; st.innerHTML = '<span>' + ic('warn') + '<span><b>Motos robadas</b><small>Avisos de tu zona y de tus comunidades</small></span></span><div><button class="btn small" id="stSee" type="button">Ver avisos</button><button class="btn small danger" id="stNew" type="button">Me la han robado</button></div>'; gs.parentNode.insertBefore(st, gs.nextSibling); st.querySelector('#stSee').addEventListener('click', stolenList); st.querySelector('#stNew').addEventListener('click', stolenNew); }
  function stolenNew() {
    var vs = (A.vehicles() || []).filter(function (v) { return v.type !== 'coche'; });
    if (vs.length <= 1) { stolenForm(vs[0] || {}); return; }
    var s = Cl.sheet(head('¿Qué moto te han robado?') + vs.map(function (v, i) { return '<button class="club-card rg-pick" type="button" data-v="' + i + '">' + ic('bike') + '<span><b>' + esc(v.name || 'Moto') + '</b><span class="muted">' + esc([v.make, v.model].filter(Boolean).join(' ')) + '</span></span></button>'; }).join(''));
    $('#gxX', s).addEventListener('click', Cl.closeSheet); $$('[data-v]', s).forEach(function (b) { b.addEventListener('click', function () { stolenForm(vs[+b.dataset.v]); }); });
  }
  window.RGGarage = { stolen: stolenList, paint: paint };
})();
