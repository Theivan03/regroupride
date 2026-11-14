// Cálculo del trazado por carretera entre los puntos de la ruta.
// Para las pruebas usamos el servidor público de OSRM (gratis, sin clave, uso moderado).
// Antes de abrir la app a más gente hay que pasar a un servicio propio o de pago (ver docs/DECISIONES.md).
import { simplify } from './geo.js';

const OSRM = 'https://router.project-osrm.org/route/v1/driving/';

export async function routeThrough(points, { signal } = {}) {
  if (points.length < 2) return { line: points.map(({ lat, lng }) => ({ lat, lng })), distance: 0, duration: 0 };
  const coords = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const res = await fetch(`${OSRM}${coords}?overview=full&geometries=geojson&continue_straight=true`, { signal });
  if (!res.ok) throw new Error('No se ha podido calcular el trazado (' + res.status + ').');
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes?.length) throw new Error('No hay carretera entre esos puntos.');
  const r = data.routes[0];
  const line = r.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
  return { line: simplify(line, 12), distance: r.distance, duration: r.duration };
}
