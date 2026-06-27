---
title: "Cliente"
description: "Utilidades y enlaces React para aplicaciones nativas del agente: sendToAgentChat, estado de contexto de chat del agente opcional, useDbSync, useAgentChatGenerating y cn."
---

# Cliente

`@agent-native/core` proporciona ganchos y utilidades React para el lado del navegador de aplicaciones nativas del agente.

Estos clientes/React API se exportan desde `@agent-native/core` y `@agent-native/core/client`. Importarlos desde `@agent-native/core/client` (la entrada del navegador) para mayor claridad y correcta agrupación, ya que la raíz desnuda de `@agent-native/core` se resuelve en la compilación del Nodo de forma predeterminada.

Para enrutamiento basado en archivos (agregar páginas, parámetros dinámicos y navegación), consulte [Routing](/docs/routing).

## Obtener y mutar datos {#fetching-mutating}

La forma principal de leer y escribir datos de aplicaciones desde el navegador es a través de enlaces de acción. Nunca escriba a mano llamadas `fetch` a rutas `/_agent-native/*`; en su lugar, utilice los ayudantes con nombre (consulte [Actions](/docs/actions)).

```an-diagram title="El bucle de datos del navegador" summary="Los ganchos leen y escriben mediante acciones; useDbSync observa la base de datos para que las escrituras en segundo plano y del agente vuelvan a buscar los mismos cachés automáticamente."
{
  "html": "<div class=\"diagram-client\"><div class=\"diagram-col\"><div class=\"diagram-node\">useActionQuery<br><small class=\"diagram-muted\">cached read</small></div><div class=\"diagram-node\">useActionMutation<br><small class=\"diagram-muted\">write + invalidate</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&harr;</div><div class=\"diagram-box\" data-rough>Actions<br><small class=\"diagram-muted\">/_agent-native/actions/*</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&harr;</div><div class=\"diagram-panel\" data-rough><strong>base de datos SQL</strong></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-pill ok\">useDbSync &rarr; refetch on change</div></div>",
  "css": ".diagram-client{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-client .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-client .diagram-arrow{font-size:22px;line-height:1}"
}
```

```tsx
import {
  useActionQuery,
  useActionMutation,
  callAction,
} from "@agent-native/core/client";

// Read: auto-cached, auto-invalidated on mutations
const { data, isLoading } = useActionQuery("get-lead", { leadId });

// Mutate: emits a change event so query caches refetch
const { mutate, isPending } = useActionMutation("create-lead");
mutate({ name: "Alice", company: "Acme" });

// Imperative: for one-off calls outside a component
await callAction("archive-lead", { leadId });
```

## sendToAgentChat(opta) {#sendtoagentchat}

Envíe un mensaje al chat del agente a través de postMessage, la forma común de delegar una tarea de IA desde una interacción UI. Pase `context` para contexto de modelo oculto y `submit: true` para enviar inmediatamente, o `submit: false` para completar previamente un borrador que el usuario revisa primero.

```ts
import { sendToAgentChat } from "@agent-native/core/client";

// Auto-submit a prompt with hidden context
sendToAgentChat({
  message: "Generate alt text for this image",
  context: "Image path: /api/projects/hero.jpg",
  submit: true,
});

// Prefill without submitting (user reviews first)
sendToAgentChat({
  message: "Rewrite this in a conversational tone",
  context: selectedText,
  submit: false,
});
```

Dentro de una aplicación integrada MCP creada con `embedApp()`, mensajes enviados automáticamente
(`submit` omitido o `true`) se reenvían al puente host de la aplicación MCP, que
pide al host contenedor que agregue contexto oculto y envíe el turno al usuario visible.
`context` permanece visible como modelo sin publicarse en el chat de cara al usuario.
`submit: false` mantiene el comportamiento de precarga/revisión local porque las aplicaciones MCP no lo hacen
definir un borrador previo estándar API. Internamente esta es la ruta del chat enviado
a veces aparecía como `agentNative.submitChat`; el código de la aplicación debe llamar
`sendToAgentChat()` en lugar de publicar ese evento directamente.

### Envíos silenciosos en segundo plano {#background-send}

Utilice `background: true` cuando una acción UI deba iniciar el trabajo real del agente sin
abrir o enfocar la barra lateral. Esto todavía crea un hilo/ejecución de chat normal,
utiliza las herramientas/actions/contexto del agente y mantiene el trabajo observable durante
la bandeja de ejecuciones; no es una llamada de modelo única y sin formato.

```ts
const tabId = sendToAgentChat({
  message: "Analyze this import and create any missing records",
  context: `Import batch id: ${batchId}`,
  submit: true,
  newTab: true,
  background: true,
  openSidebar: false,
});
```

`background` está diseñado para combinarse con `newTab`, por lo que el trabajo oculto no lo hace
sobrescribe la conversación activa del usuario. Utilice el `tabId` devuelto si el UI
necesita correlacionar el estado del seguimiento o establecer un vínculo profundo con la ejecución más adelante.

### Mensaje de chat de agente {#agentchatmessage}

| Opción                | Tipo        | Descripción                                                                        |
| --------------------- | ----------- | ---------------------------------------------------------------------------------- |
| `message`             | `string`    | El mensaje visible enviado al chat                                                 |
| `context`             | `string?`   | Contexto oculto añadido (no se muestra en el chat UI)                              |
| `submit`              | `boolean?`  | true = envío automático, false = solo precompletar                                 |
| `newTab`              | `boolean?`  | Crea un hilo de chat independiente para este mensaje                               |
| `background`          | `boolean?`  | Con `newTab`, ejecutar sin enfocar la pestaña y mostrar la ejecución en `RunsTray` |
| `openSidebar`         | `boolean?`  | Establezca falso para enviar/rellenar previamente sin abrir la barra lateral       |
| `projectSlug`         | `string?`   | Slug de proyecto opcional para contexto estructurado                               |
| `preset`              | `string?`   | Nombre preestablecido opcional para consumidores intermedios                       |
| `referenceImagePaths` | `string[]?` | Rutas de imágenes de referencia opcionales                                         |

## Estado del contexto del chat del agente (avanzado) {#agent-chat-context-state}

Los API de estado de contexto son conexiones opcionales para UI que necesitan sincronización bidireccional con
chips de contexto preparados: renderizando los elementos preparados actualmente fuera del compositor,
reflejar si un elemento ya está adjunto o proporcionar información explícita
eliminar/borrar controles.

No recurra a estos ayudantes para simplemente "enviar esto al agente" o
Flujos de "completar previamente este borrador para revisión". Utilice `sendToAgentChat()` con `context`
y `submit` para esos.

| API                               | Usar cuando                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| `useAgentChatContext()`           | Un componente React necesita la lista de contexto preparada en vivo                       |
| `setAgentChatContextItem(item)`   | El código imperativo debe presentar o reemplazar un elemento de contexto clave            |
| `listAgentChatContext()`          | El código que no es React necesita una instantánea única del contexto preparado           |
| `removeAgentChatContextItem(key)` | UI debería eliminar un elemento de contexto preparado por su `key` estable                |
| `clearAgentChatContext()`         | UI debería borrar todo el contexto preparado, como después de un reinicio de vista o modo |
| `refreshAgentChatContext()`       | El código imperativo debe volver a leer la última instantánea del contexto persistente    |

`useAgentChatContext()` devuelve `{ items, set, remove, clear, refresh }`.

## openAgentSettings(¿sección?) {#openagentsettings}

Utilice `openAgentSettings()` cuando se abra la página de configuración de una aplicación o una tarjeta de configuración
la pestaña Configuración de la barra lateral del agente. Pase una identificación de sección como `"llm"`, `"secrets"`,
`"automations"`, `"voice"` o `"limits"` para abrir una sección específica.

```ts
import { openAgentSettings } from "@agent-native/core/client";

openAgentSettings();
openAgentSettings("secrets");
```

Prefiera este ayudante a enviar `agent-panel:open-settings` directamente.

```tsx
import { useAgentChatContext } from "@agent-native/core/client";

function SelectionContextButton({ record }: { record: { id: string } }) {
  const chatContext = useAgentChatContext();
  const contextKey = `selected-record:${record.id}`;
  const isAttached = chatContext.items.some((item) => item.key === contextKey);

  return (
    <button
      type="button"
      onClick={() => {
        if (isAttached) {
          chatContext.remove(contextKey);
          return;
        }

        chatContext.set({
          key: contextKey,
          title: "Selected Record",
          context: JSON.stringify(record, null, 2),
          openSidebar: false,
        });
      }}
    >
      {isAttached ? "Remove from prompt context" : "Add to prompt context"}
    </button>
  );
}
```

`listAgentChatContext()` es para código imperativo que solo necesita inspeccionar el
elementos preparados actualmente una vez. `clearAgentChatContext()` es intencionalmente amplio; utilizar
`removeAgentChatContextItem(key)` cuando solo cambió una selección.

### AgentChatContextSetOptions {#agentchatcontextsetoptions}

| Opción        | Tipo       | Descripción                                                                             |
| ------------- | ---------- | --------------------------------------------------------------------------------------- |
| `key`         | `string`   | Identificador estable utilizado para reemplazar una pepita existente                    |
| `title`       | `string`   | Etiqueta corta mostrada en el chip del compositor                                       |
| `context`     | `string`   | Contexto oculto incluido en el siguiente mensaje enviado                                |
| `openSidebar` | `boolean?` | El valor predeterminado es verdadero; pasar falso al contexto del escenario en silencio |

## preguntar al usuario (opta) {#ask-user-question}

Haga al usuario una pregunta de opción múltiple desde el código de la aplicación y muéstrela en línea en
panel de agentes y **espera su respuesta**. Es el gemelo del lado del cliente de
Herramienta `ask-question` incorporada del agente: escribe un `GuidedQuestionPayload` en
Clave de estado de aplicación `"guided-questions"` (donde está montada
`GuidedQuestionFlow` lo representa) y revela el panel del agente, por lo que la pregunta es
visible. A diferencia de la herramienta del agente, cuya respuesta regresa al agente,
`askUserQuestion()` **resuelve con la respuesta a la persona que llama**, por lo que el UI puede
bifurcarse en él.

Úselo cuando el UI necesite exactamente una pequeña decisión (2 a 4 opciones) antes de hacerlo
inicia el trabajo del agente, en lugar de crear un modal personalizado. Alcanza el
compositor para detalles de forma libre y un formulario/ventana emergente para entrada de múltiples campos.

```tsx
import { askUserQuestion, sendToAgentChat } from "@agent-native/core/client";

const length = await askUserQuestion({
  question: "How long should this deck be?",
  header: "Deck length", // optional short chip/heading (≈12 chars)
  options: [
    { label: "Short (3–5 slides)", value: "short" },
    { label: "Medium (6–10 slides)", value: "medium", recommended: true },
    { label: "Long (11+ slides)", value: "long" },
  ],
  allowFreeText: false, // omit the "Other" free-text option (default adds it)
  allowMultiple: false, // single-select (default)
});

if (length) {
  sendToAgentChat({ message: `Generate a ${length} deck.`, submit: true });
}
```

Cada opción es `{ label, value?, description?, preview?, recommended? }`; `value`
el valor predeterminado es `label`, y `preview` representa una pequeña maqueta/fragmento de código debajo del
opción. La promesa se resuelve con el `value` seleccionado (o `value[]` cuando
`allowMultiple`), la cadena de texto libre cuando el usuario elige "Otro", o `null`
si se saltan, permanece pendiente hasta que el usuario responda. Requiere el panel de agente
para montar (está en cada plantilla).

El agente llega al mismo UI a través de su herramienta `ask-question`: prefiere dejar que
el agente pregunta cuando _it_ llega a una bifurcación genuina que no puede resolver desde el contexto; utilizar
`askUserQuestion()` cuando el _UI_ necesita activar una acción en una elección.

## Puente de host de aplicaciones MCP {#mcp-app-host-bridge}

Las rutas integradas como aplicaciones MCP deben ser URL primero: cargue el artefacto actual desde
Parámetros de ruta/consulta, renderice la ruta React real o un componente compartido enfocado,
y usar el puente de host solo para comportamientos propiedad del host. `@agent-native/core/client`
exporta la llamada de rutas integradas de ayuda:

```ts
import {
  getMcpAppHostContext,
  openMcpAppHostLink,
  requestMcpAppDisplayMode,
  updateMcpAppModelContext,
  useMcpAppHostContext,
} from "@agent-native/core/client";
```

`getMcpAppHostContext()` lee la última instantánea del contexto del host enviado;
`useMcpAppHostContext()` suscribe los componentes de React a los cambios. La petición
ayudantes (`openMcpAppHostLink`, `requestMcpAppDisplayMode`,
`updateMcpAppModelContext`) devuelve `false` fuera de un marco de aplicación MCP integrado, o
`Promise<boolean>` dentro de un marco. `sendToAgentChat()` usa el mismo puente para
solicitudes enviadas automáticamente desde rutas integradas.

El puente en sí: los mensajes `ui/*` JSON-RPC, el `agentNative.mcpHost.*`
retransmisión de contenedor, trasplante versus renderizado de fotograma controlado, contexto de host y
solicitudes en modo de visualización: son propiedad de
[External Agents](/docs/external-agents#mcp-app-bridge).

## Sugerencias dinámicas {#dynamic-suggestions}

`<AgentSidebar>`, `<AgentPanel>` y `<AssistantChat>` combinan `suggestions` estático con sugerencias contextuales de forma predeterminada. El marco lee `navigation`, `selection`, `pending-selection-context` y el URL actual desde el estado de la aplicación mientras se ve un chat vacío y luego ofrece chips de aviso que coinciden con la pantalla actual.

```tsx
<AgentSidebar
  suggestions={["Summarize my inbox"]}
  dynamicSuggestions={{ max: 4 }}
>
  <App />
</AgentSidebar>
```

Configure `dynamicSuggestions={false}` para mantener solo chips estáticos. Pase `getSuggestions` cuando una aplicación quiera chips deterministas específicos de dominio del mismo contexto de estado de aplicación.

## useAgentChatGenerating() {#useagentchatgenerating}

Enganche React que incluye sendToAgentChat con seguimiento del estado de carga:

```ts
import { useAgentChatGenerating } from "@agent-native/core/client";

function GenerateButton() {
  const [isGenerating, send] = useAgentChatGenerating();

  return (
    <button
      disabled={isGenerating}
      onClick={() => send({
        message: "Generate a summary",
        context: documentContent,
        submit: true,
      })}
    >
      {isGenerating ? "Generating..." : "Generate"}
    </button>
  );
}
```

`isGenerating` se vuelve verdadero cuando llamas a `send()` y se restablece automáticamente a falso cuando el agente termina de generar.

## useDbSync(¿opciones?) {#usedbsync}

Enganche React (anteriormente `useFileWatcher`) que escucha los cambios en la base de datos a través de SSE, recurre al sondeo e invalida los cachés de consultas del marco que mantienen el UI alineado con las escrituras del agente:

```ts
import { useDbSync } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";

function App() {
  const queryClient = useQueryClient();

  useDbSync({
    queryClient,
    pollUrl: "/_agent-native/poll",
    onEvent: (data) => console.log("Data changed:", data),
  });

  return <div>...</div>;
}
```

### Opciones {#usedbsync-options}

| Opción             | Tipo               | Descripción                                                                                                       |
| ------------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `queryClient`      | `QueryClient?`     | Cliente de consulta React para invalidación de caché                                                              |
| `queryKeys`        | `string[]?`        | Obsoleto e ignorado; conservado para sitios de llamadas antiguos                                                  |
| `pollUrl`          | `string?`          | Punto final de encuesta URL. Predeterminado: `"/_agent-native/poll"`                                              |
| `sseUrl`           | `string \| false?` | SSE endpoint URL. Default: `"/_agent-native/events"`; pass `false` to use polling only                            |
| `interval`         | `number?`          | Intervalo de sondeo en ms. Predeterminado: `2000`                                                                 |
| `fallbackInterval` | `number?`          | Intervalo de sondeo alternativo cuando SSE no está disponible. Predeterminado: `15000`                            |
| `pauseWhenHidden`  | `boolean?`         | Pausar el sondeo cuando la pestaña del navegador esté oculta. Predeterminado: `true`                              |
| `ignoreSource`     | `string?`          | Fuente de solicitud por pestaña que se debe ignorar para que una pestaña no se recupere de sus propias escrituras |
| `onEvent`          | `(data) => void`   | Devolución de llamada opcional cuando SSE/polling recibe un evento de cambio                                      |

Para CRUD normal, prefiera `useActionQuery` y `useActionMutation`; La mutación actions emite `source: "action"` y esos ganchos se recuperan automáticamente.

## useChangeVersion / useChangeVersions {#use-change-version}

El marco utiliza versiones de cambios para sincronizar los cachés de consultas React con los cambios realizados por agentes en segundo plano, trabajos cron u otros usuarios.

Cuando ocurre cualquier mutación en la base de datos del lado del servidor, el servidor registra un evento de cambio con una clave `source` específica. El oyente `useDbSync` del cliente recibe estos eventos y activa el contador de versión de cambio local para esa fuente. Al incorporar el contador de versiones en sus claves de consulta React, las consultas se recuperan automáticamente cada vez que el backend notifica al cliente sobre una nueva actividad.

- **`useChangeVersion(source: string): number`**: devuelve un contador que se incrementa cada vez que se muta el `source` especificado.
- **`useChangeVersions(sources: readonly string[]): number`**: devuelve la suma de los contadores de versiones para múltiples fuentes.

### Ejemplo: sincronizar una consulta sin formato con la base de datos

```tsx
import { useQuery } from "@tanstack/react-query";
import { useChangeVersion } from "@agent-native/core/client";

function DashboardView({ id }) {
  // Get version for dashboards domain source
  const v = useChangeVersion("dashboards");

  const { data } = useQuery({
    queryKey: ["dashboard", id, v], // Invalidate automatically when version bumps
    queryFn: () => fetchDashboard(id),
    placeholderData: (prev) => prev, // Prevent layout flicker during refetch
  });

  return <div>{data?.title}</div>;
}
```

### Modelos de latencia y comportamiento de invalidación

- **Mutaciones iniciadas por UI:** Cuando ejecuta una acción desde UI usando `useActionMutation`, la mutación activa inmediatamente un evento local con `source: "action"` en caso de éxito. Esto activa una **rebusca instantánea y optimista** de todas las claves de consulta dependiendo de esa acción, evitando retrasos visuales.
- **Mutaciones en segundo plano o del agente:** Cuando el agente de IA, un webhook o un trabajador en segundo plano muta los datos, la actualización se transmite al cliente. El `useDbSync` del cliente captura esto instantáneamente a través de SSE (Eventos enviados por el servidor) o recurre al **tic de sondeo de 2 segundos**. La versión de la clave de consulta luego cambia, lo que activa una nueva búsqueda en segundo plano.

```an-diagram title="Dos caminos para una nueva recuperación" summary="Una mutación local invalida sus propios cachés instantáneamente; una escritura remota llega a esta pestaña a través de SSE, o el tick de sondeo como alternativa."
{
  "html": "<div class=\"diagram-latency\"><div class=\"diagram-col\"><div class=\"diagram-card\" data-rough><span class=\"diagram-pill ok\">Esta pestaña</span><strong>useActionMutation</strong><small class=\"diagram-muted\">fires source: \"action\" on success &rarr; instant local refetch</small></div><div class=\"diagram-card\" data-rough><span class=\"diagram-pill accent\">Agente · webhook · otra pestaña</span><strong>Escritura remota</strong><small class=\"diagram-muted\">SSE push, or the ~2s polling tick as fallback &rarr; version bumps &rarr; background refetch</small></div></div></div>",
  "css": ".diagram-latency .diagram-col{display:flex;flex-direction:column;gap:12px}.diagram-latency .diagram-card{display:flex;flex-direction:column;gap:4px;padding:14px 16px}"
}
```

## cn(...entradas) {#cn}

Utilidad para fusionar nombres de clases (clsx + tailwind-merge):

```ts
import { cn } from "@agent-native/core/client";

<div className={cn(
  "px-4 py-2 rounded",
  isActive && "bg-primary text-primary-foreground",
  className
)} />
```
