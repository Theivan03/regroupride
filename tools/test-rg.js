/* Pruebas de la lógica de ReGroupRide: enlaces de Google Maps y seguimiento de ruta. node tools/test-rg.js */
var L = require('../www/rg-lib.js'), assert = require('assert'), n = 0;
function t(name, f) { f(); n++; }

t('dir con coordenadas y nombres', function () {
  var r = L.parseMapsUrl('https://www.google.com/maps/dir/38.6378,-0.0428/Calp,+Alicante/Benidorm/@38.6,-0.1,11z/data=!3m1!4b1!4m20!4m19!1m3!2m2!1d-0.0428!2d38.6378!1m5!1m1!1s0x1:0x2!2m2!1d0.0445!2d38.6447!1m5!1m1!1s0x3:0x4!2m2!1d-0.1300!2d38.5400!3e0');
  assert.equal(r.points.length, 3); assert.equal(r.unresolved.length, 0); assert.equal(r.points[1].name, 'Calp, Alicante'); assert.equal(r.points[1].lat, 38.6447);
});
t('nombres con pares solo de los nombrados', function () {
  var r = L.parseMapsUrl('https://www.google.com/maps/dir/38.6378,-0.0428/Benidorm/@38.6,-0.1,11z/data=!4m9!4m8!1m0!1m5!1m1!1s0x3:0x4!2m2!1d-0.1300!2d38.5400');
  assert.equal(r.points.length, 2); assert.equal(r.points[1].lon, -0.13);
});
t('nombre sin coordenadas queda sin resolver', function () {
  var r = L.parseMapsUrl('https://www.google.com/maps/dir/38.6378,-0.0428/Benidorm/');
  assert.equal(r.points.length, 1); assert.deepEqual(r.unresolved, ['Benidorm']);
});
t('punto arrastrado se inserta en su tramo', function () {
  var r = L.parseMapsUrl('https://www.google.com/maps/dir/38.60,-0.10/38.60,-0.30/38.60,-0.50/data=!4m12!4m11!1m3!2m2!1d-0.10!2d38.60!1m5!3m4!1m2!1d-0.40!2d38.65!3s0x0:0x0!1m0!1m3!2m2!1d-0.50!2d38.60');
  assert.deepEqual(r.points.map(function (p) { return !!p.via; }), [false, false, true, false]); assert.equal(r.points[2].lon, -0.40);
});
t('formato api=1, lugar suelto, cortos y errores', function () {
  assert.equal(L.parseMapsUrl('https://www.google.com/maps/dir/?api=1&origin=38.1,-0.2&destination=38.3,-0.4&waypoints=38.2,-0.3%7C38.25,-0.35').points.length, 4);
  assert.equal(L.parseMapsUrl('Mira: https://www.google.com/maps/place/Bar+Ruta/@38.70,-0.05,17z ok').points[0].name, 'Bar Ruta');
  assert.ok(L.isShortLink('https://maps.app.goo.gl/AbCd123')); assert.equal(L.parseMapsUrl('https://maps.app.goo.gl/AbCd123').error, 'short'); assert.ok(L.parseMapsUrl('hola').error);
});

t('ruta real de 16 puntos con nombres, barras codificadas y vuelta al inicio', function () {
  var u = 'https://www.google.com/maps/dir/Estaci%C3%B3n+de+Servicio+Repsol,+Av.+Universitat,+S.N,+03009+Alicante/38.4432762,-0.638148/38.573175,-0.5898003/38.6277134,-0.5664904/38.7074659,-0.6522081/38.7834206,-0.5171418/38.7818667,-0.4275188/38.7853859,-0.3364889/38.8149182,-0.3561771/Restaurante%2FAlbergue+del+Serpis,+Les+Fontetes,+s%2Fn,+03860+L%27Orxa,+Alicante/38.827928,-0.2751228/38.7689865,-0.2721261/38.741984,-0.3154749/GASOLINERA+BENILLOBA+LEYBL,+Avinguda+d%27Alcoi,+03810+Benilloba,+Alicante/38.5624587,-0.4702267/Estaci%C3%B3n+de+Servicio+Repsol,+Av.+Universitat,+S.N,+03009+Alicante/@38.4999052,-0.519574,68418m/data=!3m1!1e3!4m38!4m37!1m5!1m1!1s0xd62369501ec889f:0x8d1c38cd99db3471!2m2!1d-0.508851!2d38.3762127!1m0!1m0!1m0!1m0!1m0!1m0!1m0!1m0!1m5!1m1!1s0xd6192c4384d3cc7:0xf5574a55a858502e!2m2!1d-0.312078!2d38.8473991!1m0!1m0!1m0!1m5!1m1!1s0xd618944f4108b7d:0xba3391eabc4d9b8!2m2!1d-0.3865755!2d38.6988919!1m0!1m5!1m1!1s0xd62369501ec889f:0x8d1c38cd99db3471!2m2!1d-0.508851!2d38.3762127!3e0?entry=ttu&g_ep=XXXX';
  var r = L.parseMapsUrl(u);
  assert.equal(r.points.length, 16); assert.equal(r.unresolved.length, 0);
  assert.equal(r.points[0].lat, 38.3762127); assert.equal(r.points[9].name.indexOf('Restaurante/Albergue del Serpis'), 0); assert.equal(r.points[9].lat, 38.8473991);
  assert.equal(r.points[13].lon, -0.3865755); assert.equal(r.points[15].lat, r.points[0].lat);
});
t('encontrar la dirección de Maps en redirecciones y páginas', function () {
  var full = 'https://www.google.com/maps/dir/38.1,-0.2/38.3,-0.4/@38.2,-0.3,12z/data=!4m2!4m1!3e0?entry=ttu';
  assert.equal(L.findMapsUrl(full), full);
  assert.equal(L.findMapsUrl('https://consent.google.com/ml?continue=' + encodeURIComponent(full) + '&gl=ES&hl=es'), full);
  assert.equal(L.findMapsUrl('<html><a href="' + full.replace(/&/g, '&amp;') + '">x</a>'), full);
  assert.equal(L.findMapsUrl('window.location="' + full.replace(/\//g, '\\/') + '";'), full);
  assert.equal(L.findMapsUrl('intent://www.google.com/maps/dir/38.1,-0.2/38.3,-0.4#Intent;scheme=https;end'), 'https://www.google.com/maps/dir/38.1,-0.2/38.3,-0.4');
  assert.equal(L.findMapsUrl('content="0;url=' + encodeURIComponent(full) + '"'), full);
  assert.equal(L.findMapsUrl('https://www.google.com/maps/api/js?x=1 nada más'), null); assert.equal(L.findMapsUrl('hola'), null);
  assert.equal(L.parseMapsUrl(L.findMapsUrl('https://consent.google.com/ml?continue=' + encodeURIComponent(full))).points.length, 2);
});

var REAL = "https://www.google.com/maps/dir/Estaci%C3%B3n+de+Servicio+Repsol,+Av.+Universitat,+S.N,+03009+Alicante/38.4432762,-0.638148/38.573175,-0.5898003/38.6277134,-0.5664904/38.7074659,-0.6522081/38.7834206,-0.5171418/38.7818667,-0.4275188/38.7853859,-0.3364889/38.8149182,-0.3561771/Restaurante%2FAlbergue+del+Serpis,+Les+Fontetes,+s%2Fn,+03860+L'Orxa,+Alicante/38.827928,-0.2751228/38.7689865,-0.2721261/38.741984,-0.3154749/GASOLINERA+BENILLOBA+LEYBL,+Avinguda+d'Alcoi,+03810+Benilloba,+Alicante/38.5624587,-0.4702267/Estaci%C3%B3n+de+Servicio+Repsol,+Av.+Universitat,+S.N,+03009+Alicante/@38.5852972,-0.5436066,68396m/data=!3m1!1e3!4m38!4m37!1m5!1m1!1s0xd62369501ec889f:0x8d1c38cd99db3471!2m2!1d-0.508851!2d38.3762127!1m0!1m0!1m0!1m0!1m0!1m0!1m0!1m0!1m5!1m1!1s0xd6192c4384d3cc7:0xf5574a55a858502e!2m2!1d-0.312078!2d38.8473991!1m0!1m0!1m0!1m5!1m1!1s0xd618944f4108b7d:0xba3391eabc4d9b8!2m2!1d-0.3865755!2d38.6988919!1m0!1m5!1m1!1s0xd62369501ec889f:0x8d1c38cd99db3471!2m2!1d-0.508851!2d38.3762127!3e0?entry=ttu";
var EXPECT = [[38.3762127, -0.508851], [38.4432762, -0.638148], [38.573175, -0.5898003], [38.6277134, -0.5664904], [38.7074659, -0.6522081], [38.7834206, -0.5171418], [38.7818667, -0.4275188], [38.7853859, -0.3364889], [38.8149182, -0.3561771], [38.8473991, -0.312078], [38.827928, -0.2751228], [38.7689865, -0.2721261], [38.741984, -0.3154749], [38.6988919, -0.3865755], [38.5624587, -0.4702267], [38.3762127, -0.508851]];
t('enlace real tal cual se copia (con apóstrofos sin codificar): 16 puntos en orden', function () {
  [REAL, 'Ruta del domingo: ' + REAL + ' nos vemos', L.findMapsUrl(REAL), L.findMapsUrl('https://consent.google.com/ml?continue=' + encodeURIComponent(REAL) + '&gl=ES')].forEach(function (input, k) {
    var r = L.parseMapsUrl(input); assert.equal(r.points.length, 16, 'caso ' + k + ': ' + r.points.length + ' ' + (r.error || '')); assert.equal(r.unresolved.length, 0);
    assert.deepEqual(r.points.map(function (p) { return [p.lat, p.lon]; }), EXPECT);
    assert.equal(r.points[9].name, "Restaurante/Albergue del Serpis, Les Fontetes, s/n, 03860 L'Orxa, Alicante"); assert.equal(r.points[13].name.indexOf('GASOLINERA BENILLOBA'), 0);
  });
});
t('enlace corto: la redirección real de maps.app.goo.gl (cabecera Location con apóstrofos)', function () {
  var LOC = REAL.replace('@38.5852972,-0.5436066,68396m/data=!3m1!1e3!4m38', '@38.4999052,-0.519574,11.75z/data=!4m38').replace('?entry=ttu', '?entry=tts&g_ep=EgoyMDI2MTExMS4wIPu8ASoASAFQAw%3D%3D&skid=abc');
  var found = L.findMapsUrl(LOC); assert.equal(found, LOC);
  var r = L.parseMapsUrl(found); assert.equal(r.points.length, 16); assert.deepEqual(r.points.map(function (p) { return [p.lat, p.lon]; }), EXPECT);
});
t('Google Maps por tramos de 9 paradas como máximo', function () {
  var wps = EXPECT.map(function (p, i) { return [p[0], p[1], 'P' + i]; }), legs = L.mapsLegs(wps);
  assert.equal(legs.length, 2); assert.deepEqual([legs[0].from, legs[0].to, legs[1].from, legs[1].to], [1, 10, 10, 16]);
  legs.forEach(function (l) { var q = new URL(l.url).searchParams; assert.ok((q.get('waypoints') || '').split('|').filter(Boolean).length + 1 <= 9); });
  assert.equal(new URL(legs[1].url).searchParams.get('origin'), new URL(legs[0].url).searchParams.get('destination'));
  assert.equal(new URL(legs[1].url).searchParams.get('destination'), '38.376213,-0.508851');
  assert.equal(L.mapsLegs(wps.slice(0, 10)).length, 1); assert.equal(L.mapsLegs(wps.slice(0, 11)).length, 2); assert.equal(L.mapsLegs(wps.slice(0, 1)).length, 0);
});
t('GPX con paradas con nombre (wpt y rte) y trazado (trk)', function () {
  var g = L.planToGpx({ name: 'Serpis & vuelta', wps: [[38.3762127, -0.508851, 'Estación de Servicio Repsol, Av. Universitat'], [38.44, -0.63, ''], [38.8473991, -0.312078, "Restaurante/Albergue del Serpis, L'Orxa"]], coords: [[-0.508851, 38.3762127], [-0.6, 38.4], [-0.312078, 38.8473991]] }, 0);
  assert.ok(g.indexOf('<gpx version="1.1"') > 0 && g.indexOf('xmlns="http://www.topografix.com/GPX/1/1"') > 0);
  assert.equal((g.match(/<wpt /g) || []).length, 3); assert.equal((g.match(/<rtept /g) || []).length, 3); assert.equal((g.match(/<trkpt /g) || []).length, 3);
  assert.ok(g.indexOf('<name>01 Estación de Servicio Repsol</name>') > 0); assert.ok(g.indexOf('<name>02 Punto 2</name>') > 0); assert.ok(g.indexOf('<name>03 Restaurante/Albergue del Serpis</name>') > 0);
  assert.ok(g.indexOf('<name>Serpis &amp; vuelta</name>') > 0); assert.ok(g.indexOf('L&apos;Orxa') > 0); assert.ok(g.indexOf('<trkpt lat="38.376213" lon="-0.508851"/>') > 0);
  assert.ok(g.indexOf('<wpt') < g.indexOf('<rte>') && g.indexOf('<rte>') < g.indexOf('<trk>'));
});
t('grupo: orden, quién se queda atrás, fuera de ruta y sin señal', function () {
  var now = 1e9, row = function (id, along, extra) { return Object.assign({ user_id: id, name: id, lat: 38, lon: 0, along: along, off: false, at: now - 5000 }, extra || {}); };
  var g = L.rankGroup([row('a', 12000), row('yo', 11500), row('b', 11000), row('lento', 6000), row('fuera', 11800, { off: true }), row('mudo', 9000, { at: now - 200000 }), { user_id: 'espera', name: 'x', lat: null, lon: null, along: null, at: now }], 'yo', now);
  assert.deepEqual(g.list.map(function (x) { return x.user_id; }), ['a', 'fuera', 'yo', 'b', 'mudo', 'lento']);
  var by = {}; g.list.forEach(function (x) { by[x.user_id] = x; });
  assert.ok(by.lento.behind && !by.b.behind && by.fuera.off && by.mudo.stale && !by.mudo.behind && by.yo.me);
  assert.equal(by.a.gap, 500); assert.equal(by.lento.gap, -5500); assert.equal(g.behind, 3); assert.equal(g.waiting, 1); assert.equal(g.total, 6);
});

// Ruta recta hacia el este por el paralelo 38.6 (unos 35 km), con un giro a mitad.
var coords = []; for (var i = 0; i <= 40; i++) coords.push([-0.5 + i * 0.01, 38.6]);
var steps = [{ lat: 38.6, lon: -0.3, text: 'gira a la derecha', icon: 'right', name: 'CV-70' }, { lat: 38.6, lon: -0.1, text: 'has llegado al final de la ruta', icon: 'arrive', name: '' }];
function run(tr, pts, v, t0) { var out = [], now = t0 || 0; pts.forEach(function (p) { now += 1000; var r = tr.update({ lat: p[1], lon: p[0], acc: 8, v: v }, now); r.events.forEach(function (e) { out.push(e); }); out.last = r; }); out.now = now; return out; }
function seg(lon0, lon1, lat, stepM) { var o = [], d = stepM / 87000 * (lon1 > lon0 ? 1 : -1); for (var x = lon0; (d > 0 ? x <= lon1 : x >= lon1); x += d) o.push([x, lat]); return o; }

t('progreso y anuncios de giro', function () {
  var tr = L.Tracker(coords, steps), ev = run(tr, seg(-0.5, -0.29, 38.6, 20), 20);
  var says = ev.filter(function (e) { return e.type === 'say'; }).map(function (e) { return e.text; });
  assert.equal(ev[0].type, 'start'); assert.equal(says.length, 2, says.join(' | '));
  assert.ok(/^En \d+ metros, gira a la derecha$/.test(says[0]), says[0]); assert.equal(says[1], 'Gira a la derecha');
  assert.ok(ev.last.next && ev.last.next.icon === 'arrive'); assert.ok(Math.abs(ev.last.remaining - 87000 * 0.19) < 600, ev.last.remaining);
});
t('pasarse una salida avisa una vez y vuelve al regresar', function () {
  var tr = L.Tracker(coords, steps), ev = run(tr, seg(-0.5, -0.45, 38.6, 20), 20);
  var off = []; for (var k = 1; k <= 30; k++) off.push([-0.45 + k * 0.00023, 38.6 + k * 0.00018]);   // se va desviando al noreste
  var e2 = run(tr, off, 20, ev.now);
  assert.equal(e2.filter(function (e) { return e.type === 'off'; }).length, 1); assert.ok(e2.last.offRoute);
  var e3 = run(tr, seg(-0.44, -0.42, 38.6, 20), 20, e2.now);
  assert.equal(e3.filter(function (e) { return e.type === 'back'; }).length, 1); assert.ok(!e3.last.offRoute);
});
t('parado fuera de la ruta (gasolinera) no avisa; antes de empezar tampoco', function () {
  var tr = L.Tracker(coords, steps), ev = run(tr, seg(-0.5, -0.45, 38.6, 20), 20);
  var stopped = []; for (var k = 0; k < 40; k++) stopped.push([-0.45, 38.6012]);
  assert.equal(run(tr, stopped, 0, ev.now).filter(function (e) { return e.type === 'off'; }).length, 0);
  var tr2 = L.Tracker(coords, steps), far = []; for (k = 0; k < 40; k++) far.push([-0.6 + k * 0.0002, 38.7]);
  assert.equal(run(tr2, far, 20).filter(function (e) { return e.type === 'off'; }).length, 0);
});
t('ida y vuelta por la misma carretera no salta de sentido', function () {
  var out = seg(-0.5, -0.4, 38.6, 100), loop = out.concat(out.slice(0, -1).reverse()), tr = L.Tracker(loop, []);
  var ev = run(tr, seg(-0.5, -0.4, 38.6, 20).concat(seg(-0.4, -0.45, 38.6, 20)), 20);
  assert.ok(ev.last.along > tr.line.total * 0.7, ev.last.along + ' de ' + tr.line.total);
});
t('ruta circular: al salir no se da por terminada y acaba al volver', function () {
  var sq = seg(-0.5, -0.45, 38.6, 100); var up = []; for (var y = 38.6; y <= 38.63; y += 0.001) up.push([-0.45, y]);
  var back = seg(-0.45, -0.5, 38.63, 100), down = []; for (y = 38.63; y >= 38.6; y -= 0.001) down.push([-0.5, y]);
  var loop = sq.concat(up, back, down, [[-0.5, 38.6]]), tr = L.Tracker(loop, []);
  var ev = run(tr, [[-0.50002, 38.60003], [-0.5001, 38.59995], [-0.4998, 38.60001], [-0.4995, 38.6]], 5);
  assert.ok(!ev.last.finished && ev.last.along < 300, 'along ' + ev.last.along);
  var e2 = run(tr, sq.concat(up, back, down), 25, ev.now);
  assert.ok(e2.last.finished, 'restan ' + e2.last.remaining); assert.equal(e2.filter(function (e) { return e.type === 'off'; }).length, 0);
});
t('fin de ruta y punto de reenganche por delante', function () {
  var tr = L.Tracker(coords, steps), ev = run(tr, seg(-0.5, -0.1, 38.6, 40), 25);
  assert.equal(ev.filter(function (e) { return e.type === 'finish'; }).length, 1);
  var rj = L.rejoinTarget({ lat: 38.62, lon: -0.35 }, L.makeLine(coords), 0);
  assert.ok(rj.off > 2000 && rj.lon > -0.33 && !rj.finished, JSON.stringify(rj));
  assert.ok(L.rejoinTarget({ lat: 38.6, lon: -0.35 }, L.makeLine(coords), 0).off < 5);
});
t('pasos de OSRM a indicaciones', function () {
  var route = { legs: [{ steps: [
    { name: 'A', maneuver: { type: 'depart', location: [0, 0] } },
    { name: 'B', maneuver: { type: 'new name', modifier: 'straight', location: [0, 0] } },
    { name: 'CV-70', maneuver: { type: 'turn', modifier: 'left', location: [-0.3, 38.6] } },
    { name: '', maneuver: { type: 'roundabout', exit: 2, location: [-0.2, 38.6] } },
    { name: '', maneuver: { type: 'exit roundabout', location: [-0.2, 38.6] } },
    { name: '', maneuver: { type: 'arrive', location: [-0.1, 38.6] } }] }] };
  var s = L.stepsFromOsrm(route);
  assert.deepEqual(s.map(function (x) { return x.text; }), ['gira a la izquierda', 'en la rotonda, toma la segunda salida', 'has llegado al final de la ruta']);
  assert.equal(L.fmtDist(1234), '1,2 km'); assert.equal(L.fmtDist(340), '350 m'); assert.equal(L.spokenDist(320), '300 metros');
});
// GPX con la forma del que exporta OsmAnd: rte con extensiones y sin nombres, trk con altitud y sin horas.
function osmandGpx() {
  var h = seg(-0.5, -0.3, 38.6, 40); h.push([-0.3, 38.6]);
  var pts = h.concat((function () { var o = []; for (var y = 38.60025; y <= 38.7; y += 0.00025) o.push([-0.3, y]); return o; })());
  var rte = [pts[0], pts[h.length - 1], pts[pts.length - 1]];
  return { pts: pts, corner: h.length - 1, text: "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>\n<gpx version=\"1.1\" creator=\"OsmAndRouterV2\" xmlns=\"http://www.topografix.com/GPX/1/1\" xmlns:osmand=\"https://osmand.net\">\n  <metadata>\n    <name>2026-11-15 Motorcycle 28 km</name>\n  </metadata>\n  <rte>\n" +
    rte.map(function (c, i) { return '    <rtept lat="' + c[1] + '" lon="' + c[0] + '">\n      <extensions>\n        <osmand:profile>motorcycle</osmand:profile>\n        <osmand:trkpt_idx>' + i + '</osmand:trkpt_idx>\n      </extensions>\n    </rtept>\n'; }).join('') +
    '  </rte>\n  <trk>\n    <trkseg>\n' + pts.map(function (c) { return '      <trkpt lat="' + c[1] + '" lon="' + c[0] + '">\n        <ele>90.5</ele>\n      </trkpt>\n'; }).join('') + '    </trkseg>\n  </trk>\n</gpx>' };
}
t('GPX de OsmAnd: trazado completo, paradas del rte y sin horas', function () {
  var o = osmandGpx(), g = L.gpxToPlan(o.text);
  assert.equal(g.name, '2026-11-15 Motorcycle 28 km'); assert.equal(g.coords.length, o.pts.length); assert.equal(g.wps.length, 3);
  assert.equal(g.timed, false); assert.equal(g.route, false);
  assert.ok(Math.abs(g.wps[1][0] - 38.6) < 1e-6 && Math.abs(g.wps[1][1] + 0.3) < 1e-3, JSON.stringify(g.wps[1]));
  assert.ok(Math.abs(L.makeLine(g.coords).total - 28500) < 600, String(L.makeLine(g.coords).total));
});
t('GPX: el nuestro vuelve igual, con horas es grabado, solo puntos sueltos hay que calcularlo, y lo que no es GPX se rechaza', function () {
  var plan = { name: 'Prueba & cía', wps: [[38.1, -0.5, 'Salida <A>'], [38.2, -0.6, "L'Orxa"]], coords: [[-0.5, 38.1], [-0.55, 38.15], [-0.6, 38.2]] };
  var g = L.gpxToPlan(L.planToGpx(plan));
  assert.equal(g.name, 'Prueba & cía'); assert.deepEqual(g.wps.map(function (w) { return w.slice(0, 3); }), plan.wps); assert.deepEqual(g.coords, plan.coords);
  var rec = '<gpx><trk><trkseg><trkpt lon="-0.5" lat="38.1"><time>2026-11-15T10:00:00Z</time></trkpt><trkpt lat="38.2" lon="-0.6"><time>2026-11-15T10:01:00Z</time></trkpt></trkseg></trk></gpx>';
  var r = L.gpxToPlan(rec); assert.equal(r.timed, true); assert.deepEqual(r.coords, [[-0.5, 38.1], [-0.6, 38.2]]); assert.equal(r.wps[0][2], 'Salida');
  var only = L.gpxToPlan('<gpx><rte><rtept lat="38.1" lon="-0.5"><name>Bar</name></rtept><rtept lat="38.2" lon="-0.6"/></rte></gpx>');
  assert.equal(only.route, true); assert.deepEqual(only.wps, [[38.1, -0.5, 'Bar', 'food'], [38.2, -0.6, '']]);
  assert.throws(function () { L.gpxToPlan('<html>hola</html>'); }, /No es un archivo GPX/);
  assert.throws(function () { L.gpxToPlan('<gpx></gpx>'); }, /ninguna ruta/);
});
t('GPX: indicaciones de giro solo de los tramos donde OSRM va por la misma carretera', function () {
  var o = osmandGpx(), line = L.makeLine(L.gpxToPlan(o.text).coords), vias = L.viaPoints(line, 1500);
  assert.ok(vias.length >= 18 && vias[0].along === 0 && Math.abs(vias[vias.length - 1].along - line.total) < 1);
  var corner = line.cum[o.corner], k = 0; while (vias[k + 1].along < corner) k++;      // tramo que contiene la esquina
  var legs = vias.slice(0, -1).map(function (v, i) {
    var seg = vias[i + 1].along - v.along, steps = [{ maneuver: { type: 'depart', location: [v.lon, v.lat] } }];
    if (i === k) steps.push({ name: 'CV-70', maneuver: { type: 'turn', modifier: 'left', location: [-0.3, 38.6] } });
    if (i === 2) steps.push({ name: 'Atajo', maneuver: { type: 'turn', modifier: 'right', location: [v.lon, v.lat] } });      // tramo por otra carretera
    if (i === 4) steps.push({ name: '', maneuver: { type: 'turn', modifier: 'uturn', location: [v.lon, v.lat] } }, { name: 'Lejos', maneuver: { type: 'turn', modifier: 'right', location: [v.lon, v.lat + 0.01] } });
    steps.push({ maneuver: { type: 'arrive', location: [vias[i + 1].lon, vias[i + 1].lat] } });
    return { distance: i === 2 ? seg * 1.6 : seg * 1.02, duration: seg / 20, steps: steps };
  });
  var r = L.trackSteps({ legs: legs }, vias, 0, line, true);
  assert.equal(r.bad, 1); assert.equal(r.ok, legs.length - 1);
  assert.deepEqual(r.steps.map(function (s) { return s.text; }), ['gira a la izquierda', 'has llegado al final de la ruta']);
  assert.ok(Math.abs(r.steps[0].along - corner) < 30, r.steps[0].along + ' vs ' + corner);
  var tr = L.Tracker(line.c, r.steps); assert.ok(Math.abs(tr.steps[0].along - corner) < 30); assert.ok(Math.abs(tr.steps[1].along - line.total) < 30);
  var mid = L.trackSteps({ legs: legs.slice(0, 3) }, vias, 0, line, false); assert.equal(mid.steps.filter(function (s) { return s.icon === 'arrive'; }).length, 0);
});
t('GPX con puntos marcados aparte (gasolineras, bar…): salen como puntos de interés, no como paradas', function () {
  var o = osmandGpx();
  var wpts = '  <wpt lat="38.6002" lon="-0.4"><name>Repsol Ibi</name><extensions><osmand:icon>fuel</osmand:icon><osmand:background>circle</osmand:background></extensions></wpt>\n' +
    '  <wpt lat="38.65" lon="-0.3001"><name>Almuerzo</name><type>Restaurant</type></wpt>\n  <wpt lat="38.69" lon="-0.3"><name>Foto</name><sym>Scenic Area</sym></wpt>\n' +
    '  <wpt lat="38.6" lon="-0.45"><name>Punto de reagrupamiento</name></wpt>\n  <wpt lat="' + o.pts[0][1] + '" lon="' + o.pts[0][0] + '"><name>Salida</name></wpt>\n';
  var g = L.gpxToPlan(o.text.replace('  <rte>', wpts + '  <rte>'));
  assert.equal(g.wps.length, 3, 'las paradas siguen siendo las del rte');
  assert.deepEqual(g.pois.map(function (p) { return p[2] + ':' + p[3]; }), ['Punto de reagrupamiento:poi', 'Repsol Ibi:fuel', 'Almuerzo:food', 'Foto:view'], 'en el orden del recorrido y sin repetir la salida');
  // sin rte: si los wpt son gasolineras y demás, la ruta va de principio a fin y ellos son puntos de interés
  var g2 = L.gpxToPlan(o.text.replace(/  <rte>[\s\S]*<\/rte>\n/, wpts));
  assert.deepEqual(g2.wps.map(function (w) { return w[2]; }), ['Salida', 'Llegada']); assert.equal(g2.pois.length, 4);
  // nuestro GPX conserva los puntos de interés al volver a importarlo
  var back = L.gpxToPlan(L.planToGpx({ name: 'X', wps: g.wps, coords: g.coords, pois: g.pois }));
  assert.equal(back.wps.length, 3); assert.deepEqual(back.pois.map(function (p) { return p[3]; }), ['poi', 'fuel', 'food', 'view']);
  assert.equal(L.poiKind('E.S. Cepsa'), 'fuel'); assert.equal(L.poiKind('Bar Paco'), 'food'); assert.equal(L.poiKind('Barranco'), 'poi');
});
t('Ir a la salida: una ruta circular no se da por empezada al pasar junto a otro tramo', function () {
  var sq = seg(-0.5, -0.4, 38.5, 50).concat([[-0.4, 38.5]]);
  for (var y = 38.5005; y <= 38.56; y += 0.0005) sq.push([-0.4, y]);
  for (var x = -0.4005; x >= -0.5; x -= 0.0005) sq.push([x, 38.56]);
  for (y = 38.5595; y >= 38.5; y -= 0.0005) sq.push([-0.5, y]);
  var mid = { lat: 38.56, lon: -0.45, v: 15, acc: 5 };                     // en el lado de arriba, lejos de la salida
  var a = L.Tracker(sq, []), b = L.Tracker(sq, [], { fromStart: true });
  assert.equal(a.update(mid, 0).started, true, 'sin la opción, empieza por donde pilla');
  var r = b.update(mid, 0); assert.equal(r.started, false); assert.ok(r.off > 5000, 'distancia hasta la salida: ' + r.off);
  r = b.update({ lat: 38.5, lon: -0.4995, v: 10, acc: 5 }, 1000); assert.equal(r.started, true); assert.ok(r.along < 100);
  r = b.update({ lat: 38.5, lon: -0.45, v: 20, acc: 5 }, 2000); assert.ok(r.started && !r.offRoute && r.along > 4000, 'y luego sigue normal');
});
t('Nota de cada motero: nivel elegido, historial y medición de hoy', function () {
  assert.deepEqual(L.riderScore({}), { score: 3, known: false });
  assert.equal(L.riderScore({ level: 5 }).score, 5); assert.equal(L.riderScore({ level: 1 }).score, 1);
  assert.equal(L.paceScore(35, 14), 1); assert.equal(L.paceScore(85, 40), 5); assert.ok(Math.abs(L.paceScore(60, 27) - 3) < 0.01);
  var fast = L.riderScore({ level: 2, hr: 12, hs: 80, hl: 38 }), slow = L.riderScore({ level: 5, hr: 12, hs: 40, hl: 16 });
  assert.ok(fast.score > slow.score, 'el historial pesa más que lo que uno dice de sí mismo: ' + fast.score + ' vs ' + slow.score);
  assert.equal(L.riderScore({ level: 3, hr: 1, hs: 90, hl: 45 }).score, 3, 'con una sola ruta aún no hay historial');
  assert.equal(L.riderScore({ level: 3, pm: 4, ps: 90, pl: 45 }).score, 3, 'con 4 minutos aún no hay medición');
  assert.ok(L.riderScore({ level: 3, pm: 25, ps: 85, pl: 40 }).score > 3.5);
  assert.equal(L.LEVELS.length, 6);
});
t('Grupos por ritmo: parejos, del más rápido al más tranquilo y con un administrador de guía en cada uno', function () {
  var rows = []; for (var i = 0; i < 13; i++) rows.push({ user_id: 'u' + i, name: 'M' + String(i).padStart(2, '0'), level: 1 + (i % 5), admin: i === 0 || i === 7 || i === 12 });
  var g = L.makeGroups(rows, 5);
  assert.deepEqual(g.map(function (x) { return x.members.length; }), [5, 4, 4]);
  var all = [].concat.apply([], g.map(function (x) { return x.members.map(function (m) { return m.id; }); }));
  assert.equal(all.length, 13); assert.equal(all.filter(function (id, k) { return all.indexOf(id) === k; }).length, 13, 'nadie repetido ni fuera');
  assert.deepEqual(g.map(function (x) { return x.guide; }), ['u7', 'u12', 'u0'], 'los administradores guían, el más rápido al primer grupo');
  g.forEach(function (x) { assert.equal(x.members[0].id, x.guide); });
  var avg = g.map(function (x) { var m = x.members.slice(1); return m.reduce(function (a, b) { return a + b.score; }, 0) / m.length; });
  assert.ok(avg[0] > avg[1] && avg[1] > avg[2], 'ritmo medio decreciente: ' + avg.join(', '));
  assert.deepEqual(L.makeGroups(rows.slice(0, 6), 5).map(function (x) { return x.members.length; }), [3, 3], 'seis en grupos de cinco: dos de tres, no cinco y uno');
  assert.deepEqual(L.makeGroups(rows.slice(1, 4), 8).map(function (x) { return [x.members.length, x.guide]; }), [[3, null]]);
  assert.deepEqual(L.makeGroups([], 5), []);
});
// GPX con la forma del que exporta MyRouteApp: todo en una línea, rte con nombres («#1», o el que se le haya puesto) y
// extensiones de Garmin (ViaPoint / ShapingPoint), sin wpt, y el trk con lon antes que lat.
function myRouteAppGpx() {
  var o = osmandGpx(), pts = o.pts, at = function (i) { return 'lat="' + pts[i][1] + '" lon="' + pts[i][0] + '"'; }, last = pts.length - 1;
  var rte = [[0, '#1', 'ViaPoint'], [20, 'PARADA DE REAGRUPACIÓN', 'ShapingPoint'], [o.corner, '#3', 'ShapingPoint'], [o.corner, '#4', 'ShapingPoint'], [o.corner + 150, 'Repsol Ibi', 'ShapingPoint'], [last, '#6', 'ViaPoint']];
  return { pts: pts, corner: o.corner, text: '<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="MyRouteApp" xmlns="http://www.topografix.com/GPX/1/1" xmlns:trp="http://www.garmin.com/xmlschemas/TripExtensions/v1"><metadata><time>2026-11-15T19:48:31+00:00</time></metadata><rte><name>2026-11-15 Motorcycle 28 km</name>' +
    rte.map(function (r) { return '<rtept ' + at(r[0]) + '><name>' + r[1] + '</name><extensions><trp:' + r[2] + '/></extensions></rtept>'; }).join('') + '</rte><trk><name>Track-2026-11-15 Motorcycle 28 km</name><trkseg>' +
    pts.map(function (c) { return '<trkpt lon="' + c[0] + '" lat="' + c[1] + '"/>'; }).join('') + '</trkseg></trk></gpx>' };
}
t('GPX de MyRouteApp: las paradas con nombre se distinguen de los puntos de relleno («#3») y se avisan durante la ruta', function () {
  var o = myRouteAppGpx(), g = L.gpxToPlan(o.text);
  assert.equal(g.name, '2026-11-15 Motorcycle 28 km'); assert.equal(g.coords.length, o.pts.length); assert.equal(g.timed, false);
  assert.deepEqual(g.wps.map(function (w) { return w[2] + '|' + (w[3] || ''); }), ['|', 'PARADA DE REAGRUPACIÓN|stop', '|', 'Repsol Ibi|fuel', '|'], 'sin «#N», sin el punto repetido, y cada parada con su tipo');
  var line = L.makeLine(g.coords), st = L.stopSteps(g, line);
  assert.deepEqual(st.map(function (x) { return x.text; }), ['parada de reagrupación', 'gasolinera: Repsol Ibi']);
  assert.ok(Math.abs(st[0].along - line.cum[20]) < 30 && Math.abs(st[1].along - line.cum[o.corner + 150]) < 30);
  // mezcladas con los giros, en orden, y el seguimiento las anuncia como un giro más
  g.steps = [{ lat: 38.6, lon: -0.3, text: 'gira a la izquierda', icon: 'left', name: 'CV-70' }];
  var all = L.navSteps(g); assert.deepEqual(all.map(function (x) { return x.icon; }), ['stop', 'left', 'stop']);
  var tr = L.Tracker(g.coords, all), said = [], p0 = o.pts[0];
  for (var i = 0; i <= 24; i++) tr.update({ lat: o.pts[i][1], lon: o.pts[i][0], v: 14, acc: 5 }, i * 3000).events.forEach(function (e) { if (e.type === 'say') said.push(e.text); });
  assert.ok(/^En \d+ metros, parada de reagrupación$/.test(said[0]), said.join(' / ')); assert.equal(said[1], 'Parada de reagrupación');
  // una gasolinera marcada aparte (wpt) junto al trazado también se anuncia; una que queda lejos, no
  g.pois = [[o.pts[30][1], o.pts[30][0], 'Cepsa', 'fuel'], [39.5, -0.3, 'Lejos', 'fuel']];
  assert.deepEqual(L.stopSteps(g, line).map(function (x) { return x.text; }), ['parada de reagrupación', 'gasolinera: Cepsa', 'gasolinera: Repsol Ibi']);
  // nuestro GPX conserva nombres y tipos
  var back = L.gpxToPlan(L.planToGpx(g)); assert.deepEqual(back.wps.map(function (w) { return w[2]; }), ['Salida', 'PARADA DE REAGRUPACIÓN', '', 'Repsol Ibi', 'Llegada']);
});
t('Consejo de nivel: solo con datos de sobra y cuando la diferencia es de un nivel o más', function () {
  var st = function (rides, hours, kmh, corners, lean) { return { rides: rides, km: kmh * hours, moving_s: hours * 3600, corners: corners, lean_sum: corners * lean }; };
  assert.equal(L.levelAdvice(5, st(2, 10, 45, 300, 18)), null, 'dos rutas no bastan');
  assert.equal(L.levelAdvice(5, st(8, 1.5, 45, 300, 18)), null, 'ni hora y media');
  assert.equal(L.levelAdvice(5, st(8, 10, 45, 20, 18)), null, 'ni veinte curvas');
  var down = L.levelAdvice(5, st(8, 10, 48, 300, 20));
  assert.equal(down.dir, 'down'); assert.equal(down.suggest, 2); assert.equal(down.speed, 48); assert.equal(down.lean, 20); assert.equal(down.rides, 8);
  assert.equal(L.levelAdvice(5, st(8, 10, 80, 300, 38)), null, 'el que va rápido de verdad se queda como está');
  assert.equal(L.levelAdvice(4, st(8, 10, 70, 300, 33)), null, 'medio nivel de diferencia no se discute');
  var up = L.levelAdvice(1, st(8, 10, 75, 300, 36)); assert.equal(up.dir, 'up'); assert.equal(up.suggest, 4);
  var set = L.levelAdvice(null, st(8, 10, 60, 300, 27)); assert.equal(set.dir, 'set'); assert.equal(set.suggest, 3);
  assert.equal(L.levelAdvice(3, null), null);
});
t('Punto de salida: coordenadas de un enlace de mapa a un sitio', function () {
  var P = function (u) { var r = L.parseMapsPoint(u); return r ? r.lat.toFixed(4) + ',' + r.lon.toFixed(4) + (r.name ? ' ' + r.name : '') : null; };
  assert.equal(P('https://www.google.com/maps/place/Repsol/@38.3790,-0.5120,17z/data=!3m1!4b1!4m6!3m5!1s0xd62:0x1!8m2!3d38.3762!4d-0.5088!16s%2Fg%2F1'), '38.3762,-0.5088 Repsol', 'el sitio, no el centro de la pantalla');
  assert.equal(P('https://www.google.com/maps?q=38.3762,-0.5088'), '38.3762,-0.5088');
  assert.equal(P('https://maps.google.com/?q=loc:38.3762,-0.5088&z=16'), '38.3762,-0.5088');
  assert.equal(P('https://www.google.com/maps/search/?api=1&query=38.3762%2C-0.5088'), '38.3762,-0.5088');
  assert.equal(P('https://www.google.es/maps/@38.3762,-0.5088,15z'), '38.3762,-0.5088');
  assert.equal(P('https://www.google.com/maps/place/38.3762,-0.5088'), '38.3762,-0.5088');
  assert.equal(P('https://www.google.com/maps/dir/?api=1&destination=38.3762,-0.5088'), '38.3762,-0.5088');
  assert.equal(P('Quedamos aquí: https://www.google.com/maps/place/Bar+Pepe,+Ibi/@38.62,-0.57,17z/data=!4m2!3m1!1s0x0:0x0.'), '38.6200,-0.5700 Bar Pepe');
  assert.equal(P('https://maps.apple.com/?ll=38.3762,-0.5088&q=Salida'), '38.3762,-0.5088');
  assert.equal(P('geo:38.3762,-0.5088?z=17'), '38.3762,-0.5088');
  assert.equal(P('38.3762, -0.5088'), '38.3762,-0.5088');
  assert.equal(P('https://maps.app.goo.gl/AbCdEf123'), null, 'el enlace corto no lleva coordenadas: hay que abrirlo');
  assert.equal(P('https://www.google.com/maps/place/Bar+Pepe'), null);
  assert.equal(P('https://www.google.com/maps?q=Gasolinera+Repsol+Ibi'), null);
  assert.equal(P('Gasolinera de la rotonda'), null);
  assert.equal(P('https://www.google.com/maps?q=138.3,-0.5'), null, 'latitud imposible');
  assert.equal(L.mapsPointUrl(38.3762, -0.5088, 'Repsol'), 'https://www.google.com/maps/search/?api=1&query=38.376200,-0.508800');
  assert.equal(L.mapsPointUrl(null, null, 'Bar Pepe, Ibi'), 'https://www.google.com/maps/search/?api=1&query=Bar%20Pepe%2C%20Ibi');
  assert.equal(L.mapsPointUrl(null, null, ''), null);
});
console.log('rg-lib: ' + n + ' pruebas correctas');
