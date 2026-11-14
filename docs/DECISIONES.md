# Decisiones técnicas y pendientes

## Tomadas en la fase 1

- **App:** web con Vite y JavaScript sin framework, empaquetada con Capacitor 8. Un solo código para Android y, más adelante, iPhone.
- **Servidor:** Supabase (autenticación, base de datos Postgres con RLS y almacenamiento de archivos). La seguridad depende de las reglas de `supabase/schema.sql`, no de la clave pública.
- **Mapa:** Leaflet con teselas de OpenStreetMap. Vale para pruebas; su política de uso no permite mucho tráfico.
- **Trazado:** servidor público de OSRM (`router.project-osrm.org`), sin clave y para uso moderado. Si falla, la ruta se guarda en línea recta entre puntos y Google Maps hace el resto.
- **Navegación:** se usan los enlaces oficiales de Google Maps (`api=1`), con un máximo de 9 puntos intermedios por enlace. Las rutas con más puntos se parten en tramos.
- **Enlaces de Maps:** se leen las coordenadas del enlace. Los puntos con nombre (sin coordenadas) se sacan de la parte `data=` del enlace. Si alguno no se puede situar, la app avisa y deja marcarlo en el mapa.
- **Firma del APK:** clave de pruebas fija dentro del repositorio, para poder actualizar sin desinstalar. **No vale para Google Play**: allí hará falta una clave de publicación aparte, guardada como secreto.

## Pendiente antes de abrir la app a más gente

- Cambiar las teselas del mapa y el trazado a un proveedor con cuenta propia (MapTiler, Stadia, OpenRouteService o un OSRM propio).
- Comprobar en el móvil el límite real de puntos intermedios en la app de Google Maps. Si es menor de 9, bajar `MAX_WAYPOINTS`.
- Recibir rutas con «Compartir» desde Google Maps directamente en la app (intent de Android). Ahora hay que copiar y pegar.
- Borrar la cuenta desde la app (RGPD) y política de privacidad.

## Siguientes fases (ver documento del proyecto)

2. Rodar en grupo: código de grupo, ubicación en vivo, servicio en primer plano con botones en la pantalla de bloqueo, SOS y aviso de fuera de ruta.
3. Gasolineras: datos del Ministerio, la más cercana frente a la que mejor cuadra, y aviso por autonomía.
4. Comunidades y eventos: página estilo Luma, inscripciones con opciones y acompañantes, plazas, lista de espera, confirmación, chat de cada ruta y pasar lista con QR.
5. Apertura al público, moderación, iPhone, y la inclinación y velocidad (con la corrección del cabeceo del móvil: medir solo el alabeo de la moto).
