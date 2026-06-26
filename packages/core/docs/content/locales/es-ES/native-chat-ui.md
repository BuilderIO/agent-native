---
title: "Chat nativo UI"
description: "Representadores de chat nativos declarados por acción, salidas reutilizables de DataTable/DataChart y cómo los tiempos de ejecución del agente BYO deben conectarse al chat Agent-Native."
---

# Chat nativo UI

El chat nativo UI es la ruta de procesamiento en la aplicación para la salida del agente propio. Un
La acción devuelve JSON estructurado, el tiempo de ejecución del chat reconoce un widget explícito
discriminante, y `<AssistantChat>` representa un componente React real en el
conversación. No creas un iframe o un artefacto HTML único para el
chat normal de la aplicación.

Utilice el chat nativo UI cuando el usuario deba inspeccionar la salida donde está el agente
ya estamos hablando: resultados de consultas, información sobre respuestas, resúmenes de configuración,
controles de aprobación/denegación o enlaces a vistas de aplicaciones. Utilice [MCP Apps](/docs/mcp-apps)
cuándo debe renderizar un host externo como Claude, ChatGPT, Copilot o Cursor
una ruta en línea desde tu aplicación.

```an-diagram title="La ruta de renderizado nativo" summary="Una acción devuelve JSON; el tiempo de ejecución coincide con un widget discriminante explícito o chatUI.renderer; AssistantChat monta un componente React real. Sin iframe, sin ejecución HTML."
{
  "html": "<div class=\"diagram-render\"><div class=\"diagram-node\">La acción se ejecuta<br><small class=\"diagram-muted\">devuelve JSON estructurado</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">Match</span><small class=\"diagram-muted\">explicit widget &middot; chatUI.renderer</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">&lt;AssistantChat&gt;<br><small class=\"diagram-muted\">monta un widget React</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card col\"><div class=\"diagram-pill ok\">DataTable</div><div class=\"diagram-pill ok\">DataChart</div><div class=\"diagram-pill ok\">DataInsights</div></div></div>",
  "css": ".diagram-render{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-render .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px}.diagram-render .col{display:flex;flex-direction:column;gap:6px;padding:12px}.diagram-render .diagram-arrow{font-size:22px;line-height:1}"
}
```

## Widgets de acción declarada {#action-declared-widgets}

La ruta nativa tiene dos partes explícitas:

- `outputSchema` valida la forma de respuesta de la acción.
- `chatUI.renderer` selecciona el renderizador nativo React para el resultado validado.

Los renderizadores de datos integrados utilizan un resultado simple JSON con `widget` más
carga útil coincidente:

| Aparato           | Carga útil requerida      | Representa como                                                      |
| ----------------- | ------------------------- | -------------------------------------------------------------------- |
| `"data-table"`    | `table`                   | Una tabla de datos nativa y reutilizable                             |
| `"data-chart"`    | `chartSeries`             | Un gráfico nativo de barras, líneas o áreas                          |
| `"data-insights"` | `table` y/o `chartSeries` | Una tarjeta de información combinada con resultados de gráfico/tabla |

El servidor actions debe importar los esquemas y ayudantes seguros para el servidor
`@agent-native/core/data-widgets`; El código del cliente puede importar los mismos tipos desde
`@agent-native/core/client/chat` o `@agent-native/core/client`.

```ts
import { defineAction } from "@agent-native/core/action";
import { ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER } from "@agent-native/core/action-ui";
import {
  createDataInsightsWidgetResult,
  dataInsightsWidgetResultSchema,
} from "@agent-native/core/data-widgets";

export default defineAction({
  description: "Analyze form responses.",
  readOnly: true,
  outputSchema: dataInsightsWidgetResultSchema,
  chatUI: {
    renderer: ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER,
    title: "Response insights",
  },
  run: async () =>
    createDataInsightsWidgetResult({
      title: "Response insights",
      display: {
        title: "42 responses",
        description: "Completion rate rose this week.",
        primaryAction: {
          label: "Open response insights",
          href: "/response-insights",
        },
      },
      chartSeries: {
        type: "bar",
        title: "Responses by day",
        xKey: "day",
        series: [{ key: "responses", label: "Responses" }],
        data: [
          { day: "Mon", responses: 8 },
          { day: "Tue", responses: 13 },
        ],
      },
      table: {
        title: "Top answers",
        columns: [
          { key: "answer", label: "Answer" },
          { key: "count", label: "Count", align: "right" },
        ],
        rows: [
          { answer: "Yes", count: 31 },
          { answer: "No", count: 11 },
        ],
        totalRows: 2,
      },
    }),
});
```

```an-callout
{
  "tone": "success",
  "body": "El renderizador solo toma el control cuando la acción declara `chatUI` **o** el resultado lleva un discriminante `widget` explícito conocido. Nunca infiere la forma de objetos arbitrarios y nunca ejecuta HTML o JavaScript a partir de los resultados de la herramienta, por lo que un widget nativo no puede convertirse en un vector de inyección."
}
```

Cuando un usuario solicita un cuadro, gráfico, tabla, tendencia o informe compacto, los agentes de la aplicación
debería preferir una acción que declare uno de estos renderizadores nativos. La final
el texto del asistente debe ser breve y permitir que el widget lleve los datos; no copiar
las mismas filas en una tabla de rebajas a menos que el usuario solicite explícitamente un texto
exportar.

Cuando no existe ninguna acción de dominio pero el agente ya ha recuperado el compacto,
datos veraces, puede llamar a la acción framework `render-data-widget` con el
misma forma `data-table`, `data-chart` o `data-insights` JSON. Sólo esta acción
valida y representa el widget; no es una fuente de datos y no debe utilizarse
para inventar métricas de marcador de posición.

## Salida de tabla de datos {#data-table}

`table` es intencionalmente simple, por lo que la lista, SQL, el análisis y la configuración de actions pueden hacerlo
reutilizarlo:

```ts
{
  title?: string;
  columns: Array<{ key: string; label: string; align?: "left" | "right" }>;
  rows: Array<Record<string, unknown>>;
  totalRows?: number;
  sampledRows?: number;
  truncated?: boolean;
}
```

Prefiere claves de columna estables y valores de fila seguros para JSON. Utilice `totalRows`,
`sampledRows` y `truncated` cuando la acción muestra una porción de un tamaño más grande
conjunto de resultados.

## Salida del gráfico de datos {#data-chart}

`chartSeries` admite las formas de gráficos comunes utilizadas en las respuestas de los agentes sin
requerir que cada plantilla envíe su propio renderizador de chat:

```ts
{
  type: "bar" | "line" | "area";
  title?: string;
  xKey: string;
  series: Array<{ key: string; label: string; color?: string }>;
  data: Array<Record<string, unknown>>;
  sampled?: boolean;
}
```

Mantenga los datos del gráfico compactos. Para conjuntos de datos grandes, agregue en la acción y vincule
a la vista completa de la aplicación con metadatos `display.primaryAction` o acción `link`.

## Widgets nativos frente a aplicaciones MCP {#native-vs-mcp-apps}

Los widgets de chat nativos y las aplicaciones MCP son complementarios:

- **Los widgets nativos** son para el tiempo de ejecución del chat propio de la aplicación. El resultado de la acción es
  JSON y el marco representa el widget React integrado.
- **Las aplicaciones MCP** son para hosts externos. La acción declara `mcpApp` y normalmente
  `link` y el host genera una ruta de aplicación real en línea cuando es compatible.
- Los **enlaces profundos** siguen siendo la alternativa universal. Utilice la acción `link` o
  `display.primaryAction` entonces clientes CLI, hosts MCP más antiguos y transcripción simple
  los lectores pueden abrir la vista completa de la aplicación.

Cuando están presentes una carga útil de widget nativo y metadatos de aplicaciones MCP, la aplicación
el chat prefiere el widget nativo. Los hosts externos utilizan el recurso de aplicaciones MCP o el
respaldo de enlaces profundos.

## Representadores nativos personalizados {#custom-native-renderers}

Registrar componentes específicos del producto por ID de renderizador exacto y luego declarar ese ID
sobre la acción:

```tsx
import { registerActionChatRenderer } from "@agent-native/core/client/chat";

registerActionChatRenderer({
  id: "crm.deal-card",
  renderer: "crm.deal-card",
  Component: ({ context }) => <DealCard result={context.resultJson} />,
});
```

```ts
export default defineAction({
  description: "Show a deal card.",
  outputSchema: dealCardSchema,
  chatUI: { renderer: "crm.deal-card" },
  run: async () => ({ dealId: "deal_123", amount: 42000 }),
});
```

Utilice esto para la aplicación propia UI. Mantenga el iframe entre hosts UI en `mcpApp` y mantenga
ejecución de consultas arbitrarias detrás de la lectura escrita actions en lugar de SQL sin formato en el chat.

## Tiempos de ejecución del agente BYO {#byo-agent-runtimes}

`AgentChatRuntime` es el contrato de traiga su propio agente para el shell de chat, y
esta sección es su referencia canónica. Permite que un agente que haya creado en otro lugar
transmita eventos normalizados a la conversación UI de Agent-Native manteniendo el
compositor compartido, renderizado de transcripciones, tarjetas de herramientas, aprobaciones, widgets nativos,
y el diseño de la aplicación circundante. El [Drop-in Agent](/docs/drop-in-agent#custom-chat-ui)
puntos tutoriales aquí para la historia en tiempo de ejecución y [Component API](/docs/components#agent-chat-ui)
enumera cada conector y adaptador con su ruta de importación; el contrato en sí es
se describe a continuación.

```an-diagram title="El tiempo de ejecución BYO mantiene el shell de chat Agent-Native" summary="Su agente externo transmite eventos normalizados a través de un conector; Agent-Native conserva el compositor, la transcripción, las tarjetas de herramientas, las aprobaciones y los widgets nativos."
{
  "html": "<div class=\"diagram-byo\"><div class=\"diagram-box\" data-rough>Tu agente<br><small class=\"diagram-muted\">OpenAI &middot; Claude &middot; Vercel AI &middot; AG-UI &middot; HTTP</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">connector</span><small class=\"diagram-muted\">eventos message-* / tool-* normalizados</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card col\"><div class=\"diagram-pill\">&lt;AssistantChat runtime=&hellip; /&gt;</div><small class=\"diagram-muted\">composer &middot; transcript &middot; tool cards</small><small class=\"diagram-muted\">approvals &middot; native widgets</small></div></div>",
  "css": ".diagram-byo{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-byo .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px}.diagram-byo .col{display:flex;flex-direction:column;gap:6px;padding:14px}.diagram-byo .diagram-arrow{font-size:22px;line-height:1}"
}
```

Todos los conectores se exportan desde `@agent-native/core/client/chat` (y la raíz
entrada `@agent-native/core/client`). Utilice el tiempo de ejecución genérico HTTP cuando su agente
puede exponer un punto final POST que devuelve eventos de tiempo de ejecución SSE o NDJSON:

```tsx
import {
  AssistantChat,
  createHttpAgentChatRuntime,
} from "@agent-native/core/client/chat";

const runtime = createHttpAgentChatRuntime({
  id: "external:mastra",
  label: "Mastra",
  endpoint: "/api/mastra/chat",
  headers: async () => ({
    Authorization: `Bearer ${await getAgentToken()}`,
  }),
});

export function SupportChat() {
  return <AssistantChat runtime={runtime} threadId="support" />;
}
```

Si su terminal ya transmite un protocolo de agente común, utilice el correspondiente
conector y omita escribir un asignador personalizado:

```ts
import {
  createAgUiChatRuntime,
  createClaudeAgentChatRuntime,
  createOpenAIAgentsChatRuntime,
  createOpenAIResponsesChatRuntime,
  createVercelAiChatRuntime,
} from "@agent-native/core/client/chat";

const openAiAgentsRuntime = createOpenAIAgentsChatRuntime({
  endpoint: "/api/openai-agents/chat",
});

const openAiResponsesRuntime = createOpenAIResponsesChatRuntime({
  endpoint: "/api/openai-responses/chat",
});

const claudeAgentRuntime = createClaudeAgentChatRuntime({
  endpoint: "/api/claude-agent/chat",
});

const vercelAiRuntime = createVercelAiChatRuntime({
  endpoint: "/api/vercel-ai/chat",
});

const agUiRuntime = createAgUiChatRuntime({
  endpoint: "/api/ag-ui/chat",
});
```

El punto final puede transmitir la forma del evento normalizado directamente:

```text
data: {"type":"message-start","message":{"id":"m1","role":"assistant","content":[]}}
data: {"type":"message-delta","messageId":"m1","delta":{"type":"text","text":"Hello"}}
data: {"type":"tool-start","toolCall":{"id":"t1","name":"query","input":{"q":"forms"}}}
data: {"type":"tool-done","toolCallId":"t1","toolName":"query","status":"completed","resultText":"34 rows"}
data: {"type":"done","reason":"complete"}
```

Para agentes muy simples, se acepta una respuesta JSON `{ "text": "..." }` y
convertido en un único mensaje de asistente. Para agentes más ricos, transmita
`message-*`, `tool-*`, `approval-request`, `status`, `artifact`, `file`,
Eventos `usage`, `error` y `done`. Los resultados de la herramienta pueden llevar `mcpApp` o
Metadatos `chatUI`, por lo que los widgets nativos con acción declarada aún se muestran sin
iframes.

Cuando desee el transporte Agent-Native integrado como objeto de tiempo de ejecución, utilice:

```ts
import { createAgentNativeChatRuntime } from "@agent-native/core/client/chat";

const runtime = createAgentNativeChatRuntime({
  threadId: "forms-chat",
  mode: "act",
});
```

Utiliza `<AssistantChat createAdapter={...} />` solo cuando lo necesites completo
control del adaptador de interfaz de usuario del asistente. Utilice `PromptComposer` solo cuando su producto
posee toda la transcripción externa y solo quiere el compositor de Agent-Native
campo.

Las transmisiones OpenAI, AG-UI, Claude Agent SDK y Vercel AI SDK pueden usar el estándar
ayudantes de conector. ACP sigue siendo la interoperabilidad entre agente de codificación y editor, no la
Tiempo de ejecución general de chat de aplicaciones para usuarios finales. Aquí no se afirma que A2UI sea compatible;
Si madura, debería adaptarse a este mismo contrato explícito de tiempo de ejecución/widget.

## Documentos relacionados {#related-docs}

- [Actions](/docs/actions): define las operaciones que devuelven datos del widget nativo.
- [Agent Surfaces](/docs/agent-surfaces): decide si necesitas una aplicación headless, chat, sidecar o completa.
- [Drop-in Agent](/docs/drop-in-agent): el tutorial para montar el tiempo de ejecución de chat estándar.
- [Component API](/docs/components): el mapa API por exportación para capas de chat, tiempos de ejecución y renderizadores de herramientas.
- [MCP Apps](/docs/mcp-apps): UI en línea para hosts MCP externos.
- [Key Concepts](/docs/key-concepts#protocols): estado y posicionamiento del protocolo.
