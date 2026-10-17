# Telegram List Bot — instrucciones del proyecto

## Proyecto y restricciones

- Repositorio: `Nobiga19/telegram_list_bot`. Worker: `telegram-list-bot`.
- Producción: https://telegram-list-bot.gabino-ro-dom.workers.dev
- React, TypeScript, Vite, Tailwind, Hono, Workers Static Assets y D1. Mantener esta arquitectura y Cloudflare Free; no activar facturación ni servicios de pago.
- Inspeccionar el repositorio antes de cambiarlo. Mantener `sources/` de solo lectura cuando exista.
- No exponer, copiar al frontend ni guardar secretos en Git. Reutilizar la configuración segura existente.

## Despliegue habitual: GitHub → Cloudflare Workers Builds

- Los commits nuevos en `main` activan automáticamente el trigger **Deploy main - telegram-list-bot** de Workers Builds. No hace falta crear una rama `main` nueva.
- Raíz: `/`. Node.js: `24`. Cloudflare instala las dependencias del lockfile.
- Build: `npm run typecheck && npm test && npm run build`.
- Deploy: `npx wrangler deploy --keep-vars`.
- Los secretos de ejecución ya están configurados en el Worker. No introducirlos como variables de compilación ni recrearlos.
- Publicar los cambios autorizados mediante GitHub; después esperar el build correspondiente al SHA publicado. No lanzar otro despliegue manual mientras el automático esté pendiente o ejecutándose.
- Consultar los triggers del Worker por API si es necesario; el trigger configurado es `3a574b60-bc82-409c-8f81-7df6bc210dc9`. Usar la credencial de build registrada en Cloudflare sin leer ni exportar su valor.
- Confirmar que el build y el despliegue han terminado correctamente; comprobar `/api/health` y que el HTML de producción referencia los nuevos assets. No declarar completado un cambio solo porque el commit se haya guardado.
- Si falla el build, revisar sus logs y corregir la causa. No saltarse las comprobaciones ni añadir servicios alternativos. Usar despliegue manual únicamente como recuperación justificada cuando la integración no esté disponible y esté dentro del alcance autorizado.
- No modificar la configuración ni los triggers de otros proyectos. No duplicar bases de datos, cambiar el webhook, migrar datos ni actualizar dependencias como parte de un cambio rutinario de UI.

## Validación y comportamiento que se debe preservar

- Ejecutar TypeScript, las pruebas relevantes y el build; para UI, comprobar móvil y temas Telegram claro/oscuro. Indicar cualquier comprobación real que no se haya podido realizar.
- Validar `initData` y pertenencia al grupo en el servidor; cada usuario solo puede modificar su pedido. Las listas cerradas o caducadas rechazan cambios en el servidor.
- Conservar listas, pedidos, enlaces de grupo y borradores al navegar entre lista y pedidos completos.
- Historial: recientes primero, scroll interno, sin botón de historial duplicado y botón Crear lista de ancho completo abajo.
- Vista previa: hasta tres pedidos; fundido del tercero y Ver pedidos solo cuando haya más de tres. Pedidos completos en pantalla separada con separadores y Volver a la lista abajo.
- Cierre rojo con confirmación. Icono circular y UI compacta en español. Mensajes genéricos de apertura con texto invisible y botón Abrir.
- Transiciones: 220 ms, dirección inversa al volver, cabecera estable, scroll restaurado y respeto a movimiento reducido; las actualizaciones de datos no deben reanimar la pantalla.

## Comunicación

Responder brevemente en español con el resultado, la validación y las limitaciones relevantes. Respetar las decisiones tomadas y distinguir hechos verificados de suposiciones.
