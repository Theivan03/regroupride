package com.regroupride.app;

import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.provider.Settings;
import android.util.Base64;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.util.List;

/**
 * Música en el mapa: dice qué está sonando en el teléfono (Spotify, YouTube Music, podcasts…) y le manda
 * anterior / pausa / siguiente. Necesita que el usuario active el «acceso a notificaciones» para ReGroupRide.
 */
@CapacitorPlugin(name = "RgMedia")
public class MediaPlugin extends Plugin {

    private boolean granted() {
        try {
            return NotificationManagerCompat.getEnabledListenerPackages(getContext()).contains(getContext().getPackageName());
        } catch (Exception e) {
            return false;
        }
    }

    /** La sesión que está sonando; si ninguna suena, la primera que haya (la última usada). */
    private MediaController pick() {
        Context c = getContext();
        MediaSessionManager m = (MediaSessionManager) c.getSystemService(Context.MEDIA_SESSION_SERVICE);
        if (m == null) return null;
        List<MediaController> all = m.getActiveSessions(new ComponentName(c, MediaListener.class));
        MediaController first = null;
        for (MediaController mc : all) {
            if (c.getPackageName().equals(mc.getPackageName())) continue;
            if (first == null) first = mc;
            PlaybackState st = mc.getPlaybackState();
            if (st != null && st.getState() == PlaybackState.STATE_PLAYING) return mc;
        }
        return first;
    }

    private static String text(MediaMetadata md, String a, String b) {
        CharSequence v = md.getText(a);
        if (v == null || v.length() == 0) v = md.getText(b);
        return v == null ? "" : v.toString();
    }

    private static String art(MediaMetadata md) {
        Bitmap bm = md.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART);
        if (bm == null) bm = md.getBitmap(MediaMetadata.METADATA_KEY_ART);
        if (bm == null) bm = md.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON);
        if (bm == null || bm.getWidth() <= 0 || bm.getHeight() <= 0) return "";
        int side = 144;
        float k = Math.min(1f, (float) side / Math.max(bm.getWidth(), bm.getHeight()));
        Bitmap small = Bitmap.createScaledBitmap(bm, Math.max(1, Math.round(bm.getWidth() * k)), Math.max(1, Math.round(bm.getHeight() * k)), true);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        small.compress(Bitmap.CompressFormat.JPEG, 78, out);
        return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
    }

    @PluginMethod
    public void state(PluginCall call) {
        JSObject o = new JSObject();
        boolean ok = granted();
        o.put("granted", ok);
        o.put("active", false);
        if (ok) {
            try {
                MediaController mc = pick();
                MediaMetadata md = mc == null ? null : mc.getMetadata();
                if (mc != null && md != null) {
                    PlaybackState st = mc.getPlaybackState();
                    String title = text(md, MediaMetadata.METADATA_KEY_TITLE, MediaMetadata.METADATA_KEY_DISPLAY_TITLE);
                    String artist = text(md, MediaMetadata.METADATA_KEY_ARTIST, MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE);
                    if (artist.length() == 0) artist = text(md, MediaMetadata.METADATA_KEY_ALBUM_ARTIST, MediaMetadata.METADATA_KEY_ALBUM);
                    o.put("active", title.length() > 0);
                    o.put("title", title);
                    o.put("artist", artist);
                    o.put("playing", st != null && st.getState() == PlaybackState.STATE_PLAYING);
                    o.put("pkg", mc.getPackageName());
                    String app = "";
                    try {
                        PackageManager pm = getContext().getPackageManager();
                        app = pm.getApplicationLabel(pm.getApplicationInfo(mc.getPackageName(), 0)).toString();
                    } catch (Exception ignored) { }
                    o.put("app", app);
                    if (Boolean.TRUE.equals(call.getBoolean("art", false))) {
                        try { o.put("art", art(md)); } catch (Exception ignored) { o.put("art", ""); }
                    }
                }
            } catch (Exception e) {
                o.put("active", false);
            }
        }
        call.resolve(o);
    }

    @PluginMethod
    public void cmd(PluginCall call) {
        String what = call.getString("cmd", "");
        try {
            MediaController mc = granted() ? pick() : null;
            if (mc == null) { call.reject("no-session"); return; }
            MediaController.TransportControls t = mc.getTransportControls();
            if ("play".equals(what)) t.play();
            else if ("pause".equals(what)) t.pause();
            else if ("next".equals(what)) t.skipToNext();
            else if ("prev".equals(what)) t.skipToPrevious();
            else if ("open".equals(what)) {
                PendingIntent pi = mc.getSessionActivity();
                if (pi != null) pi.send();
                else {
                    Intent i = getContext().getPackageManager().getLaunchIntentForPackage(mc.getPackageName());
                    if (i != null) getContext().startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                }
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("media-error", e);
        }
    }

    /** Abre la pantalla de Android donde se da el «acceso a notificaciones». */
    @PluginMethod
    public void access(PluginCall call) {
        try {
            getContext().startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            call.resolve();
        } catch (Exception e) {
            call.reject("no-settings", e);
        }
    }
}
