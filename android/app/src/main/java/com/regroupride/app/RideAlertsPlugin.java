package com.regroupride.app;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.WindowManager;
import android.widget.RemoteViews;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Avisos del grupo durante la ruta.
 *  - showBanner: aviso fijo, visible en la pantalla de bloqueo, con tres botones (SOS, Avería, Gasolina).
 *    Al pulsar uno se avisa a la parte web (evento «action»), que es la que lo envía al grupo.
 *  - alarm: aviso recibido. Si es «loud» (SOS o avería) suena como una alarma, vibra, enciende la pantalla y
 *    abre la app por encima del bloqueo, hasta que se pulsa «Entendido» (o pasan dos minutos).
 */
@CapacitorPlugin(name = "RideAlerts")
public class RideAlertsPlugin extends Plugin {
    static final String ACTION = "com.regroupride.app.RIDE_ALERT";
    static final String CH_BANNER = "rg_ride_buttons";
    static final String CH_ALARM = "rg_group_alarm";
    static final String CH_NOTICE = "rg_group_notice";
    static final int ID_BANNER = 7101;
    static final int ID_ALARM = 7102;
    private static final long ALARM_MAX_MS = 120000;

    private static RideAlertsPlugin instance;
    private static MediaPlayer player;
    private static Runnable silence;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

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
        try {
            NotificationManagerCompat.from(c).cancel(ID_BANNER);   // sin la app abierta los botones no harían nada
        } catch (Exception ignored) { }
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
        Context c = getContext();
        String sent = call.getString("sent", "");
        String label = call.getString("label", "");
        boolean seen = Boolean.TRUE.equals(call.getBoolean("seen", false));
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CH_BANNER)
            .setSmallIcon(R.drawable.ic_stat_rg)
            .setColor(0xFF0B8A4B)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(open(c, 20));
        if (sent == null || sent.isEmpty()) {
            RemoteViews rv = new RemoteViews(c.getPackageName(), R.layout.rg_alert_banner);
            rv.setOnClickPendingIntent(R.id.rg_sos, tap(c, "sos", 1));
            rv.setOnClickPendingIntent(R.id.rg_averia, tap(c, "averia", 2));
            rv.setOnClickPendingIntent(R.id.rg_gasolina, tap(c, "gasolina", 3));
            b.setContentTitle("Avisar al grupo")
                .setContentText("SOS · Avería · Gasolina")
                .setStyle(new NotificationCompat.DecoratedCustomViewStyle())
                .setCustomContentView(rv)
                .setCustomBigContentView(rv);
        } else {
            b.setContentTitle("Aviso enviado: " + label)
                .setContentText(seen ? "El organizador lo ha visto." : "Enviado al organizador.")
                .addAction(0, "Cancelar aviso", tap(c, "cancel", 4));
        }
        post(c, ID_BANNER, b.build());
        call.resolve();
    }

    @PluginMethod
    public void hideBanner(PluginCall call) {
        try {
            NotificationManagerCompat.from(getContext()).cancel(ID_BANNER);
        } catch (Exception ignored) { }
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
            .setColor(loud ? 0xFFE5484D : 0xFF2F7CF6)
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
            if (v != null && v.hasVibrator()) v.vibrate(VibrationEffect.createWaveform(new long[] { 0, 900, 500 }, 0), attrs);
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
        try {
            Vibrator v = (Vibrator) c.getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null) v.cancel();
        } catch (Exception ignored) { }
    }

    /** Se ha pulsado un botón de un aviso (también con el teléfono bloqueado). */
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
