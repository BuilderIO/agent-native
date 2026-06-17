---
title: "Agent Surfaces"
description: "Use Agent-Native headlessly, as rich chat, inside an existing app, or as a full agent-native application."
search: "headless agent rich chat full app BYO agent runtime AgentChatRuntime embed actions MCP A2A HTTP CLI"
---

# Agent Surfaces

Agent-Native is deliberately composable. You can use the agent without much UI,
use the UI without the built-in agent runtime, or use both together as a full
application.

The useful way to choose is not by protocol first. Choose the product surface
you want, then use the matching primitive.

| Surface                       | Use it when                                                                                                 | Start with                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Headless agent/actions**    | Code, jobs, scripts, another app, or another agent should call the work directly.                           | `defineAction`, HTTP, CLI, MCP, A2A                                |
| **Rich chat on Agent-Native** | You want a standalone or embedded chat backed by the built-in agent loop.                                   | `<AgentChatSurface>`, `<AssistantChat>`, `createAgentChatPlugin()` |
| **Rich chat on your agent**   | You built the agent elsewhere and want Agent-Native's composer, transcript, tool cards, and native widgets. | `AgentChatRuntime`, `<AssistantChat runtime={runtime}>`            |
| **Embedded sidecar**          | You already have a SaaS app and want an agent beside it with page context and host commands.                | `createAgentNativeEmbeddedPlugin()`, `AgentNativeEmbedded`         |
| **Full application**          | Humans and agents should share durable screens, data, navigation, and collaboration.                        | Templates, actions, SQL state, context awareness                   |

Those are stages, not separate products. A workflow can start as a headless
action, appear in chat as a table or chart, and later become a full screen in an
app without changing the operation the agent calls.

## Headless agent/actions {#headless}

Use the headless path when no one needs to stare at a custom app screen while
the work runs: scheduled jobs, integrations, backend workflows, CLI loops,
another agent, or an existing product calling into Agent-Native.

Most headless integrations should start with actions:

```ts
// actions/summarize-week.ts
import { defineAction } from "@agent-native/core";
import { z } from "zod";

export default defineAction({
  description: "Summarize this week's submissions.",
  readOnly: true,
  schema: z.object({ formId: z.string() }),
  run: async ({ formId }) => {
    return { formId, summary: "34 submissions, up 18% from last week." };
  },
});
```

One action is then callable as:

- **HTTP** — `POST /_agent-native/actions/summarize-week`
- **CLI** — `pnpm action summarize-week --formId form_123`
- **MCP** — from Claude, ChatGPT, Codex, Cursor, OpenCode, Copilot, and other MCP hosts
- **A2A** — from another agent-native app or agent peer
- **UI** — through `useActionQuery`, `useActionMutation`, or `callAction`
- **Agent tool** — from the built-in chat loop

If you need the whole agent loop headlessly, use the server API from a worker,
job, integration webhook, or custom host. This is lower-level than actions: you
provide the engine, model, messages, actions, and event sink yourself.

```ts
import {
  actionsToEngineTools,
  resolveEngine,
  runAgentLoop,
} from "@agent-native/core/server";

const engine = await resolveEngine({ engineOption: undefined });
const model = engine.defaultModel;
const controller = new AbortController();

await runAgentLoop({
  engine,
  model,
  systemPrompt: "You are the reporting agent for this workspace.",
  actions,
  tools: actionsToEngineTools(actions),
  messages: [
    {
      role: "user",
      content: [{ type: "text", text: "Summarize this week's forms." }],
    },
  ],
  send: (event) => {
    // Persist, log, stream, or translate AgentChatEvent objects.
  },
  signal: controller.signal,
  ownerEmail: user.email,
  orgId: user.orgId,
});
```

For most apps, scheduled prompts and integration webhooks already call this loop
for you. Reach for direct `runAgentLoop()` when you are building a custom
headless host, eval runner, or server-side orchestration surface.

## Rich chat on Agent-Native {#rich-chat}

Use the built-in chat when the user should talk to the agent, see tool calls,
approve work, inspect native results, and keep a durable thread history.

The simplest full-page chat:

```tsx
import { AgentChatSurface } from "@agent-native/core/client/chat";

export default function ChatRoute() {
  return <AgentChatSurface mode="page" className="h-screen" />;
}
```

The simplest embedded chat with your own chrome:

```tsx
import { AssistantChat } from "@agent-native/core/client/chat";

export function ProjectChat({ threadId }: { threadId: string }) {
  return <AssistantChat threadId={threadId} />;
}
```

Actions can return explicit native widget results so chat output is not just
text. Tables, charts, and typed product cards render as first-party React
components in the chat, without iframes. See [Native Chat UI](/docs/native-chat-ui).

## Rich chat on your agent {#byo-agent}

Use this path when your agent is already built with another framework or
runtime and you want Agent-Native's chat UI around it.

`AgentChatRuntime` is the boundary. Your runtime streams normalized events;
Agent-Native renders the composer, transcript, tool calls, approvals, native
widgets, and app layout.

```tsx
import {
  AssistantChat,
  createHttpAgentChatRuntime,
} from "@agent-native/core/client/chat";

const runtime = createHttpAgentChatRuntime({
  id: "external:support-agent",
  label: "Support agent",
  endpoint: "/api/support-agent/chat",
  headers: async () => ({ Authorization: `Bearer ${await getToken()}` }),
});

export function SupportAgentChat() {
  return <AssistantChat runtime={runtime} threadId="support" />;
}
```

The endpoint can stream SSE or NDJSON events:

```txt
data: {"type":"message-delta","messageId":"m1","delta":{"type":"text","text":"I found 34 submissions."}}
data: {"type":"tool-start","toolCall":{"id":"t1","name":"query","input":{"formId":"form_123"}}}
data: {"type":"tool-done","toolCallId":"t1","toolName":"query","status":"completed","resultText":"34 rows"}
data: {"type":"done","reason":"complete"}
```

For a trivial integration, returning `{ "text": "..." }` also works. For richer
integrations, stream `message-*`, `tool-*`, `approval-request`, `status`,
`artifact`, `file`, `usage`, `error`, and `done` events. Tool results can carry
`chatUI` metadata so the same native table/chart/card renderers work with your
agent too.

This is the right place to adapt Mastra, Flue, Eve, LangGraph, a custom service,
or an AG-UI-compatible event stream. Do not use ACP as the default end-user app
chat protocol; ACP is better framed as coding-agent/editor interoperability.
Agent-Native does not currently claim A2UI support.

## Embedded sidecar {#embedded-sidecar}

Use the embedded sidecar when the main product already exists and you want an
agent beside it.

The server plugin mounts Agent-Native routes into your host app and resolves
host identity server-side:

```ts
import { createAgentNativeEmbeddedPlugin } from "@agent-native/core/server";

export default createAgentNativeEmbeddedPlugin({
  databaseUrl: process.env.AGENT_NATIVE_DATABASE_URL,
  auth: getHostSession,
  actions: hostActions,
});
```

The React sidecar passes page context and host commands:

```tsx
import { AgentNativeEmbedded } from "@agent-native/core/client";

export function AppShell({ children }) {
  return (
    <AgentNativeEmbedded
      getContext={() => ({
        route: { pathname: window.location.pathname },
        selection: { text: window.getSelection()?.toString() || undefined },
      })}
      onNavigate={(payload) =>
        router.navigate((payload as { path: string }).path)
      }
      onRefresh={() => queryClient.invalidateQueries()}
    >
      {children}
    </AgentNativeEmbedded>
  );
}
```

See [Embedding SDK](/docs/embedding-sdk) for host auth, database isolation,
iframe/picker mode, and lower-level bridge APIs.

## Full application {#full-application}

Use the full app path when users need durable objects and workflows: forms,
dashboards, calendars, inboxes, editors, documents, assets, or reports.

Full apps add product UI around the same action and agent contract:

- **SQL state** — app data, navigation, settings, and chat history are durable.
- **Context awareness** — the agent knows the current route, selection, and focused object.
- **Live sync** — agent changes update the UI, and UI changes update the agent's context.
- **Deep links** — action results can open the right app view.
- **Native chat widgets** — tables, charts, cards, approvals, and typed results appear inline.

Start from a [template](/docs/cloneable-saas) when you want a complete app, or
from [Starter](/docs/template-starter) when you want only the framework wiring.

## How to choose {#how-to-choose}

| If you are thinking...                                          | Choose                    |
| --------------------------------------------------------------- | ------------------------- |
| "I just need a callable tool or workflow."                      | Headless action           |
| "I want the framework's agent, but chat should be the main UI." | Rich chat on Agent-Native |
| "I already have an agent; I need a polished chat UI for it."    | Rich chat on your agent   |
| "I already have a SaaS app; add an agent beside it."            | Embedded sidecar          |
| "The agent and UI should evolve together as the product."       | Full application          |

Keep the contract small: define durable operations as actions, return explicit
widget results when chat needs rich UI, and add full screens only when users
need to browse, compare, configure, or collaborate over persistent objects.

## Related docs {#related-docs}

- [Actions](/docs/actions) — define the headless operation once.
- [Native Chat UI](/docs/native-chat-ui) — render typed action results in chat.
- [Drop-in Agent](/docs/drop-in-agent) — mount chat, sidebar, or panel surfaces.
- [Component API](/docs/components) — lower-level React chat/composer pieces.
- [Embedding SDK](/docs/embedding-sdk) — add Agent-Native to an existing app.
- [External Agents](/docs/external-agents) — connect MCP-compatible hosts to an app.
- [A2A Protocol](/docs/a2a-protocol) — call agents from other agents.
