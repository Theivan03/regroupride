/* ReGroupRide — carretera: gasolineras con precio (datos del Ministerio), incidencias de la DGT y avisos de peligro
   de otros moteros (supabase/31). Todo se consulta por cercanía; la base de datos actualiza las fuentes cuando toca. */
(function () {
  'use strict';
  var A = window.RGApp, Cl = window.RGCloud, L = window.RGLib; if (!A || !Cl || !Cl.sb) return;
  var sb = Cl.sb, $ = function (s, r) { return (r || document).querySelector(s); }, $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var RA = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.RideAlerts;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function ic(n) { return '<svg><use href="#i-' + n + '"/></svg>'; }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; }
  function head(t) { return '<div class="head"><h1>' + t + '</h1><button class="btn small icon" id="rdX" type="button" title="Cerrar">' + ic('close') + '</button></div>'; }
  function dist(a, b, c, d) { if (L && L.dist) return L.dist(a, b, c, d); var x = (d - b) * Math.PI / 180 * Math.cos((a + c) * Math.PI / 360), y = (c - a) * Math.PI / 180; return Math.sqrt(x * x + y * y) * 6371000; }
  function eur(v) { return v == null ? '—' : Number(v).toFixed(3).replace('.', ','); }
  function kmTxt(k) { return k < 10 ? String(Math.round(k * 10) / 10).replace('.', ',') : String(Math.round(k)); }
  function say(t) { try { if (A.settings.navVoice === true && window.Platform && Platform.canSpeak && Platform.canSpeak()) Platform.speak(t); } catch (e) {} }
  function note(id, headTx, body) { try { if (RA && RA.newsNow) RA.newsNow({ items: [{ kind: 'note', id: id, community: 'ReGroupRide', head: headTx, title: body }], silent: false }).catch(function () {}); } catch (e) {} }
  // distancia (m) de un punto a una línea [[lon,lat],…], mirando un punto de cada pocos
  function toLine(lat, lon, line) { var best = 1e12, step = Math.max(1, Math.floor(line.length / 800)); for (var i = 0; i < line.length; i += step) { var d = dist(lat, lon, line[i][1], line[i][0]); if (d < best) best = d; } return best; }
  function bbox(line) { var a = 90, b = 180, c = -90, d = -180; line.forEach(function (p) { if (p[1] < a) a = p[1]; if (p[1] > c) c = p[1]; if (p[0] < b) b = p[0]; if (p[0] > d) d = p[0]; }); return [a, b, c, d]; }
  function plan() { var p = A.activePlan && A.activePlan(); return p && p.coords && p.coords.length > 1 ? p : null; }
  function gmaps(lat, lon) { window.open('https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lon, '_blank'); }

  /* ---------- gasolineras ---------- */
  var F = { kind: store('rg.fuel.kind') === 'g98' ? 'g98' : 'g95', sort: 'price', route: false, rows: [], marks: [], shown: false };
  // El Ministerio solo contesta a conexiones desde España: los precios los baja el teléfono (las tres provincias más
  // cercanas, por la capital) y los deja en el servidor para los demás. En el navegador no se puede (CORS): se usa lo guardado.
  var PROV = '01:42.85:-2.67|02:38.99:-1.86|03:38.35:-0.48|04:36.84:-2.46|05:40.66:-4.70|06:38.88:-6.97|07:39.57:2.65|08:41.39:2.17|09:42.34:-3.70|10:39.48:-6.37|11:36.53:-6.29|12:39.99:-0.04|13:38.99:-3.93|14:37.89:-4.78|15:43.36:-8.41|16:40.07:-2.14|17:41.98:2.82|18:37.18:-3.60|19:40.63:-3.17|20:43.32:-1.98|21:37.26:-6.95|22:42.14:-0.41|23:37.77:-3.79|24:42.60:-5.57|25:41.62:0.62|26:42.47:-2.45|27:43.01:-7.56|28:40.42:-3.70|29:36.72:-4.42|30:37.99:-1.13|31:42.82:-1.64|32:42.34:-7.86|33:43.36:-5.85|34:42.01:-4.53|35:28.12:-15.43|36:42.43:-8.64|37:40.97:-5.66|38:28.47:-16.25|39:43.46:-3.81|40:40.95:-4.12|41:37.39:-5.98|42:41.76:-2.47|43:41.12:1.25|44:40.34:-1.11|45:39.86:-4.02|46:39.47:-0.38|47:41.65:-4.72|48:43.26:-2.93|49:41.50:-5.75|50:41.65:-0.88|51:35.89:-5.32|52:35.29:-2.94'
    .split('|').map(function (x) { var a = x.split(':'); return { id: a[0], lat: +a[1], lon: +a[2] }; });
  var FAPI = 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/FiltroProvincia/', FC = {};
  function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : null; }
  function httpJson(url) {
    var H = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.CapacitorHttp;
    if (H && Capacitor.isNativePlatform && Capacitor.isNativePlatform()) return H.get({ url: url, headers: { Accept: 'application/json' }, connectTimeout: 15000, readTimeout: 40000 }).then(function (r) { if (r.status !== 200) throw new Error('HTTP ' + r.status); return typeof r.data === 'string' ? JSON.parse(r.data) : r.data; });
    return fetch(url, { headers: { Accept: 'application/json' } }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function fuelProv(id) {
    var c = FC[id]; if (c && Date.now() - c.at < 3 * 36e5) return c.p;
    var p = httpJson(FAPI + id).then(function (d) {
      var rows = []; (d.ListaEESSPrecio || []).forEach(function (e) {
        var lat = num(e['Latitud']), lon = num(e['Longitud (WGS84)']), g95 = num(e['Precio Gasolina 95 E5']), g98 = num(e['Precio Gasolina 98 E5']);
        if (lat == null || lon == null || (g95 == null && g98 == null) || !e['IDEESS'] || String(e['Tipo Venta'] || 'P').toUpperCase() !== 'P') return;
        rows.push({ id: String(e['IDEESS']), name: String(e['Rótulo'] || 'Gasolinera').slice(0, 60), addr: String(e['Dirección'] || '').slice(0, 120), town: String(e['Municipio'] || e['Localidad'] || '').slice(0, 60), lat: lat, lon: lon, g95: g95, g98: g98, hours: String(e['Horario'] || '').slice(0, 80) });
      });
      if (rows.length) sb.rpc('fuel_put', { p_rows: rows.slice(0, 4000) }).then(function () {}, function () {});
      return rows;
    });
    FC[id] = { at: Date.now(), p: p }; p.catch(function () { delete FC[id]; }); return p;
  }
  // gasolineras a menos de km de un punto: primero lo guardado; si falta o es viejo, se baja desde el teléfono
  function fuelAround(f, km) {
    var fromPhone = function () {
      var near = PROV.slice().sort(function (a, b) { return dist(f.lat, f.lon, a.lat, a.lon) - dist(f.lat, f.lon, b.lat, b.lon); }).slice(0, 3);
      return Promise.all(near.map(function (p) { return fuelProv(p.id).catch(function () { return []; }); })).then(function (all) {
        var rows = [].concat.apply([], all).map(function (x) { var y = Object.assign({}, x); y.km = Math.round(dist(f.lat, f.lon, x.lat, x.lon) / 100) / 10; return y; }).filter(function (x) { return x.km <= km; });
        if (!rows.length) throw new Error('sin datos'); return { rows: rows, at: Date.now() };
      });
    };
    return sb.rpc('fuel_near', { p_lat: f.lat, p_lon: f.lon, p_km: km }).then(function (r) {
      var d = r.error ? null : r.data; if (d && d.rows && d.rows.length && d.at && Date.now() - d.at < 8 * 36e5) return d;
      return fromPhone().catch(function () { if (d && d.rows && d.rows.length) return d; return { rows: [], at: null }; });
    }, function () { return fromPhone().catch(function () { return { rows: [], at: null }; }); });
  }
  function fuelOpen() {
    if (!Cl.user()) { Cl.openAuth(false); return; }
    var f = A.anyFix && A.anyFix(), p = plan(); if (!p) F.route = false;
    var s = Cl.sheet(head('Gasolineras') +
      '<div class="rd-bar"><div class="seg" id="fuKind"><button type="button" data-k="g95" aria-pressed="' + (F.kind === 'g95') + '">95</button><button type="button" data-k="g98" aria-pressed="' + (F.kind === 'g98') + '">98</button></div>' +
      '<div class="seg" id="fuSort"><button type="button" data-s="price" aria-pressed="' + (F.sort === 'price') + '">Más baratas</button><button type="button" data-s="near" aria-pressed="' + (F.sort === 'near') + '">Más cerca</button></div></div>' +
      (p ? '<label class="rg-check"><input type="checkbox" id="fuRoute"' + (F.route ? ' checked' : '') + '><span><b>Solo las de mi ruta</b><small>A menos de 1,5 km del trazado de «' + esc(p.name || 'tu ruta') + '».</small></span></label>' : '') +
      '<div id="fuList" class="rd-list"><div class="empty">' + (f || F.route ? 'Buscando…' : 'Hace falta tu ubicación. Abre el mapa y espera a que te sitúe.') + '</div></div>' +
      '<p class="muted rg-small" id="fuNote" style="text-align:left">Precios comunicados por las estaciones al Ministerio para la Transición Ecológica.</p>');
    $('#rdX', s).addEventListener('click', Cl.closeSheet);
    $$('#fuKind button', s).forEach(function (b) { b.addEventListener('click', function () { F.kind = b.dataset.k; store('rg.fuel.kind', F.kind); fuelOpen(); }); });
    $$('#fuSort button', s).forEach(function (b) { b.addEventListener('click', function () { F.sort = b.dataset.s; fuelOpen(); }); });
    if ($('#fuRoute', s)) $('#fuRoute', s).addEventListener('change', function (e) { F.route = e.target.checked; fuelOpen(); });
    var done = function (rows, at, nt) {
      F.rows = rows.filter(function (x) { return x[F.kind] != null; });
      F.rows.sort(function (a, b) { return F.sort === 'price' ? (a[F.kind] - b[F.kind]) || (a.km - b.km) : a.km - b.km; });
      var el = $('#fuList'); if (!el) return; fuelList(el);
      var n = $('#fuNote'); if (n && at) n.textContent = 'Precios comunicados por las estaciones al Ministerio para la Transición Ecológica. Actualizados ' + new Date(at).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + '.';
      if (n && !at && !F.rows.length) n.textContent = 'Todavía no hay precios guardados de esta zona. Se descargan desde la app del móvil la primera vez que alguien los consulta aquí.';
    };
    var fail = function () { var el = $('#fuList'); if (el) el.innerHTML = '<div class="empty">No se ha podido cargar. Revisa la conexión.</div>'; };
    if (F.route && p) {
      var bb = bbox(p.coords);
      sb.rpc('fuel_box', { a_lat: bb[0], a_lon: bb[1], b_lat: bb[2], b_lon: bb[3] }).then(function (r) {
        if (r.error) return fail();
        var rows = (r.data || []).filter(function (x) { return toLine(x.lat, x.lon, p.coords) <= 1500; });
        rows.forEach(function (x) { x.km = f ? dist(f.lat, f.lon, x.lat, x.lon) / 1000 : 0; }); done(rows, Date.now());
      }, fail);
    } else if (f) {
      fuelAround(f, 25).then(function (d) { done(d.rows || [], d.at); }, fail);
    }
  }
  function fuelList(el) {
    if (!F.rows.length) { el.innerHTML = '<div class="empty">No hay gasolineras con ese combustible ' + (F.route ? 'junto a tu ruta (o aún no hay precios guardados de esa zona).' : 'a menos de 25 km, o aún no hay precios guardados de esta zona.') + '</div>'; return; }
    var min = Math.min.apply(null, F.rows.map(function (x) { return +x[F.kind]; }));
    el.innerHTML = '<button class="btn rd-map" id="fuMap" type="button">' + ic('map') + (F.shown ? 'Quitar del mapa' : 'Verlas en el mapa') + '</button>' + F.rows.slice(0, 40).map(function (x, i) {
      return '<button class="rd-row" type="button" data-i="' + i + '"><span class="rd-price' + (+x[F.kind] === min ? ' best' : '') + '">' + eur(x[F.kind]) + '<small>€/l</small></span><span class="rd-txt"><b>' + esc(x.name) + (+x[F.kind] === min ? '<i>la más barata</i>' : '') + '</b><small>' + esc(x.town || '') + ' · a ' + kmTxt(x.km) + ' km' + (x.hours ? ' · ' + esc(x.hours) : '') + '</small></span>' + ic('chev') + '</button>';
    }).join('');
    $$('[data-i]', el).forEach(function (b) { b.addEventListener('click', function () { var x = F.rows[+b.dataset.i]; gmaps(x.lat, x.lon); }); });
    $('#fuMap', el).addEventListener('click', function () { if (F.shown) fuelMarks([]); else { fuelMarks(F.rows.slice(0, 40)); Cl.closeSheet(); A.showView('map'); } });
  }
  function fuelMarks(rows) {
    var map = A.map && A.map(); F.marks.forEach(function (m) { m.remove(); }); F.marks = []; F.shown = false;
    if (!map || !window.maplibregl || !rows.length) { if (rows.length) A.toast('El mapa aún no está listo.', 'warn'); return; }
    var min = Math.min.apply(null, rows.map(function (x) { return +x[F.kind]; }));
    rows.forEach(function (x) {
      var el = document.createElement('div'); el.className = 'rd-mk fuel' + (+x[F.kind] === min ? ' best' : ''); el.textContent = eur(x[F.kind]); el.title = x.name;
      el.addEventListener('click', function (ev) { ev.stopPropagation(); var s = Cl.sheet(head(esc(x.name)) + '<p style="margin:0;text-align:left"><b class="rd-big">' + eur(x[F.kind]) + ' €/l</b> · gasolina ' + (F.kind === 'g95' ? '95' : '98') + '<br><span class="muted">' + esc([x.addr, x.town].filter(Boolean).join(', ')) + (x.hours ? '<br>' + esc(x.hours) : '') + '</span></p><div class="rg-row"><button class="btn primary" id="fuGo" type="button">' + ic('gmaps') + 'Cómo llegar</button><button class="btn" id="fuOff" type="button">Quitar gasolineras del mapa</button></div>'); $('#rdX', s).addEventListener('click', Cl.closeSheet); $('#fuGo', s).addEventListener('click', function () { gmaps(x.lat, x.lon); }); $('#fuOff', s).addEventListener('click', function () { fuelMarks([]); Cl.closeSheet(); }); });
      F.marks.push(new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([x.lon, x.lat]).addTo(map));
    });
    F.shown = true;
  }
  // aviso por autonomía: si la moto tiene autonomía apuntada y se acerca al 75 %, propone la gasolinera más barata cerca
  var RW = { ride: 0, told: false };
  function rangeWatch() {
    var rn = A.recNow && A.recNow(); if (!rn) { RW.told = false; return; } if (RW.told) return;
    var v = (A.vehicles() || []).filter(function (x) { return x.principal; })[0]; if (!v || !(v.range > 30)) return;
    var since = rn.km, last = (v.fuel || []).slice().sort(function (a, b) { return b.at - a.at; })[0];
    if (last) since += (A.rides() || []).filter(function (r) { return r.start > last.at && (r.vehicleId === v.id || !r.vehicleId); }).reduce(function (s, r) { return s + (r.dist || 0); }, 0);
    if (since < v.range * 0.75) return; RW.told = true;
    var f = A.lastFix && A.lastFix(); if (!f) return;
    fuelAround(f, 20).then(function (r) {
      var rows = (r.rows || []).filter(function (x) { return x[F.kind] != null; }).sort(function (a, b) { return a[F.kind] - b[F.kind]; }), x = rows[0];
      var msg = 'Llevas unos ' + Math.round(since) + ' km desde el último repostaje' + (x ? '. La más barata cerca: ' + x.name + ', a ' + kmTxt(x.km) + ' km (' + eur(x[F.kind]) + ' €)' : '') + '.';
      A.toast('Aviso de gasolina: ' + msg, 'warn'); say('Aviso de gasolina. Llevas ' + Math.round(since) + ' kilómetros desde el último repostaje.'); note('fuel-' + Date.now(), 'Toca repostar pronto', msg);
    }, function () {});
  }
  setInterval(rangeWatch, 30000);

  /* ---------- incidencias de la DGT y peligros avisados ---------- */
  var HK = { grava: ['Gravilla', '🪨'], aceite: ['Aceite o gasoil', '🛢️'], animales: ['Animales', '🦌'], obras: ['Obras', '🚧'], obstaculo: ['Obstáculo en la calzada', '⚠️'], mojado: ['Suelo mojado o hielo', '💧'], otro: ['Otro peligro', '❗'] };
  var DK = { roadClosed: 'Carretera cortada', carriagewayClosures: 'Calzada cortada', laneClosures: 'Carril cortado', narrowLanes: 'Carriles estrechos', contraflow: 'Circulación en sentido contrario', singleAlternateLineTraffic: 'Paso alternativo', roadworks: 'Obras', maintenanceWork: 'Obras', accident: 'Accidente', Accident: 'Accidente', AbnormalTraffic: 'Retención', MaintenanceWorks: 'Obras', ConstructionWorks: 'Obras',
    AnimalPresenceObstruction: 'Animales en la calzada', VehicleObstruction: 'Vehículo parado', GeneralObstruction: 'Obstáculo en la calzada', EnvironmentalObstruction: 'Obstáculo por el tiempo', WeatherRelatedRoadConditions: 'Calzada en mal estado por el tiempo', NonWeatherRelatedRoadConditions: 'Calzada en mal estado', PoorEnvironmentConditions: 'Mal tiempo', RoadOrCarriagewayOrLaneManagement: 'Restricción de circulación', SpeedManagement: 'Límite de velocidad temporal', ReroutingManagement: 'Desvío', PublicEvent: 'Evento en la vía',
    snowfall: 'Nieve', ice: 'Hielo', fog: 'Niebla', flooding: 'Inundación', rockfalls: 'Desprendimientos', oilOnRoad: 'Aceite en la calzada', strongWinds: 'Viento fuerte', heavyRain: 'Lluvia fuerte' };
  function dgtLabel(x) { var subs = (x.sub || '').split(','), t = null; ['roadClosed', 'carriagewayClosures'].concat(subs).forEach(function (k) { if (!t && subs.indexOf(k) >= 0 && DK[k]) t = DK[k]; }); t = t || DK[x.kind] || 'Incidencia'; var why = subs.filter(function (k) { return DK[k] && DK[k] !== t; }).map(function (k) { return DK[k]; })[0]; return t + (why ? ' · ' + why.toLowerCase() : ''); }
  function dgtBad(x) { return /roadClosed|carriagewayClosures|Accident|accident|ice|snowfall|rockfalls|oilOnRoad|flooding|AnimalPresence|GeneralObstruction/.test(x.kind + ',' + (x.sub || '')); }
  var H = { at: 0, dgt: [], hz: [], marks: [], told: {}, routeN: 0, planId: null };
  function hzLoad(force) {
    var f = A.anyFix && A.anyFix(); if (!f || !Cl.user()) return Promise.resolve();
    if (!force && Date.now() - H.at < 4 * 60000) return Promise.resolve(); H.at = Date.now();
    return sb.rpc('hazards_near', { p_lat: f.lat, p_lon: f.lon, p_km: 60 }).then(function (r) {
      if (r.error || !r.data) return; H.dgt = r.data.dgt || []; H.hz = r.data.hz || []; hzMarks(); routeCheck(true);
    }, function () {});
  }
  function hzMarks() {
    var map = A.map && A.map(); if (!map || !window.maplibregl) return;
    H.marks.forEach(function (m) { m.remove(); }); H.marks = [];
    H.hz.forEach(function (x) { var el = document.createElement('div'); el.className = 'rd-mk hz'; el.textContent = (HK[x.kind] || HK.otro)[1]; el.addEventListener('click', function (ev) { ev.stopPropagation(); hzSheet(x); }); H.marks.push(new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([x.lon, x.lat]).addTo(map)); });
    H.dgt.filter(function (x) { return x.km <= 40; }).slice(0, 80).forEach(function (x) { var el = document.createElement('div'); el.className = 'rd-mk dgt' + (dgtBad(x) ? ' bad' : ''); el.textContent = '!'; el.addEventListener('click', function (ev) { ev.stopPropagation(); dgtSheet(x); }); H.marks.push(new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([x.lon, x.lat]).addTo(map)); });
  }
  function hzSheet(x) {
    var k = HK[x.kind] || HK.otro, s = Cl.sheet(head(k[1] + ' ' + k[0]) + '<p style="margin:0;text-align:left">' + (x.note ? esc(x.note) + '<br>' : '') + '<span class="muted">Avisado por un motero hace ' + Math.max(1, Math.round((Date.now() - x.at) / 60000)) + ' min · a ' + kmTxt(x.km) + ' km de ti</span></p><div class="rg-row"><button class="btn" id="hzGone" type="button">' + (x.mine ? 'Quitar mi aviso' : 'Ya no está') + '</button></div>');
    $('#rdX', s).addEventListener('click', Cl.closeSheet);
    $('#hzGone', s).addEventListener('click', function () { sb.rpc('hazard_gone', { p_id: x.id }).then(function () { Cl.closeSheet(); if (x.mine) H.hz = H.hz.filter(function (y) { return y.id !== x.id; }); hzMarks(); A.toast('Aviso anotado: gracias.', 'ok'); }, function () {}); });
  }
  function dgtSheet(x) { var s = Cl.sheet(head(esc(dgtLabel(x))) + '<p style="margin:0;text-align:left">' + (x.road ? '<b>' + esc(x.road) + '</b><br>' : '') + '<span class="muted">Incidencia de la DGT' + (x.since ? ' desde el ' + new Date(x.since).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '') + ' · a ' + kmTxt(x.km) + ' km de ti</span></p><div class="rg-row"><button class="btn" id="dgGo" type="button">' + ic('gmaps') + 'Ver en Google Maps</button></div>'); $('#rdX', s).addEventListener('click', Cl.closeSheet); $('#dgGo', s).addEventListener('click', function () { window.open('https://www.google.com/maps/search/?api=1&query=' + x.lat + ',' + x.lon, '_blank'); }); }
  // lo que cae sobre la ruta que voy a seguir
  function onRoute() { var p = plan(); if (!p) return []; return H.dgt.filter(function (x) { return toLine(x.lat, x.lon, p.coords) <= 120; }).map(function (x) { return { t: dgtLabel(x), road: x.road, bad: dgtBad(x), x: x, dgt: 1 }; }).concat(H.hz.filter(function (x) { return toLine(x.lat, x.lon, p.coords) <= 150; }).map(function (x) { return { t: (HK[x.kind] || HK.otro)[0], road: '', bad: 1, x: x }; })); }
  function routeCheck(quiet) {
    var p = plan(), id = p ? p.id : null, list = onRoute(); H.routeN = list.length;
    if (id !== H.planId) { H.planId = id; if (p && !quiet) { hzLoad(true); return; } if (p && list.length) A.toast('Aviso: ' + list.length + (list.length === 1 ? ' incidencia' : ' incidencias') + ' en tu ruta. Míralas en Explorar → Incidencias.', 'warn'); }
    if (window.RGShell) RGShell.today();
  }
  setInterval(function () { routeCheck(false); }, 5000);
  (window.RGToday = window.RGToday || []).push(function () { return H.routeN && plan() ? { i: 'warn', hot: 1, b: H.routeN + (H.routeN === 1 ? ' incidencia en tu ruta' : ' incidencias en tu ruta'), t: onRoute().slice(0, 2).map(function (x) { return x.t + (x.road ? ' (' + x.road + ')' : ''); }).join(' · '), go: incOpen } : null; });
  function incOpen() {
    if (!Cl.user()) { Cl.openAuth(false); return; }
    var s = Cl.sheet(head('Incidencias y peligros') + '<div id="inList" class="rd-list"><div class="empty">Cargando…</div></div><button class="btn primary" id="inAdd" type="button">' + ic('warn') + 'Avisar de un peligro aquí</button><p class="muted rg-small" style="text-align:left">Incidencias oficiales de la DGT (no cubre Cataluña ni el País Vasco) y avisos de otros moteros, que caducan a las pocas horas.</p>');
    $('#rdX', s).addEventListener('click', Cl.closeSheet); $('#inAdd', s).addEventListener('click', hazard);
    hzLoad(true).then(function () {
      var el = $('#inList'); if (!el) return; var onr = onRoute();
      var all = H.hz.map(function (x) { return { km: x.km, e: (HK[x.kind] || HK.otro)[1], t: (HK[x.kind] || HK.otro)[0], s: (x.note ? x.note + ' · ' : '') + 'avisado por un motero', x: x, f: hzSheet }; })
        .concat(H.dgt.map(function (x) { return { km: x.km, e: dgtBad(x) ? '⛔' : '🚧', t: dgtLabel(x), s: (x.road || 'DGT'), x: x, f: dgtSheet }; })).sort(function (a, b) { return a.km - b.km; }).slice(0, 60);
      el.innerHTML = (onr.length ? '<div class="notice">' + onr.length + (onr.length === 1 ? ' cae' : ' caen') + ' sobre la ruta que tienes cargada: ' + esc(onr.slice(0, 3).map(function (x) { return x.t + (x.road ? ' (' + x.road + ')' : ''); }).join(' · ')) + '</div>' : '') +
        (all.length ? all.map(function (x, i) { return '<button class="rd-row" type="button" data-i="' + i + '"><span class="rd-emo">' + x.e + '</span><span class="rd-txt"><b>' + esc(x.t) + '</b><small>' + esc(x.s) + ' · a ' + kmTxt(x.km) + ' km</small></span>' + ic('chev') + '</button>'; }).join('') : '<div class="empty">' + ((A.anyFix && A.anyFix()) ? 'Nada avisado a menos de 60 km.' : 'Hace falta tu ubicación para saber qué tienes cerca.') + '</div>');
      $$('[data-i]', el).forEach(function (b) { b.addEventListener('click', function () { var x = all[+b.dataset.i]; x.f(x.x); }); });
    });
  }
  // avisar de un peligro: desde «Avisar» o desde Incidencias
  function hazard() {
    if (!Cl.user()) { Cl.openAuth(false); return; }
    var f = A.lastFix && A.lastFix(); if (!f || Date.now() - f.ts > 60000) { A.toast('Hace falta tu posición exacta para marcar el peligro. Espera a que el GPS te sitúe.', 'warn'); return; }
    var s = Cl.sheet(head('Avisar de un peligro') + '<p class="muted" style="margin:0;text-align:left">Se marca donde estás ahora y lo ven los moteros que pasen cerca durante unas horas. Hazlo con la moto parada.</p><div class="rd-hz">' + Object.keys(HK).map(function (k) { return '<button class="btn" type="button" data-hz="' + k + '"><span>' + HK[k][1] + '</span>' + HK[k][0] + '</button>'; }).join('') + '</div><input id="hzNote" maxlength="140" placeholder="Detalle (opcional): «en la segunda curva»">');
    $('#rdX', s).addEventListener('click', Cl.closeSheet);
    $$('[data-hz]', s).forEach(function (b) { b.addEventListener('click', function () {
      Cl.busy(b, function () { return sb.from('hazards').insert({ kind: b.dataset.hz, lat: f.lat, lon: f.lon, note: $('#hzNote').value.trim() || null }).then(function (r) { if (r.error) throw r.error; Cl.closeSheet(); A.toast('Aviso enviado: ' + HK[b.dataset.hz][0].toLowerCase() + '. Gracias.', 'ok'); H.at = 0; hzLoad(true); }); }).catch(function (e) { A.toast(Cl.msg(e), 'warn'); });
    }); });
  }
  // cerca de un peligro avisado: una vez por aviso
  function nearWatch() {
    if (!(A.isRec && A.isRec())) return; var f = A.lastFix && A.lastFix(); if (!f) return;
    H.hz.forEach(function (x) { if (x.mine || H.told[x.id]) return; var d = dist(f.lat, f.lon, x.lat, x.lon); if (d > 900) return; H.told[x.id] = 1; var k = (HK[x.kind] || HK.otro)[0]; A.toast('Aviso: ' + k.toLowerCase() + ' a ' + Math.round(d / 50) * 50 + ' m.', 'warn'); say('Atención: ' + k + ' cerca.'); });
  }
  setInterval(nearWatch, 4000);
  setInterval(function () { if (document.visibilityState !== 'hidden' && ((A.isRec && A.isRec()) || !$('#view-map').hidden)) hzLoad(false); }, 60000);
  setTimeout(function () { hzLoad(false); }, 12000);

  // el botón «Avisar» también sale rodando sin grupo: ahí sirve para avisar de un peligro
  var ab = $('#btnAlert');
  function inGroup() { return !!(window.RGGroup && RGGroup.state && RGGroup.state.s); }
  if (ab) { ab.addEventListener('click', function () { if (!inGroup()) hazard(); }); setInterval(function () { if (!inGroup()) ab.hidden = !(A.isRec && A.isRec()); }, 2000); }

  var row = $('#exRow');
  if (row) { [['exFuel', 'fuel', 'Gasolineras', fuelOpen], ['exInc', 'warn', 'Incidencias', incOpen]].forEach(function (x) { var b = document.createElement('button'); b.className = 'btn'; b.type = 'button'; b.id = x[0]; b.innerHTML = ic(x[1]) + x[2]; row.appendChild(b); b.addEventListener('click', x[3]); }); }
  // cortes, accidentes, hielo… de la DGT y peligros avisados que caen sobre un trazado
  function badOn(coords) { return H.dgt.filter(function (x) { return dgtBad(x) && toLine(x.lat, x.lon, coords) <= 150; }).length + H.hz.filter(function (x) { return toLine(x.lat, x.lon, coords) <= 150; }).length; }
  window.RGRoad = { badOn: badOn, fuel: fuelOpen, incidents: incOpen, hazard: hazard, state: H };
})();
