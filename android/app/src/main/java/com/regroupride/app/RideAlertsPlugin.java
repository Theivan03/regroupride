package com.regroupride.app;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.location.LocationManager;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.service.notification.StatusBarNotification;
import android.view.WindowManager;
import android.widget.RemoteViews;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.common.api.ResolvableApiException;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.LocationSettingsRequest;
import com.google.android.gms.location.LocationSettingsResponse;
import com.google.android.gms.location.Priority;
import com.google.android.gms.tasks.OnFailureListener;
import com.google.android.gms.tasks.OnSuccessListener;

import java.util.ArrayList;

/**
 * Avisos del grupo durante la ruta.
 *  - showBanner: aviso fijo, visible en la pantalla de bloqueo, con tres botones (SOS, Avería, Gasolina).
 *    Al pulsar uno se avisa a la parte web (evento «action»), que es la que lo envía al grupo.
 *    Mientras se graba la ruta hay otro aviso de la app (el del seguimiento por GPS). Con dos avisos de la misma app
 *    el teléfono los apila y los botones quedan escondidos hasta desplegarlos, así que los botones se ponen DENTRO
 *    del aviso del seguimiento: queda un solo aviso de la app y los tres botones se ven nada más encender la pantalla.
 *  - alarm: aviso recibido. Si es «loud» (SOS o avería) suena como una alarma, vibra, enciende la pantalla y
 *    abre la app por encima del bloqueo, hasta que se pulsa «Entendido» (o pasan dos minutos).
 */
@CapacitorPlugin(
    name = "RideAlerts",
    permissions = {
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
        @Permission(alias = "notifications", strings = { "android.permission.POST_NOTIFICATIONS" }),
        @Permission(alias = "camera", strings = { Manifest.permission.CAMERA })
    }
)
public class RideAlertsPlugin extends Plugin {
    static final String ACTION = "com.regroupride.app.RIDE_ALERT";
    static final String CH_BANNER = "rg_ride_buttons";
    static final String CH_ALARM = "rg_group_alarm";
    static final String CH_NOTICE = "rg_group_notice";
    static final int ID_BANNER = 7101;
    static final int ID_ALARM = 7102;
    /** El aviso del seguimiento por GPS (plugin BackgroundGeolocation 1.3.x): su número y su canal. */
    static final int ID_TRACK = 28351;
    static final String CH_TRACK = "com.equimaps.capacitor_background_geolocation";
    private static final long BANNER_CHECK_MS = 5000;
    private static final long ALARM_MAX_MS = 120000;

    private static RideAlertsPlugin instance;
    private static MediaPlayer player;
    private static Vibrator vibrating;   // el mismo objeto que empezó a vibrar: solo él puede pararlo
    private static Runnable silence;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static boolean bannerOn;
    private static String bannerSent = "";
    private static String bannerLabel = "";
    private static boolean bannerSeen;
    private static Runnable bannerTick;
    private static BroadcastReceiver screenRx;

    @Override
    public void load() {
        instance = this;
        channels(getContext());
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) instance = null;
        Context c = getContext();
        stopSound(c);
        removeBanner(c);   // sin la app abierta los botones no harían nada
    }

    private static void channels(Context c) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel b = new NotificationChannel(CH_BANNER, "Botones de aviso durante la ruta", NotificationManager.IMPORTANCE_DEFAULT);
        b.setDescription("SOS, avería y gasolina, a mano en la pantalla de bloqueo mientras ruedas en grupo.");
        b.setSound(null, null);
        b.enableVibration(false);
        b.setShowBadge(false);
        b.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(b);
        NotificationChannel a = new NotificationChannel(CH_ALARM, "Alarma del grupo (SOS y avería)", NotificationManager.IMPORTANCE_HIGH);
        a.setDescription("Suena como una alarma cuando alguien del grupo pide ayuda.");
        a.setSound(null, null);          // el sonido lo pone la app, en bucle y por el canal de alarmas
        a.enableVibration(false);
        a.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(a);
        NotificationChannel n = new NotificationChannel(CH_NOTICE, "Avisos del grupo", NotificationManager.IMPORTANCE_HIGH);
        n.setDescription("Avisos que no son urgentes, como una parada para repostar.");
        n.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(n);
    }

    private static PendingIntent tap(Context c, String kind, int code) {
        Intent i = new Intent(c, RideAlertsReceiver.class).setAction(ACTION).putExtra("kind", kind);
        return PendingIntent.getBroadcast(c, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent open(Context c, int code) {
        Intent i = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void post(Context c, int id, Notification n) {
        try {
            NotificationManagerCompat.from(c).notify(id, n);
        } catch (SecurityException ignored) {
            // sin permiso de notificaciones: no se puede enseñar
        }
    }

    /** Botones en la pantalla de bloqueo. sent = aviso que ya he enviado (entonces se ofrece cancelarlo). */
    @PluginMethod
    public void showBanner(PluginCall call) {
        Context c = getContext().getApplicationContext();
        String sent = call.getString("sent", "");
        String label = call.getString("label", "");
        synchronized (RideAlertsPlugin.class) {
            bannerSent = sent == null ? "" : sent;
            bannerLabel = label == null ? "" : label;
            bannerSeen = Boolean.TRUE.equals(call.getBoolean("seen", false));
            bannerOn = true;
        }
        placeBanner(c, true);
        watchBanner(c);
        call.resolve();
    }

    /** El aviso con los botones (o, si ya he enviado uno, con «Cancelar aviso»). Siempre con vista propia: se ve entero aunque el aviso esté recogido. */
    private static Notification bannerNotification(Context c, boolean merged) {
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CH_BANNER)
            .setSmallIcon(R.drawable.ic_stat_rg)
            .setColor(0xFF5A2DB0)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
            .setStyle(new NotificationCompat.DecoratedCustomViewStyle())
            .setContentIntent(open(c, 20));
        if (merged) b.setSubText("Siguiendo tu ruta");
        RemoteViews rv;
        if (bannerSent.isEmpty()) {
            rv = new RemoteViews(c.getPackageName(), R.layout.rg_alert_banner);
            rv.setOnClickPendingIntent(R.id.rg_sos, tap(c, "sos", 1));
            rv.setOnClickPendingIntent(R.id.rg_averia, tap(c, "averia", 2));
            rv.setOnClickPendingIntent(R.id.rg_gasolina, tap(c, "gasolina", 3));
            b.setContentTitle("Avisar al grupo").setContentText("SOS · Avería · Gasolina");
        } else {
            String title = "Aviso enviado: " + bannerLabel;
            String text = bannerSeen ? "El organizador lo ha visto." : "Enviado al organizador.";
            rv = new RemoteViews(c.getPackageName(), R.layout.rg_alert_sent);
            rv.setTextViewText(R.id.rg_sent_title, title);
            rv.setTextViewText(R.id.rg_sent_text, text);
            rv.setOnClickPendingIntent(R.id.rg_cancel, tap(c, "cancel", 4));
            b.setContentTitle(title).setContentText(text);
        }
        b.setCustomContentView(rv).setCustomBigContentView(rv);
        return b.build();
    }

    /**
     * Coloca los botones donde toca: dentro del aviso del seguimiento si existe (un solo aviso de la app),
     * y si no en el suyo. force = el contenido ha cambiado y hay que volver a pintarlo.
     */
    private static synchronized void placeBanner(Context c, boolean force) {
        if (!bannerOn) return;
        try {
            boolean track = false, trackOurs = false, own = false;
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                for (StatusBarNotification s : nm.getActiveNotifications()) {
                    if (s.getId() == ID_TRACK) {
                        if (!isService(s)) {   // el seguimiento ya paró y quedó un aviso suelto con su número: fuera
                            nm.cancel(ID_TRACK);
                            continue;
                        }
                        track = true;
                        trackOurs = CH_BANNER.equals(s.getNotification().getChannelId());
                    } else if (s.getId() == ID_BANNER) {
                        own = true;
                    }
                }
            }
            if (track) {
                if (force || !trackOurs) post(c, ID_TRACK, bannerNotification(c, true));
                if (own) NotificationManagerCompat.from(c).cancel(ID_BANNER);
            } else if (force || !own) {
                post(c, ID_BANNER, bannerNotification(c, false));
            }
        } catch (Exception ignored) { }
    }

    /** ¿Es el aviso de un servicio en marcha (el seguimiento por GPS)? */
    private static boolean isService(StatusBarNotification s) {
        return (s.getNotification().flags & Notification.FLAG_FOREGROUND_SERVICE) != 0;
    }

    /** Si el seguimiento paró justo cuando se repintaba su aviso, puede quedar uno suelto que no se quita solo: se retira. */
    private static void sweepOrphan(Context c) {
        try {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            for (StatusBarNotification s : nm.getActiveNotifications()) {
                if (s.getId() == ID_TRACK && !isService(s)) nm.cancel(ID_TRACK);
            }
        } catch (Exception ignored) { }
    }

    /** Mientras los botones están puestos se comprueba cada pocos segundos y al encender la pantalla que siguen en su sitio. */
    private static synchronized void watchBanner(final Context c) {
        if (bannerTick == null) {
            bannerTick = new Runnable() {
                @Override
                public void run() {
                    if (!bannerOn) return;
                    placeBanner(c, false);
                    MAIN.postDelayed(this, BANNER_CHECK_MS);
                }
            };
            MAIN.postDelayed(bannerTick, 1500);
        }
        if (screenRx == null) {
            screenRx = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    placeBanner(c, false);
                }
            };
            try {
                IntentFilter f = new IntentFilter(Intent.ACTION_SCREEN_ON);
                f.addAction(Intent.ACTION_USER_PRESENT);
                ContextCompat.registerReceiver(c, screenRx, f, ContextCompat.RECEIVER_NOT_EXPORTED);
            } catch (Exception e) {
                screenRx = null;
            }
        }
    }

    /** Quita los botones. Si estaban dentro del aviso del seguimiento, ese aviso vuelve a su texto de siempre. */
    private static synchronized void removeBanner(Context ctx) {
        Context c = ctx.getApplicationContext();
        bannerOn = false;
        if (bannerTick != null) { MAIN.removeCallbacks(bannerTick); bannerTick = null; }
        if (screenRx != null) {
            try { c.unregisterReceiver(screenRx); } catch (Exception ignored) { }
            screenRx = null;
        }
        try {
            NotificationManagerCompat.from(c).cancel(ID_BANNER);
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            for (StatusBarNotification s : nm.getActiveNotifications()) {
                if (s.getId() == ID_TRACK && isService(s) && CH_BANNER.equals(s.getNotification().getChannelId())) {
                    Notification plain = new NotificationCompat.Builder(c, CH_TRACK)
                        .setSmallIcon(R.drawable.ic_stat_rg)
                        .setContentTitle("ReGroupRide está siguiendo tu ruta")
                        .setContentText("Toca Parar en la app cuando acabes.")
                        .setOngoing(true)
                        .setOnlyAlertOnce(true)
                        .setShowWhen(false)
                        .setContentIntent(open(c, 20))
                        .build();
                    post(c, ID_TRACK, plain);
                }
            }
        } catch (Exception ignored) { }
        final Context app = c;
        Runnable sweep = new Runnable() {
            @Override
            public void run() {
                if (!bannerOn) sweepOrphan(app);
            }
        };
        MAIN.postDelayed(sweep, 1500);
        MAIN.postDelayed(sweep, 6000);
    }

    @PluginMethod
    public void hideBanner(PluginCall call) {
        removeBanner(getContext());
        call.resolve();
    }

    /** Aviso recibido de alguien del grupo. loud = alarma (SOS, avería); si no, aviso normal. */
    @PluginMethod
    public void alarm(PluginCall call) {
        Context c = getContext();
        String title = call.getString("title", "Aviso del grupo");
        String text = call.getString("text", "");
        boolean loud = Boolean.TRUE.equals(call.getBoolean("loud", true));
        PendingIntent full = open(c, 21);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, loud ? CH_ALARM : CH_NOTICE)
            .setSmallIcon(R.drawable.ic_stat_rg)
            .setColor(loud ? 0xFFA31919 : 0xFF5A2DB0)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(loud ? NotificationCompat.CATEGORY_ALARM : NotificationCompat.CATEGORY_MESSAGE)
            .setOngoing(loud)
            .setAutoCancel(!loud)
            .setContentIntent(full)
            .addAction(0, "Entendido", tap(c, "ack", 5));
        String phone = call.getString("phone", "");
        if (phone != null && !phone.isEmpty()) {     // «Llamar a…»: abre el marcador con el número puesto
            Intent dial = new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + phone.replaceAll("[^0-9+]", ""))).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            PendingIntent pd = PendingIntent.getActivity(c, 22, dial, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            b.addAction(0, call.getString("phoneLabel", "Llamar"), pd);
        }
        if (loud) {
            b.setFullScreenIntent(full, true);
            overLock(true);
            startSound(c);
        }
        post(c, ID_ALARM, b.build());
        call.resolve();
    }

    @PluginMethod
    public void stopAlarm(PluginCall call) {
        Context c = getContext();
        stopSound(c);
        overLock(false);
        try {
            NotificationManagerCompat.from(c).cancel(ID_ALARM);
        } catch (Exception ignored) { }
        call.resolve();
    }

    /** Qué puede hacer el teléfono: notificaciones y abrir a pantalla completa (Android 14+ lo deja a elección del usuario). */
    @PluginMethod
    public void status(PluginCall call) {
        Context c = getContext();
        JSObject r = new JSObject();
        boolean full = true;
        if (Build.VERSION.SDK_INT >= 34) {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            full = nm != null && nm.canUseFullScreenIntent();
        }
        r.put("fullScreen", full);
        r.put("notifications", NotificationManagerCompat.from(c).areNotificationsEnabled());
        call.resolve(r);
    }

    @PluginMethod
    public void openFullScreenSettings(PluginCall call) {
        try {
            Context c = getContext();
            Intent i;
            if (Build.VERSION.SDK_INT >= 34) {
                i = new Intent("android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT", Uri.parse("package:" + c.getPackageName()));
            } else {
                i = new Intent("android.settings.APP_NOTIFICATION_SETTINGS").putExtra("android.provider.extra.APP_PACKAGE", c.getPackageName());
            }
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            c.startActivity(i);
        } catch (Exception ignored) { }
        call.resolve();
    }

    /* ---------- permisos y ubicación del teléfono ---------- */

    private boolean locationOn() {
        try {
            LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
            if (lm == null) return false;
            if (Build.VERSION.SDK_INT >= 28) return lm.isLocationEnabled();
            return lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        } catch (Exception e) {
            return false;
        }
    }

    private String state(String alias) {
        try {
            if ("notifications".equals(alias) && Build.VERSION.SDK_INT < 33) {
                return NotificationManagerCompat.from(getContext()).areNotificationsEnabled() ? "granted" : "denied";
            }
            PermissionState st = getPermissionState(alias);
            return st == null ? "prompt" : st.toString();
        } catch (Exception e) {
            return "prompt";
        }
    }

    private JSObject systemState() {
        Context c = getContext();
        JSObject r = new JSObject();
        r.put("location", state("location"));
        r.put("notifications", state("notifications"));
        r.put("camera", state("camera"));
        r.put("locationOn", locationOn());
        boolean full = true;
        if (Build.VERSION.SDK_INT >= 34) {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            full = nm != null && nm.canUseFullScreenIntent();
        }
        r.put("fullScreen", full);
        return r;
    }

    /** Cómo están los permisos y si el teléfono tiene la ubicación encendida. */
    @PluginMethod
    public void system(PluginCall call) {
        call.resolve(systemState());
    }

    /** Pide de una vez todos los permisos que falten (ubicación, notificaciones, cámara). Android enseña sus ventanas una tras otra. */
    @PluginMethod
    public void requestAll(PluginCall call) {
        ArrayList<String> need = new ArrayList<>();
        if (!"granted".equals(state("location"))) need.add("location");
        if (Build.VERSION.SDK_INT >= 33 && !"granted".equals(state("notifications"))) need.add("notifications");
        if (!"granted".equals(state("camera"))) need.add("camera");
        if (need.isEmpty()) {
            call.resolve(systemState());
            return;
        }
        try {
            requestPermissionForAliases(need.toArray(new String[0]), call, "permsDone");
        } catch (Exception e) {
            call.resolve(systemState());
        }
    }

    @PermissionCallback
    private void permsDone(PluginCall call) {
        call.resolve(systemState());
    }

    /** Si la ubicación del teléfono está apagada, enseña la ventana del sistema para encenderla con un toque. */
    @PluginMethod
    public void enableLocation(final PluginCall call) {
        final Activity a = getActivity();
        final JSObject r = new JSObject();
        if (locationOn()) {
            r.put("on", true);
            call.resolve(r);
            return;
        }
        r.put("on", false);
        try {
            LocationRequest req = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 2000).build();
            LocationSettingsRequest settings = new LocationSettingsRequest.Builder().addLocationRequest(req).setAlwaysShow(true).build();
            LocationServices.getSettingsClient(a).checkLocationSettings(settings)
                .addOnSuccessListener(new OnSuccessListener<LocationSettingsResponse>() {
                    @Override
                    public void onSuccess(LocationSettingsResponse res) {
                        r.put("on", locationOn());
                        call.resolve(r);
                    }
                })
                .addOnFailureListener(new OnFailureListener() {
                    @Override
                    public void onFailure(Exception e) {
                        boolean asked = false;
                        if (e instanceof ResolvableApiException) {
                            try {
                                ((ResolvableApiException) e).startResolutionForResult(a, 9911);
                                asked = true;
                            } catch (Exception ignored) { }
                        }
                        if (!asked) openLocationPanel();
                        r.put("asked", asked);
                        call.resolve(r);
                    }
                });
        } catch (Throwable t) {
            openLocationPanel();
            r.put("asked", false);
            call.resolve(r);
        }
    }

    private void openLocationPanel() {
        try {
            getContext().startActivity(new Intent(android.provider.Settings.ACTION_LOCATION_SOURCE_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Exception ignored) { }
    }

    /** Abre la ficha de la app en los ajustes del teléfono (para dar un permiso que Android ya no deja pedir). */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Context c = getContext();
            c.startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + c.getPackageName())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Exception ignored) { }
        call.resolve();
    }

    /** Deja (o no) que la app se vea por encima de la pantalla de bloqueo y encienda la pantalla. */
    private void overLock(final boolean on) {
        final Activity a = getActivity();
        if (a == null) return;
        a.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (Build.VERSION.SDK_INT >= 27) {
                        a.setShowWhenLocked(on);
                        a.setTurnScreenOn(on);
                    } else {
                        int f = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON;
                        if (on) a.getWindow().addFlags(f); else a.getWindow().clearFlags(f);
                    }
                } catch (Exception ignored) { }
            }
        });
    }

    private static synchronized void startSound(Context ctx) {
        final Context c = ctx.getApplicationContext();
        stopSound(c);
        AudioAttributes attrs = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
        try {
            Uri u = RingtoneManager.getActualDefaultRingtoneUri(c, RingtoneManager.TYPE_ALARM);
            if (u == null) u = RingtoneManager.getActualDefaultRingtoneUri(c, RingtoneManager.TYPE_RINGTONE);
            if (u == null) u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            if (u != null) {
                MediaPlayer p = new MediaPlayer();
                p.setAudioAttributes(attrs);
                p.setDataSource(c, u);
                p.setLooping(true);
                p.prepare();
                p.start();
                player = p;
            }
        } catch (Exception e) {
            player = null;
        }
        try {
            Vibrator v = (Vibrator) c.getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null && v.hasVibrator()) {
                // Sin repetición infinita: 60 pulsos (unos 84 s). Si algo impidiera cancelarla, se acaba sola.
                long[] wave = new long[120];
                for (int i = 0; i < wave.length; i += 2) { wave[i] = i == 0 ? 0 : 500; wave[i + 1] = 900; }
                v.vibrate(VibrationEffect.createWaveform(wave, -1), attrs);
                vibrating = v;
            }
        } catch (Exception ignored) { }
        silence = new Runnable() {
            @Override
            public void run() {
                stopSound(c);
            }
        };
        MAIN.postDelayed(silence, ALARM_MAX_MS);
    }

    private static synchronized void stopSound(Context c) {
        if (silence != null) MAIN.removeCallbacks(silence);
        silence = null;
        if (player != null) {
            try {
                player.stop();
            } catch (Exception ignored) { }
            try {
                player.release();
            } catch (Exception ignored) { }
            player = null;
        }
        // La vibración solo la para el mismo objeto que la empezó: pedir otro (desde la pantalla o desde el aviso) no la cancela.
        try {
            if (vibrating != null) vibrating.cancel();
        } catch (Exception ignored) { }
        vibrating = null;
        try {
            Vibrator v = (Vibrator) c.getApplicationContext().getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null) v.cancel();
        } catch (Exception ignored) { }
    }

    /** Se ha pulsado un botón de un aviso (también con el teléfono bloqueado). */
    /* ---------- avisos de eventos con botones que no abren la app (ver EventNotices) ---------- */

    @PluginMethod
    public void eventConfig(PluginCall call) {
        EventNotices.configure(getContext(), call.getString("url", ""), call.getString("apikey", ""));
        call.resolve();
    }

    /** Recordatorios que tienen que quedar programados; los demás se quitan. */
    @PluginMethod
    public void eventSync(PluginCall call) {
        JSArray items = call.getArray("items");
        EventNotices.sync(getContext(), items == null ? new JSArray() : items);
        call.resolve();
    }

    /** Un aviso suelto, ahora o a su hora (plaza ofrecida). */
    @PluginMethod
    public void eventShow(PluginCall call) {
        JSObject item = call.getObject("item");
        if (item != null) EventNotices.put(getContext(), item);
        call.resolve();
    }

    /** Eventos en los que se está en lista de espera: el teléfono pregunta cada 10 minutos si ya hay plaza. */
    @PluginMethod
    public void eventWatch(PluginCall call) {
        JSArray items = call.getArray("items");
        EventNotices.watch(getContext(), items == null ? new JSArray() : items);
        call.resolve();
    }

    /** Clave de novedades de la cuenta: el teléfono pregunta cada 15 minutos si hay evento, tablón o info nuevos. */
    @PluginMethod
    public void newsWatch(PluginCall call) {
        EventNotices.news(getContext(), call.getString("key", ""));
        call.resolve();
    }

    /** Novedad recibida por el canal en directo: se avisa ya (o, con silent, solo se apunta para no repetirla). */
    @PluginMethod
    public void newsNow(PluginCall call) {
        JSArray items = call.getArray("items");
        final org.json.JSONArray list = items == null ? new org.json.JSONArray() : items;
        final boolean silent = Boolean.TRUE.equals(call.getBoolean("silent", false));
        final android.content.Context ctx = getContext();
        new Thread(new Runnable() {
            @Override
            public void run() {
                EventNotices.newsNow(ctx, list, silent);
            }
        }).start();
        call.resolve();
    }

    /** La app ya ha enseñado esa plaza ofrecida en pantalla. */
    @PluginMethod
    public void eventSeen(PluginCall call) {
        Double off = call.getDouble("offeredAt", 0.0);
        EventNotices.seen(getContext(), call.getString("eventId", ""), off == null ? 0L : off.longValue());
        call.resolve();
    }

    @PluginMethod
    public void eventClear(PluginCall call) {
        EventNotices.clear(getContext());
        call.resolve();
    }

    /** Respuestas pulsadas en un aviso que no llegaron al servidor: la app las envía. */
    @PluginMethod
    public void eventPending(PluginCall call) {
        JSObject r = new JSObject();
        r.put("list", EventNotices.takePending(getContext()));
        call.resolve(r);
    }

    static void eventDone(org.json.JSONObject o) {
        RideAlertsPlugin p = instance;
        if (p == null) return;
        try {
            p.notifyListeners("eventAction", JSObject.fromJSONObject(o), true);
        } catch (Exception ignored) { }
    }

    static void onAction(Context c, String kind) {
        if ("ack".equals(kind)) {
            stopSound(c);
            try {
                NotificationManagerCompat.from(c).cancel(ID_ALARM);
            } catch (Exception ignored) { }
        } else {
            try {   // respuesta al tacto: se nota que el botón ha entrado
                Vibrator v = (Vibrator) c.getSystemService(Context.VIBRATOR_SERVICE);
                if (v != null && v.hasVibrator()) v.vibrate(VibrationEffect.createOneShot(120, VibrationEffect.DEFAULT_AMPLITUDE));
            } catch (Exception ignored) { }
        }
        RideAlertsPlugin p = instance;
        if (p == null) return;
        if ("ack".equals(kind)) p.overLock(false);
        JSObject o = new JSObject();
        o.put("kind", kind);
        p.notifyListeners("action", o, true);
    }
}
