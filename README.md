# ReGroupRide

App para rodar en grupo en moto. Parte del código de **Inclina** (mapa, grabación de rutas con inclinación, rutas guardadas, exportación GPX/CSV, estadísticas, garaje y logros) y le añade lo propio de ReGroupRide.

El plan completo (funciones y fases) está en el documento «App para moteros — Documento de proyecto» de Claude.

## Qué hay en la versión 0.12

Identidad visual **Dirección A · «Quedada»**, elegida del documento «Tres direcciones visuales» (16 nov 2026). Está al final de `www/rg-theme.css`.

- **Colores** (día / noche): marca `#086236` / `#3DDC84`, texto `#0E141B` / `#E8EDF2`, texto secundario `#4A5563` / `#9AA6B2`, izquierda `#1552B8` / `#5AA9FF`, derecha `#9A3209` / `#FF8A5B`, aviso `#FFB300` / `#FFC24A` con texto `#1A1300`, error `#A31919` / `#FF7A7A`. Todo lo que se lee en marcha cumple 7:1.
- **Cartel de navegación** a todo el ancho con el giro en una ficha, en tres casos: en ruta (marca), hacia la ruta o la salida (superficie neutra) y fuera de la ruta (ámbar con texto oscuro). El rojo ya no se usa en el cartel.
- **«Avisar» y «Parar» separados**: «Avisar» flota aparte, a la izquierda y 12 px por encima, en ámbar y con triángulo; «Parar» va dentro del marcador, a la derecha, en rojo y con cuadrado. El marcador lleva km y curvas, el cronómetro y el botón de ampliar. Todo a 60 px.
- **La ruta por delante se pinta en tinta con filete** (clara con filete oscuro de noche) para no confundirse con las carreteras del mapa. **Lo recorrido** va en azul a la izquierda y naranja a la derecha, según el lado de la inclinación.
- **El color nunca va solo**: administrador = marcador cuadrado, compañero = redondo; rezagado o fuera de ruta = anillo discontinuo ámbar con «!»; indicadores de estado con forma (círculo bien, rombo a medias, cuadrado mal).
- Botones redondos del mapa de 56 px (60 en ruta), fila de estado en píldoras con icono, pestaña activa con punto.
- No aplicado, como en el documento: ocultar la barra de pestañas mientras se rueda.

## Qué hay en la versión 0.11

Necesita ejecutar **`supabase/07_avisos_y_garaje.sql`** (después del 06). Sin él, los avisos y la copia de rutas siguen como en la 0.10.

- **Los botones de los avisos ya no abren la app** (Android). Los recordatorios de evento y el aviso de plaza libre los pone ahora el plugin propio (`EventNotices.java`, `EventNoticeReceiver.java`): al pulsar «No puedo ir», «Sí, voy» o «No puedo», el teléfono contesta al servidor por detrás y el aviso cambia a «Te has desapuntado…». Funciona sin sesión gracias a una clave secreta por evento y persona (`event_keys`, `event_action`). Si no hay conexión, la respuesta se guarda y la app la envía al abrirse. Los recordatorios se reponen al reiniciar el teléfono.
- **Comunidad más rápida.** La pestaña de eventos hacía 4 peticiones seguidas y bajaba la ruta entera de cada evento (decenas de KB por evento). Ahora es **una** petición, sin las rutas (solo nombre, km y dónde empieza; la ruta completa se pide al pulsar «Cargar ruta»). Además cada pantalla de Comunidad se enseña al instante con lo último que se vio y se refresca por detrás; los nombres de la gente se recuerdan.
- **Copia siempre automática.** Cualquier cambio (guardar, editar la nota, renombrar, borrar) dispara la copia solo; si falla, se reintenta sola (30 s, 1 min, 2 min… hasta 15 min), y también al recuperar la conexión, al salir de la app y cada 10 min con la app abierta. Ya no hay botón «Sincronizar ahora» (solo «Reintentar» si hay un fallo). **El garaje** (vehículos y mantenimiento) entra en la copia (`user_backup`). Siguen sin copiarse las fotos de las rutas.
- **Curvas en desplegable** en el detalle de una ruta: se ve «12 curvas · máxima 26°» y la tabla solo al abrirlo.

## Qué hay en la versión 0.10

Necesita ejecutar **`supabase/06_plazas_y_salida.sql`** en Supabase (después de los anteriores). Sin él la app funciona como la 0.9.

- **Plazas y lista de espera en los eventos.** El administrador pone un límite de motos. Quien se apunta con el evento lleno queda en lista de espera, por orden de llegada. Cuando alguien con plaza se desapunta, la plaza se **ofrece** al primero de la lista, que tiene que confirmar («Sí, voy» / «No puedo»); si dice que no, pasa al siguiente. Si no contesta en 12 horas (o en la mitad del tiempo que falte para la salida), pasa al siguiente y él vuelve al final. Las reglas las aplica la base de datos (disparadores sobre `event_attendees`), así que valen también para móviles con la app antigua.
- **Recordatorios un día antes y una hora antes** de cada evento al que estás apuntado, con el botón **«No puedo ir»** para desapuntarse desde la propia notificación. Son notificaciones programadas en el teléfono: saltan con la app cerrada. Se reprograman solas si el organizador cambia la hora (cuando el móvil abre la app y lo ve).
- **Aviso de plaza libre**: en pantalla si la app está abierta; como notificación con «Sí, voy» / «No puedo» si está en segundo plano. Con la app cerrada del todo no llega (haría falta push).
- **Punto de salida con enlace de Maps**: el organizador pega el enlace del sitio (o usa su posición). La tarjeta del evento enlaza siempre a Maps, y **«Ir al punto de salida»** pone en el mapa de la app el camino desde donde estás; «Iniciar ruta» te guía hasta allí. Si no hay enlace y el evento lleva ruta, la salida es donde empieza la ruta.
- **Inclinómetro: la vertical se mide en marcha.** En cuanto la moto rueda a más de ~15 km/h, 1,5 s bastan para saber dónde está su vertical de verdad, vaya recta o en curva, sin depender de cómo estaba aparcada (pata de cabra, cuesta, peralte). Lo que marque en parado es provisional y **no cuenta**: en una ruta, máximas, «última» y curvas solo se apuntan rodando y con la vertical ya medida.
- **Ubicación rápida**: el plugin de GPS pedía una posición cada 15 s (su valor por defecto); ahora cada segundo. Además el GPS se pide al arrancar, el mapa abre donde estabas la última vez y se centra con la posición aproximada del teléfono mientras llega la buena.
- Pruebas: `tools/test-arranque.js` (vertical en marcha), `tools/test-rg.js` (enlaces de Maps a un sitio).

## Qué hay en la versión 0.9.1

- **El inclinómetro marca desde que se abre la app.** Antes los sensores no se encendían hasta abrir el inclinómetro o empezar la ruta, y sin referencia guardada había que tener el móvil 1,5 s completamente quieto (en la mano o con el motor en marcha no llegaba nunca). Ahora:
  - Los sensores se encienden al cargar la app, antes incluso de leer la base de datos.
  - Sin referencia, bastan 0,3 s de sensor para una **referencia provisional** (`auto-quick`). Se afina sola con el móvil quieto 1,5 s y, como siempre, rodando recto.
  - Con referencia guardada, la primera lectura sale ya del acelerómetro (antes subía desde 0°), también al volver de segundo plano.
  - Si la referencia guardada es de otra postura del móvil (más de 20° de diferencia con la moto parada 3 s), se corrige sola sin esperar a rodar.
  - Corregido de paso: un cambio de referencia podía enseñarle al giróscopo una unidad equivocada.
- Pruebas nuevas: `tools/test-arranque.js` (dentro de `npm test`).

## Qué hay en la versión 0.9

- **Copia de las rutas en la cuenta** (`www/rg-sync.js`, `supabase/05_copia_en_la_cuenta.sql`): las rutas planificadas y las grabadas se guardan también en la cuenta, no solo en el teléfono. Al iniciar sesión en un móvil nuevo se recuperan.
  - Planificadas → tabla `routes` (privadas; «publicar» solo cambia quién las ve).
  - Grabadas → tabla `rides` (la ficha completa: km, tiempos, inclinaciones, curvas…) y su trazado punto a punto, comprimido, en el almacén privado `rides`.
  - Se copia sola al entrar, al guardar una ruta y al volver a la app; en ruta no. Lo que se borra en un móvil se borra de la cuenta, pero nunca se borra nada de otro móvil.
  - Si otra persona inicia sesión en el mismo teléfono, sus rutas no se mezclan salvo que lo pida.

## Qué hay en la versión 0.8

- **Permisos al abrir la app** (y al volver a ella y al iniciar una ruta): se piden los que falten —ubicación, notificaciones, cámara— y, si la ubicación del teléfono está apagada, sale la ventana del sistema para encenderla. Lo que Android ya no deja pedir se explica con un botón a los ajustes.
- **Voz apagada por defecto**; se enciende en Ajustes.
- **Plan de mantenimiento con vista previa**: se ve lo que se va a añadir, se puede quitar o cambiar cada tarea y hay que confirmar.
- **Opciones del mapa**: fuera «seguirme», «orientar al rumbo» y «ver mis rutas». El botón de recentrar solo aparece al mover el mapa.
- **Rutas de otros moteros** en una pestaña propia de Rutas, con «Ver en el mapa» antes de guardar y filtro por autor. Una ruta grabada se puede convertir en ruta para seguir y publicarla.

- **0.8.1** · Al importar una ruta (GPX, o una grabada convertida) se elige entre «Guardar en mis rutas» y «Guardar y empezarla ahora»; ya no se pone a seguirla sola. · **Consejo de nivel**: si el nivel elegido y las rutas no cuadran por un nivel o más (con al menos 3 rutas, 2 horas y 40 curvas medidas), la app propone cambiarlo, con buenas palabras, al guardar una ruta o al entrar en Ajustes; si se dice que no, no insiste en un mes.

- **0.8.2** · «Voz al salir de cada curva» y «Pausa automática al parar» vienen apagadas (en las instalaciones anteriores se apagan una vez). · El permiso de alarma sobre la pantalla de bloqueo (Android 14 o superior) se pide al abrir la app, con un botón que lleva directo a su interruptor.

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
- **0.7.1** · Paradas con nombre: en los GPX de MyRouteApp o Garmin las paradas van como puntos de la ruta con nombre (`rtept`), mezcladas con puntos de relleno («#3»). Ahora las que tienen nombre se ven en el mapa con su nombre e icono y se anuncian al acercarse («En 500 metros, parada de reagrupación»), igual que las gasolineras y demás puntos marcados.

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

## 0.12.1 · la fila de arriba del mapa

- La píldora del tiempo dice solo los grados («17°»). Si llueve, nieva o hay tormenta se vuelve ámbar y cambia el icono; al tocarla se lee el tiempo entero. Antes el texto («17° · Cubierto») empujaba el avatar fuera de la pantalla.
- Si los sensores o el GPS fallan, ese aviso se lee con palabras y el tiempo se aparta para dejarle sitio.
- El crédito del mapa sale recogido en una «i» bajo las píldoras (se abre al tocarla); ya no queda medio tapado por la barra de pestañas.
