// ReGroupRide · función «push» (Supabase Edge Function).
// La llama la base de datos (supabase/11_push_y_web.sql) cuando hay alguien a quien avisar. Lee la cola push_queue,
// busca los teléfonos de esas cuentas y les manda por Firebase un «toque» sin contenido: el teléfono se despierta,
// pregunta él mismo qué hay nuevo y pone la notificación.
//
// Secreto necesario (Edge Functions → Secrets): FCM_SERVICE_ACCOUNT = el JSON entero de la cuenta de servicio de Firebase.
// Desplegar con «Verify JWT» desactivado: no recibe datos de quien la llama, solo procesa la cola.
import { createClient } from "npm:@supabase/supabase-js@2";

let cached = { token: "", exp: 0 };
function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function accessToken(sa) {
  if (cached.token && Date.now() < cached.exp) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = enc({ alg: "RS256", typ: "JWT" }) + "." + enc({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  });
  const pem = String(sa.private_key).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: unsigned + "." + b64url(sig) }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("Firebase no ha dado acceso: " + JSON.stringify(j).slice(0, 200));
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in - 120) * 1000 };
  return cached.token;
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async () => {
  try {
    const raw = Deno.env.get("FCM_SERVICE_ACCOUNT");
    if (!raw) return json({ ok: false, error: "Falta el secreto FCM_SERVICE_ACCOUNT" }, 500);
    const sa = JSON.parse(raw);
    const db = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const q = await db.from("push_queue").select("id,user_id").order("id").limit(1000);
    if (q.error) return json({ ok: false, error: q.error.message }, 500);
    const rows = q.data || [];
    if (!rows.length) return json({ ok: true, sent: 0 });
    const users = [...new Set(rows.map((r) => r.user_id))];
    const t = await db.from("push_tokens").select("token").in("user_id", users);
    const tokens = (t.data || []).map((x) => x.token);
    const at = await accessToken(sa);
    let sent = 0;
    const dead = [];
    await Promise.all(tokens.map(async (token) => {
      const r = await fetch("https://fcm.googleapis.com/v1/projects/" + sa.project_id + "/messages:send", {
        method: "POST", headers: { Authorization: "Bearer " + at, "Content-Type": "application/json" },
        body: JSON.stringify({ message: { token, data: { k: "tick" }, android: { priority: "HIGH", ttl: "3600s" } } }),
      });
      if (r.ok) sent++;
      else if (r.status === 404 || r.status === 400) dead.push(token);      // teléfono que ya no existe o token inválido
    }));
    if (dead.length) await db.from("push_tokens").delete().in("token", dead);
    await db.from("push_queue").delete().in("id", rows.map((r) => r.id));
    return json({ ok: true, sent, removed: dead.length });
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e) }, 500);
  }
});
