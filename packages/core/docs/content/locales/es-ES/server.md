---
title: "Servidor"
description: "Rutas del servidor Nitro, complementos, rutas montadas en el marco, contexto de solicitud y sincronización respaldada por SQL."
---

# Servidor

Las aplicaciones nativas del agente utilizan [Nitro](https://nitro.build) para rutas de servidor y complementos. La mayor parte del comportamiento del producto debería residir en [Actions](/docs/actions); las rutas personalizadas son para superficies de protocolo que actions no encajan: cargas, streaming, páginas públicas, devoluciones de llamada webhooks, OAuth y API específicos del proveedor.

```an-diagram title="Qué se ejecuta en el servidor" summary="Las acciones son las predeterminadas. Las rutas de archivos personalizadas y las rutas montadas en el marco comparten la misma aplicación Nitro y la misma base de datos SQL."
{
  "html": "<div class=\"diagram-server\"><div class=\"diagram-col entry\"><div class=\"diagram-node\">Navegador / UI</div><div class=\"diagram-node\">bucle del agente</div><div class=\"diagram-node\">clientes externos<br><small class=\"diagram-muted\">HTTP · MCP · A2A</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\" data-rough><strong>servidor Nitro</strong><div class=\"diagram-row\"><span class=\"diagram-pill accent\">Actions</span><small class=\"diagram-muted\">superficie predeterminada</small></div><div class=\"diagram-row\"><span class=\"diagram-pill\">/_agent-native/*</span><small class=\"diagram-muted\">framework routes</small></div><div class=\"diagram-row\"><span class=\"diagram-pill\">/api/*</span><small class=\"diagram-muted\">custom file routes</small></div><div class=\"diagram-row\"><span class=\"diagram-pill\">plugins</span><small class=\"diagram-muted\">inicio: migraciones, trabajos</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>base de datos SQL<br><small class=\"diagram-muted\">Drizzle · punto de coordinación</small></div></div>",
  "css": ".diagram-server{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-server .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-server .diagram-panel{display:flex;flex-direction:column;gap:8px;padding:14px 16px}.diagram-server .diagram-row{display:flex;align-items:center;gap:8px}.diagram-server .diagram-arrow{font-size:22px;line-height:1}"
}
```

## Rutas basadas en archivos {#file-based-routes}

Las rutas viven en `server/routes/` y Nitro asignan nombres de archivos a métodos y rutas:

```text
server/routes/
  api/
    health.get.ts              -> GET  /api/health
    uploads.post.ts            -> POST /api/uploads
    webhooks/
      stripe.post.ts           -> POST /api/webhooks/stripe
  [...page].get.ts             -> SSR catch-all for public pages
```

Cada ruta exporta un `defineEventHandler`:

```ts
// server/routes/api/health.get.ts
import { defineEventHandler } from "h3";

export default defineEventHandler(() => ({
  ok: true,
  service: "my-template",
}));
```

### Convenciones de nomenclatura de rutas {#route-naming-conventions}

| Patrón de nombre de archivo | Método HTTP | Ruta de ejemplo          |
| --------------------------- | ----------- | ------------------------ |
| `index.get.ts`              | GET         | `/api/items`             |
| `index.post.ts`             | POST        | `/api/items`             |
| `[id].get.ts`               | GET         | `/api/items/:id`         |
| `[id].patch.ts`             | PATCH       | `/api/items/:id`         |
| `[id].delete.ts`            | DELETE      | `/api/items/:id`         |
| `[...slug].get.ts`          | GET         | `/api/items/*` o comodín |

## Prefiere Actions para operaciones de aplicaciones {#actions-first}

Si tanto el UI como el agente necesitan hacer algo, defina una acción en lugar de una ruta API personalizada. Actions se convierte automáticamente en:

- Herramientas del agente.
- Ganchos frontales escritos.
- Puntos finales HTTP en `/_agent-native/actions/:name`.
- Herramientas invocables MCP y A2A.
- Comandos CLI para desarrollo.

Utilice rutas `/api/*` personalizadas solo cuando necesite un protocolo en forma de ruta o un comportamiento binario/de transmisión. Ver [Actions](/docs/actions).

## Completación de texto de una sola vez {#complete-text}

La mayor parte del trabajo de IA debe realizarse a través del chat del agente para que los usuarios puedan verlo, dirigirlo y auditarlo
qué pasó. Para transformaciones estrechas del lado del servidor que intencionalmente no necesitan
herramientas, historial de chat o estado de ejecución, use `completeText()` como escape explícito
escotilla.

```ts
// actions/classify-message.ts
import { defineAction } from "@agent-native/core/action";
import { completeText } from "@agent-native/core/server";
import { z } from "zod";

export default defineAction({
  description: "Classify a short message",
  schema: z.object({ body: z.string() }),
  run: async ({ body }) => {
    const result = await completeText({
      systemPrompt:
        "Return exactly one label: urgent, follow-up, waiting, or archive.",
      input: body,
      maxOutputTokens: 16,
      temperature: 0,
    });

    return { label: result.text.trim() };
  },
});
```

`completeText()` se ejecuta a través de la misma capa de motor configurada que el agente
chat, incluidos Builder, Anthropic, proveedores AI SDK, valores predeterminados del modelo de usuario/aplicación,
secretos de ámbito de solicitud y errores normalizados por el motor. Es sólo de servidor; no
llamar a proveedores de modelos desde el código de cliente. Si la operación es de cara al usuario, envuélvala
en una acción para que UI y el agente compartan la misma capacidad.

## Solicitar contexto y acceso {#request-context}

Actions montado por el marco se ejecuta automáticamente con el contexto de solicitud. Las rutas personalizadas no. Si una ruta personalizada lee o escribe recursos propios, carga la sesión y ajusta el trabajo:

```an-annotated-code title="Determinar el alcance de una ruta personalizada para el usuario de la solicitud"
{
  "filename": "server/routes/api/projects.get.ts",
  "language": "ts",
  "code": "import { defineEventHandler, createError } from \"h3\";\nimport { getSession, runWithRequestContext } from \"@agent-native/core/server\";\nimport { getDb } from \"../../db/index.js\";\nimport { accessFilter } from \"@agent-native/core/sharing\";\nimport * as schema from \"../../db/schema\";\n\nexport default defineEventHandler(async (event) => {\n  const session = await getSession(event);\n  if (!session?.email) {\n    throw createError({ statusCode: 401, statusMessage: \"Unauthorized\" });\n  }\n\n  return runWithRequestContext(\n    { userEmail: session.email, orgId: session.orgId },\n    async () => {\n      const db = getDb();\n      return db\n        .select()\n        .from(schema.projects)\n        .where(accessFilter(schema.projects, schema.projectShares));\n    },\n  );\n});",
  "annotations": [
    {
      "lines": "7-10",
      "label": "Las rutas personalizadas no tienen contexto automático",
      "note": "A diferencia de las acciones, una ruta de archivo debe cargar la sesión misma y no cerrarse cuando no hay ningún usuario autenticado."
    },
    {
      "lines": "12-13",
      "label": "Establecer contexto de solicitud",
      "note": "`runWithRequestContext` pone el usuario y la organización a disposición de los ayudantes de alcance durante la duración del trabajo."
    },
    {
      "lines": "18-19",
      "label": "Lecturas propias del alcance",
      "note": "`accessFilter` constrains the query to rows the caller may see. Never run an unscoped `db.select().from(ownableTable)` here."
    }
  ]
}
```

`getDb` se crea por aplicación a través de `createGetDb(schema)` en `server/db/index.ts`, por lo que las rutas personalizadas se importan desde la plantilla (`../../db/index.js`), no desde `@agent-native/core/db`; ver [Database — Where the DB Client Lives](/docs/database#db-client). No ejecute `db.select().from(ownableTable)` sin ámbito en rutas personalizadas.

## Complementos de servidor {#server-plugins}

Los complementos se encuentran en `server/plugins/` y se ejecutan al inicio. Úselos para migraciones, configuración de proveedores, trabajos recurrentes, adaptadores de integración y configuración de complementos de marco.

```ts
// server/plugins/db.ts
import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      sql: `CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      org_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    },
  ],
  { table: "my_app_migrations" },
);
```

Las migraciones deben ser aditivas. Nunca coloques SQL destructivo en complementos de inicio.

## Rutas montadas en el marco {#framework-routes}

El marco monta sus propias rutas bajo `/_agent-native/`. Trate ese espacio de nombres como reservado.

| Prefijo de ruta                  | Propósito                                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| `/_agent-native/actions/:name`   | Puntos finales de acción HTTP                                                                      |
| `/_agent-native/agent-chat`      | Bucle de chat del agente                                                                           |
| `/_agent-native/poll`            | Sincronización de UI respaldada por SQL                                                            |
| `/_agent-native/resources/*`     | Recursos del espacio de trabajo                                                                    |
| `/_agent-native/extensions/*`    | Extensiones de tiempo de ejecución y proxy de extensión (alias heredado: `/_agent-native/tools/*`) |
| `/_agent-native/integrations/*`  | Integraciones de mensajería/webhook                                                                |
| `/_agent-native/a2a`             | Agente a agente JSON-RPC                                                                           |
| `/_agent-native/mcp`             | Punto final MCP                                                                                    |
| `/_agent-native/onboarding/*`    | Lista de verificación de configuración                                                             |
| `/_agent-native/observability/*` | Seguimientos, comentarios, evaluaciones, experimentos                                              |
| `/_agent-native/file-upload`     | Punto final del proveedor de carga de archivos                                                     |

Las rutas de aplicaciones personalizadas deben utilizar `/api/*`, rutas de aplicaciones públicas o rutas de devolución de llamadas específicas del proveedor que no colisionen con `/_agent-native/`.

## Sincronización respaldada por SQL {#sync}

El agente nativo no depende de los observadores del sistema de archivos ni del estado fijo en la memoria. Cuando actions o los asistentes del marco mutan los datos, la versión de sincronización de la base de datos aumenta. El enlace del cliente `useDbSync()` sondea `/_agent-native/poll` e invalida los cachés de consultas React.

Esto funciona en implementaciones sin servidor y de múltiples instancias porque la base de datos es el punto de coordinación. Si escribe mutaciones personalizadas fuera de actions, utilice asistentes de marco o emita la invalidación de sincronización adecuada para abrir la actualización de UI.

```an-diagram title="SQL-backed bucle de sincronización" summary="Sin observadores, sin estado pegajoso. Una escritura modifica una versión en SQL; cada cliente sondea la versión y la recupera."
{
  "html": "<div class=\"diagram-sync\"><div class=\"diagram-box\" data-rough>Acción / helper<br><small class=\"diagram-muted\">mutates data</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\" data-rough><strong>base de datos SQL</strong><small class=\"diagram-muted\">sync version increments</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&larr;</div><div class=\"diagram-col\"><div class=\"diagram-node\">useDbSync()<br><small class=\"diagram-muted\">polls /_agent-native/poll</small></div><div class=\"diagram-pill ok\">invalidate caches &rarr; UI refreshes</div></div></div>",
  "css": ".diagram-sync{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-sync .diagram-col{display:flex;flex-direction:column;gap:8px;align-items:flex-start}.diagram-sync .diagram-arrow{font-size:22px;line-height:1}"
}
```

```an-api title="El punto final de la encuesta" method="GET" path="/_agent-native/poll"
{
  "method": "GET",
  "path": "/_agent-native/poll",
  "summary": "Devuelve las versiones actuales de sincronización de la base de datos por fuente para que el cliente pueda detectar cambios.",
  "description": "`useDbSync()` calls this on an interval (and falls back to it when SSE is unavailable). When a returned version is higher than the client's last-seen value, the matching React Query caches are invalidated and refetch.",
  "auth": "Session cookie (request-scoped identity)",
  "responses": [
    { "status": "200", "description": "Current sync versions keyed by source." }
  ]
}
```

## Webhooks {#webhooks}

El webhooks entrante debería verificarse, persistir y regresar rápidamente. El trabajo de agente de larga duración debe utilizar el patrón de cola de integración:

1. Verifique la firma o el desafío de la plataforma.
2. Inserte trabajo duradero en SQL.
3. Autodisparar una ruta de procesador firmada.
4. Devuelve 200 inmediatamente.
5. Deje que la nueva ejecución del procesador ejecute el ciclo del agente y publique el resultado.

```an-diagram title="Patrón de cola de integración" summary="El controlador del webhook regresa en milisegundos; una ejecución firmada separada ejecuta el trabajo lento del agente."
{
  "html": "<div class=\"diagram-webhook\"><div class=\"diagram-box\" data-rough>Webhook entrante<br><small class=\"diagram-muted\">Slack · Stripe · email</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\" data-rough><strong>Handler</strong><div class=\"diagram-step\"><span class=\"diagram-pill\">1</span><small class=\"diagram-muted\">verify signature</small></div><div class=\"diagram-step\"><span class=\"diagram-pill\">2</span><small class=\"diagram-muted\">inserta trabajo en SQL</small></div><div class=\"diagram-step\"><span class=\"diagram-pill\">3</span><small class=\"diagram-muted\">self-fire processor</small></div><div class=\"diagram-step\"><span class=\"diagram-pill ok\">4</span><small class=\"diagram-muted\">return 200 now</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Signed processor<br><small class=\"diagram-muted\">ejecuta el bucle del agente y publica el resultado</small></div></div>",
  "css": ".diagram-webhook{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-webhook .diagram-panel{display:flex;flex-direction:column;gap:6px;padding:14px 16px}.diagram-webhook .diagram-step{display:flex;align-items:center;gap:8px}.diagram-webhook .diagram-arrow{font-size:22px;line-height:1}"
}
```

> [!WARNING]
> No confíe en promesas no esperadas después de devolver una respuesta: los hosts sin servidor congelan la ejecución. Consulte [Messaging](/docs/messaging) para conocer la cola de integración canónica.

## Avanzado: trampillas de escape {#advanced-escape-hatches}

La mayoría de las plantillas nunca las necesitan. Rutas de archivos Nitro y agente del framework
El complemento de chat ya conecta el servidor de aplicaciones y el controlador del agente de producción.
Utilícelos solo cuando cree una integración de servidor personalizada fuera del
Pila de complementos de plantilla estándar.

### Servidores programáticos H3 {#create-server}

Para paquetes personalizados o pruebas que necesitan una aplicación H3 directamente, `createServer()`
devuelve una aplicación y un enrutador preconfigurados:

```ts
import { createServer } from "@agent-native/core/server";
import { defineEventHandler } from "h3";

const { app, router } = createServer();

router.get(
  "/api/health",
  defineEventHandler(() => ({ ok: true })),
);
```

### Manejador del agente de producción {#agent-handler}

El complemento de chat del agente del marco ya monta el controlador del agente de producción
para plantillas. Llame solo a `createProductionAgentHandler()` directamente cuando construya
una integración de servidor personalizada fuera de la pila de complementos de plantilla estándar:
de lo contrario, personalice el agente a través de `AGENTS.md`, skills, actions y
complemento de chat para agentes.

```ts
import { createProductionAgentHandler } from "@agent-native/core/server";

const handler = createProductionAgentHandler({
  scripts,
  systemPrompt: "You are the app agent...",
});
```
