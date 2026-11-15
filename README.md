# ReGroupRide

App para rodar en grupo en moto. Parte del código de **Inclina** (mapa, grabación de rutas con inclinación, rutas guardadas, exportación GPX/CSV, estadísticas, garaje y logros) y le añade lo propio de ReGroupRide.

El plan completo (funciones y fases) está en el documento «App para moteros — Documento de proyecto» de Claude.

## Qué hay en la versión 0.3

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
