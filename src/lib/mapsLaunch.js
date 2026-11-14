// Construye enlaces de navegación de Google Maps (formato oficial api=1).
// Google admite hasta 9 puntos intermedios por enlace (3 en navegadores móviles), así que las
// rutas largas se parten en tramos: cada tramo acaba donde empieza el siguiente.

export const MAX_WAYPOINTS = 9;

const fmt = (p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

export function navUrl({ origin, destination, waypoints = [] }) {
  const q = new URLSearchParams({ api: '1', destination: fmt(destination), travelmode: 'driving', dir_action: 'navigate' });
  if (origin) q.set('origin', fmt(origin));
  if (waypoints.length) q.set('waypoints', waypoints.map(fmt).join('|'));
  return 'https://www.google.com/maps/dir/?' + q.toString().replace(/%2C/g, ',').replace(/%7C/g, '%7C');
}

/**
 * Parte una lista de puntos en tramos navegables.
 * El primer tramo no lleva origen: Google Maps sale desde donde estás.
 * Devuelve [{ url, from, to, count }]
 */
export function legsFor(points, max = MAX_WAYPOINTS) {
  if (!points.length) return [];
  const legs = [];
  let i = 0;
  let origin = null;
  while (i < points.length) {
    const end = Math.min(points.length - 1, i + max);
    const destination = points[end];
    const waypoints = points.slice(i, end);
    legs.push({ url: navUrl({ origin, destination, waypoints }), from: i, to: end, count: end - i + 1 });
    if (end === points.length - 1) break;
    origin = destination;
    i = end + 1;
  }
  return legs;
}

/** Abre una URL fuera de la app (en Android, la abre Google Maps). */
export async function openExternal(url) {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      const { AppLauncher } = await import('@capacitor/app-launcher');
      await AppLauncher.openUrl({ url });
      return;
    }
  } catch { /* cae al navegador */ }
  window.open(url, '_blank', 'noopener');
}
