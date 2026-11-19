package com.regroupride.app;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/**
 * Push de Firebase. El mensaje es solo un «toque», sin contenido: al llegar (también con la app cerrada), el teléfono
 * pregunta al servidor qué hay (plaza ofrecida, novedades, ruta que empieza) y pone la notificación con EventNotices,
 * igual que en la comprobación de cada minuto, pero al momento.
 */
public class RgPushService extends FirebaseMessagingService {
    @Override
    public void onMessageReceived(RemoteMessage message) {
        try {
            EventNotices.prefsFor(getApplicationContext()).edit().putLong("lastPush", System.currentTimeMillis()).apply();
            EventNotices.check(getApplicationContext());
        } catch (Exception ignored) { }
    }

    @Override
    public void onNewToken(String token) {
        try {
            EventNotices.prefsFor(getApplicationContext()).edit().putString("pushToken", token).apply();
        } catch (Exception ignored) { }
    }
}
