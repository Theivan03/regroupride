// Utilidades geográficas puras (sin dependencias), probadas en tests/geo.test.js.
// Puntos como {lat, lng}. Distancias en metros.

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

export function distance(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Proyección local equirectangular alrededor de un origen: suficiente para tramos cortos.
function toXY(p, o) {
  return { x: rad(p.lng - o.lng) * Math.cos(rad(o.lat)) * R, y: rad(p.lat - o.lat) * R };
}

// Punto más cercano de un segmento a-b respecto a p. Devuelve t (0..1) y distancia.
export function projectOnSegment(p, a, b) {
  const A = toXY(a, p), B = toXY(b, p);
  const dx = B.x - A.x, dy = B.y - A.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : -(A.x * dx + A.y * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const point = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
  return { t, point, dist: distance(p, point) };
}

// Distancias acumuladas a lo largo de una polilínea.
export function cumulative(line) {
  const out = [0];
  for (let i = 1; i < line.length; i++) out.push(out[i - 1] + distance(line[i - 1], line[i]));
  return out;
}

// Proyecta p sobre la polilínea. Si se da fromAlong (metros ya recorridos), solo busca
// por delante de ese punto menos una tolerancia, para no "volver atrás" en rutas con bucles.
export function projectOnLine(p, line, cum = cumulative(line), fromAlong = 0, backTolerance = 300) {
  let best = null;
  const minAlong = Math.max(0, fromAlong - backTolerance);
  for (let i = 0; i < line.length - 1; i++) {
    if (cum[i + 1] < minAlong) continue;
    const r = projectOnSegment(p, line[i], line[i + 1]);
    const along = cum[i] + r.t * (cum[i + 1] - cum[i]);
    if (along < minAlong) continue;
    if (!best || r.dist < best.dist) best = { ...r, index: i, along };
  }
  if (!best && line.length) best = { point: line[0], dist: distance(p, line[0]), index: 0, t: 0, along: 0 };
  return best;
}

// Punto de la polilínea a una distancia dada desde el inicio.
export function pointAtAlong(line, cum, along) {
  if (along <= 0) return { ...line[0], index: 0 };
  const total = cum[cum.length - 1];
  if (along >= total) return { ...line[line.length - 1], index: line.length - 2 };
  let i = 0;
  while (i < cum.length - 1 && cum[i + 1] < along) i++;
  const seg = cum[i + 1] - cum[i];
  const t = seg === 0 ? 0 : (along - cum[i]) / seg;
  const a = line[i], b = line[i + 1];
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t, index: i };
}

// Posición (metros a lo largo de la línea) de cada punto de paso.
export function alongOfWaypoints(waypoints, line, cum = cumulative(line)) {
  let from = 0;
  return waypoints.map((w) => {
    const r = projectOnLine(w, line, cum, from, 1e9);
    // Busca el más cercano pero sin retroceder respecto al anterior (rutas con ida y vuelta).
    const ahead = projectOnLine(w, line, cum, from, 0);
    const pick = ahead && ahead.dist < r.dist + 50 ? ahead : r;
    from = Math.max(from, pick.along);
    return pick.along;
  });
}

/**
 * Calcula dónde reengancharse a la ruta.
 * @param pos posición actual
 * @param line trazado [{lat,lng}]
 * @param waypoints puntos de la ruta (con kind: start|stop|via|end)
 * @param progressAlong metros recorridos según el seguimiento (0 si no se sabe)
 * Devuelve el punto objetivo (por delante, para no conducir hacia atrás) y los puntos
 * de la ruta que quedan después de él.
 */
export function rejoinPlan(pos, line, waypoints, progressAlong = 0) {
  const cum = cumulative(line);
  const total = cum[cum.length - 1];
  const proj = projectOnLine(pos, line, cum, progressAlong);
  // Cuanto más lejos estás de la ruta, más por delante te reenganchas: así no das media vuelta.
  const ahead = Math.min(5000, Math.max(500, proj.dist * 1.5));
  const targetAlong = Math.min(total, proj.along + (proj.dist > 80 ? ahead : 0));
  const target = pointAtAlong(line, cum, targetAlong);
  const wAlong = alongOfWaypoints(waypoints, line, cum);
  const remaining = waypoints.filter((w, i) => wAlong[i] > targetAlong + 50);
  const finished = total - targetAlong < 200;
  return {
    offRouteMeters: Math.round(proj.dist),
    progressAlong: proj.along,
    targetAlong,
    target: { lat: target.lat, lng: target.lng },
    remaining,
    finished,
  };
}

// Simplificación Douglas-Peucker (tolerancia en metros) para guardar trazados ligeros.
export function simplify(line, tol = 15) {
  if (line.length < 3) return line.slice();
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack = [[0, line.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = projectOnSegment(line[i], line[s], line[e]).dist;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return line.filter((_, i) => keep[i]);
}

// Inserta un punto de paso intermedio (via) en el lugar donde menos alarga el recorrido.
export function insertByDetour(points, via) {
  if (points.length < 2) return [...points, via];
  let bestI = 1, bestCost = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const cost = distance(a, via) + distance(via, b) - distance(a, b);
    if (cost < bestCost) { bestCost = cost; bestI = i; }
  }
  return [...points.slice(0, bestI), via, ...points.slice(bestI)];
}

export function formatKm(m) {
  return m >= 10000 ? `${Math.round(m / 1000)} km` : `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

export function formatDuration(s) {
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}
