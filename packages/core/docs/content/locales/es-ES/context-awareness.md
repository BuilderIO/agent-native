---
title: "Conciencia del contexto"
description: "Cómo sabe el agente lo que está mirando el usuario: estado de navegación, contexto de selección, pantalla de visualización, transferencias de sendToAgentChat, comandos de navegación y prevención de fluctuaciones."
---

# Conciencia del contexto

> **Página de desarrollador.** Esta página es para desarrolladores que conectan la capa de contexto de la aplicación. Para conocer la experiencia del usuario final (cómo el agente utiliza ese contexto en la conversación), consulte [Using Your Agent](/docs/using-your-agent).

Cómo sabe el agente lo que el usuario está mirando y cómo puede controlar lo que ve el usuario.

## Descripción general {#overview}

Sin conocimiento del contexto, el agente está ciego. Pregunta "¿qué correo electrónico?" cuando el usuario está mirando uno. No puede actuar sobre la selección actual, no puede proporcionar sugerencias relevantes y no puede modificar lo que ve el usuario. Con conocimiento del contexto, el usuario puede hacer clic en una fila, resaltar un párrafo, seleccionar un elemento de diapositiva o presionar Cmd+I, luego decir "resumir esto" y el agente ya sabrá lo que significa "esto".

Para saber qué colocar en cada superficie (AGENTS.md frente a skills frente a application_state), consulte [Writing Agent Instructions — The four surfaces the agent sees](/docs/writing-agent-instructions#four-surfaces).

Seis patrones resuelven esto:

1. **Estado de navegación**: el UI escribe una clave `navigation` en el estado de la aplicación en cada cambio de ruta
2. **URL actual**: el marco escribe `__url__` para que el agente pueda ver y editar los parámetros de consulta
3. **Estado de selección**: el UI escribe una clave `selection` cuando el usuario enfoca, selecciona o realiza una selección múltiple de algo significativo
4. **`view-screen`**: una acción que lee el estado de la aplicación, obtiene datos contextuales y devuelve una instantánea de lo que ve el usuario
5. **Transferencia rápida**: los controles UI llaman a `sendToAgentChat()` cuando un clic debe convertirse en un turno de agente
6. **`navigate`**: un comando único del agente que le indica al UI adónde ir

```an-diagram title="Cómo ve el agente lo que tú ves" summary="La interfaz de usuario escribe claves de estado ligeras; la pantalla de visualización los hidrata y los convierte en registros reales; el agente puede escribir navegar hacia atrás para mover la interfaz de usuario."
{
  "html": "<div class=\"diagram-ctx\"><div class=\"diagram-card col\"><span class=\"diagram-pill\">La UI escribe</span><div class=\"diagram-node\">navigation<br><small class=\"diagram-muted\">vista, IDs abiertos</small></div><div class=\"diagram-node\">__url__<br><small class=\"diagram-muted\">shareable filters</small></div><div class=\"diagram-node\">selection<br><small class=\"diagram-muted\">filas, bloques, formas</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">view-screen</span><small class=\"diagram-muted\">reads state &middot; fetches records</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">El agente actúa<br><small class=\"diagram-muted\">on the real object</small></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-box diagram-accent\">navigate<br><small class=\"diagram-muted\">el agente mueve la UI</small></div></div>",
  "css": ".diagram-ctx{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-ctx .col{display:flex;flex-direction:column;gap:8px;padding:14px}.diagram-ctx .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px}.diagram-ctx .diagram-arrow{font-size:22px;line-height:1}"
}
```

## Capas de contexto {#context-layers}

Utilice diferentes canales de contexto para diferentes trabajos:

| Capa                                                      | Propietario       | Úselo para                                                                                           |
| --------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------- |
| Clave de estado de aplicación `navigation`                | UI                | Estado de ruta semántica: vista actual, registro abierto, pestaña activa, ID estables                |
| Clave de estado de aplicación `__url__`                   | Marco UI          | Nombre de ruta actual, cadena de búsqueda, hash y parámetros de consulta URL analizados              |
| Clave de estado de aplicación `__set_url__`               | Agente/marco      | Ediciones únicas de URL de `set-search-params` y `set-url-path`                                      |
| Clave de estado de aplicación `selection`                 | UI                | Selección semántica duradera: filas, bloques, formas, activos, mensajes                              |
| Clave de estado de aplicación `pending-selection-context` | UI / `AgentPanel` | Texto seleccionado de una sola vez adjunto al siguiente turno de chat, generalmente desde Cmd+I      |
| Acción `view-screen`                                      | Agente            | Hidratar las claves de estado de la aplicación en registros reales y resúmenes de pantalla           |
| `sendToAgentChat()`                                       | UI                | Convertir un clic, un comando, un pin de comentario o un elemento seleccionado en un mensaje de chat |
| Clave de estado de aplicación `navigate`                  | Agente            | Pedir al UI que se mueva a otra ruta o enfoque otro objeto                                           |

La versión corta: los parámetros de consulta URL son la fuente de verdad para los filtros que se pueden compartir, `navigation` almacena ID semánticos y nombres de vistas, `view-screen` convierte esas capas de estado en datos útiles y `sendToAgentChat()` convierte la intención de UI en un mensaje de chat cuando el usuario hace clic en un comando.

## Estado de navegación {#navigation-state}

El UI escribe una clave `navigation` en el estado de la aplicación en cada cambio de ruta. Esto le dice al agente en qué vista se encuentra el usuario, qué elemento está abierto y qué estado semántico de UI importa.

```json
{
  "view": "inbox",
  "threadId": "thread-123",
  "focusedEmailId": "msg-456",
  "label": "important"
}
```

Qué incluir en el estado de navegación:

- `view`: la página/sección actual, como "bandeja de entrada", "creador de formularios" o "panel de control"
- ID de artículo: el artículo seleccionado/abierto, como `threadId` o `formId`
- Alias semánticos: pestaña activa, nombre de etiqueta u otros conceptos de aplicación estable que ayudan al agente a razonar
- Estado de enfoque de luz: fila enfocada, pestaña activa, panel actual

Mantenga `navigation` pequeño y semántico. Debe identificar la pantalla actual, no duplicar registros completos ni reflejar cada parámetro de consulta. Obtenga registros en `view-screen` para que el agente siempre obtenga datos nuevos.

El agente lee esto antes de actuar:

```ts
import { readAppState } from "@agent-native/core/application-state";

const navigation = await readAppState("navigation");
// { view: "inbox", threadId: "thread-123", label: "important" }
```

## URL actual y filtros {#current-url}

`AgentPanel` sincroniza automáticamente el enrutador React actual URL con la clave de estado de la aplicación `__url__`. El agente integrado lo incluye en cada turno como un bloque `<current-url>`:

```text
<current-url>
pathname: /adhoc/revenue
search: ?f_region=west&q=renewal
searchParams:
  f_region: west
  q: renewal
</current-url>
```

Esta es la capa canónica para el estado del filtro compartible. Si el usuario puede copiar un URL y volver a la misma lista filtrada, el filtro pertenece a la cadena de consulta. El agente puede cambiar esos filtros con la herramienta `set-search-params` incorporada:

```text
set-search-params({ "params": { "f_region": "east", "q": null } })
```

Utilice `navigation` solo para alias semánticos que ayuden a `view-screen` a obtener o resumir los datos correctos. Un panel puede conservar `navigation.dashboardId`, mientras que `__url__.searchParams` posee `f_region`, `f_dateStart` y `q`.

Cuando `view-screen` devuelve una instantánea más rica, puede copiar filtros URL importantes en un objeto `activeFilters` amigable:

```ts
const url = (await readAppState("__url__")) as {
  searchParams?: Record<string, string>;
} | null;

if (url?.searchParams) {
  screen.activeFilters = Object.fromEntries(
    Object.entries(url.searchParams).filter(
      ([key, value]) => key.startsWith("f_") && value,
    ),
  );
}
```

## Estado de selección {#selection-state}

La selección es el estado semántico UI. Así es como "el gráfico en el que hice clic", "estas tres filas", "el título de esta diapositiva" o "el rango actual de borradores de correo electrónico" se convierten en un contexto visible para el modelo.

Utilice la clave de estado de la aplicación `selection` para una selección duradera que debería sobrevivir a un momento de navegación, sugerencias de chat vacío o una llamada posterior de `view-screen`:

```json
{
  "kind": "slide.elements",
  "deckId": "deck-123",
  "slideId": "slide-4",
  "items": [
    {
      "id": "hero-title",
      "selector": "[data-block-id='hero-title']",
      "label": "Hero title",
      "text": "Lanzamiento del T3 plan"
    }
  ],
  "capturedAt": 1780332977027
}
```

Escríbalo desde UI cuando el usuario seleccione, enfoque o realice una selección múltiple de objetos significativos:

```tsx
import { setClientAppState } from "@agent-native/core/client";

async function syncSelection(selection: unknown | null) {
  await setClientAppState("selection", selection, { keepalive: true });
}
```

El buen estado de selección incluye:

- ID estables que el agente puede usar en actions, como `threadId`, `slideId` o `assetId`
- Una etiqueta humana breve para que las indicaciones y sugerencias sean legibles
- Suficiente texto o metadatos para eliminar la ambigüedad del objeto
- Localizadores UI opcionales, como selectores o coordenadas, cuando el agente necesita consultar un elemento visual
- `capturedAt` cuando la selección obsoleta sería perjudicial

Evite almacenar secretos, documentos completos, cargas útiles binarias grandes o respuestas API completas en `selection`. Almacene los ID y extractos breves y luego deje que `view-screen` obtenga la fuente de información actual.

### Texto seleccionado de una sola vez {#pending-selection-context}

`AgentPanel` ya maneja el flujo común de selección de texto. Cuando el usuario presiona Cmd+I (o Ctrl+I) con el texto seleccionado en la página:

1. Lee `window.getSelection()`
2. Escribe `{ text, capturedAt }` en `pending-selection-context`
3. Enfoca el chat del agente

El agente de producción inyecta esa clave en el siguiente turno como contexto de selección inmediata y la ignora una vez que está obsoleta. Esta es la ruta que hace que "seleccionar texto, presionar Cmd+I, preguntar 'hacer esto más impactante'" funcione sin que el usuario copie la selección en el mensaje.

Los editores personalizados pueden escribir la misma clave cuando su selección no está representada por la selección del navegador nativo:

```tsx
import { setClientAppState } from "@agent-native/core/client";

await setClientAppState(
  "pending-selection-context",
  {
    text: selectedMarkdown,
    capturedAt: Date.now(),
  },
  { keepalive: true },
);
```

Utilice `pending-selection-context` para flujos únicos de "actuar sobre este texto resaltado exacto". Utilice `selection` para una selección duradera de objetos que `view-screen` y sugerencias dinámicas deberían seguir apareciendo.

## La acción de ver pantalla {#view-screen-action}

Cada plantilla debe tener una acción `view-screen`. Lee el estado de navegación y selección, recupera los datos relevantes y devuelve una instantánea de lo que ve el usuario. Estos son los ojos del agente.

```an-annotated-code title="pantalla de visualización: los ojos del agente"
{
  "filename": "actions/view-screen.ts",
  "language": "ts",
  "code": "import { defineAction } from \"@agent-native/core/action\";\nimport { readAppState } from \"@agent-native/core/application-state\";\nimport { eq, inArray } from \"drizzle-orm\";\nimport { z } from \"zod\";\nimport { getDb, schema } from \"../server/db/index.js\";\n\nexport default defineAction({\n  description:\n    \"See what the user is currently looking at on screen.\",\n  schema: z.object({}),\n  http: false,\n  run: async () => {\n    const navigation = (await readAppState(\"navigation\")) as any;\n    const selection = (await readAppState(\"selection\")) as any;\n    const screen: Record<string, unknown> = {};\n    if (navigation) screen.navigation = navigation;\n    if (selection) screen.selection = selection;\n\n    const db = getDb();\n\n    // Fetch data based on what the user is viewing\n    if (navigation?.view === \"inbox\") {\n      screen.emailList = await db\n        .select()\n        .from(schema.emails)\n        .where(eq(schema.emails.label, navigation.label));\n    }\n    if (navigation?.threadId) {\n      screen.thread = await db\n        .select()\n        .from(schema.threads)\n        .where(eq(schema.threads.id, navigation.threadId));\n    }\n    if (selection?.kind === \"email.messages\") {\n      screen.selectedMessages = await db\n        .select()\n        .from(schema.emails)\n        .where(inArray(schema.emails.id, selection.messageIds));\n    }\n\n    if (Object.keys(screen).length === 0) {\n      return \"No application state found. Is the app running?\";\n    }\n    return screen;\n  },\n});",
  "annotations": [
    { "lines": "10-11", "label": "Superficie de la herramienta", "note": "El agente lee esta descripción para saber que puede llamar a `view-screen` para ver la interfaz de usuario actual." },
    { "lines": "13", "label": "http: false", "note": "Acción interna: no expuesta sobre HTTP. Lo llaman el agente y `pnpm action`, no el navegador." },
    { "lines": "15-16", "label": "Leer estado", "note": "Extrae las teclas ligeras `navigation` y `selection` que escribió la interfaz de usuario." },
    { "lines": "23-37", "label": "Hidratar", "note": "Convierte esos IDs en registros **nuevos** directamente desde SQL, de modo que el agente verifica el objeto activo antes de actuar." }
  ]
}
```

El agente debe llamar a `pnpm action view-screen` antes de actuar sobre el UI actual. Esta es una convención estricta para todas las plantillas. Al agregar nuevas funciones, actualice `view-screen` para devolver datos para la nueva vista y cualquier nueva forma de selección.

```an-callout
{
  "tone": "info",
  "body": "**Mantenga `navigation` y `selection` pequeños.** Almacene IDs más etiquetas cortas, no registros completos. `view-screen` recupera la fuente de la verdad a pedido, por lo que el estado obsoleto o voluminoso nunca llega al agente."
}
```

## Transferencia rápida con `sendToAgentChat()` {#send-to-agent-chat}

A veces el contexto no debería limitarse a permanecer en el estado de la aplicación. Un usuario hace clic en un botón, coloca un pin de comentario, selecciona un elemento y elige "Preguntar al agente" o presiona un comando de IA en una barra de herramientas. Ese clic es una instrucción. En el navegador UI, entréguelo al agente con `sendToAgentChat()`.

```tsx
import { sendToAgentChat } from "@agent-native/core/client";

function askAgentAboutSelection(selection: {
  documentId: string;
  blockId: string;
  label: string;
  text: string;
}) {
  sendToAgentChat({
    message: `Improve the selected block: ${selection.label}`,
    context: [
      `Document id: ${selection.documentId}`,
      `Block id: ${selection.blockId}`,
      "Current selected text:",
      selection.text,
    ].join("\n"),
    submit: false,
    openSidebar: true,
  });
}
```

Utilice los campos deliberadamente:

| Campo               | Significado                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| `message`           | Texto de aviso visible mostrado en el chat                                                                 |
| `context`           | Contexto visible del modelo oculto, no se muestra como texto de chat de cara al usuario                    |
| `submit: true`      | Enviar inmediatamente; bueno para botones de comando explícitos como "Reparar diseño"                      |
| `submit: false`     | Precompletar para revisión del usuario; bueno para "Preguntar al agente sobre esto" o selecciones ambiguas |
| `openSidebar: true` | Hacer visible la respuesta del agente incluso si el panel estaba contraído                                 |
| `newTab: true`      | Iniciar un hilo de chat independiente para una tarea de creación más grande                                |
| `type: "code"`      | Ruta al marco de edición de código cuando la solicitud trata sobre cambiar la fuente de la aplicación      |

`sendToAgentChat()` es el contenedor del navegador compatible para la ruta del chat enviado que a veces se ve internamente como `agentNative.submitChat`. La aplicación UI debe llamar al contenedor en lugar de publicar `agentNative.submitChat` directamente porque el contenedor maneja las barras laterales locales, el enrutamiento Builder/Frame, el enrutamiento del host de la aplicación MCP, los ID de pestañas y el enrutamiento de solicitud de código.

Utilice `agentChat.submit()` o `agentChat.prefill()` para contextos de nodo/script donde no hay barra lateral del navegador. El servidor actions generalmente no debería llamar al `sendToAgentChat()` solo del navegador; Si una acción necesita el UI abierto para preguntarle algo al agente, escriba una pequeña solicitud en `application_state` y deje que un puente UI la envíe desde el navegador.

### Elementos en los que se hizo clic en el mensaje {#clicked-items-in-prompt}

Para la experiencia "haga clic en elementos en UI y se convertirán en parte del mensaje", combine el estado de selección con la transferencia del mensaje:

1. Al hacer clic o realizar una selección múltiple, escriba el estado semántico de `selection` para que `view-screen`, las sugerencias dinámicas y los giros futuros puedan verlo.
2. Si el clic también es un comando, llame a `sendToAgentChat()` con un `message` visible conciso y un `context` oculto más rico.
3. En `view-screen`, hidrate los ID seleccionados en los registros actuales para que el agente pueda verificar el objeto antes de mutarlo.
4. Borrar `selection` cuando el objeto ya no esté seleccionado, eliminado o ya no sea relevante.

Eso le da al usuario el comportamiento mágico de "esto es lo que quise decir" sin llenar cada mensaje con un contexto visible voluminoso.

## La acción de navegación {#navigate-action}

`navigate` es la imagen especular de `navigation`. Donde `navigation` es el UI que le dice al agente dónde está el usuario, `navigate` es el agente que le dice al UI adónde ir. El agente escribe un comando `navigate` de un solo uso en el estado de la aplicación; el UI lo lee, realiza la navegación y luego elimina la entrada.

```ts
// Agent side -- write a navigate command
import { writeAppState } from "@agent-native/core/application-state";

await writeAppState("navigate", { view: "inbox", threadId: "thread-123" });
```

En el lado UI nunca se consulta ni se elimina esta clave manualmente. Ambas direcciones (escribir `navigation` en cada cambio de ruta y consumir el comando `navigate` del agente) se manejan mediante un único enlace, [`useNavigationState`](#use-navigation-state), que se trata en la siguiente sección.

La clave `navigation` pertenece al UI; el agente nunca debe escribirle directamente. El agente escribe `navigate`, UI realiza el movimiento y ese movimiento es lo que actualiza `navigation`.

Cuando el destino tiene un URL real, incluye un `path` del mismo origen en el
Comando `navigate` y haga que UI prefiera esa ruta antes de recurrir a
campos semánticos. Mantenga la navegación de la aplicación en un solo canal: no escriba ambos
`navigate` y `__set_url__` para el mismo movimiento. `__set_url__` es para el
herramientas de framework URL (`set-url-path`, `set-search-params`) y filtro exclusivo para URL
cambios. Para comandos que puedan llegar mientras se transmite el chat, confirme la ruta
con `navigate(path, { replace: true, flushSync: true })` en lugar de envolverlo
en una transición de vista para que la barra de direcciones y la página visible permanezcan juntas.

## El gancho useNavigationState {#use-navigation-state}

`useNavigationState` es **el gancho de su aplicación, no una importación de marco.** Cada plantilla envía una en `app/hooks/use-navigation-state.ts` y la llama una vez desde el shell de la aplicación (`root.tsx`). Es el único lugar que conecta la navegación en ambas direcciones:

- **Saliente (UI → agente):** escribe la clave `navigation` cada vez que cambia la ruta, para que el agente siempre conozca la vista actual.
- **Entrante (agente → UI):** sondea el comando `navigate`, ejecuta la navegación y elimina el comando.

Se queda corto porque es una envoltura delgada alrededor del marco primitivo real, `useAgentRouteState` (exportado de `@agent-native/core/client`). Usted proporciona dos funciones específicas de la aplicación y el marco hace el resto:

```tsx
// app/hooks/use-navigation-state.ts -- this file lives in YOUR app
import { useAgentRouteState } from "@agent-native/core/client";
import { TAB_ID } from "@/lib/tab-id";

interface NavigationState {
  view: "inbox" | "thread";
  threadId?: string;
  path?: string;
}

export function useNavigationState() {
  useAgentRouteState<NavigationState>({
    browserTabId: TAB_ID,
    requestSource: TAB_ID,

    // UI → agent: derive semantic state from the current URL.
    getNavigationState: ({ pathname }) => {
      const match = pathname.match(/^\/thread\/([^/]+)/);
      return match ? { view: "thread", threadId: match[1] } : { view: "inbox" };
    },

    // agent → UI: turn a `navigate` command into a route to push.
    getCommandPath: (command) =>
      command.path ??
      (command.view === "thread" && command.threadId
        ? `/thread/${command.threadId}`
        : "/"),
    navigateOptions: { replace: true, flushSync: true },
  });
}
```

| Tú escribes                                               | El marco maneja                                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `getNavigationState`: asigna el URL al estado semántico   | Escrituras `navigation`, con alcance de tabulación más una clave alternativa global                                      |
| `getCommandPath`: asigna un comando `navigate` a una ruta | sondeo de comandos, eliminación después de lectura, protección de comandos duplicados, etiquetado de fuente de solicitud |

`useAgentRouteState` asume el enrutador React. Cuando la navegación no reside en el URL (un paso del asistente, una selección de lienzo, un shell que no es un enrutador), descienda al `useSemanticNavigationState` de nivel inferior: le entrega un valor `state` listo para usar más `navigationKeys`/`commandKeys` y una devolución de llamada `onCommand`, y se mantiene completamente independiente del enrutador React.

## Prevención de inquietud {#jitter-prevention}

Cuando el agente escribe en el estado de la aplicación, el sistema de sincronización puede hacer que UI vuelva a recuperar los datos que acaba de escribir. Esto crea nerviosismo. La solución es el etiquetado de origen:

Utilice `setClientAppState`, `writeClientAppState`, `readClientAppState` y `deleteClientAppState` de `@agent-native/core/client` para acceder al estado de la aplicación del lado del navegador. Pase las escrituras `{ requestSource: TAB_ID }` en UI al emparejarse con `useDbSync({ ignoreSource: TAB_ID })`; pase `{ keepalive: true }` para escrituras de corta duración, como limpieza de selección durante la descarga.

```ts
// app/root.tsx
import { TAB_ID } from "@/lib/tab-id";

useDbSync({
  queryClient,
  ignoreSource: TAB_ID, // ignore events from this tab's own writes
});
```

Cómo funciona:

- Las escrituras del agente están etiquetadas con `requestSource: "agent"` (los asistentes de acción lo hacen automáticamente)
- Las escrituras UI incluyen el ID único de la pestaña a través del encabezado `X-Request-Source`
- El servidor almacena la fuente de cada evento
- Al procesar eventos de sincronización, el UI filtra los eventos que coinciden con su propio valor `ignoreSource`, por lo que no recupera los datos que acaba de escribir
- Los eventos de los agentes, otras pestañas y actions siguen llegando normalmente

```an-diagram title="El etiquetado de origen detiene la inquietud de autorrecuperación" summary="Una pestaña ignora los eventos de sincronización marcados con su propio TAB_ID, pero aún reacciona a las escrituras del agente y de otras pestañas."
{
  "html": "<div class=\"diagram-jitter\"><div class=\"diagram-node\">Esta pestaña escribe<br><small class=\"diagram-muted\">X-Request-Source: TAB_ID</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>El servidor guarda la fuente<br>on the event</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card col\"><div class=\"diagram-pill warn\">source == TAB_ID &rarr; ignored</div><small class=\"diagram-muted\">sin recarga, sin parpadeo</small><div class=\"diagram-pill ok\">agent / other tab &rarr; applied</div><small class=\"diagram-muted\">La UI se actualiza en vivo</small></div></div>",
  "css": ".diagram-jitter{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-jitter .col{display:flex;flex-direction:column;gap:6px;padding:14px}.diagram-jitter .diagram-arrow{font-size:22px;line-height:1}"
}
```
