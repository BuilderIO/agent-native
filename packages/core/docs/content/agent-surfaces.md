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

| Surface                       | Use it when                                                                                                 | Start with                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Headless agent**            | Code, jobs, scripts, another app, or another agent should call the work directly.                           | `agent-native create --headless`, `defineAction`, `agent-native agent`, HTTP, CLI, MCP, A2A |
| **Rich chat on Agent-Native** | You want a standalone or embedded chat backed by the built-in agent loop.                                   | [Chat template](/docs/template-chat), `<AgentChatSurface>`, `<AssistantChat>`               |
| **Generated inline UI**       | The agent should create temporary or reusable controls, pickers, calculators, or visualizers inside chat.   | [Generative UI](/docs/generative-ui), `render-inline-extension`, `create-extension`         |
| **Rich chat on your agent**   | You built the agent elsewhere and want Agent-Native's composer, transcript, tool cards, and native widgets. | `AgentChatRuntime`, `<AssistantChat runtime={runtime}>`                                     |
| **Embedded sidecar**          | You already have a SaaS app and want an agent beside it with page context and host commands.                | `createAgentNativeEmbeddedPlugin()`, `AgentNativeEmbedded`                                  |
| **Full application**          | Humans and agents should share durable screens, data, navigation, and collaboration.                        | Templates, actions, SQL state, context awareness                                            |

Those are stages, not separate products. A workflow can start as a headless
agent with one action, appear in chat as a table or chart, and later become a
full screen in an app without changing the operation the agent calls.

```an-diagram title="The surface spectrum" summary="One action surface, four product shapes — each adds UI without changing the operation underneath."
{
  "html": "<div class=\"diagram-spectrum\"><div class=\"diagram-card\"><strong>Headless</strong><small class=\"diagram-muted\">actions, jobs, scripts, other agents</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><strong>Rich chat</strong><small class=\"diagram-muted\">composer, transcript, tool cards</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><strong>Embedded sidecar</strong><small class=\"diagram-muted\">agent beside an existing app</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card accent-card\"><span class=\"diagram-pill accent\">most UI</span><strong>Full application</strong><small class=\"diagram-muted\">durable screens, data, collaboration</small></div></div><div class=\"diagram-base\" data-rough><span class=\"diagram-muted\">same actions · same SQL · same agent loop</span></div>",
  "css": ".diagram-spectrum{display:flex;align-items:stretch;gap:10px;flex-wrap:wrap}.diagram-spectrum .diagram-card{display:flex;flex-direction:column;gap:6px;padding:14px 16px;min-width:150px;flex:1}.diagram-spectrum .diagram-arrow{align-self:center;font-size:22px;line-height:1}.diagram-base{margin-top:12px;padding:10px 14px;text-align:center}"
}
```

## Headless agent {#headless}

Use the headless path when no one needs to stare at a custom app screen while
the work runs: scheduled jobs, integrations, backend workflows, CLI loops,
another agent, or an existing product calling into Agent-Native.

This is also the shape to reach for when **the agent _is_ the product** — the
app-agent loop is the front door, not a dashboard. You send a request from the
terminal, Slack, email, a scheduled job, another agent, or Chat — "summarize my
unread emails," "post the daily metrics to Slack," "find the candidates who
replied last week" — and the agent acts and returns the result wherever it
belongs. It is still a real app, not a stateless prompt: actions, auth sessions,
app state, thread/run history, settings, credentials, and share records all live
in SQL.

Pick this pattern when:

- **The work happens in the background.** Most of the value is created while the user isn't looking — triage agents, daily-report agents, on-call responders.
- **The output leaves the app.** The agent posts to Slack, sends email, or updates a third-party system; there's nothing to browse in-app.
- **The domain is one-shot.** Research bot, summary generator, report writer — no persistent object that needs a list view.
- **You're prototyping.** Ship the agent now; add richer UI later if users want one.

If your product is built around persistent objects users browse, pivot, and
share — emails, events, documents, charts — pick a [full application](#full-application)
or a [template](/docs/cloneable-saas) instead; those add a full UI _plus_ the agent.

### What ships in the box {#in-the-box}

A headless app skips weeks of dashboard work, and it's channel-agnostic from day
one — the same agent runs from the web, Slack, Telegram, email, and other agents
because everything goes through the agent, not the UI. The trade-off is there's
no "browse-everything-at-a-glance" view; if users need that, mix patterns and
add a small status page or list view.

When you add the built-in Chat shell, the framework provides five management
surfaces you don't have to build: **Chat** (the main input), **Workspace**
(skills, memory, instructions, sub-agents, connected MCP servers, scheduled
jobs), **Job history**, **Thread history**, and **Settings**. Those are usually
enough — talk to it, see what it's done, configure how it behaves. Reach for
[Chat](/docs/template-chat) when you're ready to add that browser UI, or the
[Dispatch template](/docs/template-dispatch) for a workspace-style starting
point with Slack/Telegram, scheduled jobs, and shared secrets out of the box.

The smallest local path is a headless agent scaffold plus one action:

```bash
npx @agent-native/core@latest create my-agent --headless
cd my-agent
pnpm install
```

Then define the durable operation:

```ts
// actions/summarize-week.ts
import { defineAction } from "@agent-native/core/action";
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
- **App-agent CLI** — `pnpm agent "Summarize form_123"`
- **MCP** — from Claude, ChatGPT, Codex, Cursor, OpenCode, Copilot, and other MCP hosts
- **A2A** — from another agent-native app or agent peer
- **UI** — through `useActionQuery`, `useActionMutation`, or `callAction`
- **Agent tool** — from the built-in chat loop

```an-api title="Calling an action over HTTP"
{
  "method": "POST",
  "path": "/_agent-native/actions/summarize-week",
  "summary": "Invoke any action by name over HTTP",
  "description": "Every `defineAction` is auto-mounted at `/_agent-native/actions/<name>`. The JSON body is validated against the action's zod schema before `run` executes.",
  "request": {
    "contentType": "application/json",
    "example": "{ \"formId\": \"form_123\" }"
  },
  "responses": [
    { "status": "200", "description": "The action's return value as JSON", "example": "{ \"formId\": \"form_123\", \"summary\": \"34 submissions, up 18% from last week.\" }" },
    { "status": "400", "description": "Input failed schema validation" }
  ]
}
```

This is not a no-database or stateless mode. The app-agent loop stores sessions,
threads, runs, settings, credentials, application state, and share records in
SQL. Local development defaults to SQLite; hosted headless apps should use a
persistent SQL database.

If you need the whole agent loop headlessly from the project folder, use:

```bash
pnpm agent "Summarize this week's forms."
```

If another app or script needs to call the whole agent, use
`agentNative.invoke("analytics", "...")` or the `agent-native invoke` CLI. That
keeps cross-app work on the A2A path while local work stays on actions.

Workers, jobs, integration webhooks, and custom hosts can drive the agent loop
directly through the server API. This is lower-level than actions — you provide
the engine, model, messages, actions, and event sink yourself:

```ts
import { runAgentLoop } from "@agent-native/core/server";

await runAgentLoop({ engine, model, systemPrompt, actions, messages, send });
```

For most apps, scheduled prompts and integration webhooks already call this loop
for you. Reach for it directly only when building a custom headless host, eval
runner, or server-side orchestration surface — see [Server — Production agent
handler](/docs/server#agent-handler) for the full signature.

### Running against a folder {#folder-loop}

If your goal is "run an agent against this folder," start with the app-agent
loop in that folder: scaffold the headless app, add actions/instructions, run
`pnpm agent "..."`. That keeps the work inside the same action/runtime/state
contract the app will use in production.

External coding harnesses are a separate product surface for embedding Claude
Code, Codex, Pi, Cursor, Mastra, or similar runtimes inside an Agent-Native app.
Use them when you are building a coding-agent product, not as the default way to
start a local agent-native workflow.

### Cloud repo access {#cloud-repo-access}

For cloud headless apps that need repository access, use the GitHub connector
plus token CRUD model: list repositories, search files, read files, create or
edit files, delete files, and revoke access through provider-scoped
credentials. In local development, set the target repository explicitly:

```bash
GITHUB_REPOSITORY=owner/repo pnpm agent "Read README.md and suggest the next action."
```

Do not treat a VM clone or long-lived sandbox checkout as the primary cloud
repo-access model. Sandboxes still matter for isolated code execution, but
repository access should be explicit, permissioned, auditable, and revocable
through the connector layer.

### Sharing sessions and runs {#sharing-runs}

Headless sessions and runs are durable objects. Shareability should be phased:
read/share links first, so teammates can inspect sanitized prompts, outputs,
and run status; permissioned writable collaboration later, so continuing a run,
approving actions, editing schedules, or changing configuration goes through
explicit access checks.

## Rich chat on Agent-Native {#rich-chat}

Use the built-in chat when the user should talk to the agent, see tool calls,
approve work, inspect native results, and keep a durable thread history.

For a full app starting point, use the [Chat template](/docs/template-chat):

```bash
npx @agent-native/core@latest create my-chat-app --template chat
```

The simplest full-page chat:

```tsx
import { AgentChatSurface } from "@agent-native/core/client/chat";

export default function ChatRoute() {
  return <AgentChatSurface mode="page" className="h-screen" />;
}
```

When an app has both a full-page chat tab and an `AgentSidebar`, use the same
`storageKey` on both surfaces, enable `chatViewTransition`, and install the
chat-home handoff helpers in the layout. Ordinary in-app links out of the chat
page can then morph the full chat into the sidebar while keeping the active
thread:

```tsx
import {
  AgentChatSurface,
  AgentSidebar,
  useAgentChatHomeHandoff,
  useAgentChatHomeHandoffLinks,
} from "@agent-native/core/client/chat";
import { useLocation } from "react-router";

function ChatRoute() {
  return (
    <AgentChatSurface mode="page" storageKey="my-app" chatViewTransition />
  );
}

function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const handoffActive = useAgentChatHomeHandoff({
    storageKey: "my-app",
    activePath: location.pathname,
    enabled: location.pathname !== "/chat",
  });
  useAgentChatHomeHandoffLinks({ storageKey: "my-app", chatPath: "/chat" });

  return (
    <AgentSidebar
      storageKey="my-app"
      chatViewTransition
      openOnChatRunning={handoffActive}
    >
      {children}
    </AgentSidebar>
  );
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
When the agent needs arbitrary generated controls instead of a predefined
React widget, use [Generative UI](/docs/generative-ui): it renders sandboxed
Alpine/Tailwind UI inline, can read app state and slot context, and can send
selected values back to chat.

## Rich chat on your agent {#byo-agent}

Use this path when your agent is already built with another framework or
runtime and you want Agent-Native's chat UI around it. `AgentChatRuntime` is the
boundary: your runtime streams normalized events, and Agent-Native renders the
composer, transcript, tool calls, approvals, native widgets, and app layout.

```tsx
import {
  AssistantChat,
  createHttpAgentChatRuntime,
} from "@agent-native/core/client/chat";

const runtime = createHttpAgentChatRuntime({
  endpoint: "/api/support-agent/chat",
});

export function SupportAgentChat() {
  return <AssistantChat runtime={runtime} threadId="support" />;
}
```

Ready-made runtime helpers exist for OpenAI Agents, OpenAI Responses, the Claude
Agent SDK, the Vercel AI SDK, and AG-UI, plus the normalized HTTP runtime above
for any other agent (Mastra, Flue, Eve, LangGraph, or a custom service). ACP is
not the end-user app chat or A2A transport, and Agent-Native does not currently
claim A2UI support. ACP is supported in one specific place — driving a local
coding agent (Gemini CLI, Claude Code, …) through the
[harness layer](/docs/harness-agents#acp), not as the chat runtime here.

[Native Chat UI — BYO agent runtimes](/docs/native-chat-ui#byo-agent-runtimes)
is the canonical home for the event shapes, the runtime helpers, and `chatUI`
tool-result metadata. Start there when wiring an external agent into the chat.

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

```an-diagram title="How the sidecar bridges to a host app" summary="The plugin mounts Agent-Native routes server-side; the React sidecar streams page context in and host commands out."
{
  "html": "<div class=\"diagram-sidecar\"><div class=\"diagram-panel\"><strong>Host app</strong><small class=\"diagram-muted\">your existing SaaS</small><div class=\"diagram-node\">getContext()<br><small class=\"diagram-muted\">route · selection</small></div><div class=\"diagram-node\">onNavigate / onRefresh<br><small class=\"diagram-muted\">host commands</small></div></div><div class=\"diagram-col-arrows\"><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&larr;</div></div><div class=\"diagram-panel accent-panel\"><span class=\"diagram-pill accent\">AgentNativeEmbedded</span><small class=\"diagram-muted\">agent + workspace</small><div class=\"diagram-box\" data-rough>Agent-Native routes<br><small class=\"diagram-muted\">mounted by the server plugin</small></div></div></div>",
  "css": ".diagram-sidecar{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-sidecar .diagram-panel{display:flex;flex-direction:column;gap:8px;padding:14px 16px;min-width:200px}.diagram-sidecar .diagram-col-arrows{display:flex;flex-direction:column;gap:6px}.diagram-sidecar .diagram-arrow{font-size:22px;line-height:1}"
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
- **Generative UI and extensions** — the agent can create inline controls now
  and save reusable mini-apps when the workflow needs to persist.

Start from the [Chat template](/docs/template-chat) when you want a minimal app
around your actions, or from a domain [template](/docs/cloneable-saas) when you
want a complete product shape.

## How to choose {#how-to-choose}

| If you are thinking...                                          | Choose                    |
| --------------------------------------------------------------- | ------------------------- |
| "I just need a callable tool or workflow."                      | Headless agent            |
| "I want the framework's agent, but chat should be the main UI." | Rich chat on Agent-Native |
| "I want the agent to make an interactive control right now."    | Generated inline UI       |
| "I already have an agent; I need a polished chat UI for it."    | Rich chat on your agent   |
| "I already have a SaaS app; add an agent beside it."            | Embedded sidecar          |
| "The agent and UI should evolve together as the product."       | Full application          |

Keep the contract small: define durable operations as actions, return explicit
widget results when chat needs rich UI, and add full screens only when users
need to browse, compare, configure, or collaborate over persistent objects.

## Related docs {#related-docs}

- [Actions](/docs/actions) — define the headless operation once.
- [Native Chat UI](/docs/native-chat-ui) — render typed action results in chat.
- [Generative UI](/docs/generative-ui) — generate transient or persisted sandboxed UI inline in chat.
- [Drop-in Agent](/docs/drop-in-agent) — mount chat, sidebar, or panel surfaces.
- [Component API](/docs/components) — lower-level React chat/composer pieces.
- [Embedding SDK](/docs/embedding-sdk) — add Agent-Native to an existing app.
- [External Agents](/docs/external-agents) — connect MCP-compatible hosts to an app.
- [A2A Protocol](/docs/a2a-protocol) — call agents from other agents.
