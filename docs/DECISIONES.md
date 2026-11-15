# Decisiones técnicas y pendientes

## Tomadas

- **Base:** el código de Inclina 2.1.1 (web estática + Capacitor 8, sin compilación). ReGroupRide se añade en archivos `rg-*` y se engancha a `app.js` con un puente pequeño (`window.RGApp`) y unas pocas llamadas a `RGNav`.
- **Servidor:** Supabase (cuentas, perfiles, rutas compartidas y sugerencias). La seguridad depende de las reglas RLS de `supabase/schema.sql`; la clave que va en la app es la pública.
- **Mapa:** MapLibre con OpenFreeMap. **Trazado e indicaciones:** servidor público de OSRM (`router.project-osrm.org`), válido para pruebas con uso moderado.
- **Seguir la ruta:** la navegación está activa mientras se graba una ruta y hay una ruta planificada seleccionada. El GPS sigue con la pantalla apagada gracias al servicio en primer plano del plugin de ubicación.
- **Fuera de ruta:** salta al alejarse más de 60 m (más la precisión del GPS) durante 8 s, en movimiento y solo después de haber entrado en la ruta. Parado no salta (gasolinera). Valores por ajustar en pruebas reales.
- **Volver a la ruta:** se calcula un trazado hasta un punto por delante, más lejos cuanto más te hayas alejado, para no dar media vuelta.
- **Firma del APK:** clave de pruebas fija en el repositorio para actualizar sin desinstalar. No vale para Google Play.

## Pendiente antes de abrir la app a más gente

- Trazado y teselas con un proveedor propio o de pago.
- Recibir rutas con «Compartir» desde Google Maps directamente en la app.
- Borrar la cuenta desde la app (RGPD) y política de privacidad.
- Inclinación: medir solo el alabeo de la moto (hoy el cabeceo del móvil al girar el manillar o frenar puede colarse si el soporte no está recto).
- Sincronizar con la cuenta el perfil, el garaje y las rutas planificadas (ahora se guardan en el teléfono).

## Siguientes fases (ver documento del proyecto)

1. Rodar en grupo: unirse con código o QR, ubicación en vivo, botones en la pantalla de bloqueo, SOS, aviso al organizador y grupos automáticos por ritmo.
2. Comunidades y eventos: eventos importados de Luma, «¿Vienes a la ruta?», tablón, calendario, páginas de normas y descuentos, pasar lista.
3. Gasolineras: la más cercana o la que mejor cuadra, con precios y aviso por autonomía.
