// ReGroupRide · función «feedback-mail» (Supabase Edge Function).
// La llama la base de datos (supabase/17_creador_panel_y_sugerencias.sql) cuando alguien envía una sugerencia o un fallo.
// Manda un correo al creador (las cuentas de app_admins) con el mensaje. Cada sugerencia se envía una sola vez.
//
// Secreto necesario (Edge Functions → Secrets): RESEND_API_KEY = la clave de una cuenta de resend.com.
// Opcional: MAIL_FROM = remitente de un dominio verificado en Resend (si no, sale de onboarding@resend.dev, que solo
// puede escribir al correo con el que se creó la cuenta de Resend).
// Desplegar con «Verify JWT» desactivado: solo recibe el número de la sugerencia y el resto lo lee de la base de datos.
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

Deno.serve(async (req) => {
  try {
    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) return json({ ok: false, error: "Falta el secreto RESEND_API_KEY" });
    const body = await req.json().catch(() => ({}));
    if (body.id == null) return json({ ok: false, error: "Falta la sugerencia" }, 400);
    const db = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    // Se marca primero: si dos llamadas llegan a la vez, solo una sigue.
    const f = await db.from("feedback").update({ mailed_at: new Date().toISOString() }).eq("id", body.id).is("mailed_at", null)
      .select("id,user_id,kind,message,app_version,device,created_at").maybeSingle();
    if (f.error) return json({ ok: false, error: f.error.message }, 500);
    if (!f.data) return json({ ok: true, sent: 0 });
    const fb = f.data;
    const admins = await db.from("app_admins").select("user_id");
    const to = [];
    for (const a of admins.data || []) {
      const u = await db.auth.admin.getUserById(a.user_id);
      if (u.data && u.data.user && u.data.user.email) to.push(u.data.user.email);
    }
    if (!to.length) return json({ ok: false, error: "No hay a quién escribir" });
    const prof = await db.from("profiles").select("name").eq("id", fb.user_id).maybeSingle();
    const who = await db.auth.admin.getUserById(fb.user_id);
    const name = (prof.data && prof.data.name) || "Alguien";
    const mail = (who.data && who.data.user && who.data.user.email) || "";
    const tipo = fb.kind === "fallo" ? "Fallo" : "Mejora";
    const dev = fb.device ? Object.entries(fb.device).map(([k, v]) => k + ": " + v).join(" · ") : "";
    const html = '<div style="font-family:system-ui,Arial,sans-serif;max-width:560px;color:#1b2430">' +
      '<p style="font-size:13px;color:#6b7a8a;margin:0 0 6px">ReGroupRide · ' + tipo + " nº " + fb.id + "</p>" +
      '<h2 style="margin:0 0 12px;font-size:19px">' + esc(name) + (fb.kind === "fallo" ? " ha encontrado un fallo" : " propone una mejora") + "</h2>" +
      '<div style="white-space:pre-wrap;background:#f2f6f9;border-left:4px solid #5A2DB0;padding:14px 16px;border-radius:8px;font-size:15px;line-height:1.5">' + esc(fb.message) + "</div>" +
      '<p style="font-size:13px;color:#6b7a8a;margin:14px 0 0">Versión ' + esc(fb.app_version || "?") + (dev ? " · " + esc(dev) : "") + (mail ? "<br>Cuenta: " + esc(mail) : "") + "</p>" +
      '<p style="margin:18px 0 0"><a href="https://regroupride-eventos.netlify.app/?dev=1" style="background:#5A2DB0;color:#fff;text-decoration:none;padding:11px 18px;border-radius:10px;font-weight:600;display:inline-block">Contestar desde el panel</a></p></div>';
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: Deno.env.get("MAIL_FROM") || "ReGroupRide <onboarding@resend.dev>", to,
        subject: "[ReGroupRide] " + tipo + " de " + name + ": " + String(fb.message).replace(/\s+/g, " ").slice(0, 60),
        html, ...(mail ? { reply_to: mail } : {}),
      }),
    });
    if (!r.ok) {
      await db.from("feedback").update({ mailed_at: null }).eq("id", fb.id);      // que se pueda reintentar
      return json({ ok: false, error: "Resend " + r.status + ": " + (await r.text()).slice(0, 200) });
    }
    return json({ ok: true, sent: to.length });
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e) }, 500);
  }
});
