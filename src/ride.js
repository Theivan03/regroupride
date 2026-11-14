// Ruta en curso: guarda por dónde vas para que el reenganche no te mande hacia atrás.
import { cumulative, projectOnLine } from './lib/geo.js';
import { watchPosition } from './services.js';

const KEY = 'rr.ride';
let stopWatch = null;
let cache = null; // { routeId, cum }

export function activeRide() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
function save(r) { localStorage.setItem(KEY, JSON.stringify(r)); }

export function startRide(route) {
  save({ routeId: route.id, name: route.name, startedAt: Date.now(), progressAlong: 0, lastFix: null });
  follow(route);
}

export function endRide() {
  localStorage.removeItem(KEY);
  if (stopWatch) { stopWatch(); stopWatch = null; }
}

// Sigue la posición mientras la app está abierta y actualiza el progreso si vas por la ruta.
export async function follow(route) {
  const ride = activeRide();
  if (!ride || ride.routeId !== route.id || !route.geometry?.length) return;
  if (stopWatch) return;
  cache = { routeId: route.id, cum: cumulative(route.geometry) };
  try {
    stopWatch = await watchPosition((pos) => {
      const r = activeRide();
      if (!r || r.routeId !== route.id) return;
      const proj = projectOnLine(pos, route.geometry, cache.cum, r.progressAlong);
      if (proj && proj.dist < 150 && proj.along >= r.progressAlong - 300) {
        r.progressAlong = Math.max(r.progressAlong, proj.along);
      }
      r.lastFix = { ...pos, at: Date.now() };
      save(r);
    });
  } catch { /* sin permiso: el reenganche funciona igual, solo que sin progreso */ }
}
