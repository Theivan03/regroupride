/* ReGroupRide — lógica pura (sin DOM): leer enlaces de Google Maps y seguir una ruta.
   Líneas como [[lon, lat], ...] (igual que las rutas planificadas). Posiciones como {lat, lon}.
   Probado en tools/test-rg.js. */
var RGLib = (function () {
  var R = 6371000, rad = function (d) { return d * Math.PI / 180; };
  function dist(lat1, lon1, lat2, lon2) {
    var dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /* ================= enlaces de Google Maps ================= */
  var COORD = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
  function okLL(lat, lon) { return isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180; }
  function coordText(s) { var m = String(s || '').match(COORD); if (!m) return null; var lat = parseFloat(m[1]), lon = parseFloat(m[2]); return okLL(lat, lon) ? { lat: lat, lon: lon } : null; }
  function decodeSeg(s) { try { return decodeURIComponent(s.replace(/\+/g, ' ')).trim(); } catch (e) { return s.replace(/\+/g, ' ').trim(); } }
  function isShortLink(u) { return /^(https?:\/\/)?(maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(String(u).trim()); }
  function extractUrl(t) { var m = String(t || '').match(/https?:\/\/[^\s<>"]+/i); return m ? m[0].replace(/[)\].,;'»]+$/, '') : null; }
  // Busca una dirección de Google Maps dentro de un texto: una URL, una cabecera de redirección o una página.
  // Google a veces la manda dentro de otra (pantalla de cookies: ...?continue=<url>), escapada o como enlace de app.
  function findMapsUrl(text) {
    var t0 = String(text || '').trim();
    var WHOLE = /^https?:\/\/(?:www\.|maps\.)?google\.[a-z.]+\/maps\/[^\s<>"]+$/i;
    if (WHOLE.test(t0)) return t0;   // ya es la dirección (puede llevar apóstrofos)
    var t = t0, RE = /https?:\/\/(?:www\.|maps\.)?google\.[a-z.]+\/maps[^\s"'<>\\]*/i, i, m, v;
    var forms = [t, t.replace(/\\u003d/gi, '=').replace(/\\u0026/gi, '&').replace(/\\\//g, '/').replace(/&amp;/g, '&')];
    for (i = 0; i < forms.length; i++) {
      m = forms[i].match(/[?&](?:continue|link|url|q)=(https?(?::|%3A)[^&\s"<>]+)/i);
      if (m) { try { v = decodeURIComponent(m[1]); } catch (e) { v = m[1]; } if (RE.test(v) && /\/maps\/(dir|place|@|search)|[?&]q=/.test(v)) return WHOLE.test(v) ? v : v.match(RE)[0]; }
      m = forms[i].match(RE); if (m && !/\/maps\/(api|vt|preview|rpc|_)/.test(m[0])) return m[0];
      m = forms[i].match(/intent:\/\/((?:www\.|maps\.)?google\.[a-z.]+\/maps[^\s"'<>#]*)/i); if (m) return 'https://' + m[1];
      m = forms[i].match(/https?%3A%2F%2F(?:www\.|maps\.)?google\.[a-z.]+%2Fmaps[^\s"'<>&]*/i); if (m) { try { return decodeURIComponent(m[0]); } catch (e) {} }
    }
    return null;
  }
  // Mete un punto de paso donde menos alarga el recorrido.
  function insertByDetour(pts, via) {
    if (pts.length < 2) return pts.concat([via]);
    var bi = 1, bc = Infinity;
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i], c = dist(a.lat, a.lon, via.lat, via.lon) + dist(via.lat, via.lon, b.lat, b.lon) - dist(a.lat, a.lon, b.lat, b.lon);
      if (c < bc) { bc = c; bi = i; }
    }
    return pts.slice(0, bi).concat([via], pts.slice(bi));
  }
  /* Devuelve { points: [{lat, lon, name, via}], unresolved: [nombres], error } */
  function parseMapsUrl(input) {
    var raw = extractUrl(input) || String(input || '').trim(), u;
    try { u = new URL(raw); } catch (e) { return { points: [], unresolved: [], error: 'No parece un enlace válido.' }; }
    if (!/google\.[a-z.]+$/i.test(u.hostname)) {
      if (isShortLink(raw)) return { points: [], unresolved: [], error: 'short' };
      return { points: [], unresolved: [], error: 'El enlace no es de Google Maps.' };
    }
    var qp = u.searchParams, points = [], unresolved = [], i;
    if (qp.get('api') === '1' && (qp.get('destination') || qp.get('origin'))) {
      var names = [qp.get('origin')].concat((qp.get('waypoints') || '').split('|'), [qp.get('destination')]).filter(function (x) { return x && x.trim(); });
      names.forEach(function (n) { var c = coordText(n); if (c) points.push({ lat: c.lat, lon: c.lon, name: '' }); else unresolved.push(n); });
      return { points: points, unresolved: unresolved };
    }
    var path = u.pathname, di = path.indexOf('/dir/');
    if (di >= 0) {
      var segs = [], parts = path.slice(di + 5).split('/');
      for (i = 0; i < parts.length; i++) { if (/^(@|data=|am=)/.test(parts[i])) break; segs.push(decodeSeg(parts[i])); }
      var data = (path.match(/\/data=([^/?#]+)/) || [])[1] || '', m;
      var place = [], via = [], re1 = /!2m2!1d(-?[\d.]+)!2d(-?[\d.]+)/g, re2 = /!3m4!1m2!1d(-?[\d.]+)!2d(-?[\d.]+)/g;
      while ((m = re1.exec(data))) place.push({ lat: parseFloat(m[2]), lon: parseFloat(m[1]) });
      while ((m = re2.exec(data))) via.push({ lat: parseFloat(m[2]), lon: parseFloat(m[1]) });
      var ne = segs.filter(function (s) { return s !== ''; }), named = ne.filter(function (s) { return !coordText(s); });
      var all = place.length === ne.length, pi = 0;
      ne.forEach(function (s) {
        var c = coordText(s);
        if (all) { var p = place[pi++]; points.push({ lat: p.lat, lon: p.lon, name: c ? '' : s }); }
        else if (c) points.push({ lat: c.lat, lon: c.lon, name: '' });
        else if (place.length >= named.length && pi < place.length) { var q = place[pi++]; points.push({ lat: q.lat, lon: q.lon, name: s }); }
        else unresolved.push(s);
      });
      via.forEach(function (v) { if (okLL(v.lat, v.lon)) points = insertByDetour(points, { lat: v.lat, lon: v.lon, name: '', via: true }); });
      if (!points.length && !unresolved.length) return { points: [], unresolved: [], error: 'El enlace no tiene puntos de ruta.' };
      return { points: points, unresolved: unresolved };
    }
    var q1 = coordText(qp.get('q') || qp.get('query') || '');
    if (q1) return { points: [{ lat: q1.lat, lon: q1.lon, name: '' }], unresolved: [] };
    var at = path.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (at) { var nm = (path.match(/\/place\/([^/]+)/) || [])[1]; return { points: [{ lat: parseFloat(at[1]), lon: parseFloat(at[2]), name: nm ? decodeSeg(nm) : '' }], unresolved: [] }; }
    return { points: [], unresolved: [], error: 'No he encontrado puntos en el enlace.' };
  }

  /* ================= abrir en Google Maps por tramos ================= */
  // La app de Maps solo admite unas 9 paradas por enlace: la ruta se parte en tramos y cada uno empieza donde acabó el anterior.
  // wps: [[lat, lon, nombre?], ...]. Devuelve [{url, from, to}] (índices desde 1).
  function mapsLegs(wps, max) {
    max = max || 9; var legs = [], f = function (w) { return w[0].toFixed(6) + ',' + w[1].toFixed(6); };
    if (!wps || wps.length < 2) return legs;
    for (var i = 0; i < wps.length - 1; i += max) {
      var end = Math.min(wps.length - 1, i + max), mid = wps.slice(i + 1, end);
      legs.push({ from: i + 1, to: end + 1, url: 'https://www.google.com/maps/dir/?api=1&origin=' + f(wps[i]) + '&destination=' + f(wps[end]) + (mid.length ? '&waypoints=' + mid.map(f).join('%7C') : '') + '&travelmode=driving' });
    }
    return legs;
  }

  /* ================= exportar a GPX ================= */
  function xml(s) { return String(s == null ? '' : s).replace(/[<>&'"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]; }); }
  // Paradas con nombre (wpt y rte) y trazado completo por carretera (trk). plan: {name, wps: [[lat, lon, nombre]], coords: [[lon, lat]]}
  function planToGpx(plan, when) {
    var n = function (x) { return (+x).toFixed(6); }, name = xml(plan.name || 'Ruta'), wps = plan.wps || [], out = [];
    var label = function (w, i) { return xml(String(i + 1).padStart(2, '0') + ' ' + ((w[2] || '').split(',')[0] || (i === 0 ? 'Salida' : (i === wps.length - 1 ? 'Llegada' : 'Punto ' + (i + 1))))); };
    out.push('<?xml version="1.0" encoding="UTF-8"?>', '<gpx version="1.1" creator="ReGroupRide" xmlns="http://www.topografix.com/GPX/1/1">',
      '<metadata><name>' + name + '</name><time>' + new Date(when || Date.now()).toISOString() + '</time></metadata>');
    wps.forEach(function (w, i) { out.push('<wpt lat="' + n(w[0]) + '" lon="' + n(w[1]) + '"><name>' + label(w, i) + '</name>' + (w[2] ? '<desc>' + xml(w[2]) + '</desc>' : '') + '</wpt>'); });
    out.push('<rte><name>' + name + '</name>'); wps.forEach(function (w, i) { out.push('<rtept lat="' + n(w[0]) + '" lon="' + n(w[1]) + '"><name>' + label(w, i) + '</name></rtept>'); }); out.push('</rte>');
    out.push('<trk><name>' + name + '</name><trkseg>'); (plan.coords || []).forEach(function (c) { out.push('<trkpt lat="' + n(c[1]) + '" lon="' + n(c[0]) + '"/>'); }); out.push('</trkseg></trk>', '</gpx>');
    return out.join('\n');
  }

  /* ================= grupo en vivo ================= */
  // Ordena al grupo por dónde va cada uno en la ruta y marca a quien se ha quedado atrás, se ha salido o no da señal.
  // rows: [{user_id, name, lat, lon, along, off, at (ms)}]. along = metros recorridos de la ruta (null si no se sabe).
  function rankGroup(rows, myId, now, opts) {
    opts = opts || {}; var STALE = opts.stale || 90000, BEHIND = opts.behind || 2000;
    var live = rows.filter(function (r) { return r.lat != null && r.lon != null; }), me = null, al = [];
    live.forEach(function (r) { if (r.user_id === myId) me = r; if (r.along != null && now - r.at < STALE) al.push(r.along); });
    al.sort(function (a, b) { return a - b; });
    var med = al.length ? al[Math.floor(al.length / 2)] : null;
    var list = live.map(function (r) {
      var stale = now - r.at >= STALE, behind = !stale && med != null && r.along != null && r.along < med - BEHIND;
      return { user_id: r.user_id, name: r.name || 'Motero', lat: r.lat, lon: r.lon, along: r.along, me: r.user_id === myId, off: !!r.off && !stale, stale: stale, behind: behind,
        gap: (me && me.along != null && r.along != null) ? r.along - me.along : null, age: now - r.at };
    }).sort(function (a, b) { return (b.along == null ? -1 : b.along) - (a.along == null ? -1 : a.along); });
    return { list: list, total: list.length, behind: list.filter(function (x) { return x.behind || x.off || x.stale; }).length, waiting: rows.length - live.length };
  }

  /* ================= seguir una ruta ================= */
  function makeLine(coords) {
    var cum = [0];
    for (var i = 1; i < coords.length; i++) cum.push(cum[i - 1] + dist(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]));
    return { c: coords, cum: cum, total: cum[cum.length - 1] || 0 };
  }
  function projSeg(p, a, b) {  // a, b = [lon, lat]
    var k = Math.cos(rad(p.lat)) * R, ax = rad(a[0] - p.lon) * k, ay = rad(a[1] - p.lat) * R, bx = rad(b[0] - p.lon) * k, by = rad(b[1] - p.lat) * R;
    var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 === 0 ? 0 : -(ax * dx + ay * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    var x = ax + dx * t, y = ay + dy * t;
    return { t: t, d: Math.sqrt(x * x + y * y) };
  }
  // Punto de la línea más cercano a p. Solo mira por delante de `from` (menos una tolerancia): así en rutas de ida
  // y vuelta no salta al otro sentido.
  function project(p, line, from, back, maxAlong) {
    var best = null, min = Math.max(0, (from || 0) - (back == null ? 300 : back)), c = line.c, cum = line.cum;
    for (var i = 0; i < c.length - 1; i++) {
      if (cum[i + 1] < min) continue;
      if (maxAlong != null && cum[i] > maxAlong) break;
      var r = projSeg(p, c[i], c[i + 1]), along = cum[i] + r.t * (cum[i + 1] - cum[i]);
      if (along < min) continue;
      if (!best || r.d < best.d) best = { d: r.d, along: along, i: i };
    }
    if (!best && c.length) best = { d: dist(p.lat, p.lon, c[0][1], c[0][0]), along: 0, i: 0 };
    return best;
  }
  function pointAt(line, along) {
    var c = line.c, cum = line.cum;
    if (along <= 0) return c[0]; if (along >= line.total) return c[c.length - 1];
    var i = 0; while (i < cum.length - 2 && cum[i + 1] < along) i++;
    var seg = cum[i + 1] - cum[i], t = seg === 0 ? 0 : (along - cum[i]) / seg;
    return [c[i][0] + (c[i + 1][0] - c[i][0]) * t, c[i][1] + (c[i + 1][1] - c[i][1]) * t];
  }
  // Dónde volver a la ruta: por delante, y más lejos cuanto más te hayas alejado (para no dar media vuelta).
  function rejoinTarget(p, line, progress) {
    var pr = project(p, line, progress || 0);
    var ahead = pr.d > 80 ? Math.min(5000, Math.max(500, pr.d * 1.5)) : 0;
    var along = Math.min(line.total, pr.along + ahead), pt = pointAt(line, along);
    return { off: pr.d, along: along, lat: pt[1], lon: pt[0], finished: line.total - along < 150 };
  }

  /* ---- indicaciones de giro (a partir de las maniobras de OSRM) ---- */
  var MOD = { 'uturn': 'da la vuelta', 'sharp right': 'giro cerrado a la derecha', 'right': 'gira a la derecha', 'slight right': 'mantente a la derecha',
    'straight': 'sigue recto', 'slight left': 'mantente a la izquierda', 'left': 'gira a la izquierda', 'sharp left': 'giro cerrado a la izquierda' };
  var ORD = ['', 'primera', 'segunda', 'tercera', 'cuarta', 'quinta', 'sexta', 'séptima', 'octava'];
  function stepText(type, mod, exit) {
    if (type === 'arrive') return 'has llegado al final de la ruta';
    if (type === 'roundabout' || type === 'rotary') return exit ? 'en la rotonda, toma la ' + (ORD[exit] || exit + 'ª') + ' salida' : 'entra en la rotonda';
    if (type === 'roundabout turn') return 'en la rotonda, ' + (MOD[mod] || 'sigue');
    if (type === 'off ramp') return 'toma la salida' + (/left/.test(mod || '') ? ' a la izquierda' : (/right/.test(mod || '') ? ' a la derecha' : ''));
    if (type === 'on ramp' || type === 'merge') return 'incorpórate';
    if (type === 'fork') return /left/.test(mod || '') ? 'mantente a la izquierda' : 'mantente a la derecha';
    return MOD[mod] || 'sigue';
  }
  // Convierte los pasos de OSRM en una lista corta: [{lat, lon, text, icon, name}]. Quita lo que no es un giro de verdad.
  function stepOf(s, lastLeg) {
    var m = s.maneuver || {}, type = m.type, mod = m.modifier;
    if (!m.location) return null;
    if (type === 'depart' || type === 'exit roundabout' || type === 'exit rotary' || type === 'notification') return null;
    if (type === 'arrive' && !lastLeg) return null;      // puntos intermedios: no se anuncian
    if ((type === 'new name' || type === 'continue') && (mod === 'straight' || !mod)) return null;
    if (type === 'turn' && mod === 'straight') return null;
    var icon = type === 'arrive' ? 'arrive' : ((type === 'roundabout' || type === 'rotary' || type === 'roundabout turn') ? 'roundabout' : (mod || 'straight'));
    return { lat: m.location[1], lon: m.location[0], text: stepText(type, mod, m.exit), icon: icon, name: s.name || '' };
  }
  function stepsFromOsrm(route) {
    var out = [];
    (route.legs || []).forEach(function (leg, li) {
      (leg.steps || []).forEach(function (s) { var st = stepOf(s, li === route.legs.length - 1); if (st) out.push(st); });
    });
    return out;
  }

  /* ---------- GPX como ruta a seguir ---------- */
  function xmlText(t) {
    return String(t || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(+n); }).replace(/&amp;/g, '&').trim();
  }
  function gpxPts(text, tag) {
    var re = new RegExp('<' + tag + '\\b([^>]*?)(?:/>|>([\\s\\S]*?)</' + tag + '>)', 'g'), m, out = [];
    while ((m = re.exec(text))) {
      var la = /\blat\s*=\s*["']([^"']+)["']/.exec(m[1]), lo = /\blon\s*=\s*["']([^"']+)["']/.exec(m[1]);
      if (!la || !lo) continue;
      var lat = parseFloat(la[1]), lon = parseFloat(lo[1]);
      if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
      var body = m[2] || '', nm = /<name>([\s\S]*?)<\/name>/.exec(body);
      out.push({ lat: lat, lon: lon, name: nm ? xmlText(nm[1]) : '', time: /<time>/.test(body) });
    }
    return out;
  }
  // Lee un GPX (de OsmAnd, Calimoto, Kurviger, un GPS…) y lo deja como ruta a seguir:
  //   coords = el trazado tal cual viene (trk); wps = las paradas (rte, o wpt, o principio y final).
  //   route = true si el archivo solo trae unos pocos puntos sueltos y hay que calcular la carretera entre ellos.
  //   timed = true si es un recorrido grabado (lleva horas).
  function gpxToPlan(text) {
    text = String(text || '');
    if (!/<gpx[\s>]/i.test(text)) throw new Error('No es un archivo GPX.');
    var trk = gpxPts(text, 'trkpt'), rte = gpxPts(text, 'rtept'), wpt = gpxPts(text, 'wpt');
    var nm = /<metadata>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/metadata>/.exec(text) || /<(?:trk|rte)>\s*<name>([\s\S]*?)<\/name>/.exec(text);
    var name = nm ? xmlText(nm[1]) : '';
    var asStop = function (p) { return [p.lat, p.lon, p.name || '']; };
    var track = trk.length >= 2 ? trk : (rte.length >= 50 ? rte : null);
    if (!track) {
      if (rte.length < 2 && wpt.length < 2) throw new Error('El archivo no trae ninguna ruta.');
      return { name: name, coords: [], wps: (rte.length >= 2 ? rte : wpt).map(asStop), timed: false, route: true };
    }
    var coords = [], prev = null;
    track.forEach(function (p) { if (!prev || prev.lat !== p.lat || prev.lon !== p.lon) coords.push([p.lon, p.lat]); prev = p; });
    if (coords.length < 2) throw new Error('El archivo no trae ninguna ruta.');
    var stops;
    if (track === trk && rte.length >= 2 && rte.length <= 60) stops = rte.map(asStop);
    else if (wpt.length >= 2 && wpt.length <= 60) {
      var line = makeLine(coords);
      stops = wpt.map(function (p) { return { p: p, a: project(p, line, 0, 0).along }; }).sort(function (a, b) { return a.a - b.a; }).map(function (x) { return asStop(x.p); });
    } else stops = [[coords[0][1], coords[0][0], 'Salida'], [coords[coords.length - 1][1], coords[coords.length - 1][0], 'Llegada']];
    if (stops.every(function (w) { return /^\d\d /.test(w[2]); })) stops.forEach(function (w) { w[2] = w[2].slice(3); });   // «01 Nombre» de nuestro propio GPX
    var timed = track.filter(function (p) { return p.time; }).length > track.length / 2;
    return { name: name, coords: coords, wps: stops, timed: timed, route: false };
  }
  // Puntos de paso repartidos por el trazado (uno cada «every» metros), para pedir las indicaciones de giro.
  function viaPoints(line, every) {
    var out = [], n = Math.max(1, Math.round(line.total / (every || 1500)));
    for (var i = 0; i <= n; i++) { var a = line.total * i / n, c = pointAt(line, a); out.push({ along: a, lat: c[1], lon: c[0] }); }
    return out;
  }
  // Indicaciones de giro para un trazado ya hecho. «route» es la respuesta de OSRM pasando por vias[i0…]; cada tramo
  // solo vale si mide lo mismo que el trazado en ese tramo (si no, OSRM ha ido por otra carretera y sus giros no sirven).
  function trackSteps(route, vias, i0, line, isEnd) {
    var out = [], ok = 0, bad = 0, dur = 0, legs = route.legs || [];
    legs.forEach(function (leg, k) {
      var a = vias[i0 + k], b = vias[i0 + k + 1]; if (!a || !b) return;
      var seg = b.along - a.along;
      if (Math.abs((leg.distance || 0) - seg) > Math.max(80, seg * 0.12)) { bad++; dur += seg / 15; return; }
      ok++; dur += leg.duration || seg / 15;
      (leg.steps || []).forEach(function (s) {
        var st = stepOf(s, isEnd && k === legs.length - 1); if (!st || st.icon === 'uturn') return;
        var pr = project(st, line, a.along, 60, b.along + 60); if (!pr || pr.d > 45) return;
        st.along = Math.round(pr.along); out.push(st);
      });
    });
    return { steps: out, ok: ok, bad: bad, dur: dur };
  }
  // Sitúa cada maniobra sobre la línea (metros desde el inicio), en orden.
  function placeSteps(steps, line) {
    var from = 0;
    return (steps || []).map(function (s) {
      if (typeof s.along === 'number') { from = Math.max(from, s.along); return { along: s.along, text: s.text, icon: s.icon, name: s.name }; }   // ya situada (rutas de GPX)
      var pr = project({ lat: s.lat, lon: s.lon }, line, from, 0); from = Math.max(from, pr.along);
      return { along: pr.along, text: s.text, icon: s.icon, name: s.name };
    });
  }
  function fmtDist(m) {
    if (m >= 10000) return Math.round(m / 1000) + ' km';
    if (m >= 1000) return (Math.round(m / 100) / 10).toFixed(1).replace('.', ',') + ' km';
    if (m >= 200) return Math.round(m / 50) * 50 + ' m';
    return Math.max(10, Math.round(m / 10) * 10) + ' m';
  }
  function spokenDist(m) {
    if (m >= 1000) { var k = Math.round(m / 100) / 10; return (k === 1 ? 'un kilómetro' : String(k).replace('.', ' coma ') + ' kilómetros'); }
    return (m >= 200 ? Math.round(m / 100) * 100 : Math.round(m / 50) * 50) + ' metros';
  }

  /* Seguimiento: se le pasan las posiciones y dice por dónde vas, el siguiente giro, si te has salido y qué decir.
     opts: { offDist (m, 60), offSecs (8), backSecs (4) } */
  function Tracker(coords, steps, opts) {
    opts = opts || {};
    var line = makeLine(coords), st = placeSteps(steps, line);
    var OFF = opts.offDist || 60, OFF_S = (opts.offSecs || 8) * 1000, BACK_S = (opts.backSecs || 4) * 1000;
    var s = { along: 0, off: 0, offRoute: false, started: false, finished: false, offSince: null, onSince: null, said: {}, stepIdx: 0 };
    function update(fix, now) {
      // Primero busca cerca de por donde ibas: en rutas circulares o que pasan dos veces por el mismo sitio,
      // el punto «más cercano» de toda la ruta puede ser el final. Solo si ahí no estás, mira el resto.
      var ev = [], acc = Math.min(fix.acc || 0, 40), lim = OFF + acc;
      var pr = project(fix, line, s.along, 300, s.along + 1500 + (fix.v || 0) * 10);
      if (!pr || pr.d > lim) { var far = project(fix, line, s.along); if (far && (!pr || far.d < pr.d)) pr = far; }
      s.off = pr.d;
      if (pr.d <= lim) {
        s.offSince = null;
        if (!s.started) { s.started = true; ev.push({ type: 'start' }); }
        s.along = Math.max(s.along, pr.along);
        if (s.offRoute) { if (s.onSince == null) s.onSince = now; if (now - s.onSince >= BACK_S) { s.offRoute = false; s.onSince = null; ev.push({ type: 'back' }); } }
      } else {
        s.onSince = null;
        // Solo cuenta como «salirse» si ya estabas en la ruta y te mueves: parado en una gasolinera no avisa.
        if (s.started && !s.offRoute && !s.finished && (fix.v == null || fix.v > 2)) {
          if (s.offSince == null) s.offSince = now;
          if (now - s.offSince >= OFF_S) { s.offRoute = true; s.offSince = null; ev.push({ type: 'off', dist: pr.d }); }
        } else if (fix.v != null && fix.v <= 2) s.offSince = null;
      }
      while (s.stepIdx < st.length && st[s.stepIdx].along < s.along - 15) s.stepIdx++;
      var next = st[s.stepIdx] || null, dn = next ? next.along - s.along : null;
      if (next && !s.offRoute && s.started) {
        var v = fix.v || 0, far = Math.max(300, v * 14), near = Math.max(45, v * 3.5), k = s.stepIdx;
        if (dn <= near) { if (s.said[k] !== 2) { s.said[k] = 2; ev.push({ type: 'say', text: cap(next.text) }); } }
        else if (dn <= far && dn > near * 1.6 && !s.said[k]) { s.said[k] = 1; ev.push({ type: 'say', text: 'En ' + spokenDist(dn) + ', ' + next.text }); }
      }
      if (!s.finished && s.started && line.total - s.along < 40) { s.finished = true; ev.push({ type: 'finish' }); }
      return { along: s.along, remaining: Math.max(0, line.total - s.along), total: line.total, off: s.off, offRoute: s.offRoute, started: s.started, finished: s.finished,
        next: next ? { text: next.text, icon: next.icon, name: next.name, dist: Math.max(0, dn) } : null, events: ev };
    }
    return { update: update, line: line, state: s, steps: st };
  }
  function cap(t) { return t.charAt(0).toUpperCase() + t.slice(1); }

  return { dist: dist, findMapsUrl: findMapsUrl, parseMapsUrl: parseMapsUrl, isShortLink: isShortLink, extractUrl: extractUrl, makeLine: makeLine, project: project, pointAt: pointAt,
    rejoinTarget: rejoinTarget, mapsLegs: mapsLegs, planToGpx: planToGpx, rankGroup: rankGroup, stepsFromOsrm: stepsFromOsrm, gpxToPlan: gpxToPlan, viaPoints: viaPoints, trackSteps: trackSteps, placeSteps: placeSteps, fmtDist: fmtDist, spokenDist: spokenDist, Tracker: Tracker, cap: cap };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = RGLib;
