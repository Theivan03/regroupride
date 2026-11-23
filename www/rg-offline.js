/* ReGroupRide — mapas sin conexión. Se descarga el mapa de la zona de una ruta (teselas de OpenFreeMap) y se guarda
   en el teléfono; a partir de ahí el mapa mira primero lo guardado y, si no lo tiene, lo pide a la red.
   Mientras no se haya descargado nada, el mapa funciona exactamente igual que antes (no pasa por aquí). */
(function () {
  'use strict';
  var HOST = 'https://tiles.openfreemap.org/', ON = false; try { ON = localStorage.getItem('rg.offline') === '1'; } catch (e) {}
  var dbp = null;
  function db() { if (!dbp) dbp = new Promise(function (res, rej) { var r = indexedDB.open('rg-tiles', 1); r.onupgradeneeded = function () { r.result.createObjectStore('t'); }; r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); return dbp; }
  function get(k) { return db().then(function (d) { return new Promise(function (res) { var q = d.transaction('t').objectStore('t').get(k); q.onsuccess = function () { res(q.result == null ? null : q.result); }; q.onerror = function () { res(null); }; }); }).catch(function () { return null; }); }
  function put(k, v) { return db().then(function (d) { return new Promise(function (res) { var t = d.transaction('t', 'readwrite'); t.objectStore('t').put(v, k); t.oncomplete = function () { res(true); }; t.onerror = t.onabort = function () { res(false); }; }); }).catch(function () { return false; }); }
  function wipe() { return db().then(function (d) { return new Promise(function (res) { var t = d.transaction('t', 'readwrite'); t.objectStore('t').clear(); t.oncomplete = res; t.onerror = res; }); }).catch(function () {}); }
  function count() { return db().then(function (d) { return new Promise(function (res) { var q = d.transaction('t').objectStore('t').count(); q.onsuccess = function () { res(q.result || 0); }; q.onerror = function () { res(0); }; }); }).catch(function () { return 0; }); }
  function net(url, json, signal, ms) {
    var opt = signal ? { signal: signal } : {}, p = fetch(url, opt).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return json ? r.text() : r.arrayBuffer(); });
    return ms ? Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('lento')); }, ms); })]) : p;
  }
  // lo que el mapa pide a OpenFreeMap pasa por aquí solo si hay mapas descargados
  function transform(url) { if (ON && url.indexOf(HOST) === 0) return { url: 'rgt://' + url.slice(8) }; return undefined; }
  if (window.maplibregl && maplibregl.addProtocol) {
    maplibregl.addProtocol('rgt', function (params, ac) {
      var url = 'https://' + params.url.slice(6), json = params.type === 'json', signal = ac && ac.signal;
      if (json) return net(url, true, signal, 5000).then(function (t) { put(url, t); return { data: JSON.parse(t) }; }, function (e) { return get(url).then(function (t) { if (t == null) throw e; return { data: JSON.parse(t) }; }); });   // la descripción del mapa: la de la red si hay; si no, la guardada
      return get(url).then(function (hit) {
        if (hit != null) return { data: hit };
        return net(url, false, signal).then(function (buf) { if (url.indexOf(HOST + 'fonts/') === 0) put(url, buf); return { data: buf }; });
      });
    });
  }
  window.RGOffline = { transform: transform };

  /* ---------- descarga ---------- */
  function tx(lon, z) { return Math.floor((lon + 180) / 360 * Math.pow(2, z)); }
  function ty(lat, z) { var r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z)); }
  function tilesFor(coords) {
    var set = {}, out = [], add = function (z, x, y) { var n = Math.pow(2, z); if (y < 0 || y >= n) return; x = (x % n + n) % n; var k = z + '/' + x + '/' + y; if (!set[k]) { set[k] = 1; out.push(k); } };
    for (var z = 5; z <= 14; z++) {
      var ring = z <= 12 ? 1 : 0, step = Math.max(1, Math.floor(coords.length / 4000));
      for (var i = 0; i < coords.length; i += step) { var x = tx(coords[i][0], z), y = ty(coords[i][1], z); for (var dx = -ring; dx <= ring; dx++) for (var dy = -ring; dy <= ring; dy++) add(z, x + dx, y + dy); }
    }
    return out;
  }
  var busy = null;
  function download(plan, onProg) {
    if (busy) return Promise.reject(new Error('Ya hay una descarga en marcha.'));
    var list = tilesFor(plan.coords), done = 0, fail = 0, bytes = 0, stop = false; busy = { stop: function () { stop = true; } };
    var end = function (x) { busy = null; return x; };
    return net(HOST + 'planet', true, null, 15000).then(function (t) {
      put(HOST + 'planet', t); var tpl = (JSON.parse(t).tiles || [])[0]; if (!tpl) throw new Error('No se ha podido leer el mapa.');
      var next = 0, worker = function () {
        if (stop || next >= list.length) return Promise.resolve();
        var k = list[next++].split('/'), url = tpl.replace('{z}', k[0]).replace('{x}', k[1]).replace('{y}', k[2]);
        return get(url).then(function (hit) { if (hit != null) return hit; return net(url, false, null, 20000).then(function (buf) { return put(url, buf).then(function (ok) { if (!ok) throw new Error('sin espacio'); return buf; }); }); })
          .then(function (buf) { bytes += buf.byteLength || 0; }, function () { fail++; }).then(function () { done++; if (onProg) onProg(done, list.length); return worker(); });
      };
      return Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
    }).then(function () {
      if (stop) return end({ stopped: true });
      if (fail > list.length * 0.2) throw new Error('Han fallado demasiadas partes del mapa. Revisa la conexión y el espacio libre, y vuelve a intentarlo.');
      ON = true; try { localStorage.setItem('rg.offline', '1'); var a = JSON.parse(localStorage.getItem('rg.offline.areas') || '[]').filter(function (x) { return String(x.id) !== String(plan.id); }); a.unshift({ id: plan.id, name: plan.name || 'Ruta', n: list.length, mb: Math.round(bytes / 104857.6) / 10, at: Date.now() }); localStorage.setItem('rg.offline.areas', JSON.stringify(a.slice(0, 30))); } catch (e) {}
      return end({ n: list.length, fail: fail });
    }, function (e) { end(); throw e; });
  }
  function areas() { try { return JSON.parse(localStorage.getItem('rg.offline.areas') || '[]'); } catch (e) { return []; } }
  function clear() { ON = false; try { localStorage.removeItem('rg.offline'); localStorage.removeItem('rg.offline.areas'); } catch (e) {} return wipe(); }
  window.RGOffline.estimate = function (plan) { return tilesFor(plan.coords).length; };
  window.RGOffline.download = download; window.RGOffline.areas = areas; window.RGOffline.clear = clear; window.RGOffline.count = count; window.RGOffline.stop = function () { if (busy) busy.stop(); };

  /* ---------- pantalla (cuando la app ya ha cargado) ---------- */
  window.addEventListener('load', function () {
    var A = window.RGApp, Cl = window.RGCloud; if (!A || !Cl) return;
    var $ = function (s, r) { return (r || document).querySelector(s); }, $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
    function ic(n) { return '<svg><use href="#i-' + n + '"/></svg>'; }
    function open() {
      var plans = (A.plans() || []).filter(function (p) { return p.coords && p.coords.length > 1; }), ar = areas(), got = {}; ar.forEach(function (x) { got[String(x.id)] = x; });
      var act = A.activePlan && A.activePlan(); if (act) plans = [act].concat(plans.filter(function (p) { return p.id !== act.id; }));
      var s = Cl.sheet('<div class="head"><h1>Mapas sin conexión</h1><button class="btn small icon" id="ofX" type="button" title="Cerrar">' + ic('close') + '</button></div>' +
        '<p class="muted" style="margin:0;text-align:left">Descarga el mapa de la zona de una ruta para verlo aunque te quedes sin cobertura. Hazlo con wifi: una ruta de 150 km ocupa entre 15 y 40 MB.</p>' +
        '<div class="rd-list" id="ofL">' + (plans.length ? plans.slice(0, 30).map(function (p, i) { var g = got[String(p.id)]; return '<div class="gx-log of-row"><span><b>' + esc(p.name || 'Ruta') + '</b><small>' + String(Math.round((p.dist || 0) * 10) / 10).replace('.', ',') + ' km' + (g ? ' · descargado (' + String(g.mb).replace('.', ',') + ' MB)' : '') + '</small></span><button class="btn small' + (g ? '' : ' primary') + '" data-dl="' + i + '" type="button">' + ic('download') + (g ? 'Actualizar' : 'Descargar') + '</button></div>'; }).join('') : '<div class="empty">Guarda antes una ruta (planificada, importada o de una salida) y aquí podrás descargar su mapa.</div>') + '</div>' +
        '<div id="ofP" hidden><span class="bar3"><i id="ofBar" style="width:0%"></i></span><span class="muted rg-small" id="ofT"></span><button class="btn small" id="ofStop" type="button">Parar</button></div>' +
        (ar.length ? '<button class="link danger" id="ofClear" type="button">Borrar todos los mapas descargados</button>' : '') +
        '<p class="muted rg-small" style="text-align:left">Sin conexión sigues viendo el mapa y el trazado de la ruta. Recalcular el camino, el tiempo y los avisos sí necesitan cobertura.</p>');
      $('#ofX', s).addEventListener('click', Cl.closeSheet);
      if ($('#ofClear', s)) $('#ofClear', s).addEventListener('click', function () { clear().then(open); });
      $('#ofStop', s).addEventListener('click', function () { RGOffline.stop(); });
      $$('[data-dl]', s).forEach(function (b) { b.addEventListener('click', function () {
        var p = plans[+b.dataset.dl], box = $('#ofP'); box.hidden = false; $$('[data-dl]').forEach(function (x) { x.disabled = true; });
        download(p, function (d, n) { var bar = $('#ofBar'), t = $('#ofT'); if (bar) bar.style.width = Math.round(d / n * 100) + '%'; if (t) t.textContent = d + ' de ' + n + ' partes del mapa'; }).then(function (r) {
          if (!$('#ofP')) return; if (r && r.stopped) { open(); return; } A.toast('Aviso: mapa de «' + (p.name || 'la ruta') + '» descargado. Cierra y abre la app para que el mapa lo use.', 'ok'); open();
        }, function (e) { A.toast(e.message || 'No se ha podido descargar.', 'warn'); if ($('#ofP')) open(); });
      }); });
    }
    var row = $('#exRow');
    if (row) { var b = document.createElement('button'); b.className = 'btn'; b.type = 'button'; b.id = 'exOffline'; b.innerHTML = ic('download') + 'Mapas sin conexión'; row.appendChild(b); b.addEventListener('click', open); }
    window.RGOffline.open = open;
  });
})();
