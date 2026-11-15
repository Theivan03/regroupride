package com.regroupride.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MotionPlugin.class); // sensores nativos a alta frecuencia
        registerPlugin(RideAlertsPlugin.class); // avisos del grupo: botones en la pantalla de bloqueo y alarma
        super.onCreate(savedInstanceState);
    }
}
