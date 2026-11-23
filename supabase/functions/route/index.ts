// ReGroupRide · función «route» (Supabase Edge Function): trazado con GraphHopper cuando hay clave.
// Secreto (Edge Functions → Secrets): GRAPHHOPPER_KEY = la clave de una cuenta de graphhopper.com.
// Sin el secreto contesta { ok: false, reason: "no-key" } y la app usa su trazado de siempre.
//  · { kind: "loop", lat, lon, km, seed }      → vuelta circular de unos km kilómetros desde ese punto.
//  · { kind: "route", points: [[lat, lon], …], curvy } → ruta entre puntos; con curvy evita autovías y vías rápidas.
// Devuelve { ok, coords: [[lon, lat], …], dist (km), dur (s) }. Necesita sesión (Verify JWT activado).
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({});
  const key = Deno.env.get("GRAPHHOPPER_KEY");
  if (!key) return json({ ok: false, reason: "no-key" });
  try {
    const b = await req.json().catch(() => ({}));
    const body: Record<string, unknown> = { profile: "car", points_encoded: false, instructions: false, locale: "es" };
    if (b.kind === "loop") {
      if (!(Math.abs(b.lat) <= 90) || !(Math.abs(b.lon) <= 180)) return json({ ok: false, reason: "bad-input" }, 400);
      body.points = [[b.lon, b.lat]]; body.algorithm = "round_trip"; body["ch.disable"] = true;
      body["round_trip.distance"] = Math.min(600, Math.max(20, Number(b.km) || 100)) * 1000; body["round_trip.seed"] = Number(b.seed) || 1;
    } else {
      const pts = Array.isArray(b.points) ? b.points.slice(0, 40) : [];
      if (pts.length < 2) return json({ ok: false, reason: "bad-input" }, 400);
      body.points = pts.map((p) => [p[1], p[0]]);
      if (b.curvy) { body["ch.disable"] = true; body.custom_model = { priority: [{ if: "road_class == MOTORWAY", multiply_by: "0.05" }, { if: "road_class == TRUNK", multiply_by: "0.4" }] }; }
    }
    const r = await fetch("https://graphhopper.com/api/1/route?key=" + encodeURIComponent(key), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => null);
    const p = d && d.paths && d.paths[0];
    if (!r.ok || !p || !p.points || !p.points.coordinates) return json({ ok: false, reason: "provider", detail: d && d.message ? String(d.message).slice(0, 200) : "HTTP " + r.status });
    return json({ ok: true, coords: p.points.coordinates.map((c) => [c[0], c[1]]), dist: Math.round(p.distance / 100) / 10, dur: Math.round(p.time / 1000) });
  } catch (e) {
    return json({ ok: false, reason: "error", detail: String(e && e.message || e).slice(0, 200) });
  }
});
