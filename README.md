# RutasRatoners

App para rodar en grupo: rutas desde Google Maps, «Iniciar ruta», «Reengancharme» y, en próximas fases, ubicación del grupo en vivo, avisos desde la pantalla de bloqueo, gasolineras y eventos de la comunidad.

El documento completo del proyecto (funciones y fases) está en Claude: «App para moteros — Documento de proyecto».

## Fase 1 (esta versión)

- Registro con correo y contraseña. Perfil con la moto, la autonomía y un contacto de emergencia privado.
- Crear rutas pegando un enlace de Google Maps (también los cortos `maps.app.goo.gl`) o tocando puntos en el mapa. Los puntos se pueden arrastrar, reordenar, renombrar o convertir en puntos de paso.
- Trazado por carretera, con distancia y duración.
- Rutas privadas o públicas. Pestaña de rutas públicas de otros.
- **Iniciar ruta:** abre Google Maps con el recorrido. Si hay más de 10 puntos, va por tramos.
- **Reengancharme:** mira dónde estás y te manda a un punto de la ruta por delante, más adelante cuanto más lejos estés, para no hacerte dar media vuelta. Mientras la ruta está en curso y la app abierta, guarda por dónde vas, así no te devuelve al principio en rutas de ida y vuelta.
- Sugerencias y fallos con captura opcional. La app añade sola el modelo de móvil y la versión. Panel de administración para cambiar el estado y responder.

## Puesta en marcha

1. **Supabase:** en el SQL Editor, ejecuta `supabase/schema.sql` entero. Se puede ejecutar más de una vez.
2. Pon la URL y la clave *anon/publishable* en `src/config.js`.
3. Regístrate en la app y hazte administrador con la última línea de `supabase/schema.sql`.
4. **APK:** cada `git push` a `main` compila en GitHub Actions y publica `rutasratoners.apk` en *Releases → latest*. Se firma siempre con la misma clave de pruebas (`android/debug.keystore`), así que se instala encima de la versión anterior sin desinstalar.

## Desarrollo

```
npm install
npm run dev      # en el navegador (el enlace corto de Maps solo funciona en el móvil)
npm test         # tests de la lógica de rutas
npm run build && npx cap sync android
```

Estructura:

- `src/lib/`: lógica pura y probada (`gmaps.js` lee los enlaces de Google Maps, `geo.js` hace los cálculos y el reenganche, `mapsLaunch.js` crea los enlaces de navegación, `routing.js` calcula el trazado).
- `src/screens/`: pantallas.
- `src/services.js`: Supabase y funciones del móvil.
- `src/ride.js`: la ruta en curso.

Las decisiones técnicas y lo que queda pendiente están en `docs/DECISIONES.md`.
