package com.regroupride.app;

import android.content.Context;
import android.media.AudioManager;
import android.os.SystemClock;
import android.view.KeyEvent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Música en el mapa: botones de anterior / pausa / siguiente para lo que esté sonando en el teléfono (Spotify,
 * YouTube Music, podcasts…). Usa las teclas multimedia del sistema, que no necesitan ningún permiso.
 * No lee el título de la canción: eso exige «acceso a notificaciones», y Google Play Protect bloquea la instalación
 * de las apps que lo declaran si no vienen de Google Play.
 */
@CapacitorPlugin(name = "RgMedia")
public class MediaPlugin extends Plugin {

    private AudioManager audio() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    @PluginMethod
    public void state(PluginCall call) {
        JSObject o = new JSObject();
        boolean playing = false;
        try {
            AudioManager am = audio();
            playing = am != null && am.isMusicActive();
        } catch (Exception ignored) { }
        o.put("basic", true);
        o.put("granted", true);
        o.put("playing", playing);
        call.resolve(o);
    }

    @PluginMethod
    public void cmd(PluginCall call) {
        String what = call.getString("cmd", "");
        int code = "next".equals(what) ? KeyEvent.KEYCODE_MEDIA_NEXT
                : "prev".equals(what) ? KeyEvent.KEYCODE_MEDIA_PREVIOUS
                : "play".equals(what) ? KeyEvent.KEYCODE_MEDIA_PLAY
                : "pause".equals(what) ? KeyEvent.KEYCODE_MEDIA_PAUSE
                : KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE;
        try {
            AudioManager am = audio();
            if (am == null) { call.reject("no-audio"); return; }
            long t = SystemClock.uptimeMillis();
            am.dispatchMediaKeyEvent(new KeyEvent(t, t, KeyEvent.ACTION_DOWN, code, 0));
            am.dispatchMediaKeyEvent(new KeyEvent(t, t, KeyEvent.ACTION_UP, code, 0));
            call.resolve();
        } catch (Exception e) {
            call.reject("media-error", e);
        }
    }
}
