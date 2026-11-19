package com.regroupride.app;

import android.service.notification.NotificationListenerService;

/**
 * Servicio vacío. Android solo deja ver qué música suena (y mandarle pausa o siguiente) a las apps a las que el
 * usuario ha dado «acceso a notificaciones»; ese permiso se concede a un servicio como este. No lee ni guarda
 * ninguna notificación: solo existe para que MediaPlugin pueda consultar las sesiones de música activas.
 */
public class MediaListener extends NotificationListenerService {
}
