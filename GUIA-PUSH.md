# Activar las notificaciones push (Firebase)

Con esto los avisos llegan al momento aunque la app esté cerrada. Son unos 15 minutos, una sola vez.

## 1 · Crear el proyecto de Firebase (gratis)

1. Entra en https://console.firebase.google.com con tu cuenta de Google y pulsa **Crear un proyecto**. Nombre: `ReGroupRide`. Google Analytics no hace falta.
2. En la página del proyecto pulsa el icono de **Android** («Añadir app»).
   - **Nombre del paquete de Android:** `com.regroupride.app` (exactamente así).
   - Lo demás, vacío. Pulsa **Registrar app**.
3. Descarga **`google-services.json`** y guárdalo. Ese archivo va dentro de la app: **pásaselo a Claude** (adjúntalo en el chat) para que lo meta en `android/app/` y publique la versión con push. No es una contraseña: solo identifica el proyecto.
4. Sáltate el resto de pasos del asistente («Siguiente» hasta el final).

## 2 · La llave para enviar (esta sí es secreta)

1. En Firebase: rueda dentada → **Configuración del proyecto** → pestaña **Cuentas de servicio** → **Generar nueva clave privada**. Se descarga un archivo `.json`.
2. **No se lo pases a nadie ni lo subas al repositorio.** Solo se pega en Supabase, en el paso siguiente.

## 3 · La función en Supabase

1. En Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Nombre de la función: **`push`** (exactamente así).
3. Borra el código de ejemplo y pega entero el contenido de `supabase/functions/push/index.ts`.
4. Desactiva **«Verify JWT»** (la función no recibe datos de quien la llama; solo procesa la cola) y pulsa **Deploy**.
5. En **Edge Functions → Secrets** añade un secreto:
   - Nombre: `FCM_SERVICE_ACCOUNT`
   - Valor: el contenido **entero** del archivo `.json` del paso 2 (ábrelo con el Bloc de notas, copia todo y pégalo).

## 4 · El SQL

En Supabase → **SQL Editor**, ejecuta `supabase/11_push_y_web.sql` (después del 10).

## 5 · Comprobar

1. Instala la versión de la app que lleva el `google-services.json` y ábrela una vez con tu cuenta.
2. En **Ajustes → Avisos con la app cerrada** tiene que poner **«Push activado»**.
3. Prueba: con un móvil en lista de espera y la app cerrada, desapunta a otro desde otro móvil. La notificación debería llegar en pocos segundos.

Si no llega: en Supabase → Edge Functions → `push` → **Logs** se ve si la función se ha llamado y qué ha respondido (`sent` = cuántos teléfonos ha avisado).
