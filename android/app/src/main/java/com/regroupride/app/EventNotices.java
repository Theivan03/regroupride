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
 * Un aviso: { id, at (ms; 0 = ya), title, body, kind: "remind" | "offer", key, eventId, eventTitle }.
 * Los ids van de cuatro en cuatro por evento (id % 4: 0 = día antes, 1 = hora antes, 2 = plaza ofrecida).
 */
final class EventNotices {
    static final String ACTION_SHOW = "com.regroupride.app.EVENT_SHOW";
    static final String ACTION_DO = "com.regroupride.app.EVENT_DO";
    private static final String CH = "rg_events";
    private static final String PREFS = "rg_events";

    private EventNotices() { }

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
        prefs(c).edit().remove("items").remove("pending").apply();
    }

    /** Tras reiniciar el teléfono o actualizar la app, el sistema olvida las alarmas: se reponen. */
    static synchronized void rearm(Context c) {
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
        SharedPreferences sp = prefs(c);
        String url = sp.getString("url", ""), apikey = sp.getString("apikey", "");
        if (url.isEmpty() || apikey.isEmpty() || key == null || key.isEmpty()) throw new IllegalStateException("sin configurar");
        HttpURLConnection h = (HttpURLConnection) new URL(url + "/rest/v1/rpc/event_action").openConnection();
        try {
            h.setRequestMethod("POST");
            h.setConnectTimeout(8000);
            h.setReadTimeout(8000);
            h.setDoOutput(true);
            h.setRequestProperty("Content-Type", "application/json");
            h.setRequestProperty("apikey", apikey);
            h.setRequestProperty("Authorization", "Bearer " + apikey);
            byte[] body = new JSONObject().put("p_key", key).put("p_action", act).toString().getBytes(StandardCharsets.UTF_8);
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
        result(c, id, sent ? name : head, text, sent);
        try {
            RideAlertsPlugin.eventDone(new JSONObject().put("act", act).put("eventId", eventId).put("ok", sent).put("status", status));
        } catch (Exception ignored) { }
    }
}
