// Calendario de una comunidad en formato iCalendar, para suscribirse desde Google Calendar, Apple o Outlook.
// Uso: /functions/v1/ical?c=<id de la comunidad>&web=<dirección de la web de eventos>
const URL_ = Deno.env.get("SUPABASE_URL")!, KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const WEB = "https://regroupride-eventos.netlify.app";
const st = (ms: number) => new Date(ms).toISOString().replace(/[-:]|\.\d{3}/g, "");
const x = (t: unknown) => String(t ?? "").replace(/([,;\\])/g, "\\$1").replace(/\r?\n/g, "\\n");
Deno.serve(async (req) => {
  const id = new URL(req.url).searchParams.get("c") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Falta la comunidad", { status: 400 });
  const r = await fetch(`${URL_}/rest/v1/rpc/community_public`, { method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_id: id }) });
  const c = r.ok ? await r.json() : null;
  if (!c) return new Response("Comunidad no encontrada", { status: 404 });
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ReGroupRide//Eventos//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:" + x(c.name), "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"];
  for (const e of c.events) {
    const url = `${WEB}/?e=${e.id}`;
    L.push("BEGIN:VEVENT", `UID:${e.id}@regroupride`, "DTSTAMP:" + st(Date.now()), "DTSTART:" + st(e.starts_at), "DTEND:" + st(e.ends_at ?? e.starts_at + 3 * 36e5),
      "SUMMARY:" + x(e.title), "LOCATION:" + x(e.meet_name), "DESCRIPTION:" + x(url), "URL:" + url, "END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return new Response(L.join("\r\n") + "\r\n", { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "public, max-age=900" } });
});
