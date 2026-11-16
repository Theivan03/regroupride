package com.regroupride.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Avisos de los eventos: los enseña a su hora, atiende sus botones sin abrir la app
 * y repone las alarmas tras reiniciar el teléfono o actualizar la app.
 */
public class EventNoticeReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        final Context c = context.getApplicationContext();
        String a = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(a) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) {
            EventNotices.rearm(c);
            return;
        }
        final int id = intent.getIntExtra("id", 0);
        if (id == 0) return;
        if (EventNotices.ACTION_SHOW.equals(a)) {
            EventNotices.show(c, id);
            return;
        }
        if (EventNotices.ACTION_DO.equals(a)) {
            final String act = intent.getStringExtra("act");
            final PendingResult pending = goAsync();        // la respuesta al servidor va en otro hilo
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        EventNotices.act(c, id, act);
                    } finally {
                        pending.finish();
                    }
                }
            }).start();
        }
    }
}
