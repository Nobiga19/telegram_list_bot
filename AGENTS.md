# Telegram List Bot — instrucciones del proyecto

## Proyecto y restricciones

- Repositorio: `Nobiga19/telegram_list_bot`. Worker: `telegram-list-bot`.
- Producción: https://telegram-list-bot.gabino-ro-dom.workers.dev
- React, TypeScript, Vite, Tailwind, Hono, Workers Static Assets y D1. Mantener esta arquitectura y Cloudflare Free; no activar facturación ni servicios de pago.
- Inspeccionar el repositorio antes de cambiarlo. Mantener `sources/` de solo lectura cuando exista.
- No exponer, copiar al frontend ni guardar secretos en Git. Reutilizar la configuración segura existente.

## Despliegue habitual: GitHub → Cloudflare Workers Builds

- El trigger **Deploy main - telegram-list-bot** de Workers Builds está configurado para nuevos commits en `main`. No hace falta crear una rama `main` nueva.
- La aplicación GitHub **Cloudflare Workers and Pages** tiene acceso explícito a `Nobiga19/telegram_list_bot`. Mantener este repositorio incluido en la selección de la aplicación para que Cloudflare reciba los eventos push.
- Raíz: `/`. Node.js: `24`. Cloudflare instala las dependencias del lockfile.
- Build: `npm run typecheck && npm test && npm run build`.
- Deploy: `npx wrangler deploy --keep-vars && node scripts/verify-deployment.mjs`.
- Los secretos de ejecución ya están configurados en el Worker. No introducirlos como variables de compilación ni recrearlos.
- Publicar los cambios autorizados mediante GitHub; después buscar el build correspondiente al SHA publicado. No lanzar otro build mientras ya exista uno pendiente o ejecutándose para ese SHA. Si no aparece un build automático, iniciar una sola vez el trigger configurado mediante la API Workers Builds (`POST /accounts/{account_id}/builds/triggers/{trigger_uuid}/builds`, con `branch: main` y el SHA exacto), y esperar su resultado. Este mecanismo ya está validado y no requiere preparar una subida manual de assets ni nuevas credenciales.
- Consultar los triggers del Worker por API si es necesario; el trigger configurado es `3a574b60-bc82-409c-8f81-7df6bc210dc9`. Usar la credencial de build registrada en Cloudflare sin leer ni exportar su valor.
- Confirmar que el build y el despliegue han terminado correctamente; comprobar `/api/health` y que el HTML de producción referencia los nuevos assets. No declarar completado un cambio solo porque el commit se haya guardado.
- Si falla el build, revisar sus logs y corregir la causa. No saltarse las comprobaciones ni añadir servicios alternativos. Usar despliegue manual únicamente como recuperación justificada cuando la integración no esté disponible y esté dentro del alcance autorizado.
- No modificar la configuración ni los triggers de otros proyectos. No duplicar bases de datos, cambiar el webhook, migrar datos ni actualizar dependencias como parte de un cambio rutinario de UI.

## Validación y comportamiento que se debe preservar

- Ejecutar TypeScript, las pruebas relevantes y el build; para UI, comprobar móvil y temas Telegram claro/oscuro. Indicar cualquier comprobación real que no se haya podido realizar.
- Validar `initData` y pertenencia al grupo en el servidor; cada usuario solo puede modificar su aportación. Las listas cerradas o caducadas rechazan cambios en el servidor.
- Conservar listas, aportaciones, enlaces de grupo y borradores al navegar entre lista y aportaciones completos.
- Historial: recientes primero, scroll interno, sin botón de historial duplicado y botón Crear lista de ancho completo abajo.
- Vista previa: hasta tres aportaciones; fundido del tercero y Ver aportaciones solo cuando haya más de tres. Pedidos completos en pantalla separada con separadores y Volver a la lista abajo.
- Cierre rojo con confirmación. Icono circular y UI compacta en español. Mensajes genéricos de apertura con texto invisible y botón Abrir.
- Transiciones: 220 ms, dirección inversa al volver, cabecera estable, scroll restaurado y respeto a movimiento reducido; las actualizaciones de datos no deben reanimar la pantalla.

## Comunicación

Responder brevemente en español con el resultado, la validación y las limitaciones relevantes. Respetar las decisiones tomadas y distinguir hechos verificados de suposiciones.


## Listas generales y eliminación

- Mantener textos y ejemplos neutrales, sin referencias a comida o pedidos. Usar «aportaciones». Conservar los identificadores internos y rutas existentes para compatibilidad.
- Solo los administradores actuales de Telegram pueden eliminar listas abiertas, cerradas o caducadas; comprobarlo en el servidor. Botón rojo con confirmación explícita.
- Eliminar las aportaciones y ocultar la lista de todas las lecturas. Conservar únicamente la referencia de lanzamiento y metadatos mínimos para que los enlaces firmados existentes permitan volver al historial del grupo, sin recuperar el contenido eliminado.
- Aplicar migraciones D1 pendientes antes de desplegar código que las requiera.
