/* ReGroupRide — rutas con curvas y vuelta circular.
   · «Evitar autovías» en el planificador: el trazado busca carreteras secundarias.
   · Vuelta circular: «una vuelta de 150 km» desde donde estás, hacia donde elijas.
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
  // puntos de paso en círculo: el punto de salida queda en el borde y el centro, hacia el rumbo elegido
  function ring(f, km, brg, k) {
    var r = km * 1000 / (2 * Math.PI) / k, c = dest(f.lat, f.lon, brg, r), back = (brg + 180) % 360, pts = [[f.lat, f.lon, 'Salida']];
    [72, 144, 216, 288].forEach(function (a) { var p = dest(c[0], c[1], (back + a) % 360, r); pts.push([p[0], p[1], '']); });
    pts.push([f.lat, f.lon, 'Llegada']); return pts;
  }
  function own(f, km, brg) {
    var keep = A.routeOpt.noHighway; A.routeOpt.noHighway = O.nohw;
    var attempt = function (k, n) {
      var wps = ring(f, km, brg, k);
      return A.routeBetween(wps).then(function (r) {
        if (!r.routed) throw new Error('No hay conexión para trazar la vuelta.');
        var off = r.dist / km; if (n < 3 && (off > 1.2 || off < 0.8)) return attempt(k * off, n + 1);      // sale más larga o más corta de lo pedido: se ajusta el círculo
        r.wps = wps; return r;
      });
    };
    return attempt(1.35, 1).then(function (r) { A.routeOpt.noHighway = keep; return r; }, function (e) { A.routeOpt.noHighway = keep; throw e; });
  }
  function viaGh(f, km) {
    if (ghOff || !sb || !sb.functions) return Promise.resolve(null);
    return sb.functions.invoke('route', { body: { kind: 'loop', lat: f.lat, lon: f.lon, km: km, seed: O.seed } }).then(function (r) {
      var d = r && r.data; if (!d || !d.ok) { if (!d || d.reason === 'no-key' || (r && r.error)) ghOff = true; return null; }
      // el trazado de GraphHopper se pasa por el de la app con puntos de paso cada pocos km, para tener los giros por voz
      var c = d.coords, n = Math.min(22, Math.max(6, Math.round(d.dist / 8))), wps = []; for (var i = 0; i <= n; i++) { var p = c[Math.min(c.length - 1, Math.round(i * (c.length - 1) / n))]; wps.push([p[1], p[0], i === 0 ? 'Salida' : i === n ? 'Llegada' : '']); }
      return A.routeBetween(wps).then(function (x) { if (!x.routed) return { coords: c, dist: d.dist, dur: d.dur, routed: true, steps: [], wps: [wps[0], wps[wps.length - 1]] }; x.wps = wps; return x; });
    }, function () { ghOff = true; return null; });
  }
  function open() {
    var f = A.anyFix && A.anyFix(), dirs = [[-1, 'Da igual'], [0, 'Norte'], [90, 'Este'], [180, 'Sur'], [270, 'Oeste']];
    var s = Cl.sheet('<div class="head"><h1>Vuelta circular</h1><button class="btn small icon" id="lpX" type="button" title="Cerrar">' + ic('close') + '</button></div>' +
      '<p class="muted" style="margin:0;text-align:left">Di cuántos kilómetros quieres hacer y la app te propone una vuelta que sale y vuelve a donde estás.</p>' +
      '<span class="label">Distancia</span><div class="pills" id="lpKm">' + [60, 100, 150, 200, 300].map(function (k) { return '<button class="pill" type="button" data-k="' + k + '" aria-pressed="' + (k === O.km) + '">' + k + ' km</button>'; }).join('') + '</div>' +
      '<span class="label">Hacia dónde</span><div class="pills" id="lpDir">' + dirs.map(function (d) { return '<button class="pill" type="button" data-d="' + d[0] + '" aria-pressed="' + (d[0] === O.dir) + '">' + d[1] + '</button>'; }).join('') + '</div>' +
      '<label class="rg-check"><input type="checkbox" id="lpHw"' + (O.nohw ? ' checked' : '') + '><span><b>Evitar autovías</b><small>Carreteras secundarias, con más curvas.</small></span></label>' +
      '<button class="btn big primary" id="lpGo" type="button"' + (f ? '' : ' disabled') + '>' + ic('route') + 'Proponer una vuelta</button>' + (f ? '' : '<p class="muted rg-small">Hace falta tu ubicación. Abre el mapa y espera a que te sitúe.</p>') +
      '<p class="muted rg-small" style="text-align:left">Es una propuesta: mírala en el mapa antes de salir y, si no te convence, pide otra. Al guardarla queda en tus rutas.</p>');
    $('#lpX', s).addEventListener('click', Cl.closeSheet);
    $$('#lpKm button', s).forEach(function (b) { b.addEventListener('click', function () { O.km = +b.dataset.k; $$('#lpKm button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); }); });
    $$('#lpDir button', s).forEach(function (b) { b.addEventListener('click', function () { O.dir = +b.dataset.d; $$('#lpDir button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); }); });
    $('#lpHw', s).addEventListener('change', function (e) { O.nohw = e.target.checked; });
    $('#lpGo', s).addEventListener('click', function (ev) {
      var brg = O.dir >= 0 ? O.dir : (O.seed * 137) % 360; O.seed++;
      Cl.busy(ev.currentTarget, function () {
        return (O.dir < 0 ? viaGh(f, O.km) : Promise.resolve(null)).then(function (r) { return r || own(f, O.km, brg); }).then(function (r) {
          Cl.closeSheet();
          A.previewPlan({ id: Date.now(), name: 'Vuelta de ' + Math.round(r.dist) + ' km', wps: r.wps, pois: [], coords: r.coords, dist: Math.round(r.dist * 10) / 10, dur: r.dur, routed: true, steps: r.steps || [], created: Date.now() });
        });
      }).catch(function (e) { A.toast(e.message || 'No se ha podido trazar la vuelta.', 'warn'); });
    });
  }
  var row = $('#exRow');
  if (row) { var b = document.createElement('button'); b.className = 'btn'; b.type = 'button'; b.id = 'exLoop'; b.innerHTML = ic('undo') + 'Vuelta circular'; row.insertBefore(b, row.firstChild); b.addEventListener('click', open); }
  window.RGRoutes = { loop: open };
})();
