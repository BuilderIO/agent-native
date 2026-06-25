---
title: "Trabajos recurrentes"
description: "Solicitudes programadas por cron que el agente ejecuta por sí solo: resúmenes diarios, informes semanales, sondeos cada hora."
---

# Trabajos recurrentes

Un **trabajo recurrente** es un mensaje que se ejecuta según una programación cron. Así es como el agente hace las cosas por sí solo: "cada mañana a las 7 resume mis correos electrónicos nocturnos", "todos los lunes publica los números de registro de la semana pasada en Slack", "cada hora busca borradores obsoletos y los elimina".

Los trabajos recurrentes se activan en un reloj. Para reaccionar a _eventos_ (una reserva creada, un correo electrónico recibido), el mismo formato de archivo `jobs/` más las condiciones, consulte [Automations](/docs/automations).

Los trabajos se encuentran en [workspace](/docs/workspace) en `jobs/<name>.md`: solo un archivo Markdown con texto frontal de YAML. Sin registro, sin cableado. Suelte el archivo y el marco lo recogerá.

## Un archivo de trabajo {#job-file}

```an-annotated-code title="jobs/morning-digest.md"
{
  "filename": "jobs/morning-digest.md",
  "language": "markdown",
  "code": "---\nschedule: \"0 7 * * *\"\nenabled: true\nrunAs: creator\n---\n\n# Resumen matutino\n\nSummarize los correos electrónicos recibidos durante la noche. Agrupar por dominio del remitente.\nPin los 3 hilos principales que parecen necesitar una respuesta hoy a la etiqueta\n\"Necesita respuesta\". Borradores de respuestas para aquellos que sean obvios.",
  "annotations": [
    { "lines": "2", "label": "cuando", "note": "Cron estándar de 5 campos: `0 7 * * *` es todos los días a las 07:00." },
    { "lines": "3", "label": "interruptor de pausa", "note": "Flip to `false` to stop the job without deleting it." },
    { "lines": "4", "label": "Identidad", "note": "`creator` runs with the owner's identity and `ANTHROPIC_API_KEY`; `shared` uses the org's key." },
    { "lines": "7-12", "label": "el aviso", "note": "El cuerpo es solo un mensaje: el agente lo ejecuta en cada disparo con todas sus herramientas normales y el contexto del espacio de trabajo." }
  ]
}
```

Eso es todo. El cuerpo es un mensaje que el agente ejecuta en cada disparo programado. El agente tiene acceso a las mismas herramientas y contexto de espacio de trabajo que tiene en un chat interactivo: actions, skills, memoria, servidores MCP conectados, subagentes.

## Antecedentes {#frontmatter}

| Campo        | Tipo                          | Predeterminado  | Descripción                                                                                                                                |
| ------------ | ----------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `schedule`   | expresión cron                | _(obligatorio)_ | Cron estándar de 5 campos. `"0 7 * * *"` = todos los días a las 07:00 horas; `"0 */4 * * *"` = cada 4 horas.                               |
| `enabled`    | booleano                      | `true`          | Pase a `false` para pausar sin eliminar el trabajo.                                                                                        |
| `runAs`      | `"creator"` \| `"shared"`     | `"creator"`     | `"creator"` se ejecuta con la identidad del propietario del trabajo y `ANTHROPIC_API_KEY`. `"shared"` utiliza la clave de la organización. |
| `createdBy`  | correo electrónico            | _(automático)_  | Se completa cuando el trabajo se crea a través del espacio de trabajo UI o por el agente.                                                  |
| `orgId`      | cadena                        | _(automático)_  | Alcance de la organización; heredado de la organización activa del creador.                                                                |
| `lastRun`    | Marca de tiempo ISO           | _(gestionado)_  | Escrito por el planificador después de cada ejecución.                                                                                     |
| `lastStatus` | `"success"` \| `"error"` \| … | _(gestionado)_  | Último resultado.                                                                                                                          |
| `lastError`  | cadena                        | _(gestionado)_  | Mensaje de error si la última ejecución falló.                                                                                             |
| `nextRun`    | Marca de tiempo ISO           | _(gestionado)_  | Calculado a partir de `schedule`; utilizado por el programador para decidir cuándo disparar a continuación.                                |

Los campos `last*` y `nextRun` los escribe el programador. Puedes leerlos para ver el historial, pero no los edites manualmente: la siguiente ejecución los sobrescribirá.

## Sintaxis cron {#cron}

Cron estándar de 5 campos (minuto, hora, día del mes, mes, día de la semana):

| Cron           | Significado                 |
| -------------- | --------------------------- |
| `*/5 * * * *`  | Cada 5 minutos              |
| `0 * * * *`    | Cada hora en punto          |
| `0 */4 * * *`  | Cada 4 horas                |
| `0 7 * * *`    | Todos los días a las 07:00  |
| `0 9 * * 1`    | Todos los lunes a las 09:00 |
| `0 17 * * 1-5` | Días laborables a las 17:00 |
| `0 0 1 * *`    | Primer día de cada mes      |

El marco incluye utilidades cron (`isValidCron()` y `describeCron()`) para validar y representar cadenas cron, utilizadas internamente por las capas de recursos y programador.

## Creando un trabajo {#creating}

### Desde la pestaña Espacio de trabajo

`+` → **Tarea programada** en el panel del espacio de trabajo. Complete el mensaje y el cronograma. Se guarda como `jobs/<slug>.md` y comienza a ejecutarse en el siguiente tick coincidente.

### Preguntando al agente

> "Crear una tarea programada que resuma mis correos electrónicos no leídos todas las mañanas a las 7."

El agente escribe el archivo por usted.

### A mano

Coloque un archivo Markdown en `jobs/` a través del recurso APIs del marco:

```ts
import { resourcePut } from "@agent-native/core/resources";

await resourcePut(
  ownerEmail,
  "jobs/morning-digest.md",
  `---
schedule: "0 7 * * *"
enabled: true
---
Summarize overnight emails.`,
);
```

## Cómo se ejecuta el programador {#how-scheduler-runs}

El programador es un complemento de marco (la rutina interna `processRecurringJobs()`) que se ejecuta durante el proceso: un `setInterval` se activa cada 60 segundos (con un retraso de inicio de 10 segundos) dentro del complemento de chat del agente, dondequiera que se esté ejecutando el servidor.

```an-diagram title="Un tic del programador" summary="Cada 60 segundos, el programador encuentra los trabajos vencidos, ejecuta cada uno como un hilo de agente nuevo y escribe el resultado en el archivo del trabajo."
{
  "html": "<div class=\"sched\"><div class=\"diagram-box accent\"><code>setInterval</code> &bull; 60s &#8635;</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">1 &middot; scan</span><small class=\"diagram-muted\">list every enabled <code>jobs/*.md</code> across all owners</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">2 &middot; due?</span><small class=\"diagram-muted\">compare <code>nextRun</code> to now</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card accent\"><span class=\"diagram-pill accent\">3 &middot; run</span><small class=\"diagram-muted\">fresh agent thread, job body as the user message &mdash; actions, SQL, A2A, email</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card ok\"><span class=\"diagram-pill ok\">4 &middot; record</span><small class=\"diagram-muted\">write <code>lastRun</code> / <code>lastStatus</code> / <code>lastError</code>, recompute <code>nextRun</code></small></div></div>",
  "css": ".sched{display:flex;flex-direction:column;gap:6px;max-width:520px}.sched .diagram-card{display:flex;flex-direction:column;gap:2px;padding:10px 14px}.sched .diagram-box{align-self:flex-start}.sched .diagram-arrow{font-size:18px;align-self:center}"
}
```

```an-callout
{ "tone": "risk", "body": "**Scale-to-zero caveat.** The scheduler is in-process, so on serverless hosts jobs only fire while an instance is warm. If reliable scheduling matters, keep an instance warm with keep-alive pings or use an always-on host (Fly, Render, a VPS)." }
```

## Depurar un trabajo {#debugging}

- Abra `jobs/<name>.md` en el espacio de trabajo; el frontmatter muestra `lastRun`, `lastStatus`, `lastError`, `nextRun`.
- **Pruébalo sin esperar:** no hay ninguna herramienta de disparo forzado. Para realizar el mismo trabajo bajo demanda, pegue el mensaje del trabajo en el chat del agente y déjelo ejecutar allí, o configure temporalmente el cronograma para el siguiente minuto para que el programador lo retome en el siguiente tick (luego restaure el cron real).
- **Pausa:** voltea `enabled: false`. El archivo permanece ahí, simplemente deja de ejecutarse.

## Herramienta de agente {#agent-tool}

Se registra una única herramienta `manage-jobs` en cada plantilla. El parámetro `action` selecciona la operación:

| Acción   | Parámetros                                                           | Propósito                                                                                   |
| -------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `create` | `name`, `schedule`, `instructions` (obligatorio); `scope`, `runAs`   | Crear un nuevo trabajo recurrente                                                           |
| `list`   | `scope` (`personal`, `shared` o todos)                               | Enumerar todos los trabajos con estado (programado, habilitado, última/siguiente ejecución) |
| `update` | `name` (obligatorio); `schedule`, `instructions`, `enabled`, `runAs` | Editar un trabajo existente                                                                 |
| `delete` | `name` (obligatorio)                                                 | Eliminar un trabajo: confírmalo siempre primero con el usuario                              |

**Ámbito personal versus compartido.** Cada trabajo se encuentra en un ámbito personal (se ejecuta y es visible solo para el creador) o en un ámbito compartido/orgánico (se ejecuta en nombre del creador pero es visible para los miembros de la organización). Los parámetros `scope` y `runAs` controlan esto en el momento de la creación. Los administradores de la organización pueden actualizar o eliminar cualquier trabajo compartido; los miembros no administradores solo pueden administrar los suyos propios.

## Diferente del paquete de programación {#vs-scheduling-package}

No confunda trabajos recurrentes con `@agent-native/scheduling`:

- **Trabajos recurrentes (esta página)**: _avisos_ programados cron que el agente ejecuta en segundo plano. Nivel de marco. Vive en el espacio de trabajo. Se ejecuta en cualquier aplicación nativa del agente.
- **`@agent-native/scheduling`**: un paquete de dominio reutilizable para crear funciones de calendario/reservas (tipos de eventos, períodos de disponibilidad, reservas). Impulsa la plantilla `calendar` y las superficies de programación personalizadas.

Los trabajos recurrentes son "¿cómo hago para que el agente actúe por sí solo?" El paquete de programación es "¿cómo creo una aplicación de calendario?" Diferentes preocupaciones.

## ¿Qué sigue?

- [**Automations**](/docs/automations): agregue activadores de eventos y condiciones al mismo formato `jobs/`
- [**Workspace**](/docs/workspace): donde los trabajos conviven con skills, la memoria y los agentes personalizados
- [**Actions**](/docs/actions): las herramientas que requiere un trabajo
- [**Agent Teams**](/docs/agent-teams): los trabajos a menudo generan subagentes para realizar trabajos paralelos
