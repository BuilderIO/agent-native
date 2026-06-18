---
title: "Native Chat UI"
description: "Action-declared native chat renderers, reusable DataTable/DataChart outputs, and how BYO agent runtimes should connect to Agent-Native chat."
---

# Native Chat UI

Native chat UI is the in-app rendering path for first-party agent output. An
action returns structured JSON, the chat runtime recognizes an explicit widget
discriminant, and `<AssistantChat>` renders a real React component in the
conversation. You do not build an iframe or a one-off HTML artifact for the
normal app chat.

Use native chat UI when the user should inspect output where the agent is
already speaking: query results, response insights, setup summaries,
approval/denial controls, or links into app views. Use [MCP Apps](/docs/mcp-apps)
when an external host such as Claude, ChatGPT, Copilot, or Cursor should render
an inline route from your app.

## Action-declared widgets {#action-declared-widgets}

The native path has two explicit parts:

- `outputSchema` validates the action's response shape.
- `chatUI.renderer` selects the native React renderer for the validated result.

The built-in data renderers use a plain JSON result with `widget` plus the
matching payload:

| Widget            | Required payload             | Renders as                                      |
| ----------------- | ---------------------------- | ----------------------------------------------- |
| `"data-table"`    | `table`                      | A native, reusable data table                   |
| `"data-chart"`    | `chartSeries`                | A native bar, line, or area chart               |
| `"data-insights"` | `table` and/or `chartSeries` | A combined insight card with chart/table output |

Server actions should import the server-safe helpers and schemas from
`@agent-native/core/data-widgets`; client code can import the same types from
`@agent-native/core/client/chat` or `@agent-native/core/client`.

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

The renderer only takes over when the action declares `chatUI` or the result has
an explicit known `widget` discriminant. It never shape-infers arbitrary objects
and it never executes HTML or JavaScript from tool results.

When a user asks for a chart, graph, table, trend, or compact report, app agents
should prefer an action that declares one of these native renderers. The final
assistant text should stay brief and let the widget carry the data; do not copy
the same rows into a markdown table unless the user explicitly asks for a text
export.

When no domain action exists but the agent has already retrieved compact,
truthful data, it can call the framework `render-data-widget` action with the
same `data-table`, `data-chart`, or `data-insights` JSON shape. This action only
validates and renders the widget; it is not a data source and must not be used
to invent placeholder metrics.

## DataTable output {#data-table}

`table` is intentionally simple so list, SQL, analytics, and setup actions can
reuse it:

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

Prefer stable column keys and JSON-safe row values. Use `totalRows`,
`sampledRows`, and `truncated` when the action is showing a slice of a larger
result set.

## DataChart output {#data-chart}

`chartSeries` supports the common chart shapes used in agent answers without
requiring each template to ship its own chat renderer:

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

Keep chart data compact. For large datasets, aggregate in the action and link
to the full app view with `display.primaryAction` or action `link` metadata.

## Native widgets vs MCP Apps {#native-vs-mcp-apps}

Native chat widgets and MCP Apps are complementary:

- **Native widgets** are for the app's own chat runtime. The action result is
  JSON, and the framework renders the built-in React widget.
- **MCP Apps** are for external hosts. The action declares `mcpApp` and usually
  `link`, and the host renders a real app route inline when supported.
- **Deep links** remain the universal fallback. Use action `link` or
  `display.primaryAction` so CLI clients, older MCP hosts, and plain transcript
  readers can open the full app view.

When both a native widget payload and MCP Apps metadata are present, the in-app
chat prefers the native widget. External hosts use the MCP Apps resource or the
deep link fallback.

## Custom native renderers {#custom-native-renderers}

Register product-specific components by exact renderer id, then declare that id
on the action:

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

Use this for first-party app UI. Keep cross-host iframe UI in `mcpApp`, and keep
arbitrary query execution behind typed read actions rather than raw SQL in chat.

## BYO agent runtimes {#byo-agent-runtimes}

`AgentChatRuntime` is the bring-your-own-agent contract for the chat shell. It
lets an agent you built elsewhere stream normalized events into Agent-Native's
conversation UI while keeping the shared composer, transcript rendering, tool
cards, approvals, native widgets, and surrounding app layout. For how this fits
with headless actions, embedded sidecars, and full applications, see
[Agent Surfaces](/docs/agent-surfaces).

Use the generic HTTP runtime when your agent can expose a POST endpoint that
returns SSE or NDJSON runtime events:

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

If your endpoint already streams a common agent protocol, use the matching
connector and skip writing a custom mapper:

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

The endpoint may stream the normalized event shape directly:

```txt
data: {"type":"message-start","message":{"id":"m1","role":"assistant","content":[]}}
data: {"type":"message-delta","messageId":"m1","delta":{"type":"text","text":"Hello"}}
data: {"type":"tool-start","toolCall":{"id":"t1","name":"query","input":{"q":"forms"}}}
data: {"type":"tool-done","toolCallId":"t1","toolName":"query","status":"completed","resultText":"34 rows"}
data: {"type":"done","reason":"complete"}
```

For very simple agents, a JSON response `{ "text": "..." }` is accepted and
converted into a single assistant message. For richer agents, stream
`message-*`, `tool-*`, `approval-request`, `status`, `artifact`, `file`,
`usage`, `error`, and `done` events. Tool results can carry `mcpApp` or
`chatUI` metadata, so action-declared native widgets still render without
iframes.

When you want the built-in Agent-Native transport as a runtime object, use:

```ts
import { createAgentNativeChatRuntime } from "@agent-native/core/client/chat";

const runtime = createAgentNativeChatRuntime({
  threadId: "forms-chat",
  mode: "act",
});
```

Use `<AssistantChat createAdapter={...} />` only when you need full
assistant-ui adapter control. Use `PromptComposer` by itself when your product
owns the entire external transcript and only wants Agent-Native's composer
field.

OpenAI, AG-UI, Claude Agent SDK, and Vercel AI SDK streams can use the standard
connector helpers. ACP remains coding-agent/editor interoperability, not the
general app-chat runtime for end users. A2UI is not claimed as supported here;
if it matures, it should adapt into this same explicit runtime/widget contract.

## Related docs {#related-docs}

- [Actions](/docs/actions) — define the operations that return native widget data.
- [Agent Surfaces](/docs/agent-surfaces) — decide whether you need headless, chat, sidecar, or full app.
- [Drop-in Agent](/docs/drop-in-agent) — mount the standard chat runtime.
- [Component API](/docs/components) — custom chat layers and tool renderers.
- [MCP Apps](/docs/mcp-apps) — inline UI for external MCP hosts.
- [Key Concepts](/docs/key-concepts#protocols) — protocol status and positioning.
