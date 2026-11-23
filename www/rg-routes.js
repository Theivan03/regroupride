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
  var O = { km: 150, dir: -1, nohw: true, seed: 1, stops: store('rg.loop.stops') !== '0' }, ghOff = false;
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
  function m2(a, b) { var x = (b[0] - a[0]) * Math.PI / 180 * Math.cos((a[1] + b[1]) * Math.PI / 360), y = (b[1] - a[1]) * Math.PI / 180; return Math.sqrt(x * x + y * y) * 6371000; }
  // Ida y vuelta por la misma carretera hasta un punto de paso (pasa cuando el punto cae en un ramal): se mide cuánto
  // se repite a cada lado del punto y, si es más de 250 m, el punto se lleva al cruce donde empieza la repetición.
  function fixSpurs(r, wps) {
    var c = r.coords, cum = [0], i; for (i = 1; i < c.length; i++) cum.push(cum[i - 1] + m2(c[i - 1], c[i]));
    var at = function (d) { if (d <= 0) return c[0]; if (d >= cum[cum.length - 1]) return c[c.length - 1]; var lo = 0, hi = cum.length - 1; while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; } var t = (d - cum[lo]) / Math.max(1e-6, cum[hi] - cum[lo]); return [c[lo][0] + (c[hi][0] - c[lo][0]) * t, c[lo][1] + (c[hi][1] - c[lo][1]) * t]; };
    var out = wps.slice(), changed = 0, from = 0, wasted = 0;
    for (var w = 1; w < wps.length - 1; w++) {
      var best = from, bd = 1e12; for (i = from; i < c.length; i++) { var d = m2(c[i], [wps[w][1], wps[w][0]]); if (d < bd) { bd = d; best = i; } } from = best;
      var k = cum[best], spur = 0; for (var s = 50; s <= 30000; s += 50) { if (k - s < 0 || k + s > cum[cum.length - 1]) break; if (m2(at(k - s), at(k + s)) > 45) break; spur = s; }
      if (spur >= 250) { var p = at(k - spur); out[w] = [p[1], p[0], '']; changed++; wasted += spur * 2; }
    }
    return { wps: out, changed: changed, wasted: wasted };
  }
  // kilómetros que se hacen dos veces en cualquier parte de la ruta (sin contar la salida de casa)
  function repeated(coords, f) { var seen = {}, rep = 0, n = 0, last = null; coords.forEach(function (c) { var k = cell(c); if (k === last) return; last = k; if (Math.abs(c[1] - f.lat) < 0.012 && Math.abs(c[0] - f.lon) < 0.016) return; n++; if (seen[k]) rep++; seen[k] = 1; }); return n ? rep / n : 0; }
  function one(f, km, brg) {
    var attempt = function (k, n) {
      var wps = shape(f, km, brg, k);
      return A.routeBetween(wps, { noFerry: true }).then(function (r) {
        if (!r.routed) throw new Error('offline');
        if (r.ferry) return null;                                             // habría que coger un barco: no vale
        var off = r.dist / km; if (n < 2 && (off > 1.25 || off < 0.75)) return attempt(k * off, n + 1);
        r.wps = wps; return clean(r, 0);
      });
    };
    var clean = function (r, n) {
      var fx = fixSpurs(r, r.wps); if (!fx.changed || n >= 2) return r;
      return A.routeBetween(fx.wps, { noFerry: true }).then(function (x) { if (!x.routed || x.ferry) return r; x.wps = fx.wps; return clean(x, n + 1); }, function () { return r; });
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
      found.forEach(function (r) { r.score = repeated(r.coords, f) * 6 + Math.abs(r.dist - km) / km * 2 + overlap(r.coords, used, f) * 1.5 + (window.RGRoad && RGRoad.badOn ? RGRoad.badOn(r.coords) * 0.6 : 0); });
      found.sort(function (a, b) { return a.score - b.score; }); remember(found[0].coords); return found[0];
    }, function (e) { A.routeOpt.noHighway = keep; throw e; });
  }
  /* ---------- paradas con nombre: miradores y bares junto al trazado, y el pueblo por el que pasa cada punto ---------- */
  function lineDist(lat, lon, c) { var best = 1e12, step = Math.max(1, Math.floor(c.length / 1500)); for (var i = 0; i < c.length; i += step) { var d = m2([lon, lat], c[i]); if (d < best) best = d; } return best; }
  function alongIdx(lat, lon, c) { var best = 0, bd = 1e12; for (var i = 0; i < c.length; i += 3) { var d = m2([lon, lat], c[i]); if (d < bd) { bd = d; best = i; } } return best; }
  function stops(r, wantStops) {
    var c = r.coords, a = 90, b = 180, cc = -90, d = -180; c.forEach(function (p) { if (p[1] < a) a = p[1]; if (p[1] > cc) cc = p[1]; if (p[0] < b) b = p[0]; if (p[0] > d) d = p[0]; });
    var box = '(' + (a - 0.01).toFixed(4) + ',' + (b - 0.01).toFixed(4) + ',' + (cc + 0.01).toFixed(4) + ',' + (d + 0.01).toFixed(4) + ')';
    var q = '[out:json][timeout:12];(node[place~"^(town|village|city)$"][name]' + box + ';' + (wantStops ? 'node[tourism=viewpoint]' + box + ';node[amenity~"^(cafe|bar|restaurant|pub)$"][name]' + box + ';' : '') + ');out body 3000;';
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null; if (ctrl) setTimeout(function () { ctrl.abort(); }, 14000);
    var osm = fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctrl ? ctrl.signal : undefined }).then(function (x) { return x.json(); }).then(function (j) { return j.elements || []; }).catch(function () { return []; });
    var mine = wantStops && sb && Cl.user() ? sb.rpc('places_near', { p_lat: (a + cc) / 2, p_lon: (b + d) / 2, p_km: 150 }).then(function (x) { return x.error ? [] : (x.data || []); }, function () { return []; }) : Promise.resolve([]);
    return Promise.all([osm, mine]).then(function (res) {
      var els = res[0], towns = els.filter(function (e) { return e.tags && e.tags.place; });
      // cada punto de paso sin nombre toma el del pueblo más cercano (a menos de 4 km)
      r.wps = r.wps.map(function (w, i) { if (w[2] || i === 0 || i === r.wps.length - 1) return w; var best = null, bd = 4000; towns.forEach(function (t) { var dd = m2([w[1], w[0]], [t.lon, t.lat]); if (dd < bd) { bd = dd; best = t; } }); return best ? [w[0], w[1], 'Paso por ' + best.tags.name] : w; });
      if (!wantStops) return r;
      var cand = [];
      res[1].forEach(function (p) { if ((p.kind === 'bar' || p.kind === 'mirador') && lineDist(p.lat, p.lon, c) <= 300) cand.push({ lat: p.lat, lon: p.lon, name: p.name + ' · recomendado por ' + p.community, type: p.kind === 'bar' ? 'food' : 'view', w: 3 }); });
      els.forEach(function (e) { var t = e.tags || {}; if (t.place) return; var view = t.tourism === 'viewpoint'; if (lineDist(e.lat, e.lon, c) > (view ? 150 : 90)) return; cand.push({ lat: e.lat, lon: e.lon, name: t.name || 'Mirador', type: view ? 'view' : 'food', w: view ? (t.name ? 2 : 1) : 1 }); });
      cand.forEach(function (x) { x.i = alongIdx(x.lat, x.lon, c); });
      // repartidas: como mucho una parada por cada quinto de la ruta, sin contar el principio ni el final
      var pois = [], used = {}; [1, 2, 3].forEach(function (s5) { ['view', 'food'].forEach(function (ty) { var lo = c.length * s5 / 5, hi = c.length * (s5 + 1) / 5, pick = cand.filter(function (x) { return x.type === ty && x.i >= lo && x.i < hi && !used[x.name]; }).sort(function (p1, p2) { return p2.w - p1.w; })[0]; if (pick && pois.length < 5 && (ty === 'view' || s5 === 2)) { used[pick.name] = 1; pois.push([pick.lat, pick.lon, pick.name.slice(0, 60), pick.type]); } }); });
      r.pois = pois; return r;
    }).catch(function () { return r; });
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
      '<label class="rg-check"><input type="checkbox" id="lpSt"' + (O.stops ? ' checked' : '') + '><span><b>Proponer paradas</b><small>Miradores y bares que quedan en el camino, con su nombre en el mapa.</small></span></label>' +
      '<button class="btn big primary" id="lpGo" type="button"' + (f ? '' : ' disabled') + '>' + ic('route') + 'Generar ruta</button>' + (f ? '' : '<p class="muted rg-small">Hace falta tu ubicación. Abre el mapa y espera a que te sitúe.</p>') +
      '<p class="muted rg-small" style="text-align:left">Es una propuesta: mírala en el mapa antes de salir y, si no te convence, genera otra. Al guardarla queda en tus rutas. La app no sabe cómo está el asfalto: solo evita lo que haya avisado la DGT u otros moteros.</p>');
    $('#lpX', s).addEventListener('click', Cl.closeSheet);
    $$('#lpKm button', s).forEach(function (b) { b.addEventListener('click', function () { O.km = +b.dataset.k; $$('#lpKm button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); }); });
    $$('#lpDir button', s).forEach(function (b) { b.addEventListener('click', function () { O.dir = +b.dataset.d; $$('#lpDir button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); }); });
    $('#lpHw', s).addEventListener('change', function (e) { O.nohw = e.target.checked; });
    $('#lpSt', s).addEventListener('change', function (e) { O.stops = e.target.checked; store('rg.loop.stops', O.stops ? '1' : '0'); });
    $('#lpGo', s).addEventListener('click', function (ev) {
      O.seed++;
      Cl.busy(ev.currentTarget, function () {
        return (O.dir < 0 ? viaGh(f, O.km) : Promise.resolve(null)).then(function (r) { return r || own(f, O.km, O.dir); }).then(function (r) { return stops(r, O.stops); }).then(function (r) {
          Cl.closeSheet();
          A.previewPlan({ id: Date.now(), name: 'Ruta de ' + Math.round(r.dist) + ' km', wps: r.wps, pois: r.pois || [], coords: r.coords, dist: Math.round(r.dist * 10) / 10, dur: r.dur, routed: true, steps: r.steps || [], created: Date.now() });
        });
      }).catch(function (e) { A.toast(e.message || 'No se ha podido generar la ruta.', 'warn'); });
    });
  }
  var row = $('#exRow');
  if (row) { var b = document.createElement('button'); b.className = 'btn'; b.type = 'button'; b.id = 'exLoop'; b.innerHTML = ic('compass') + 'Generar ruta'; row.insertBefore(b, row.firstChild); b.addEventListener('click', open); }
  window.RGRoutes = { loop: open };
})();
