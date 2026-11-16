# ReGroupRide

App para rodar en grupo en moto. Parte del código de **Inclina** (mapa, grabación de rutas con inclinación, rutas guardadas, exportación GPX/CSV, estadísticas, garaje y logros) y le añade lo propio de ReGroupRide.

El plan completo (funciones y fases) está en el documento «App para moteros — Documento de proyecto» de Claude.

## Qué hay en la versión 0.7

- **Ir al punto de salida**: al iniciar una ruta lejos de su comienzo, cada uno elige entre ir primero a la salida o entrar por el punto más cercano.
- **Rutas de evento sin códigos**: un administrador pulsa «Iniciar la ruta para los apuntados» en el evento; a quien dijo «Voy» le sale «¿Vienes?» (con la app abierta) y entra con un toque.
- **Administradores solo de una ruta** (`event_admins`), además de los de la comunidad. Varias comunidades a la vista.
- **Avisos al administrador más cercano**: a él le salta la alarma; al resto de administradores, un aviso sencillo con su teléfono y un botón para llamarle. Si nadie lo atiende en un minuto, salta a todos. Arreglada la vibración que no paraba.
- **Nivel del motero** (cinco opciones), **medias guardadas** de velocidad e inclinación (`rider_stats`, se suman al guardar cada ruta) y **medición durante la ruta**.
- **Organizar por grupos**: el administrador elige de cuántas motos y a cada uno le sale su grupo.
- **Rutas públicas o privadas** y «Explorar rutas públicas».
- **GPX**: los puntos marcados aparte (gasolineras, paradas…) salen en el mapa.
- Todo lo del servidor está en `supabase/04_rutas_niveles.sql` (hay que ejecutarlo).

## Qué hay en la versión 0.6

- **Avisos del grupo: SOS, avería y gasolina.** Se envían desde el botón del triángulo (junto a «Parar») o, en Android, desde la **pantalla de bloqueo**: mientras ruedas en grupo hay un aviso fijo con los tres botones (`RideAlertsPlugin.java`). Al organizador le salta a pantalla completa con el nombre y la distancia; SOS y avería suenan como una alarma (canal de alarmas, en bucle, con vibración, encendiendo la pantalla por encima del bloqueo) hasta que pulsa «Entendido». Quien avisa se entera de que lo han visto y puede cancelarlo. Si no hay cobertura, el aviso se reintenta solo.
- **Sin Realtime ni push**: los avisos viajan en la misma llamada `ride_sync`. El organizador la hace cada 5 s (los demás, cada 15 s), así que le llega en unos segundos mientras tiene la ruta en marcha o la app abierta.
- **Salida conjunta más robusta**: además de `ride_start`, a los demás se les inicia la ruta al ver que el organizador empieza a mandar posición, así que funciona aunque el servidor tenga el `03_grupo.sql` anterior.
- `supabase/03_grupo.sql` añade `ride_alert` y `ride_alert_seen`: hay que volver a ejecutarlo para que funcionen los avisos.

## Qué hay en la versión 0.5

- **Importar GPX como ruta a seguir** (OsmAnd, Calimoto, Kurviger, un GPS…), desde el planificador o desde Rutas. Se sigue el trazado del archivo tal cual; las paradas salen del `rte` (o de los `wpt`). Las indicaciones de giro se piden a OSRM pasando por puntos del propio trazado y solo se usan en los tramos donde coincide la carretera. Un GPX con horas (recorrido grabado) se puede seguir o guardar como ruta grabada.
- **Panel de datos en ruta**: el de siempre en pequeño (inclinación en vivo, máxima y última de cada lado, velocidad y km). Es el mismo elemento que se actualiza con cada lectura del sensor.
- **Salida conjunta**: cuando quien creó el grupo inicia la ruta, a los demás se les inicia sola (con la app abierta). Función `ride_start` y columna `started_at` en `supabase/03_grupo.sql`, que hay que volver a ejecutar.

## Qué hay en la versión 0.4

- **Todas las paradas en el mapa**, sin límite, al importar y al seguir la ruta. Los puntos con nombre del enlace de Google Maps salen con sus coordenadas exactas (bloque `data=`).
- **Enlaces de Maps**: se leen también cuando llevan apóstrofos sin codificar (L'Orxa, d'Alcoi), que es como los devuelve el enlace corto `maps.app.goo.gl`.
- **Google Maps como opción secundaria**, por tramos de 9 paradas como máximo.
- **Descargar GPX** de cada ruta planificada: paradas con nombre (`wpt` y `rte`) y trazado por carretera (`trk`).
- **Grupo en vivo** (`www/rg-group.js`, `supabase/03_grupo.sql`): crear un grupo para una ruta o unirse con código o QR, ver a todos en el mapa y quién se queda atrás, se sale o pierde la señal. Sin Realtime: una llamada cada 15 s guarda la posición propia (una fila por usuario y grupo) y trae la del grupo. La posición se borra al parar la ruta, al salir o al terminar el grupo.

## Qué había en la versión 0.3

- **Comunidad** (pestaña nueva, `www/rg-club.js`): crear una comunidad o unirse con código, eventos y rutas con «Voy», acompañante, lista de quién viene, ruta adjunta que se carga en el mapa y enlace a Luma; tablón de avisos; páginas con enlaces y códigos de descuento; miembros y administradores. Necesita ejecutar `supabase/02_comunidades.sql`.
- Arreglado: los interruptores de Ajustes no respondían al tocarlos.

## Qué había en la versión 0.2

- Todo lo de Inclina 2.1.1, con estética nueva (`www/rg-theme.css`).
- **Seguir una ruta dentro de la app**, sin Google Maps: siguiente giro con distancia, voz, kilómetros que quedan, aviso de «fuera de ruta» (voz, vibración y notificación) y trazado para volver a la ruta. Si empiezas lejos de la ruta o te unes a mitad, te lleva al punto más cercano por delante.
- **Importar una ruta desde un enlace de Google Maps** en el planificador (también enlaces cortos `maps.app.goo.gl`, solo en el móvil).
- **Cuenta** con correo y contraseña (Supabase) y **sugerencias y fallos** desde Ajustes.
- «Ruta simulada» (Ajustes) recorre la ruta que estés siguiendo, para ver la navegación sin moverte.

## Estructura

- `www/`: la app (sin compilación: archivos estáticos).
  - `app.js`, `lean-core.js`, `geo.js`, `db.js`, `achievements.js`, `platform.js`: base de Inclina.
  - `rg-lib.js`: lógica pura de ReGroupRide (enlaces de Maps, seguimiento, indicaciones). Probada en `tools/test-rg.js`.
  - `rg-app.js`: navegación, importación de enlaces, cuenta y sugerencias. Habla con `app.js` a través de `window.RGApp`.
  - `rg-theme.css`: tema visual.
- `android/`: proyecto Capacitor (`com.regroupride.app`), con el plugin nativo de sensores `MotionPlugin`.
- `supabase/schema.sql`: tablas y reglas de seguridad. Se ejecuta entero en el SQL Editor de Supabase.
- `.github/workflows/android-apk.yml`: cada `git push` a `main` pasa los tests, compila el APK y lo publica en *Releases → latest*, firmado siempre con `android/debug.keystore` (se instala encima de la versión anterior).

## Desarrollo

```
npm install
npm test          # inclinación, enlaces de Maps y seguimiento de ruta
npm run serve     # http://localhost:8080 (los enlaces cortos de Maps solo funcionan en el móvil)
npx cap sync android
```

Decisiones técnicas y pendientes: `docs/DECISIONES.md`.
