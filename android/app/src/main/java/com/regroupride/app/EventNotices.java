package com.regroupride.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;

/**
 * Avisos de los eventos (recordatorio un día y una hora antes, y «hay una plaza para ti») cuyos botones actúan
 * SIN abrir la app: al pulsar «No puedo ir», «Sí, voy» o «No puedo», el teléfono se lo dice al servidor por detrás
 * y el aviso cambia para confirmar que está hecho.
 *
 * Cada aviso lleva la clave del evento para esa persona (supabase/07): con ella basta, no hace falta la sesión.
 * Lo programado se guarda en el teléfono para poder reponerlo tras reiniciarlo o actualizar la app.
 *
 * Lista de espera: mientras la app está cerrada nadie avisa al teléfono de que le ha tocado plaza (no hay notificaciones
 * push), así que el teléfono lo pregunta: cada 10 minutos consulta al servidor, con la clave de cada evento en el que se
 * está en espera (supabase/08), y si hay plaza ofrecida pone el aviso con «Sí, voy» y «No puedo».
 *
 * Con la app abierta o en segundo plano, todo llega al instante por el canal en directo (www/rg-live.js) y la app pone
 * el aviso aquí con newsNow(); lo que ya se ha avisado no se repite (se recuerdan los últimos).
 * Novedades de la comunidad (evento, mensaje del tablón, página de info o «empieza la ruta»): igual, sin push. Cada minuto el
 * teléfono pregunta con la clave de novedades de la cuenta (supabase/09) qué hay desde la última vez y pone un aviso
 * por cada cosa. Lo que publica uno mismo no se le avisa.
 *
 * Un aviso: { id, at (ms; 0 = ya), title, body, kind: "remind" | "offer", key, eventId, eventTitle, offeredAt }.
 * En espera: { eventId, key, eventTitle, startsAt, nid (id del aviso de plaza), remind: [avisos si se confirma] }.
 * Los ids van de cuatro en cuatro por evento (id % 4: 0 = día antes, 1 = hora antes, 2 = plaza ofrecida).
 */
final class EventNotices {
    static final String ACTION_SHOW = "com.regroupride.app.EVENT_SHOW";
    static final String ACTION_DO = "com.regroupride.app.EVENT_DO";
    static final String ACTION_CHECK = "com.regroupride.app.EVENT_CHECK";
    // Cada minuto: lo mínimo que Android deja con la app cerrada. Con el teléfono en reposo profundo (Doze), el propio
    // sistema las espacia (unos 9 minutos) hasta que se vuelve a usar el teléfono.
    private static final long CHECK_EVERY = 60000L;
    private static final long NEWS_EVERY = 60000L;
    private static final String CH = "rg_events";
    private static final String CH_NEWS = "rg_news";
    private static final String PREFS = "rg_events";

    private EventNotices() { }

    static SharedPreferences prefsFor(Context c) {
        return prefs(c);
    }

    private static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static JSONObject items(Context c) {
        try {
            return new JSONObject(prefs(c).getString("items", "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private static void save(Context c, JSONObject all) {
        prefs(c).edit().putString("items", all.toString()).apply();
    }

    static void configure(Context c, String url, String apikey) {
        prefs(c).edit().putString("url", url == null ? "" : url).putString("apikey", apikey == null ? "" : apikey).apply();
    }

    private static void channel(Context c) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel ch = new NotificationChannel(CH, "Recordatorios y plazas de eventos", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Te recuerda las rutas a las que estás apuntado y te avisa si queda una plaza libre.");
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);
    }

    private static PendingIntent broadcast(Context c, String action, int id, String act) {
        Intent i = new Intent(c, EventNoticeReceiver.class).setAction(action)
                .setData(Uri.parse("rg://event/" + id + "/" + act))     // distingue un botón de otro
                .putExtra("id", id).putExtra("act", act);
        return PendingIntent.getBroadcast(c, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent openApp(Context c, int id) {
        Intent i = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, id, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void arm(Context c, int id, long at) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent pi = broadcast(c, ACTION_SHOW, id, "show");
        try {
            if (Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);      // sin permiso de alarmas exactas: puede retrasarse unos minutos
        } catch (SecurityException e) {
            try {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            } catch (Exception ignored) { }
        }
    }

    private static void disarm(Context c, int id) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am != null) {
            try {
                am.cancel(broadcast(c, ACTION_SHOW, id, "show"));
            } catch (Exception ignored) { }
        }
        try {
            NotificationManagerCompat.from(c).cancel(id);
        } catch (Exception ignored) { }
    }

    /* ---------- lista de espera: preguntar si ya me toca ---------- */
    private static JSONObject watching(Context c) {
        try {
            return new JSONObject(prefs(c).getString("watch", "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private static void armCheck(Context c, long delay) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        long at = System.currentTimeMillis() + delay;
        PendingIntent pi = broadcast(c, ACTION_CHECK, 1, "check");
        try {
            if (Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            prefs(c).edit().putLong("nextCheck", at).apply();
        } catch (Exception e) {
            try {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                prefs(c).edit().putLong("nextCheck", at).apply();
            } catch (Exception ignored) { }
        }
    }

    private static void disarmCheck(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am != null) {
            try {
                am.cancel(broadcast(c, ACTION_CHECK, 1, "check"));
            } catch (Exception ignored) { }
        }
        prefs(c).edit().remove("nextCheck").apply();
    }

    /** Deja puesta la siguiente consulta: cada 10 min si hay lista de espera, cada 15 si solo hay novedades, o ninguna. */
    private static void schedule(Context c) {
        boolean waiting = watching(c).length() > 0, news = !prefs(c).getString("newsKey", "").isEmpty();
        if (waiting) armCheck(c, CHECK_EVERY);
        else if (news) armCheck(c, NEWS_EVERY);
        else disarmCheck(c);
    }

    /** Clave de novedades de la cuenta. Vacía = dejar de preguntar. La primera vez solo cuenta lo que se publique desde ahora. */
    static synchronized void news(Context c, String key) {
        SharedPreferences sp = prefs(c);
        if (key == null || key.isEmpty()) {
            sp.edit().remove("newsKey").remove("newsSince").apply();
            schedule(c);
            return;
        }
        boolean fresh = !key.equals(sp.getString("newsKey", ""));
        SharedPreferences.Editor e = sp.edit().putString("newsKey", key);
        if (fresh || sp.getLong("newsSince", 0) == 0) e.putLong("newsSince", System.currentTimeMillis());
        e.apply();
        long due = sp.getLong("nextCheck", 0), now = System.currentTimeMillis();
        if (due < now - 60000L || due > now + NEWS_EVERY) armCheck(c, NEWS_EVERY);
    }

    /** Pregunta qué se ha publicado en mis comunidades desde la última vez y lo avisa. Fuera del hilo principal. */
    private static void checkNews(Context c) {
        SharedPreferences sp = prefs(c);
        String key = sp.getString("newsKey", "");
        if (key.isEmpty()) return;
        long since = sp.getLong("newsSince", 0);
        if (since == 0) since = System.currentTimeMillis();
        try {
            java.text.SimpleDateFormat iso = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
            iso.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
            JSONObject r = rpc(c, "community_news", new JSONObject().put("p_key", key).put("p_since", iso.format(new java.util.Date(since))));
            if (!r.optBoolean("ok", false)) {
                if ("clave".equals(r.optString("error"))) sp.edit().remove("newsKey").apply();
                return;
            }
            JSONArray items = r.optJSONArray("items");
            sp.edit().putLong("lastNews", System.currentTimeMillis()).putInt("lastNewsN", items == null ? 0 : items.length()).apply();
            long last = since;
            for (int n = 0; items != null && n < items.length(); n++) {
                JSONObject it = items.optJSONObject(n);
                if (it == null) continue;
                long at = it.optLong("at", 0);
                if (at > last) last = at;
                notifyNews(c, it, false);
            }
            if (last > since) sp.edit().putLong("newsSince", last + 1).apply();
        } catch (Exception e) {
            if ("http 404".equals(e.getMessage())) sp.edit().remove("newsKey").apply();    // falta supabase/09: no se insiste
        }
    }

    /** ¿Ya se ha avisado esto? (se recuerdan los últimos 100). Si no, queda apuntado. */
    private static synchronized boolean firstTime(Context c, String k) {
        try {
            JSONArray seen = new JSONArray(prefs(c).getString("newsSeen", "[]"));
            for (int i = 0; i < seen.length(); i++) if (k.equals(seen.optString(i))) return false;
            JSONArray out = new JSONArray();
            int from = Math.max(0, seen.length() - 99);
            for (int i = from; i < seen.length(); i++) out.put(seen.optString(i));
            out.put(k);
            prefs(c).edit().putString("newsSeen", out.toString()).apply();
        } catch (Exception ignored) { }
        return true;
    }

    /** Un aviso de novedad: evento, tablón, info o «empieza la ruta». silent = solo apuntarlo (la app ya lo ha enseñado). */
    static void notifyNews(Context c, JSONObject it, boolean silent) {
        if ("offer".equals(it.optString("kind"))) {
            // Plaza ofrecida (supabase/12): el aviso con «Sí, voy» y «No puedo», sin depender de nada guardado antes.
            if (silent) return;
            try {
                String ev = it.optString("event_id", ""), name = it.optString("title", "la ruta");
                long dl = it.optLong("deadline", 0);
                String until = dl > 0 ? " Contesta antes de las " + new java.text.SimpleDateFormat("HH:mm 'del' d/M", new java.util.Locale("es", "ES")).format(new java.util.Date(dl)) + "." : "";
                int nid = 6;
                try {
                    nid = Integer.parseInt(ev.replace("-", "").substring(0, 7), 16) * 4 + 2;      // el mismo número que usa la app
                } catch (Exception ignored) { }
                put(c, new JSONObject().put("id", nid).put("at", 0).put("kind", "offer")
                        .put("title", "Hay una plaza para ti: " + name)
                        .put("body", "Alguien se ha desapuntado y te toca a ti. ¿Vienes?" + until)
                        .put("key", it.optString("key", "")).put("eventId", ev).put("eventTitle", name)
                        .put("offeredAt", it.optLong("offered_at", 0)).put("cid", it.optString("cid", "")));
            } catch (Exception ignored) { }
            return;
        }
        String kind = it.optString("kind"), key = kind + ":" + it.optString("id");
        if (!firstTime(c, key) || silent) return;
        String com = it.optString("community", "Tu comunidad"), title = it.optString("title", "");
        String head, body, chId = CH_NEWS;
        if ("call".equals(kind)) {
            head = "Empieza la ruta: " + (title.isEmpty() ? com : title);
            body = it.optString("by", "El organizador") + " ha iniciado la ruta. Toca para unirte.";
            chId = CH;
            channel(c);
        } else {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                NotificationChannel ch = new NotificationChannel(CH_NEWS, "Novedades de la comunidad", NotificationManager.IMPORTANCE_DEFAULT);
                ch.setDescription("Avisa cuando se publica un evento, un mensaje en el tablón o una página de información.");
                nm.createNotificationChannel(ch);
            }
            if ("event".equals(kind)) {
                long st = it.optLong("starts_at", 0);
                java.text.SimpleDateFormat when = new java.text.SimpleDateFormat("EEE d MMM, HH:mm", new java.util.Locale("es", "ES"));
                head = com + " · Nuevo evento";
                body = title + (st > 0 ? " · " + when.format(new java.util.Date(st)) : "");
            } else if ("post".equals(kind)) {
                head = com + " · Tablón";
                body = title;
            } else if ("note".equals(kind)) {       // respuestas a sugerencias y avisos del creador
                head = it.optString("head", com);
                body = title;
            } else {
                head = com + " · Info";
                body = title;
            }
        }
        int id = -1 - ((key.hashCode() & 0x7fffffff) % 1000000000);     // negativos: no chocan con los de eventos
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, chId)
                .setSmallIcon(R.drawable.ic_stat_rg)
                .setContentTitle(head).setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority("call".equals(kind) ? NotificationCompat.PRIORITY_HIGH : NotificationCompat.PRIORITY_DEFAULT)
                .setCategory("call".equals(kind) ? NotificationCompat.CATEGORY_EVENT : NotificationCompat.CATEGORY_SOCIAL)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setAutoCancel(true)
                .setContentIntent(openApp(c, id));
        if ("call".equals(kind)) b.setTimeoutAfter(6 * 3600000L);
        post(c, id, b.build());
    }

    /** La app (abierta o en segundo plano) ha recibido una novedad por el canal en directo. */
    static void newsNow(Context c, JSONArray items, boolean silent) {
        for (int n = 0; items != null && n < items.length(); n++) {
            JSONObject it = items.optJSONObject(n);
            if (it != null) notifyNews(c, it, silent);
        }
    }

    /** Toca el timbre del canal en directo (por la web), para que las apps abiertas se pongan al día al momento. */
    static void ping(Context c, String topic, JSONObject payload) {
        SharedPreferences sp = prefs(c);
        String url = sp.getString("url", ""), apikey = sp.getString("apikey", "");
        if (url.isEmpty() || apikey.isEmpty()) return;
        HttpURLConnection h = null;
        try {
            h = (HttpURLConnection) new URL(url + "/realtime/v1/api/broadcast").openConnection();
            h.setRequestMethod("POST");
            h.setConnectTimeout(6000);
            h.setReadTimeout(6000);
            h.setDoOutput(true);
            h.setRequestProperty("Content-Type", "application/json");
            h.setRequestProperty("apikey", apikey);
            h.setRequestProperty("Authorization", "Bearer " + apikey);
            JSONObject m = new JSONObject().put("topic", topic).put("event", "ping").put("payload", payload).put("private", false);
            byte[] body = new JSONObject().put("messages", new JSONArray().put(m)).toString().getBytes(StandardCharsets.UTF_8);
            OutputStream os = h.getOutputStream();
            os.write(body);
            os.close();
            h.getResponseCode();
        } catch (Exception ignored) {
        } finally {
            if (h != null) h.disconnect();
        }
    }

    /** Eventos en los que estoy en lista de espera (la lista entera cada vez). Vacía = no hay nada que preguntar. */
    static synchronized void watch(Context c, JSONArray wanted) {
        JSONObject old = watching(c), next = new JSONObject();
        try {
            for (int n = 0; n < wanted.length(); n++) {
                JSONObject it = wanted.getJSONObject(n);
                String ev = it.optString("eventId", "");
                if (ev.isEmpty() || it.optString("key", "").isEmpty()) continue;
                JSONObject o = old.optJSONObject(ev);
                if (o != null && o.has("seen")) it.put("seen", o.optLong("seen"));     // esa oferta ya se avisó
                next.put(ev, it);
            }
        } catch (Exception ignored) { }
        prefs(c).edit().putString("watch", next.toString()).apply();
        if (next.length() == 0) { schedule(c); return; }
        long due = prefs(c).getLong("nextCheck", 0), now = System.currentTimeMillis();
        if (due < now - 60000L || due > now + CHECK_EVERY) armCheck(c, CHECK_EVERY);   // si ya hay una consulta pendiente, no se retrasa
    }

    /** La app ha enseñado esta oferta en pantalla: no hace falta avisarla otra vez. */
    static synchronized void seen(Context c, String eventId, long offeredAt) {
        try {
            JSONObject w = watching(c), e = w.optJSONObject(eventId);
            if (e == null) return;
            e.put("seen", offeredAt);
            prefs(c).edit().putString("watch", w.toString()).apply();
        } catch (Exception ignored) { }
    }

    /** Lo ha contestado la app: se quita el aviso y su recuerdo. */
    static synchronized void done(Context c, int id) {
        try {
            NotificationManagerCompat.from(c).cancel(id);
        } catch (Exception ignored) { }
        JSONObject all = items(c);
        all.remove(String.valueOf(id));
        save(c, all);
        disarm(c, id);
    }

    /** Lo último que pasó al comprobar (se ve en Ajustes → Avisos con la app cerrada). */
    private static void note(Context c, String r) {
        prefs(c).edit().putLong("lastCheck", System.currentTimeMillis()).putString("lastResult", r).apply();
    }

    /** Pregunta al servidor por cada evento en espera. Se ejecuta fuera del hilo principal. */
    static void check(Context c) {
        JSONObject w;
        synchronized (EventNotices.class) {
            w = watching(c);
        }
        long now = System.currentTimeMillis();
        ArrayList<String> drop = new ArrayList<>();
        ArrayList<JSONObject> offers = new ArrayList<>();
        boolean unsupported = false, offline = false;
        int asked = 0;
        for (Iterator<String> k = w.keys(); k.hasNext() && asked < 4; ) {
            String ev = k.next();
            JSONObject it = w.optJSONObject(ev);
            if (it == null) { drop.add(ev); continue; }
            long starts = it.optLong("startsAt", 0);
            if (starts > 0 && starts < now) { drop.add(ev); continue; }                // el evento ya ha empezado
            asked++;
            try {
                JSONObject r = call(c, it.optString("key", ""), "status");
                if (!r.optBoolean("ok", false)) {
                    if ("accion".equals(r.optString("error"))) { unsupported = true; break; }   // falta supabase/08: no se insiste
                    drop.add(ev);                                                      // clave caducada o ya no estoy apuntado
                    continue;
                }
                String st = r.optString("status", "");
                if ("offered".equals(st)) {
                    long dl = r.optLong("deadline", 0);
                    String until = dl > 0 ? " Contesta antes de las " + new java.text.SimpleDateFormat("HH:mm 'del' d/M", new java.util.Locale("es", "ES")).format(new java.util.Date(dl)) + "." : "";
                    String name = it.optString("eventTitle", r.optString("title", "la ruta"));
                    offers.add(new JSONObject().put("id", it.optInt("nid")).put("at", 0).put("kind", "offer")
                            .put("title", "Hay una plaza para ti: " + name)
                            .put("body", "Alguien se ha desapuntado y te toca a ti. ¿Vienes?" + until)
                            .put("key", it.optString("key", "")).put("eventId", ev).put("eventTitle", name)
                            .put("offeredAt", r.optLong("offered_at", 0)));
                } else if (!"waiting".equals(st)) {
                    drop.add(ev);                                                      // ya voy o ya no voy
                }
            } catch (Exception ignored) {
                offline = true;
                break;      // sin conexión: no se insiste con los demás (el sistema da pocos segundos); se pregunta en la siguiente
            }
        }
        note(c, unsupported ? "falta08" : offline ? "sinred" : (!offers.isEmpty() ? "plaza" : "ok:" + Math.max(0, w.length() - drop.size())));
        synchronized (EventNotices.class) {
            if (unsupported) {
                prefs(c).edit().remove("watch").apply();
            } else {
                JSONObject cur = watching(c);
                for (String ev : drop) cur.remove(ev);
                prefs(c).edit().putString("watch", cur.toString()).apply();
                for (JSONObject o : offers) put(c, o);
            }
        }
        if (!offline) checkNews(c);
        synchronized (EventNotices.class) {
            schedule(c);
        }
    }

    /** Deja programados exactamente estos recordatorios: quita los que sobran y pone los nuevos o cambiados. */
    static synchronized void sync(Context c, JSONArray wanted) {
        JSONObject all = items(c), next = new JSONObject();
        long now = System.currentTimeMillis();
        try {
            for (int n = 0; n < wanted.length(); n++) {
                JSONObject it = wanted.getJSONObject(n);
                String id = String.valueOf(it.getInt("id"));
                JSONObject old = all.optJSONObject(id);
                boolean same = old != null && old.optLong("at") == it.optLong("at") && old.optString("title").equals(it.optString("title")) && old.optString("body").equals(it.optString("body"));
                if (same && old.optBoolean("shown")) it.put("shown", true);          // ya saltó: no se repite
                next.put(id, it);
            }
            ArrayList<String> gone = new ArrayList<>();
            for (Iterator<String> k = all.keys(); k.hasNext(); ) {
                String id = k.next();
                JSONObject old = all.optJSONObject(id);
                if (old == null) continue;
                if (!"remind".equals(old.optString("kind", "remind"))) { if (!next.has(id)) next.put(id, old); continue; }   // las plazas ofrecidas no se tocan aquí
                if (!next.has(id)) gone.add(id);
            }
            for (String id : gone) disarm(c, Integer.parseInt(id));
            save(c, next);
            for (Iterator<String> k = next.keys(); k.hasNext(); ) {
                JSONObject it = next.optJSONObject(k.next());
                if (it == null || !"remind".equals(it.optString("kind", "remind")) || it.optBoolean("shown")) continue;
                long at = it.optLong("at");
                if (at > now + 1000) arm(c, it.getInt("id"), at);                   // armar dos veces lo mismo no duplica nada
            }
        } catch (Exception ignored) { }
    }

    /** Un aviso suelto: ahora mismo (at = 0) o a su hora. */
    static synchronized void put(Context c, JSONObject it) {
        try {
            int id = it.getInt("id");
            if ("offer".equals(it.optString("kind"))) {          // una misma oferta solo suena una vez, la avise la app o el teléfono
                long off = it.optLong("offeredAt", 0);
                if (off > 0 && !firstTime(c, "offer:" + it.optString("eventId", "") + ":" + off)) return;
            }
            JSONObject all = items(c);
            all.put(String.valueOf(id), it);
            save(c, all);
            long at = it.optLong("at", 0);
            if (at <= System.currentTimeMillis() + 1000) show(c, id); else arm(c, id, at);
        } catch (Exception ignored) { }
    }

    static synchronized void clear(Context c) {
        JSONObject all = items(c);
        for (Iterator<String> k = all.keys(); k.hasNext(); ) {
            try {
                disarm(c, Integer.parseInt(k.next()));
            } catch (Exception ignored) { }
        }
        disarmCheck(c);
        prefs(c).edit().remove("items").remove("pending").remove("watch").remove("newsKey").remove("newsSince").remove("newsSeen").apply();
    }

    /** Tras reiniciar el teléfono o actualizar la app, el sistema olvida las alarmas: se reponen. */
    static synchronized void rearm(Context c) {
        if (watching(c).length() > 0 || !prefs(c).getString("newsKey", "").isEmpty()) armCheck(c, 60000L);
        JSONObject all = items(c);
        long now = System.currentTimeMillis();
        for (Iterator<String> k = all.keys(); k.hasNext(); ) {
            JSONObject it = all.optJSONObject(k.next());
            if (it == null || it.optBoolean("shown")) continue;
            long at = it.optLong("at");
            try {
                if (at > now + 1000) arm(c, it.getInt("id"), at);
                else if (at > now - 30 * 60000L) show(c, it.getInt("id"));          // tocaba hace un momento, con el teléfono apagado
            } catch (Exception ignored) { }
        }
    }

    private static void post(Context c, int id, Notification n) {
        try {
            NotificationManagerCompat.from(c).notify(id, n);
        } catch (SecurityException ignored) {
            // sin permiso de notificaciones
        }
    }

    static synchronized void show(Context c, int id) {
        JSONObject all = items(c);
        JSONObject it = all.optJSONObject(String.valueOf(id));
        if (it == null) return;
        channel(c);
        String title = it.optString("title"), body = it.optString("body");
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CH)
                .setSmallIcon(R.drawable.ic_stat_rg)
                .setContentTitle(title).setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_EVENT)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setAutoCancel(true)
                .setContentIntent(openApp(c, id));
        if ("offer".equals(it.optString("kind"))) {
            b.addAction(0, "Sí, voy", broadcast(c, ACTION_DO, id, "yes"));
            b.addAction(0, "No puedo", broadcast(c, ACTION_DO, id, "no"));
        } else {
            b.addAction(0, "No puedo ir", broadcast(c, ACTION_DO, id, "leave"));
            b.addAction(0, "Allí estaré", broadcast(c, ACTION_DO, id, "ok"));
        }
        post(c, id, b.build());
        try {
            it.put("shown", true);
            all.put(String.valueOf(id), it);
            save(c, all);
        } catch (Exception ignored) { }
    }

    private static void result(Context c, int id, String title, String text, boolean done) {
        channel(c);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CH)
                .setSmallIcon(R.drawable.ic_stat_rg)
                .setContentTitle(title).setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setOnlyAlertOnce(true).setSilent(true)
                .setAutoCancel(true)
                .setContentIntent(openApp(c, id));
        if (done) b.setTimeoutAfter(20000);
        post(c, id, b.build());
    }

    /** Lo que no se pudo enviar se guarda: la app lo envía al abrirse. */
    private static synchronized void remember(Context c, String act, String eventId, String title) {
        try {
            JSONArray p = new JSONArray(prefs(c).getString("pending", "[]"));
            p.put(new JSONObject().put("act", act).put("eventId", eventId).put("title", title));
            prefs(c).edit().putString("pending", p.toString()).apply();
        } catch (Exception ignored) { }
    }

    static synchronized JSONArray takePending(Context c) {
        JSONArray p;
        try {
            p = new JSONArray(prefs(c).getString("pending", "[]"));
        } catch (Exception e) {
            p = new JSONArray();
        }
        prefs(c).edit().remove("pending").apply();
        return p;
    }

    private static JSONObject call(Context c, String key, String act) throws Exception {
        if (key == null || key.isEmpty()) throw new IllegalStateException("sin configurar");
        return rpc(c, "event_action", new JSONObject().put("p_key", key).put("p_action", act));
    }

    private static JSONObject rpc(Context c, String fn, JSONObject args) throws Exception {
        SharedPreferences sp = prefs(c);
        String url = sp.getString("url", ""), apikey = sp.getString("apikey", "");
        if (url.isEmpty() || apikey.isEmpty()) throw new IllegalStateException("sin configurar");
        HttpURLConnection h = (HttpURLConnection) new URL(url + "/rest/v1/rpc/" + fn).openConnection();
        try {
            h.setRequestMethod("POST");
            h.setConnectTimeout(8000);
            h.setReadTimeout(8000);
            h.setDoOutput(true);
            h.setRequestProperty("Content-Type", "application/json");
            h.setRequestProperty("apikey", apikey);
            h.setRequestProperty("Authorization", "Bearer " + apikey);
            byte[] body = args.toString().getBytes(StandardCharsets.UTF_8);
            OutputStream os = h.getOutputStream();
            os.write(body);
            os.close();
            int code = h.getResponseCode();
            if (code < 200 || code >= 300) throw new IllegalStateException("http " + code);
            InputStream in = h.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[2048];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            in.close();
            return new JSONObject(new String(out.toByteArray(), StandardCharsets.UTF_8));
        } finally {
            h.disconnect();
        }
    }

    /** Se ha pulsado un botón del aviso. Se ejecuta fuera del hilo principal. */
    static void act(Context c, int id, String act) {
        JSONObject it;
        synchronized (EventNotices.class) {
            it = items(c).optJSONObject(String.valueOf(id));
        }
        if (it == null || act == null) {
            try {
                NotificationManagerCompat.from(c).cancel(id);
            } catch (Exception ignored) { }
            return;
        }
        String name = it.optString("eventTitle", "la ruta"), eventId = it.optString("eventId", ""), head = it.optString("title", name);
        if ("ok".equals(act)) {               // «Allí estaré»: solo se cierra el aviso
            try {
                NotificationManagerCompat.from(c).cancel(id);
            } catch (Exception ignored) { }
            return;
        }
        result(c, id, head, "Enviando…", false);
        boolean sent = false;
        String status = "";
        try {
            JSONObject r = call(c, it.optString("key", ""), act);
            sent = r.optBoolean("ok", false);
            status = r.optString("status", "");
        } catch (Exception ignored) { }
        String text;
        if (!sent) {
            remember(c, act, eventId, name);
            text = "No se ha podido enviar (¿sin conexión?). Toca aquí para abrir la app y se enviará.";
        } else if ("yes".equals(act)) {
            text = "going".equals(status) ? "Confirmado: vas a «" + name + "»." : "La plaza ya no estaba libre. Sigues en la lista de espera.";
        } else if ("no".equals(act)) {
            text = "Vale. La plaza pasa al siguiente de la lista.";
        } else {
            text = "Te has desapuntado de «" + name + "». Tu plaza pasa a otro.";
        }
        if (sent && !"yes".equals(act)) {      // ya no voy: sobran los demás avisos de este evento
            int base = id - (id % 4);
            synchronized (EventNotices.class) {
                JSONObject all = items(c);
                for (int k = 0; k < 3; k++) {
                    if (base + k != id) disarm(c, base + k);
                    all.remove(String.valueOf(base + k));
                }
                save(c, all);
            }
        } else if (sent) {
            synchronized (EventNotices.class) {
                JSONObject all = items(c);
                all.remove(String.valueOf(id));
                save(c, all);
            }
        }
        if (sent && ("no".equals(act) || "leave".equals(act) || "going".equals(status))) {
            // Contestado: ya no se está en espera. Si se ha confirmado la plaza, quedan puestos sus dos recordatorios.
            synchronized (EventNotices.class) {
                JSONObject w = watching(c), e = w.optJSONObject(eventId);
                if (e != null) {
                    w.remove(eventId);
                    prefs(c).edit().putString("watch", w.toString()).apply();
                    if (w.length() == 0) schedule(c);
                    JSONArray rem = "going".equals(status) ? e.optJSONArray("remind") : null;
                    long now = System.currentTimeMillis();
                    for (int n = 0; rem != null && n < rem.length(); n++) {
                        JSONObject r = rem.optJSONObject(n);
                        if (r != null && r.optLong("at", 0) > now + 30000L) put(c, r);
                    }
                }
            }
        }
        result(c, id, sent ? name : head, text, sent);
        String cid = it.optString("cid", "");
        if (sent && !cid.isEmpty()) {      // las apps abiertas de los demás se ponen al día al momento (plazas, lista de espera)
            try {
                ping(c, "rg-c-" + cid, new JSONObject().put("kind", "att").put("eid", eventId));
            } catch (Exception ignored) { }
        }
        try {
            RideAlertsPlugin.eventDone(new JSONObject().put("act", act).put("eventId", eventId).put("ok", sent).put("status", status));
        } catch (Exception ignored) { }
    }
}
