package com.regroupride.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Recibe las pulsaciones de los botones de los avisos (SOS, Avería, Gasolina, Cancelar, Entendido). */
public class RideAlertsReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !RideAlertsPlugin.ACTION.equals(intent.getAction())) return;
        String kind = intent.getStringExtra("kind");
        if (kind != null) RideAlertsPlugin.onAction(context, kind);
    }
}
