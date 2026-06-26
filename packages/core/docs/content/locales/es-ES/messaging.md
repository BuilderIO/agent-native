---
title: "Mensajería"
description: "Hable con su agente desde Slack, correo electrónico, Telegram o WhatsApp: el mismo agente, la misma memoria, las mismas herramientas."
---

# Mensajería

Conecta tu agente a Slack, correo electrónico, Telegram o WhatsApp para que puedas chatear con él desde las aplicaciones que ya usas. Es el mismo agente (la misma memoria, las mismas herramientas, los mismos subprocesos), pero al que se puede acceder desde más lugares.

> **¿Estás usando la plantilla de Despacho?** Todo esto está conectado para ti en **Configuración → Mensajería**. Haga clic para conectar cada plataforma; no necesita leer el resto de esta página a menos que esté personalizando o creando su propia plantilla. Ver [Dispatch](/docs/dispatch) o [Dispatch template reference](/docs/template-dispatch).

## Qué puedes hacer {#what-you-can-do}

- **Envíe un correo electrónico a su agente** a una dirección como `agent@yourcompany.com`; responde en el hilo, tal como lo haría un compañero de trabajo.
- **Envía un mensaje de texto a tu agente** en un hilo: lo leerá y participará cuando lo solicites.
- **Envíe un mensaje de texto al agente en Slack**, o `@mention` en cualquier canal.
- **Envía mensajes al agente por Telegram o WhatsApp** desde tu teléfono.
- **Mismo agente, misma memoria.** Todo lo que diga en Slack se recordará cuando lo envíe por correo electrónico más tarde. El chat web y los mensajes externos comparten un historial de conversaciones.
- Para alertas unidireccionales en la aplicación (icono de campana, webhooks), consulte [Notifications](/docs/notifications).

```an-diagram title="Muchos canales, un agente" summary="Cada plataforma participa en el mismo bucle de agente y el mismo historial de hilos SQL, por lo que un DM Slack y un correo electrónico continúan la misma conversación."
{
  "html": "<div class=\"msg-fanin\"><div class=\"diagram-col\"><div class=\"diagram-node\">Slack</div><div class=\"diagram-node\">Email</div><div class=\"diagram-node\">Telegram</div><div class=\"diagram-node\">WhatsApp</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">Un bucle de agente</span><small class=\"diagram-muted\">misma memoria · mismas herramientas</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Un historial de hilo SQL<br><small class=\"diagram-muted\">web chat + external messages share it</small></div></div>",
  "css": ".msg-fanin{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.msg-fanin .diagram-col{display:flex;flex-direction:column;gap:8px}.msg-fanin .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## Configurar Slack {#slack}

### Qué necesitarás

- Un espacio de trabajo Slack donde puedes instalar aplicaciones (acceso de administrador)
- Aproximadamente 5 minutos

### Pasos

1. Vaya a **[api.slack.com/apps](https://api.slack.com/apps)** y haga clic en **Crear nueva aplicación** → **Desde cero**. Asígnale un nombre (por ejemplo, "Agente") y elige tu espacio de trabajo.
2. En la barra lateral izquierda, abra **OAuth y permisos**. En **Alcances de tokens de bot**, agregue:
   - `chat:write`: permite al agente enviar mensajes
   - `app_mentions:read`: permite al agente ver cuándo se menciona @ (opcional)
   - `im:history`: permite al agente leer los mensajes directos que se le envían
   - `assistant:write` — opcional; permite que Slack muestre el estado nativo "está pensando..." en los hilos del asistente
   - `users:read.email` — opcional; ayuda a plantillas como Mail a verificar el correo electrónico del remitente Slack para verificar la identidad de la cola de borradores
3. Haga clic en **Instalar en el espacio de trabajo** en la parte superior de esa página. Slack le dará un **Token de usuario de bot OAuth** que comienza con `xoxb-`. Cópialo.
4. Vaya a **Información básica** en la barra lateral y copie el **Secreto de firma**.
5. Abra la configuración de su aplicación (o el panel de variables de entorno de su proveedor de hosting) y pegue:
   - `SLACK_BOT_TOKEN`: el token `xoxb-…`
   - `SLACK_SIGNING_SECRET`: el secreto de firma
   - `SLACK_ALLOWED_TEAM_IDS`: recomendado en producción; ID de equipo/espacio de trabajo Slack separados por comas permitidos para enviar eventos
   - `SLACK_ALLOWED_API_APP_IDS`: recomendado para aplicaciones de múltiples espacios de trabajo; Los ID de aplicación Slack separados por comas pueden utilizar este secreto de firma
6. De vuelta en Slack, abra **Suscripciones a eventos**, actívelo y pegue esta Solicitud URL:

   ```texto
   https://your-app.example.com/_agent-native/integrations/slack/webhook
   ```

   Luego, en **Suscribirse a eventos de bot**, agregue `message.im` (para mensajes directos) y, opcionalmente, `app_mention` (para menciones de canales). Guardar.

7. Envía un DM a tu bot en Slack. Debería responder.

### Opcional: la aplicación se despliega

La aplicación Slack se despliega y permite que una aplicación reemplace la vista previa de enlace normal de Slack con una más rica
vista previa. Clips utiliza esto para vistas previas de vídeos reproducibles al estilo Loom.

Agregue estos alcances de bot adicionales cuando su aplicación necesite desplegarse:

- `links:read`: permite a Slack notificar a la aplicación cuando se publican dominios registrados
- `links:write`: permite que la aplicación reemplace la vista previa predeterminada de Slack
- `links.embed:write`: permite que la aplicación incorpore archivos multimedia o reproductores aprobados URL

Luego suscríbete al evento `link_shared` y registra los dominios de tu aplicación pública
en **Dominios de despliegue de aplicaciones**. Para vistas previas reproducibles solo de clips, configure Slack
Solicitud de suscripciones a eventos URL a:

```text
https://your-clips.example.com/api/slack/unfurl
```

Una aplicación Slack tiene una solicitud de eventos API URL. Si la misma aplicación Slack debería manejar
tanto los eventos de chat del agente como los clips se despliegan, enrute los eventos Slack a través de un pequeño
despachador que envía eventos de mensajes a `/_agent-native/integrations/slack/webhook`
y `link_shared` al controlador de despliegue de clips.

### Consejos

- **Menciones de canales**: el bot solo responde en los canales cuando se @-menciona, para evitar ruido.
- **DM**: cada DM se trata como una conversación privada con el agente.
- **Misma identidad, todos los canales**: si un usuario de Slack tiene el mismo correo electrónico que un usuario registrado en su aplicación, el agente lo trata como a la misma persona.
- **Listas permitidas de producción**: configure `SLACK_ALLOWED_TEAM_IDS` y, para aplicaciones Slack compartidas, `SLACK_ALLOWED_API_APP_IDS` para que un espacio de trabajo inesperado no pueda reutilizar un secreto de firma válido.
- **La aplicación Clips se despliega**: los clips Agent-Native instalables para Slack utilizan `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` y `/api/slack/oauth/callback`. Cada espacio de trabajo Slack conectado obtiene su propio token de bot cifrado en `app_secrets`; `SLACK_BOT_TOKEN` es solo un respaldo heredado de un único espacio de trabajo.

## Configurar Telegrama {#telegram}

### Qué necesitarás

- La aplicación Telegram en tu teléfono
- Aproximadamente 3 minutos

### Pasos

1. Abre Telegram y envía un mensaje **[@BotFather](https://t.me/BotFather)**.
2. Envíe `/newbot` y siga las instrucciones para nombrar su bot. BotFather responderá con un **token HTTP API**. Cópialo.
3. En las variables de entorno de su aplicación, establezca:
   - `TELEGRAM_BOT_TOKEN` — el token de BotFather
4. Después de la implementación, registre el webhook mediante `POST`ing en su aplicación en:

   ```texto
   POST https://your-app.example.com/_agent-native/integrations/telegram/setup
   ```

   Esto le indica a Telegram que envíe mensajes al webhook de su aplicación. Solo necesitas hacer esto una vez por implementación.

5. Encuentra tu bot en Telegram (busca el nombre de usuario que te dio BotFather) y envíale un mensaje.

## Configurar correo electrónico {#email}

El correo electrónico es la integración más poderosa: su agente obtiene su propia dirección, responde en el hilo, puede recibir CC en las conversaciones y utiliza el correo electrónico del remitente como su identidad. No se necesita ningún comando `/link`.

### Qué necesitarás

- Un dominio que usted controla (o puede usar un subdominio de reenvío gratuito; consulte a continuación)
- Una cuenta con **Resend** o **SendGrid** para manejar el correo entrante y saliente
- Unos 10 minutos

### Pasos (con Reenvío: más fácil)

1. Regístrese en **[resend.com](https://resend.com)**. El nivel gratuito es suficiente para empezar.
2. Elija cómo se verá la dirección de correo electrónico del agente:
   - **Más fácil:** use una dirección `<your-slug>.resend.app` gratuita; no se necesita DNS.
   - **Branded:** agregue un dominio personalizado (como `yourcompany.com`) en la página **Dominios** de Resend y siga los pasos de DNS.
3. En Reenviar, abra **Webhooks** → **Agregar punto final** y apúntelo a:

   ```texto
   https://your-app.example.com/_agent-native/integrations/email/webhook
   ```

   Suscríbete al evento **`email.received`**. Reenviar le dará un secreto de firma: cópielo.

4. En las variables de entorno de su aplicación, establezca:
   - `EMAIL_AGENT_ADDRESS`: la dirección en la que el agente recibe el correo (por ejemplo, `agent@yourcompany.com`)
   - `RESEND_API_KEY`: tu clave de reenvío API
   - `EMAIL_INBOUND_WEBHOOK_SECRET`: el secreto de firma de Resend (recomendado; usado para verificar la firma)

5. Enviar un correo electrónico a la dirección del agente. Responderá en el mismo hilo.

### Pasos (con SendGrid)

1. Regístrese en **[sendgrid.com](https://sendgrid.com)**.
2. Agregue el registro MX de su dominio para que el correo entrante fluya a SendGrid:
   ```texto
   MX tuempresa.com → mx.sendgrid.net (prioridad 10)
   ```
3. Abra **Configuración → Análisis entrante**, haga clic en **Agregar host y URL** y establezca el destino en:

   ```texto
   https://your-app.example.com/_agent-native/integrations/email/webhook
   ```

4. Establecer variables de entorno:
   - `EMAIL_AGENT_ADDRESS`: la dirección que recibe el agente
   - `SENDGRID_API_KEY`: tu clave SendGrid API
   - `EMAIL_INBOUND_WEBHOOK_SECRET`: secreto de firma Svix opcional si ha configurado webhooks firmado

5. Enviar un correo electrónico a la dirección del agente.

### Consejos

- **CC al agente** para incorporarlo a un hilo. Cuando el agente recibe una copia, responderá todo para que todo el hilo vea la respuesta.
- **El subproceso simplemente funciona**: el agente utiliza encabezados estándar `Message-ID`/`In-Reply-To`/`References`, por lo que las respuestas permanecen en el hilo correcto en cualquier cliente de correo electrónico.
- **La identidad es el correo electrónico del remitente.** Si `alice@acme.com` envía un correo electrónico al agente, esa _es_ su identidad, sin vínculo ni flujo de registro.
- **Respuestas enriquecidas**: la rebaja en la respuesta del agente se representa como HTML en el correo electrónico.
- **Dominios permitidos**: restrinja quién puede enviar correos electrónicos al agente configurando `allowedDomains` en la configuración de la integración; los mensajes de otros dominios se eliminan.
- **Límite de velocidad**: 20 mensajes entrantes por hora por remitente.

## Configurar WhatsApp {#whatsapp}

### Qué necesitarás

- Una cuenta de desarrollador Meta (Facebook)
- Un número de teléfono que puedes dedicar al bot
- Aproximadamente 15 minutos (la configuración de Meta tiene la mayor cantidad de pasos)

### Pasos

1. Vaya a **[Meta Developer Portal](https://developers.facebook.com/)**, haga clic en **Crear aplicación** y elija el tipo **Empresa**.
2. Agregue el producto **WhatsApp** a su aplicación y configure un número de teléfono para usarlo como remitente.
3. Desde la página de configuración de WhatsApp, selecciona:
   - **Token de acceso** (el temporal está bien para realizar pruebas; genera un token permanente antes de publicarlo)
   - **ID del número de teléfono**
4. Elija cualquier cadena aleatoria para usarla como token de verificación; ingresará el mismo valor en dos lugares a continuación.
5. En las variables de entorno de tu aplicación, establece:
   - `WHATSAPP_ACCESS_TOKEN`: tu token de acceso
   - `WHATSAPP_PHONE_NUMBER_ID`: el ID del número de teléfono
   - `WHATSAPP_VERIFY_TOKEN`: la cadena aleatoria que elegiste
6. De vuelta en la configuración de WhatsApp de Meta, abre la sección de webhook y configura:

   ```texto
   Devolución de llamada URL: https://your-app.example.com/_agent-native/integrations/whatsapp/webhook
   Token de verificación: la misma cadena aleatoria que configuraste como WHATSAPP_VERIFY_TOKEN
   ```

   Suscríbete al campo `messages`.

7. Envía un mensaje de WhatsApp al número de teléfono del bot.

## Utilice Dispatch como la bandeja de entrada central de su agente {#dispatch}

Si está ejecutando varias aplicaciones nativas del agente (correo, calendario, análisis, etc.), el patrón recomendado es configurar la mensajería en **[Dispatch](/docs/dispatch)** (consulte también [template reference](/docs/template-dispatch)) y dejar que enrute el trabajo a las aplicaciones de su dominio a través de [A2A](/docs/a2a-protocol).

Por qué esto es bueno:

- **Un agente, una bandeja de entrada.** Todos sus canales (Slack, correo electrónico, Telegram, WhatsApp) fluyen hacia Dispatch. Las integraciones solo se configuran una vez.
- **Delegados de Dispatch.** Pregunte "resumir los registros de la semana pasada": Dispatch llama al agente de análisis. Pregunte "redactar una respuesta a Alice": el centro de distribución llama al agente de correo.
- **Clics, no configuración.** La página **Configuración → Mensajería** de Dispatch tiene botones de conexión para cada plataforma con los campos env-var integrados.

Si no necesita un orquestador, cualquier plantilla puede conectar la mensajería directamente usando las variables de entorno en esta página.

---

## Para desarrolladores {#for-developers}

Todo lo que aparece a continuación es la referencia técnica. Si finalizó los pasos de configuración anteriores, puede detenerse aquí a menos que esté personalizando el complemento de integración o creando su propio adaptador.

### Cómo funciona {#how-it-works}

La plataforma de entrada webhooks utiliza un patrón de cola SQL multiplataforma para que funcione en todos los hosts sin servidor (Netlify, Vercel, Cloudflare Workers, Fly, Render, Node) sin depender de API de ejecución en segundo plano específicos de la plataforma.

1. La plataforma `POST`s a `/_agent-native/integrations/<platform>/webhook`. El controlador verifica la firma, analiza la carga útil en un `IncomingMessage` e **inserta una fila en `integration_pending_tasks`** con `status='pending'`.
2. El manejador dispara un `POST /_agent-native/integrations/process-task` de disparar y olvidar y devuelve `200` inmediatamente, dentro del SLA de 3 segundos de Slack.
3. El punto final del procesador se ejecuta en una **ejecución de función nueva** con su propio presupuesto de tiempo de espera completo. Reclama atómicamente la tarea (`pending` → `processing` vía `claimPendingTask`), ejecuta el bucle del agente, publica la respuesta a través del adaptador y marca la tarea `completed`.
4. Un trabajo de reintento recurrente (`startPendingTasksRetryJob`, cada 60 s) barre las tareas atascadas en `pending` >90 s o `processing` >5 min y vuelve a encender el procesador. Limitado a 3 intentos, luego marcado como `failed`.

```an-diagram title="Ciclo de vida del webhook entrante" summary="El webhook solo verifica, pone en cola y devuelve 200. Una nueva ejecución de función drena la cola y ejecuta el bucle del agente, con un trabajo de reintento de 60 segundos como red de seguridad."
{
  "html": "<div class=\"msg-flow\"><div class=\"msg-row\"><div class=\"diagram-node\">Platform<br><small class=\"diagram-muted\">Slack · correo · etc.</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough><strong>/webhook</strong><br><small class=\"diagram-muted\">verify signature + parse</small><br><span class=\"diagram-pill\">INSERT tarea pendiente</span></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill ok\">return 200</div></div><div class=\"msg-fire\"><span class=\"diagram-muted\">fire-and-forget</span> <span class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</span></div><div class=\"msg-row\"><div class=\"diagram-box\" data-rough><strong>/process-task</strong><br><small class=\"diagram-muted\">ejecución nueva · timeout propio</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill accent\">claim</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill accent\">agent loop</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill accent\">adapter.sendResponse</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill ok\">completed</div></div><div class=\"diagram-panel msg-retry\" data-rough><span class=\"diagram-pill warn\">every 60s</span> <span class=\"diagram-muted\">retry job sweeps stuck tasks (pending &gt;90s · processing &gt;5min) and re-fires /process-task &mdash; capped at 3 attempts, then <strong>failed</strong></span></div></div>",
  "css": ".msg-flow{display:flex;flex-direction:column;gap:12px}.msg-flow .msg-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.msg-flow .msg-fire{display:flex;align-items:center;gap:8px;padding-inline-start:12px}.msg-flow .msg-retry{display:flex;align-items:center;gap:8px;flex-wrap:wrap}"
}
```

Las conversaciones entrantes y salientes viven en el mismo hilo SQL, por lo que puedes continuar un DM de Slack desde la web UI o viceversa.

```an-api
{
  "method": "POST",
  "path": "/_agent-native/integrations/slack/webhook",
  "summary": "Webhook entrante de la API de eventos de Slack",
  "description": "Receives Slack events (DMs and channel `app_mention`s). Verifies the request signature, parses the payload into an `IncomingMessage`, inserts a `pending` row into `integration_pending_tasks`, fires the fresh-execution processor, and returns **200 immediately** — well inside Slack's 3-second SLA. The same route shape exists per platform under `/_agent-native/integrations/<platform>/webhook`.",
  "auth": "HMAC-SHA256 of the raw body using `SLACK_SIGNING_SECRET`, checked against the `X-Slack-Signature` header. In production also gated by `SLACK_ALLOWED_TEAM_IDS` / `SLACK_ALLOWED_API_APP_IDS`.",
  "params": [
    { "name": "X-Slack-Signature", "in": "header", "type": "string", "required": true, "description": "Slack request signature, verified before any processing." },
    { "name": "X-Slack-Request-Timestamp", "in": "header", "type": "string", "required": true, "description": "Timestamp used in the signature base string." }
  ],
  "request": {
    "contentType": "application/json",
    "example": "{\n  \"type\": \"event_callback\",\n  \"team_id\": \"T0123\",\n  \"api_app_id\": \"A0123\",\n  \"event\": {\n    \"type\": \"message\",\n    \"channel_type\": \"im\",\n    \"user\": \"U0123\",\n    \"text\": \"summarize last week's signups\"\n  }\n}"
  },
  "responses": [
    { "status": "200", "description": "Acknowledged immediately. The agent loop runs in the separate /process-task execution. The first time a Request URL is saved, Slack POSTs a `url_verification` challenge and the adapter replies with the `challenge` value automatically.", "example": "{ \"ok\": true }" },
    { "status": "401", "description": "Signature verification failed, or the team/app id is not in the production allowlist." }
  ]
}
```

#### Por qué este patrón (y no los atajos nativos de la plataforma) {#why-this-pattern}

Las funciones sin servidor se congelan en el momento en que se envía la respuesta. Todo lo que aún se esté ejecutando, incluida una promesa de disparar y olvidar, una llamada LLM diferida o una herramienta en vuelo, se cancela a mitad de la ejecución. La única forma de mantener vivo un bucle de agente es iniciar una **nueva** ejecución de función para él, que es lo que hace el `/process-task` POST autoactivado.

¿Utiliza NOT alguna de estas alternativas?

- **Funciones en segundo plano de Netlify**: solo para Netlify, requiere un sufijo de nombre de archivo `-background.ts`, se interrumpe en todos los demás hosts.
- **Cloudflare `event.waitUntil()`**: solo trabajadores de CF, no portátil.
- **Vercel `after()` / Fluid**: solo Vercel, controlado detrás de tiempos de ejecución específicos.
- **Promesas desnudas de disparar y olvidar después de `return`**: se eliminan silenciosamente cuando la función se congela; no hay errores en los registros, el usuario simplemente nunca recibe una respuesta.

La combinación SQL-cola + auto-webhook + reintento-trabajo es lo único que funciona de manera idéntica en todos los hosts compatibles. El trabajo de reintento es la red de seguridad: nunca asuma que el envío inicial se descargó antes de que la función se congelara.

### El complemento de integraciones {#plugin}

El complemento se monta automáticamente cuando no existe una versión personalizada. Para personalizar, cree:

```ts
// server/plugins/integrations.ts
import { createIntegrationsPlugin } from "@agent-native/core/server";
import { scriptRegistry } from "../../agent.config";

export default createIntegrationsPlugin({
  actions: scriptRegistry,
  systemPrompt: "You are a helpful assistant...",
});
```

Las plataformas que están activas dependen de las variables de entorno configuradas. El complemento registra rutas de webhook para cada uno en `/_agent-native/integrations/`.

### Webhook URLs {#webhook-urls}

```text
/_agent-native/integrations/slack/webhook
/_agent-native/integrations/telegram/webhook
/_agent-native/integrations/whatsapp/webhook
/_agent-native/integrations/email/webhook
```

Telegram también expone un punto final de configuración única:

```text
POST /_agent-native/integrations/telegram/setup
```

### Variables de entorno {#env-vars}

| Plataforma         | Obligatorio                                                                  | Opcional                                              |
| ------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------- |
| Slack              | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`                                    | `SLACK_ALLOWED_TEAM_IDS`, `SLACK_ALLOWED_API_APP_IDS` |
| Telegrama          | `TELEGRAM_BOT_TOKEN`                                                         | —                                                     |
| Correo electrónico | `EMAIL_AGENT_ADDRESS`, más uno de `RESEND_API_KEY` o `SENDGRID_API_KEY`      | `EMAIL_INBOUND_WEBHOOK_SECRET`                        |
| WhatsApp           | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | —                                                     |

Todas las credenciales residen en env vars: nunca la base de datos, nunca el código fuente. Utilice la configuración de la barra lateral UI o el panel ambiental de su proveedor de hosting.

### Subprocesos e identidad {#threading-and-identity}

Cada conversación externa se asigna a un hilo persistente en la base de datos nativa del agente:

- **DM de Slack** → un hilo por usuario de Slack.
- **canal Slack @mención** → un hilo por canal.
- **Chat de Telegram** → un hilo por chat de Telegram.
- **Conversación de WhatsApp** → un hilo por número de WhatsApp.
- **Correo electrónico** → subprocesos derivados de los encabezados `Message-ID` / `In-Reply-To` / `References`.

Los hilos externos aparecen en la web UI junto con los hilos originados en la web, etiquetados con su plataforma de origen. Resolución de identidad: cuando un usuario de Slack/correo electrónico coincide con un usuario registrado (normalmente por correo electrónico), se vincula a esa cuenta.

### Seguridad {#security}

Cada webhook entrante se verifica con firma antes de procesarlo:

- **Slack** — HMAC-SHA256 del cuerpo usando `SLACK_SIGNING_SECRET`, comparado con el encabezado `X-Slack-Signature`. La primera vez que guarda una Solicitud URL en el panel de Suscripciones a Eventos de Slack, Slack PUBLICA un desafío `url_verification`; El adaptador del marco detecta esto y responde con el valor `challenge` automáticamente, por lo que el URL se vuelve verde en Slack sin ningún trabajo adicional por su parte.
- **Telegram**: token secreto establecido al registrar el webhook.
- **WhatsApp**: desafío de verificación de Meta (usando `WHATSAPP_VERIFY_TOKEN`) más firma de carga útil.
- **Correo electrónico**: verificación de firma estilo Svix cuando se configura `EMAIL_INBOUND_WEBHOOK_SECRET` (Resend y SendGrid usan este formato). Si el secreto no está establecido, se acepta el webhook pero se registra una advertencia.

El adaptador de correo electrónico también aplica:

- **Dominios permitidos**: matriz `allowedDomains` opcional en la fila `integration_configs` de la integración; los remitentes fuera de la lista se eliminan.
- **Límite de velocidad**: límite de velocidad respaldado por cola SQL de 20 mensajes entrantes por remitente por hora.

### Envíos proactivos {#proactive-sends}

El agente puede enviar mensajes por iniciativa propia (notificaciones, recordatorios, resúmenes programados) llamando a la acción `send-platform-message` con un campo `platform` de `"slack"`, `"telegram"`, `"whatsapp"` o `"email"`. La acción se encuentra en el paquete Dispatch en `packages/dispatch/src/actions/send-platform-message.ts` y puedes copiarla o adaptarla a cualquier plantilla.

### Adaptadores personalizados {#custom-adapters}

Para agregar una nueva plataforma de mensajería, implemente la interfaz `PlatformAdapter`:

```ts
import type { H3Event } from "h3";
import type {
  PlatformAdapter,
  IncomingMessage,
  OutgoingMessage,
} from "@agent-native/core/server";
import type { EnvKeyConfig } from "@agent-native/core/server";

const myAdapter: PlatformAdapter = {
  platform: "discord",
  label: "Discord",

  // Env keys this adapter needs (rendered in the settings UI)
  getRequiredEnvKeys(): EnvKeyConfig[] {
    return [
      { key: "DISCORD_BOT_TOKEN", label: "Discord Bot Token", required: true },
    ];
  },

  // Handle platform-specific verification challenges (e.g. Slack's
  // url_verification). Return { handled: true, response } to short-circuit.
  async handleVerification(event: H3Event) {
    return { handled: false };
  },

  // Validate the webhook request signature
  async verifyWebhook(event: H3Event): Promise<boolean> {
    // Validate signature headers; return true if authentic
    return true;
  },

  // Parse the webhook payload into a normalized IncomingMessage.
  // Return null to silently ignore the event (bot messages, edits, etc.).
  async parseIncomingMessage(event: H3Event): Promise<IncomingMessage | null> {
    return {
      platform: "discord",
      externalThreadId: "channel-or-thread-id",
      text: "the user's message",
      senderId: "discord-user-id",
      platformContext: { channelId: "channel-id" },
      timestamp: Date.now(),
    };
  },

  // Format plain agent text into a platform-appropriate OutgoingMessage.
  // opts.threadDeepLinkUrl, when provided, is a URL back to the originating
  // thread in the dispatch UI — render it as a button (Slack) or inline link.
  formatAgentResponse(
    text: string,
    opts?: { threadDeepLinkUrl?: string },
  ): OutgoingMessage {
    return { text, platformContext: {} };
  },

  // Post the agent's response back to the platform
  async sendResponse(
    message: OutgoingMessage,
    context: IncomingMessage,
  ): Promise<void> {
    // Call the platform's API, using context.platformContext for routing
  },

  // Return current connection/configuration status for the settings UI.
  // baseUrl is the app's public URL, used for status checks that need it.
  async getStatus(baseUrl?: string) {
    return {
      platform: "discord",
      label: "Discord",
      enabled: true,
      configured: !!process.env.DISCORD_BOT_TOKEN,
    };
  },
};
```

Regístrelo en su complemento de integraciones:

```ts
export default createIntegrationsPlugin({
  actions: scriptRegistry,
  systemPrompt: "You are a helpful assistant...",
  adapters: [myAdapter],
});
```

Las implementaciones de referencia se encuentran en `packages/core/src/integrations/adapters/` (`slack.ts`, `telegram.ts`, `whatsapp.ts`, `email.ts`): el adaptador de correo electrónico es el ejemplo más completo e incluye verificación de firma, subprocesamiento, limitación de velocidad y renderizado HTML.

### Fiabilidad a través de Dispatch + continuaciones A2A {#reliability}

Cuando [Dispatch](/docs/dispatch) delega una solicitud a otra aplicación a través de [A2A](/docs/a2a-protocol#continuations), el flujo de recuperación de continuación garantiza que el usuario reciba una respuesta Slack/correo electrónico incluso si el agente descendente falla en mitad de la ejecución. La tarea de webhook original permanece en `processing` hasta que la continuación se resuelve o el barrido de reintento marca que está bloqueada; De cualquier manera, el hilo de la plataforma obtiene una respuesta final en lugar de quedarse en silencio.

Esto significa que un espacio de trabajo de múltiples aplicaciones liderado por Dispatch es más resistente que una sola plantilla conectada directamente a la mensajería: las fallas en cualquier aplicación posterior se degradan a un elegante mensaje de error en lugar de una respuesta descartada. Consulte [A2A continuations](/docs/a2a-protocol#continuations) para conocer la historia completa de la garantía de entrega.

### Errores comunes {#pitfalls}

- **No lea dos veces el cuerpo de la solicitud.** El flujo del cuerpo de h3 v2 se consume una vez: si llama a `readBody(event)` después de que el marco ya haya analizado `event.node.req.body` (o viceversa), la segunda lectura bloquea la solicitud indefinidamente. Esto aparece con mayor frecuencia con Resend y SendGrid: ambos transmiten la carga útil entrante y la lectura pendiente nunca se resuelve, la plataforma se agota y el webhook se vuelve a intentar hasta que se desduplica. Si incluye el controlador de webhook del marco en su propio middleware, pase el `IncomingMessage` ya analizado a través de la opción `incoming` en lugar de dejar que el controlador vuelva a analizarlo.
- **No ejecute bucles de agente dentro del controlador de webhook.** El controlador debe ponerse en cola y regresar: el bucle de agente se ejecuta en la nueva ejecución del procesador. Ponerlo en línea garantiza que la congelación sin servidor detenga la ejecución. Además, las integraciones de puertas de enlace públicas (como Netlify o Vercel) imponen límites estrictos de tiempo de espera de HTTP (por ejemplo, el límite de solicitud de 10 segundos de Netlify). Debido a que las ejecuciones del agente y las herramientas suelen tardar más que esta ventana, intentar ejecutar el bucle sincrónicamente dentro de la solicitud del webhook hará que la puerta de enlace finalice la conexión, lo que provocará una ejecución abortada y respuestas descartadas. El patrón de cola `/process-task` del autowebhook firmado por HMAC es la única manera de satisfacer los límites de la puerta de enlace mientras se ejecuta el ciclo completo del agente de forma segura.
- **No confíe en la memoria de desduplicación durante los arranques en frío.** La clave de desduplicación se encuentra en el índice único SQL `(platform, external_event_key)`, no en un mapa en proceso. Si reemplaza la cola, mantenga la desduplicación de nivel SQL o los reintentos duplicados de Slack activarán ejecuciones duplicadas del agente.
- **Mantenga accesible el autowebhook URL.** El procesador URL se construye a partir de `APP_URL` / `URL` / `DEPLOY_URL` / `BETTER_AUTH_URL`, recurriendo a los encabezados de solicitud entrante. En implementaciones de vista previa con nombres de host reescritos, configure uno de estos explícitamente o el envío llegará a un 404.

### Ver también {#see-also}

- [Dispatch](/docs/dispatch): descripción general del concepto para usar una bandeja de entrada central en todas las aplicaciones
- [Dispatch template reference](/docs/template-dispatch): bandeja de entrada central recomendada para espacios de trabajo con múltiples aplicaciones
- [A2A Protocol](/docs/a2a-protocol): cómo funcionan los delegados de Dispatch con otros agentes, incluida la recuperación de continuación
- [Agent Mentions](/docs/agent-mentions) — `@`-menciona agentes dentro del chat web
