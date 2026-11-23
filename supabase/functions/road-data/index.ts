// ReGroupRide · función «road-data» (Supabase Edge Function).
// Trae dos datos públicos y los deja en la base de datos para que la app los consulte por cercanía:
//  · fuel: precios de las gasolineras (Ministerio para la Transición Ecológica, datos abiertos).
//  · dgt:  incidencias de tráfico de la DGT (DATEX II v3.6; no incluye Cataluña ni País Vasco).
// La llama la propia base de datos cuando los datos se han quedado viejos (supabase/31). No recibe datos de nadie.
// Desplegar con «Verify JWT» desactivado: no devuelve nada privado y ella misma limita cada cuánto se actualiza.
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
const num = (s) => { const v = parseFloat(String(s == null ? "" : s).replace(",", ".")); return isFinite(v) ? v : null; };
const FUEL = "https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/";
const DGT = "https://nap.dgt.es/datex2/v3/dgt/SituationPublication/datex2_v36.xml";

async function fuel(db, t0) {
  const r = await fetch(FUEL, { headers: { Accept: "application/json", "User-Agent": "ReGroupRide/1.0 (+https://regroupride-eventos.netlify.app)" } });
  if (!r.ok) throw new Error("gasolineras: HTTP " + r.status);
  const d = await r.json(), list = d.ListaEESSPrecio || [], rows = [];
  for (const e of list) {
    const lat = num(e["Latitud"]), lon = num(e["Longitud (WGS84)"]), g95 = num(e["Precio Gasolina 95 E5"]), g98 = num(e["Precio Gasolina 98 E5"]);
    if (lat == null || lon == null || (g95 == null && g98 == null) || !e["IDEESS"]) continue;
    if (String(e["Tipo Venta"] || "P").toUpperCase() !== "P") continue;        // solo venta al público
    rows.push({ id: String(e["IDEESS"]), name: String(e["Rótulo"] || "Gasolinera").slice(0, 60), addr: String(e["Dirección"] || "").slice(0, 120), town: String(e["Municipio"] || e["Localidad"] || "").slice(0, 60), lat, lon, g95, g98, hours: String(e["Horario"] || "").slice(0, 80), updated_at: t0 });
  }
  if (rows.length < 1000) throw new Error("gasolineras: respuesta incompleta (" + rows.length + ")");
  for (let i = 0; i < rows.length; i += 1000) { const u = await db.from("fuel_stations").upsert(rows.slice(i, i + 1000)); if (u.error) throw new Error(u.error.message); }
  await db.from("fuel_stations").delete().lt("updated_at", new Date(Date.now() - 3 * 864e5).toISOString());
  return rows.length;
}

async function dgt(db, t0) {
  const r = await fetch(DGT, { headers: { Accept: "application/xml", "User-Agent": "ReGroupRide/1.0" } });
  if (!r.ok) throw new Error("dgt: HTTP " + r.status);
  const xml = await r.text(), parts = xml.split(/<(?:\w+:)?situation\s+id="/).slice(1), rows = [], seen = new Set();
  const tag = (s, name) => { const m = new RegExp("<(?:\\w+:)?" + name + ">([^<]+)<").exec(s); return m ? m[1].trim() : null; };
  for (const p of parts) {
    const id = p.slice(0, p.indexOf('"')); if (!id || seen.has(id)) continue; seen.add(id);
    const lat = num(tag(p, "latitude")), lon = num(tag(p, "longitude")); if (lat == null || lon == null) continue;
    const kind = (/situationRecord\s+xsi:type="(?:\w+:)?(\w+)"/.exec(p) || [])[1] || "Situation";
    const subs = []; const re = /<(?:\w+:)?(\w*Type)>([A-Za-z]+)</g; let m;
    while ((m = re.exec(p)) && subs.length < 6) { if (m[1] !== "causeType" && subs.indexOf(m[2]) < 0) subs.push(m[2]); }
    const st = tag(p, "overallStartTime"), sev = tag(p, "overallSeverity") || tag(p, "severity");
    rows.push({ id: "dgt-" + id, kind, sub: subs.join(",").slice(0, 160), road: (tag(p, "roadName") || tag(p, "roadNumber") || "").slice(0, 40), lat, lon, starts_at: st && !isNaN(Date.parse(st)) ? new Date(st).toISOString() : null, severity: sev, seen_at: t0 });
  }
  if (!rows.length) throw new Error("dgt: sin incidencias legibles");
  for (let i = 0; i < rows.length; i += 1000) { const u = await db.from("road_incidents").upsert(rows.slice(i, i + 1000)); if (u.error) throw new Error(u.error.message); }
  await db.from("road_incidents").delete().lt("seen_at", t0);
  return rows.length;
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({})), what = body.what === "dgt" ? "dgt" : "fuel";
  const db = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const minAge = what === "fuel" ? 2 * 3600e3 : 8 * 60e3, t0 = new Date().toISOString();
  try {
    const last = await db.from("data_refresh").select("at,tried_at").eq("name", what).maybeSingle();
    const tried = last.data && last.data.tried_at ? Date.parse(last.data.tried_at) : 0, at = last.data && last.data.at ? Date.parse(last.data.at) : 0;
    if (Date.now() - at < minAge || Date.now() - tried < 3 * 60e3) return json({ ok: true, skipped: true });
    await db.from("data_refresh").upsert({ name: what, tried_at: t0, at: last.data ? last.data.at : null, note: "en curso" });
    const n = what === "fuel" ? await fuel(db, t0) : await dgt(db, t0);
    await db.from("data_refresh").upsert({ name: what, at: t0, tried_at: t0, note: "ok: " + n });
    return json({ ok: true, rows: n });
  } catch (e) {
    await db.from("data_refresh").update({ note: String(e && e.message || e).slice(0, 300) }).eq("name", what);
    return json({ ok: false, error: String(e && e.message || e) }, 500);
  }
});
