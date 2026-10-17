# Listas del grupo · Telegram

Mini App compacta en español (España) para compartir pedidos dentro de grupos de Telegram. React, TypeScript, Vite y Tailwind en el frontend; Hono en un Cloudflare Worker con Static Assets y D1. No utiliza Pages ni servicios de pago.

## Aplicación y bot

- Aplicación: https://telegram-list-bot.gabino-ro-dom.workers.dev
- Bot: https://t.me/ourizo_telegram_list_bot
- Webhook: `/telegram/webhook`.
- Endpoint de disponibilidad: `/api/health`.

El navegador convencional muestra instrucciones para abrir Telegram; no admite autenticación externa. La prueba final en Android, iOS y Telegram Desktop debe hacerse con cuentas reales después de configurar BotFather.

## Pasos pendientes en Telegram

1. Abre **@BotFather → /mybots → @ourizo_telegram_list_bot → Bot Settings → Configure Mini App → Enable Mini App** (los nombres pueden variar según el cliente).
2. Introduce `https://telegram-list-bot.gabino-ro-dom.workers.dev` como URL de la **Main Mini App**. Si pide un título, utiliza **Listas del grupo**. Selecciona el modo compacto si ofrece esa opción. Los enlaces también incluyen `mode=compact`.
3. Añade el bot al grupo mediante https://t.me/ourizo_telegram_list_bot?startgroup=true y hazlo administrador. No necesita borrar mensajes, bloquear usuarios, invitar miembros ni cambiar la información del grupo. Debe poder publicar mensajes.
4. Pulsa **Abrir** en el mensaje **📋 Listas** que publica el bot y selecciona **Crear lista** dentro de la aplicación. Solo los administradores del grupo pueden crear listas. Introduce el título y pulsa **Crear lista**.
5. Cada miembro abre **Abrir lista**, escribe en **Mi pedido** y pulsa **Guardar cambios**. Todos ven los pedidos; cada uno solo modifica o elimina el suyo.
6. El creador o un administrador puede cerrar la lista. El historial conserva las listas anteriores, incluidas las que siguen abiertas pero ya no son la principal.

El bot se llama **Listas**. El grupo dispone de un teclado persistente con **📋 Listas**. Al pulsarlo, el bot publica un mensaje compacto con el texto **📋 Listas** y el botón **Abrir**, que abre la aplicación del grupo: son dos pulsaciones. Telegram permite teclados personalizados en grupos, pero los botones de tipo `web_app` del teclado y el menú nativo de Mini Apps son exclusivos de chats privados. El texto del botón se envía como mensaje al grupo; no abre por sí solo una web.

Para activar el teclado en un grupo existente, pulsa el icono **/** junto al campo de mensaje y selecciona **listas** del bot. También funciona `/listas@ourizo_telegram_list_bot`. El bot registra este comando en el menú de grupos; no hace falta escribirlo ni volver a buscar mensajes anteriores. El cliente puede ocultar el teclado: se recupera con su icono o desde ese menú.

El botón nativo **Iniciar** de Telegram puede enviar `/start` automáticamente en privado y muestra botones gráficos. No hace falta desactivar el modo de privacidad en BotFather. Si el bot ya estaba en el grupo antes de activar el webhook, el acceso **listas** permite recuperar el registro del grupo a partir del evento autenticado de Telegram.

## Asociación segura con grupos

Los enlaces directos de Mini Apps reciben `chat_instance`, que **no es el `chat_id` de Bot API**. No se equiparan ni se aceptan IDs de chats aportados por el frontend.

El webhook autenticado registra el ID real del grupo cuando Telegram envía `my_chat_member`. Genera un UUID aleatorio para el grupo y publica un enlace `startapp=g_<uuid>`. Cada lista tiene otro UUID y se publica como `startapp=l_<uuid>`. El servidor obtiene el contexto de `start_param` dentro del `initData` firmado; ignora `initDataUnsafe` y los parámetros de URL para autorizar.

Cada consulta o modificación comprueba la pertenencia actual con `getChatMember`. Telegram solo garantiza esa consulta para otros usuarios cuando el bot es administrador: este es el motivo concreto de exigir ese rol. Un enlace reenviado a alguien ajeno al grupo no concede acceso. Las migraciones de grupo a supergrupo conservan los pedidos y el identificador original del grupo.

La fijación es opcional y está desactivada. Para activarla, cambia `PIN_MESSAGES` a `"true"`, concede únicamente el permiso adicional para fijar mensajes y vuelve a desplegar. Un fallo de fijación no impide crear la lista.

## Navegación y transiciones

Las cuatro pantallas comparten una única sesión React. La cabecera permanece estable y el contenido usa una transición horizontal con fundido de 220 ms (90 ms de salida y 130 ms de entrada), invertida al volver. No se añaden iframes ni dependencias. La carga inicial y la actualización de pedidos no animan la pantalla.

La navegación conserva los formularios al ir y volver, restaura el scroll de cada pantalla/lista y bloquea pulsaciones durante la transición. Abrir otra lista carga su pedido; volver a la misma mantiene el borrador. El foco pasa al título cuando termina la entrada. Si el dispositivo solicita movimiento reducido, el cambio es inmediato.

## Desarrollo

Requisitos: Node.js 24, npm y una cuenta Cloudflare con Workers **Free**. Las versiones están fijadas en `package.json` y `package-lock.json`.

```sh
npm ci
```

Copia `.dev.vars.example` a `.dev.vars` y completa `BOT_TOKEN` y `WEBHOOK_SECRET`. Genera el segundo con un generador criptográfico (32 bytes aleatorios en hexadecimal). El archivo está excluido de Git. Usa un bot independiente de desarrollo si vas a enviar mensajes reales.

```sh
npm run db:local
npm run dev
```

`npm run dev` compila el frontend y sirve la aplicación con Wrangler y D1 local. Tras editar el frontend, ejecuta `npm run build` para regenerar los estáticos; para recarga rápida puedes usar `npm run dev:ui` en otra terminal, con proxy a Wrangler en el puerto 8787. El acceso protegido sigue requiriendo `initData` firmado de Telegram; el navegador no contiene un acceso de prueba que eluda la autenticación.

```sh
npm run types
npm run typecheck
npm test
npm run build
```

Los tipos de bindings/runtime se generan con Wrangler. Las pruebas utilizan un token ficticio y SQLite/D1 real en Miniflare, sin tocar Telegram ni la base de datos remota. Cubren firmas, caducidad, asociación de grupos, permisos, pedidos propios, cierre, fechas límite, aislamiento de grupos, restricciones e índices SQL, reintentos de publicación y migraciones de chat.

## Despliegue automático desde GitHub

El Worker `telegram-list-bot` está conectado a este repositorio mediante **Cloudflare Workers Builds**. Cada nuevo commit en `main` activa **Deploy main - telegram-list-bot**, con Node.js 24 y raíz `/`:

- Build: `npm run typecheck && npm test && npm run build`.
- Deploy: `npx wrangler deploy --keep-vars`.

Las credenciales se gestionan dentro de Cloudflare y los secretos de ejecución se conservan en el Worker. No hay que volver a desplegar manualmente después de hacer push. Antes de dar por terminado un cambio, comprobar que el build del SHA publicado termina correctamente y que `/api/health` y los assets de producción responden. El procedimiento permanente para agentes está en `AGENTS.md`.

Workers Builds incluye 3.000 minutos mensuales y un build concurrente en Free, compartidos por la cuenta; no se ha cambiado el plan ni activado facturación. Límites comprobados el 18 de octubre de 2026: https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/.

## Instalación desde cero y despliegue con Wrangler

1. Crea un bot en **@BotFather** con `/newbot`; conserva el token fuera del repositorio. No se necesitan `api_id` ni `api_hash` de una cuenta personal de Telegram.
2. Comprueba que Cloudflare está en **Workers Free**. El proyecto no cambia el plan ni configura facturación.
3. Inicia sesión y crea D1:

```sh
npx wrangler login
npx wrangler d1 create telegram-list-bot --location weur
```

4. Sustituye `d1_databases[0].database_id` en `wrangler.jsonc` por el UUID recibido. Para este despliegue ya está configurado; no crees una segunda base de datos. Ajusta también `APP_URL` al subdominio gratuito `workers.dev` de tu cuenta y `BOT_USERNAME` al nombre exacto del bot sin `@`.
5. Aplica las migraciones y configura los secretos mediante las preguntas interactivas de Wrangler:

```sh
npm run db:remote
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npm run types
npm run deploy
```

Si aún no existe el Worker, compila y despliega una primera vez con `npm run deploy`, añade los dos secretos y vuelve a desplegar. La aplicación deniega las operaciones protegidas mientras falten. El despliegue solo configura Workers, Static Assets y el binding D1. `--keep-vars` conserva variables del panel; los secretos no van en el frontend.

6. Con el mismo token y secreto en el entorno o en `.dev.vars`, registra el webhook y el botón privado:

```sh
npm run telegram:setup
```

El script valida `getMe`, evita sustituir un webhook existente de otra URL, registra `secret_token`, limita las conexiones del webhook a una y configura el botón **Abrir**. El nombre del bot se gestiona manualmente en Telegram. No elimina actualizaciones pendientes. Después comprueba `getWebhookInfo` sin mostrar el token. La Main Mini App se configura manualmente en BotFather como se explica arriba.

7. Configura BotFather, añade el bot al grupo y prueba el flujo con al menos dos usuarios. Revisa que nadie pueda cambiar el pedido de otro, que un no miembro no vea listas reenviadas y que cerrar bloquee las modificaciones.

## API

Todas las rutas protegidas exigen `Authorization: tma <Telegram.WebApp.initData>`. Nunca envíes el token del bot al cliente. El JSON no acepta campos de identidad de usuario.

| Método | Ruta | Acción |
|---|---|---|
| GET | `/api/session` | Usuario verificado y contexto firmado del grupo |
| GET | `/api/lists/:id` | Lista, permisos y pedidos |
| GET | `/api/lists/:id/orders` | Instantánea coherente para actualización |
| POST | `/api/lists` | Crear lista y publicar el botón; requiere administrador |
| PUT | `/api/lists/:id/my-order` | Crear o modificar el pedido del usuario autenticado |
| DELETE | `/api/lists/:id/my-order` | Eliminar el pedido del usuario autenticado |
| POST | `/api/lists/:id/close` | Cerrar como creador o administrador |
| GET | `/api/groups/:id/lists` | Historial paginado, 50 listas por página |
| POST | `/api/lists/:id/publish` | Reintentar publicación como administrador |
| POST | `/telegram/webhook` | Eventos de Telegram; requiere el secreto del webhook |

`POST /api/lists` recibe `group_id` (UUID opaco), `request_id` (UUID de idempotencia), `title`, `description` y `deadline` ISO opcional. El grupo debe coincidir con el contexto firmado. El cierre y la fecha límite se comprueban dentro de las escrituras SQL, evitando escribir usando un estado anterior al cierre.

## Límites y comportamiento ante fallos

- Un pedido por persona y lista, hasta 500 pedidos por lista, título de 100 caracteres, descripción de 500 y pedido de 1000. Las respuestas son acotadas y las consultas usan índices.
- Sesiones firmadas válidas durante una hora, con tolerancia de 30 segundos al reloj futuro. Al caducar, cierra y vuelve a abrir la Mini App.
- Actualización cada 15 segundos mientras la lista está abierta y la aplicación visible/activa. Se detiene en segundo plano y al cerrar la lista. Los cambios guardados actualizan la vista con la propia respuesta del servidor.
- D1 tiene transacciones para crear listas y una restricción parcial que designa una única lista principal por grupo. Crear otra lista no cierra automáticamente las anteriores.
- Al fallar la publicación se conserva la lista y aparece **Publicar en el grupo**. Una reserva temporal evita reintentos simultáneos. La Bot API no ofrece claves de idempotencia para `sendMessage`: si Telegram acepta el mensaje pero se pierde su respuesta, un reintento puede duplicar ese mensaje. Los pedidos y listas no se duplican por ello.
- El cierre por fecha límite es efectivo en las consultas/escrituras sin procesos programados. No se envía un mensaje adicional al llegar la hora; al abrir el enlace se muestra cerrada.
- No se almacenan mensajes normales del grupo. Solo identidades, nombres, títulos de grupo, listas, pedidos y metadatos necesarios para publicarlos. No se registran tokens, cabeceras de autenticación ni cuerpos de solicitudes en logs propios.

## Free-Tier Compliance

Revisión con documentación oficial y plan de la cuenta comprobados el **17 de octubre de 2026**:

| Recurso | Límite gratuito comprobado | Uso en el proyecto |
|---|---|---|
| Workers | 100 000 solicitudes/día, 10 ms de CPU/solicitud | API Hono y webhook; sin procesos largos |
| Workers Static Assets | Entrega gratuita de estáticos | HTML, CSS y JS servidos directamente; solo `/api/*` y `/telegram/*` ejecutan primero el Worker |
| D1 | 5 millones de filas leídas/día; 100 000 escritas/día | Consultas parametrizadas e índices por grupo/lista/usuario |
| D1 | 5 GB totales por cuenta; máximo 500 MB por base en Free | Una base de datos; tres tablas de aplicación y metadatos de migración de Wrangler |
| workers.dev | Subdominio incluido | HTTPS sin comprar dominio |

No utiliza Workers Paid, Pages, Durable Objects, R2, Queues, Workflows, Workers AI, proveedores externos de autenticación, bases de datos externas, pagos, anuncios ni servicios de pago. No requiere tarjeta de crédito para esta arquitectura en Free. No activa suscripciones ni actualiza planes. Las cuotas son compartidas con otras aplicaciones de la cuenta: la disponibilidad no es ilimitada. Al superar los límites, Cloudflare rechaza solicitudes/consultas hasta el restablecimiento aplicable; el proyecto no activa facturación automáticamente.

El coste de lectura depende de cuántas personas mantengan abierta una lista y cuántos pedidos contenga. Una lista con 20 pedidos y 10 espectadores produce aproximadamente 48 000 filas de pedidos leídas por hora de visualización simultánea, además de las consultas de contexto. Consulta las métricas de D1 y Workers para el consumo real.

Fuentes oficiales:

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/
- https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
- https://core.telegram.org/bots/webapps#direct-link-mini-apps
- https://core.telegram.org/bots/api#getchatmember
- https://core.telegram.org/bots/api#setwebhook
