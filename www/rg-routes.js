/* ReGroupRide — rutas con curvas y vuelta circular.
   · «Evitar autovías» en el planificador: el trazado busca carreteras secundarias.
   · Generar ruta: «una vuelta de 150 km» desde donde estás, hacia donde elijas; distinta cada vez y sin barcos.
   Si en Supabase está la clave de GraphHopper (función «route»), la vuelta la calcula él; si no, se monta con
   puntos de paso en círculo y el trazado de siempre. */
(function () {
  'use strict';
  var A = window.RGApp, Cl = window.RGCloud; if (!A || !Cl) return;
  var sb = Cl.sb, $ = function (s, r) { return (r || document).querySelector(s); }, $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function ic(n) { return '<svg><use href="#i-' + n + '"/></svg>'; }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; }

  // planificador: evitar autovías
  var cb = $('#planNoHw');
  if (cb && A.routeOpt) { cb.checked = !!A.routeOpt.noHighway; cb.addEventListener('change', function () { A.routeOpt.noHighway = cb.checked; store('rg.route.nohw', cb.checked ? 'true' : 'false'); A.replan(); }); }

  /* ---------- vuelta circular ---------- */
  var O = { km: 150, dir: -1, nohw: true, seed: 1 }, ghOff = false;
  function dest(lat, lon, brg, m) { var R = 6371000, d = m / R, b = brg * Math.PI / 180, la = lat * Math.PI / 180, lo = lon * Math.PI / 180, la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b)), lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2)); return [la2 * 180 / Math.PI, lo2 * 180 / Math.PI]; }
  // Carreteras ya usadas: celdas de unos 400 m de las rutas que tengo guardadas y de las propuestas anteriores.
  function cell(c) { return Math.round(c[1] / 0.004) + ',' + Math.round(c[0] / 0.004); }
  function usedCells() { var u = {}; try { (JSON.parse(store('rg.loop.cells') || '[]')).forEach(function (k) { u[k] = 1; }); } catch (e) {} (A.plans() || []).forEach(function (p) { (p.coords || []).forEach(function (c) { u[cell(c)] = 1; }); }); return u; }
  function remember(coords) { var a = []; try { a = JSON.parse(store('rg.loop.cells') || '[]'); } catch (e) {} var seen = {}; a.forEach(function (k) { seen[k] = 1; }); coords.forEach(function (c) { var k = cell(c); if (!seen[k]) { seen[k] = 1; a.push(k); } }); store('rg.loop.cells', JSON.stringify(a.slice(-9000))); }
  function overlap(coords, used, f) { var n = 0, hit = 0, seen = {}; coords.forEach(function (c) { var k = cell(c); if (seen[k]) return; seen[k] = 1; if (Math.abs(c[1] - f.lat) < 0.02 && Math.abs(c[0] - f.lon) < 0.027) return; n++; if (used[k]) hit++; }); return n ? hit / n : 0; }      // lo de al lado de casa no cuenta: se repite siempre
  // Una forma distinta cada vez: rumbo, sentido de giro, número de puntos y lo «redonda» que es cambian al azar.
  function shape(f, km, brg, k) {
    var n = 3 + Math.floor(Math.random() * 3), cw = Math.random() < 0.5 ? 1 : -1, r = km * 1000 / (2 * Math.PI) / k, c = dest(f.lat, f.lon, brg, r), back = (brg + 180) % 360, pts = [[f.lat, f.lon, 'Salida']];
    for (var i = 1; i <= n; i++) { var p = dest(c[0], c[1], (back + cw * 360 * i / (n + 1) + 360) % 360, r * (0.7 + Math.random() * 0.6)); pts.push([p[0], p[1], '']); }
    pts.push([f.lat, f.lon, 'Llegada']); return pts;
  }
  function one(f, km, brg) {
    var attempt = function (k, n) {
      var wps = shape(f, km, brg, k);
      return A.routeBetween(wps, { noFerry: true }).then(function (r) {
        if (!r.routed) throw new Error('offline');
        if (r.ferry) return null;                                             // habría que coger un barco: no vale
        var off = r.dist / km; if (n < 2 && (off > 1.25 || off < 0.75)) return attempt(k * off, n + 1);
        r.wps = wps; return r;
      });
    };
    return attempt(1.35, 1);
  }
  // Se prueban varias y se queda la mejor: sin barcos, cerca de los km pedidos, por carreteras que no he hecho y sin cortes ni peligros avisados.
  function own(f, km, dir) {
    var keep = A.routeOpt.noHighway; A.routeOpt.noHighway = O.nohw;
    var used = usedCells(), found = [], tries = 0, offline = false;
    var next = function () {
      if (found.length >= 3 || tries >= 6 || offline) return Promise.resolve();
      tries++; var brg = dir >= 0 ? (dir + (Math.random() * 80 - 40) + 360) % 360 : Math.random() * 360;
      return one(f, km, brg).then(function (r) { if (r) found.push(r); }, function (e) { if (e && e.message === 'offline') offline = true; }).then(next);
    };
    return next().then(function () {
      A.routeOpt.noHighway = keep;
      if (!found.length) throw new Error(offline ? 'No hay conexión para generar la ruta.' : 'No he encontrado una ruta por carretera con esa distancia desde aquí (habría que coger un barco). Prueba con menos kilómetros o hacia otro lado.');
      found.forEach(function (r) { r.score = Math.abs(r.dist - km) / km * 2 + overlap(r.coords, used, f) * 1.5 + (window.RGRoad && RGRoad.badOn ? RGRoad.badOn(r.coords) * 0.6 : 0); });
      found.sort(function (a, b) { return a.score - b.score; }); remember(found[0].coords); return found[0];
    }, function (e) { A.routeOpt.noHighway = keep; throw e; });
  }
  function viaGh(f, km) {
    if (ghOff || !sb || !sb.functions) return Promise.resolve(null);
    return sb.functions.invoke('route', { body: { kind: 'loop', lat: f.lat, lon: f.lon, km: km, seed: O.seed } }).then(function (r) {
      var d = r && r.data; if (!d || !d.ok) { if (!d || d.reason === 'no-key' || (r && r.error)) ghOff = true; return null; }
      // el trazado de GraphHopper se pasa por el de la app con puntos de paso cada pocos km, para tener los giros por voz
      var c = d.coords, n = Math.min(22, Math.max(6, Math.round(d.dist / 8))), wps = []; for (var i = 0; i <= n; i++) { var p = c[Math.min(c.length - 1, Math.round(i * (c.length - 1) / n))]; wps.push([p[1], p[0], i === 0 ? 'Salida' : i === n ? 'Llegada' : '']); }
      return A.routeBetween(wps, { noFerry: true }).then(function (x) { if (!x.routed) return { coords: c, dist: d.dist, dur: d.dur, routed: true, steps: [], wps: [wps[0], wps[wps.length - 1]] }; if (x.ferry) return null; x.wps = wps; remember(x.coords); return x; });
    }, function () { ghOff = true; return null; });
  }
  function open() {
    var f = A.anyFix && A.anyFix(), dirs = [[-1, 'Da igual'], [0, 'Norte'], [90, 'Este'], [180, 'Sur'], [270, 'Oeste']];
    var s = Cl.sheet('<div class="head"><h1>Generar ruta</h1><button class="btn small icon" id="lpX" type="button" title="Cerrar">' + ic('close') + '</button></div>' +
      '<p class="muted" style="margin:0;text-align:left">Di cuántos kilómetros quieres hacer y la app te propone una ruta que sale de donde estás y vuelve al mismo sitio. Cada vez busca carreteras distintas, sin barcos y evitando los cortes y peligros avisados.</p>' +
      '<span class="label">Distancia</span><div class="pills" id="lpKm">' + [60, 100, 150, 200, 300].map(function (k) { return '<button class="pill" type="button" data-k="' + k + '" aria-pressed="' + (k === O.km) + '">' + k + ' km</button>'; }).join('') + '</div>' +
      '<span class="label">Hacia dónde</span><div class="pills" id="lpDir">' + dirs.map(function (d) { return '<button class="pill" type="button" data-d="' + d[0] + '" aria-pressed="' + (d[0] === O.dir) + '">' + d[1] + '</button>'; }).join('') + '</div>' +
      '<label class="rg-check"><input type="checkbox" id="lpHw"' + (O.nohw ? ' checked' : '') + '><span><b>Evitar autovías</b><small>Carreteras secundarias, con más curvas.</small></span></label>' +
      '<button class="btn big primary" id="lpGo" type="button"' + (f ? '' : ' disabled') + '>' + ic('route') + 'Generar ruta</button>' + (f ? '' : '<p class="muted rg-small">Hace falta tu ubicación. Abre el mapa y espera a que te sitúe.</p>') +
      '<p class="muted rg-small" style="text-align:left">Es una propuesta: mírala en el mapa antes de salir y, si no te convence, genera otra. Al guardarla queda en tus rutas. La app no sabe cómo está el asfalto: solo evita lo que haya avisado la DGT u otros moteros.</p>');
    $('#lpX', s).addEventListener('click', Cl.closeSheet);
    $$('#lpKm button', s).forEach(function (b) { b.addEventListener('click', function () { O.km = +b.dataset.k; $$('#lpKm button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); }); });
    $$('#lpDir button', s).forEach(function (b) { b.addEventListener('click', function () { O.dir = +b.dataset.d; $$('#lpDir button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); }); });
    $('#lpHw', s).addEventListener('change', function (e) { O.nohw = e.target.checked; });
    $('#lpGo', s).addEventListener('click', function (ev) {
      O.seed++;
      Cl.busy(ev.currentTarget, function () {
        return (O.dir < 0 ? viaGh(f, O.km) : Promise.resolve(null)).then(function (r) { return r || own(f, O.km, O.dir); }).then(function (r) {
          Cl.closeSheet();
          A.previewPlan({ id: Date.now(), name: 'Ruta de ' + Math.round(r.dist) + ' km', wps: r.wps, pois: [], coords: r.coords, dist: Math.round(r.dist * 10) / 10, dur: r.dur, routed: true, steps: r.steps || [], created: Date.now() });
        });
      }).catch(function (e) { A.toast(e.message || 'No se ha podido generar la ruta.', 'warn'); });
    });
  }
  var row = $('#exRow');
  if (row) { var b = document.createElement('button'); b.className = 'btn'; b.type = 'button'; b.id = 'exLoop'; b.innerHTML = ic('compass') + 'Generar ruta'; row.insertBefore(b, row.firstChild); b.addEventListener('click', open); }
  window.RGRoutes = { loop: open };
})();
