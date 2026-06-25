---
title: "Automatizaciones"
description: "Automatizaciones programadas y activadas por eventos con condiciones de lenguaje natural"
---

# Automatizaciones

Una **automatización** es una regla: _cuando sucede X, haz Y_, descrita en lenguaje natural. El agente ejecuta las instrucciones, por lo que las automatizaciones tienen acceso a cada acción, herramienta y servidor MCP que el agente puede usar en un chat interactivo.

Las automatizaciones amplían [recurring jobs](/docs/recurring-jobs) con **activadores de eventos**, **condiciones de lenguaje natural** y **HTTP saliente** a través de la herramienta `web-request`. Utilizan el mismo formato de archivo `jobs/<name>.md`, almacenamiento y flujo de trabajo de "creación de tres formas" que los trabajos recurrentes; consulte [Recurring Jobs](/docs/recurring-jobs#job-file) para conocer el formato compartido. Esta página cubre solo las novedades de las automatizaciones basadas en eventos.

```an-diagram title="Cuando suceda X, haz Y" summary="Se activa un evento en el autobús, una condición opcional de lenguaje natural lo bloquea y el agente ejecuta el cuerpo de automatización con acceso completo a las herramientas."
{
  "html": "<div class=\"auto-flow\"><div class=\"diagram-card\"><span class=\"diagram-pill\">Event</span><small class=\"diagram-muted\"><code>calendar.booking.created</code></small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">Condition</span><small class=\"diagram-muted\">Haiku checks: &ldquo;email ends with @builder.io&rdquo;</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card accent\"><span class=\"diagram-pill accent\">El agente ejecuta el cuerpo</span><small class=\"diagram-muted\">actions &middot; web-request &middot; MCP &middot; sub-agents</small></div></div>",
  "css": ".auto-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.auto-flow .diagram-card{display:flex;flex-direction:column;gap:4px;padding:14px 16px;min-width:180px}.auto-flow .diagram-arrow{font-size:22px}"
}
```

## Dos tipos de activadores {#trigger-types}

| Tipo       | Se dispara cuando                                                | Campo clave       |
| ---------- | ---------------------------------------------------------------- | ----------------- |
| `schedule` | Una expresión cron coincide (igual que los trabajos recurrentes) | `schedule` (cron) |
| `event`    | Se emite un evento coincidente en el bus de eventos del marco    | `event` (nombre)  |

Los desencadenantes de eventos pueden incluir un `condition`, una cadena en lenguaje natural evaluada por Haiku con respecto a la carga útil del evento antes del envío. Si la condición no coincide, la automatización se omite silenciosamente.

## Crear automatizaciones {#creating}

### Preguntando al agente

> "Cuando alguien reserva una reunión con un correo electrónico @builder.io, envíame un mensaje en Slack."

El agente descubre eventos disponibles, confirma el plan y escribe la automatización por usted.

### Desde la configuración UI

Las automatizaciones aparecen en el panel de configuración. Los usuarios pueden verlos, habilitarlos/deshabilitarlos y eliminarlos allí.

La tercera ruta (escribir el archivo `jobs/<name>.md` a mano mediante `resourcePut`) funciona exactamente igual que para [recurring jobs](/docs/recurring-jobs#creating). Para una automatización basada en eventos, agregue el frontmatter de activación de eventos a continuación al mismo archivo. Un trabajo desencadenado por evento establece `schedule: ""` y proporciona `triggerType: event`, un nombre de `event` y un `condition` opcional:

```an-annotated-code title="Una automatización activada por eventos"
{
  "filename": "jobs/slack-on-builder-booking.md",
  "language": "markdown",
  "code": "---\nschedule: \"\"\nenabled: true\ntriggerType: event\nevent: calendar.booking.created\ncondition: \"attendee email ends with @builder.io\"\nmode: agentic\ndomain: calendar\nrunAs: creator\n---\nSend a Slack message to #sales with the booking details.\nUse the web-request tool to POST to ${keys.SLACK_WEBHOOK}.",
  "annotations": [
    { "lines": "2", "label": "Sin cron", "note": "Event triggers set `schedule` to `\"\"` — the cron field stays empty." },
    { "lines": "4-5", "label": "El gatillo", "note": "`triggerType: event` más el nombre `event` suscribe esta automatización al bus." },
    { "lines": "6", "label": "Puerta", "note": "Un `condition` opcional en lenguaje natural, evaluado por Haiku con respecto a la carga útil antes del envío." },
    { "lines": "12", "label": "Secreto del lado del servidor", "note": "`${keys.SLACK_WEBHOOK}` is resolved server-side — the raw value never enters the agent's context." }
  ]
}
```

## Antecedentes de la automatización {#frontmatter}

Las automatizaciones comparten todos los campos del [recurring-jobs frontmatter table](/docs/recurring-jobs#frontmatter). Estos campos adicionales controlan los desencadenadores de eventos, las condiciones y el modo de ejecución:

| Campo         | Tipo                             | Predeterminado | Descripción                                                                                                                                                                                                  |
| ------------- | -------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `triggerType` | `"schedule"` \| `"event"`        | `"schedule"`   | Cómo se activa la automatización                                                                                                                                                                             |
| `event`       | cadena                           | _(opcional)_   | Nombre del evento al que suscribirse (solo activadores de eventos)                                                                                                                                           |
| `condition`   | cadena                           | _(opcional)_   | Condición del lenguaje natural evaluada antes del envío                                                                                                                                                      |
| `mode`        | `"agentic"` \| `"deterministic"` | `"agentic"`    | Bucle de agente completo. (`"deterministic"` está reservado pero aún no se ha implementado; las automatizaciones que lo configuran se omiten. Utilice `"agentic"` para todas las automatizaciones actuales). |
| `domain`      | cadena                           | _(opcional)_   | Etiqueta de agrupación (correo, calendario, clips, etc.)                                                                                                                                                     |

Para un desencadenador de evento, `schedule` es `""` (vacío); para un desencadenador de programación, lleva la expresión cron. El despachador también escribe los mismos campos administrados `lastRun` / `lastStatus` / `lastError` que escribe el programador, además de un estado `"skipped"` cuando una condición se evalúa como falsa.

## El autobús de eventos {#event-bus}

Las integraciones registran eventos en el momento de carga del módulo. El bus valida las cargas útiles con respecto a las definiciones de [Standard Schema](https://standardschema.dev) y las envía a los suscriptores.

### Eventos integrados {#built-in-events}

| Evento                 | Fuente                                               |
| ---------------------- | ---------------------------------------------------- |
| `test.event.fired`     | Manual / `manage-automations` acción=prueba de fuego |
| `agent.turn.completed` | Chat del agente                                      |
| `calendar.*`           | Integración de calendario                            |
| `clip.*`               | Integración de clips                                 |
| `mail.*`               | Integración de correo                                |

Llame a `manage-automations` con `action=list-events` desde el agente para ver todos los eventos registrados con descripciones y esquemas de carga útil para la plantilla actual.

### Emitir eventos personalizados {#emitting-events}

Registrar un tipo de evento en un complemento de servidor y luego emitirlo desde actions o controladores de webhook:

```ts
import { registerEvent, emit } from "@agent-native/core/event-bus";
import { z } from "zod";

// Register the event type (once, at module load)
registerEvent({
  name: "order.completed",
  description: "A customer completed an order",
  payloadSchema: z.object({
    orderId: z.string(),
    customerEmail: z.string(),
    total: z.number(),
  }),
  example: {
    orderId: "ord_123",
    customerEmail: "jane@example.com",
    total: 49.99,
  },
});

// Emit the event (from an action, webhook handler, etc.)
emit(
  "order.completed",
  {
    orderId: "ord_123",
    customerEmail: "jane@example.com",
    total: 49.99,
  },
  { owner: "steve@builder.io" },
);
```

El `owner` en los alcances de metadatos de emisión que activan las automatizaciones; solo se evalúan las automatizaciones que pertenecen al mismo usuario (o automatizaciones compartidas).

## Condiciones {#conditions}

Las condiciones son cadenas de lenguaje natural evaluadas por Claude Haiku frente a la carga útil del evento. Esta es una clasificación de sí/no, no una tarea de generación.

- **Condición vacía o faltante** = incondicional (siempre se activa).
- Los resultados se memorizan (SHA-256 de condición + carga útil) con un caché TTL de 5 minutos y LRU de 500 entradas.
- La carga útil se trunca a 4000 caracteres antes de enviarla a Haiku.
- En caso de falla de API, la condición se evalúa como `false` (valor predeterminado seguro: se omite la automatización).

Ejemplos de condiciones:

- `"attendee email ends with @builder.io"`
- `"the order total is greater than $100"`
- `"the message contains the word 'urgent'"`

## La herramienta de solicitud web {#web-request}

Las automatizaciones utilizan la herramienta `web-request` para HTTP saliente. Admite marcadores de posición `${keys.NAME}` en URL, encabezados y cuerpo:

```
POST to ${keys.SLACK_WEBHOOK}

Headers: {"Authorization": "Bearer ${keys.API_TOKEN}"}

Body: {"text": "New booking from ${attendeeEmail}"}
```

Los marcadores de posición se resuelven **del lado del servidor** después de que el agente emite la llamada a la herramienta; el valor secreto sin procesar nunca ingresa al contexto del agente.

### Parámetros {#web-request-params}

| Parámetro    | Tipo   | Predeterminado | Descripción                                                |
| ------------ | ------ | -------------- | ---------------------------------------------------------- |
| `url`        | cadena | —              | URL completo. Puede contener referencias a `${keys.NAME}`. |
| `method`     | cadena | `GET`          | Método HTTP (GET, POST, PUT, PATCH, DELETE, HEAD).         |
| `headers`    | cadena | `{}`           | JSON objeto de encabezados. Puede contener `${keys.NAME}`. |
| `body`       | cadena | —              | Cuerpo de la solicitud. Puede contener `${keys.NAME}`.     |
| `timeout_ms` | número | 15000          | Tiempo de espera en milisegundos (máximo 30000).           |

## Claves {#keys}

Las claves son secretos ad hoc creados por los usuarios o el agente para su uso en automatización (por ejemplo, `SLACK_WEBHOOK`, `HUBSPOT_API_KEY`). Se diferencian de los secretos registrados (`registerRequiredSecret`) en que no tienen metadatos definidos por plantilla ni paso de incorporación.

- Creado a través de la configuración UI o `/_agent-native/secrets/adhoc` API.
- Cada clave puede tener una **lista de permitidos URL** que restringe a qué orígenes se puede enviar la clave (coincidencia a nivel de origen).
- El valor bruto nunca se expone a la IA; solo aparecen marcadores de posición `${keys.NAME}` en el contexto del agente.
- La resolución retrocede del ámbito del usuario al ámbito del espacio de trabajo, para que los usuarios puedan anular las claves compartidas.

## Herramientas del agente {#agent-tools}

Se accede a todas las operaciones de automatización a través de una única herramienta `manage-automations` con un parámetro `action`:

| Acción        | Propósito                                                                             |
| ------------- | ------------------------------------------------------------------------------------- |
| `list-events` | Descubre todos los eventos registrados con descripciones y esquemas de carga útil     |
| `list`        | Enumerar todas las automatizaciones con estado; filtrar por dominio o habilitado      |
| `define`      | Crear una nueva automatización (nombre, tipo de activador, evento, condición, cuerpo) |
| `update`      | Actualizar una automatización existente (habilitada, condición, cuerpo)               |
| `delete`      | Eliminar una automatización (siempre confirma primero con el usuario)                 |
| `fire-test`   | Emitir un evento `test.event.fired` para validar automatizaciones                     |

Herramienta adicional: `web-request`: HTTP saliente con sustitución de `${keys.NAME}`.

## Puntos finales API {#api}

| Punto final                            | Método | Descripción                                      |
| -------------------------------------- | ------ | ------------------------------------------------ |
| `/_agent-native/automations`           | GET    | Enumerar todas las automatizaciones (analizadas) |
| `/_agent-native/automations/fire-test` | POST   | Emitir un evento `test.event.fired`              |
| `/_agent-native/secrets/adhoc`         | GET    | Lista de claves ad-hoc (sin valores)             |
| `/_agent-native/secrets/adhoc`         | POST   | Crear o actualizar una clave ad-hoc              |
| `/_agent-native/secrets/adhoc/:name`   | DELETE | Eliminar una clave ad hoc                        |

```an-api title="Disparar un evento de prueba"
{
  "method": "POST",
  "path": "/_agent-native/automations/fire-test",
  "summary": "Emitir un evento test.event.fired para validar automatizaciones activadas por eventos",
  "description": "Confirm an automation's wiring and condition without waiting for a real provider event. Equivalent to the `manage-automations` action `fire-test`.",
  "responses": [
    { "status": "200", "description": "Event emitted; matching automations are dispatched through the normal condition + ownership path." }
  ]
}
```

## Cómo funciona el despacho {#dispatch}

```an-diagram title="La ruta de despacho" summary="Desde un evento activado hasta una ejecución de agente completa, controlado por el alcance de propiedad y la condición del lenguaje natural."
{
  "html": "<div class=\"disp\"><div class=\"diagram-box accent\">event fired on the bus</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">match</span><small class=\"diagram-muted\">load enabled automations subscribed to this event name</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">scope</span><small class=\"diagram-muted\">keep only those owned by the event's owner (or shared)</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill warn\">condition</span><small class=\"diagram-muted\">Haiku yes/no on the payload &mdash; false &rarr; <code>skipped</code></small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card accent\"><span class=\"diagram-pill accent\">run</span><small class=\"diagram-muted\"><code>runAgentLoop</code> con body como prompt, payload como contexto y timeout de 5 minutos</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card ok\"><span class=\"diagram-pill ok\">record</span><small class=\"diagram-muted\">write <code>lastRun</code> / <code>lastStatus</code> / <code>lastError</code></small></div></div>",
  "css": ".disp{display:flex;flex-direction:column;gap:6px;max-width:540px}.disp .diagram-card{display:flex;flex-direction:column;gap:2px;padding:10px 14px}.disp .diagram-box{align-self:flex-start}.disp .diagram-arrow{font-size:18px;align-self:center}"
}
```

## Ejemplo {#example}

**Usuario:** "Cuando alguien reserva con un correo electrónico @builder.io, envíame un mensaje en Slack."

**Flujo de agentes:**

1. Llama a `manage-automations` con `action=list-events`: encuentra `calendar.booking.created`.
2. Confirma el plan con el usuario.
3. Llama a `manage-automations` con `action=define`:
   - `name`: `slack-on-builder-booking`
   - `trigger_type`: `event`
   - `event`: `calendar.booking.created`
   - `condition`: `attendee email ends with @builder.io`
   - `mode`: `agentic`
   - `domain`: `calendar`
   - `body`: `Send a Slack message to #sales with the booking details. Use the web-request tool to POST to ${keys.SLACK_WEBHOOK}.`
4. La automatización se guarda como `jobs/slack-on-builder-booking.md` y comienza a escucharse inmediatamente.

## Más ejemplos {#more-examples}

### Notificar mediante webhook cuando se comenta un plan

Pregúntele al agente del plan: _"Cuando alguien agrega un comentario humano en un plan, POST a
notificación a mi webhook."_

```yaml
---
triggerType: event
event: plan.commented
condition: "resolutionTarget is human or resolutionTarget is null"
mode: agentic
domain: plan
enabled: true
---

POST to ${keys.NOTIFY_WEBHOOK} with a JSON body:
{"title": "<plan title>", "excerpt": "<comment excerpt>", "author": "<author email or null>", "url": "<app base url + path>"}
```

Establezca `NOTIFY_WEBHOOK` en cualquier punto final HTTP: un webhook entrante Slack, un genérico
servicio de notificaciones o un receptor personalizado. La herramienta `web-request` resuelve
`${keys.NOTIFY_WEBHOOK}` del lado del servidor; el URL sin procesar nunca aparece en el del agente
contexto. Ver [Visual Plans — Events and notifications](/docs/template-plan#events)
para obtener la referencia completa de la carga útil de `plan.commented` y los cuatro eventos del plan.

## ¿Qué sigue?

- [**Recurring Jobs**](/docs/recurring-jobs): las automatizaciones activadas por programación reutilizan el mismo programador
- [**Actions**](/docs/actions): las automatizaciones pueden invocar cualquier acción registrada a través del bucle del agente
- [**Security**](/docs/security): validación de entradas y manejo de secretos
- [**Visual Plans — Events**](/docs/template-plan#events): referencia de eventos de planificación y recetas de automatización
