---
title: "Getting Started"
description: "Create an agent app — with a chat UI or headless — add an action, and watch the agent call it."
---

# Getting Started

Agent-Native apps give an AI agent and your UI the same actions, data, and
state. The smallest useful app is a single action.

**Want a complete app to start from?** Clone one of our rich templates —
[Chat](/docs/template-chat), [Mail](/docs/template-mail),
[Calendar](/docs/template-calendar), [Content](/docs/template-content),
[Analytics](/docs/template-analytics), and [many more](/docs/cloneable-saas) —
each a full-featured app you customize.

Building from scratch? The only choice up front is whether you want a UI —
everything after (defining actions, running the agent) is the same either way.

```an-diagram title="The three-step on-ramp" summary="Create an app, add one action, run it. The action is then reachable from every surface."
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-card\"><span class=\"diagram-pill\">1</span><strong>Create</strong><small class=\"diagram-muted\">chat template or headless</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">2</span><strong>Add an action</strong><small class=\"diagram-muted\">one defineAction file</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">3</span><strong>Run it</strong><small class=\"diagram-muted\">CLI, agent, or browser</small></div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-card{display:flex;flex-direction:column;gap:6px;padding:14px 16px;min-width:140px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}"
}
```

## 1. Create your app

You'll need [Node.js 22+](https://nodejs.org) and [pnpm](https://pnpm.io).

Run `create` with no flags and it asks how you want to start (a full template,
Chat, or Headless) before anything else:

```bash
npx @agent-native/core@latest create my-app
```

Or pass a flag to skip the prompt:

**Want a UI?** Start from the Chat template. You get a working agent plus a
customizable chat UI, and every action you add shows up in it automatically:

```bash
npx @agent-native/core@latest create my-app --template chat
```

**Just the headless primitive?** Start headless — the same actions and agent
loop, no UI shell:

```bash
npx @agent-native/core@latest create my-agent --headless
```

Then install:

```bash
cd my-app
pnpm install
```

From here on, the two are identical.

## 2. Add an action

An action is one operation your agent — and your UI — can call. Both scaffolds
ship with this example:

```an-annotated-code title="Your first action"
{
  "filename": "actions/hello.ts",
  "language": "ts",
  "code": "import { defineAction } from \"@agent-native/core/action\";\nimport { z } from \"zod\";\n\nexport default defineAction({\n  description: \"Say hello from the local agent.\",\n  schema: z.object({\n    name: z.string().default(\"world\"),\n  }),\n  http: { method: \"GET\" },\n  readOnly: true,\n  run: async ({ name }) => {\n    return { message: `Hello, ${name}!` };\n  },\n});",
  "annotations": [
    { "lines": "5", "label": "Tool description", "note": "The agent reads `description` to decide when to call this as a tool." },
    { "lines": "6-8", "label": "Typed contract", "note": "One zod `schema` validates input from every surface — agent, UI, HTTP, MCP, and A2A." },
    { "lines": "9", "label": "HTTP verb", "note": "Opt this action into an auto-mounted HTTP endpoint." },
    { "lines": "10", "label": "Read-only", "note": "`readOnly` marks the action as safe to call without approval and cacheable for queries." },
    { "lines": "11-13", "label": "One implementation", "note": "The `run` body is the single source of truth that every surface executes." }
  ]
}
```

Replace `hello` with the smallest real operation in your domain. You define it
once; every surface picks it up.

## 3. Run it

Call the action directly:

```bash
pnpm action hello --name Steve
```

Or ask the agent to call it for you:

```bash
pnpm agent "Call the hello action for Steve and explain what happened."
```

If you started from the Chat template, run the app and use the same agent in the
browser — it can already call every action you define:

```bash
pnpm dev
```

That one action is now reachable from the chat UI, the CLI, HTTP, MCP, A2A,
scheduled jobs, and webhooks. Define once, call from anywhere.

```an-diagram title="One action, every surface" summary="A single defineAction file fans out to every consumer with no extra wiring."
{
  "html": "<div class=\"diagram-fan\"><div class=\"diagram-box\" data-rough>defineAction</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-surfaces\"><span class=\"diagram-pill\">Chat UI</span><span class=\"diagram-pill\">CLI</span><span class=\"diagram-pill\">HTTP</span><span class=\"diagram-pill\">MCP</span><span class=\"diagram-pill\">A2A</span><span class=\"diagram-pill\">Scheduled jobs</span><span class=\"diagram-pill\">Webhooks</span></div></div>",
  "css": ".diagram-fan{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-fan .diagram-surfaces{display:flex;flex-wrap:wrap;gap:8px;max-width:420px}.diagram-fan .diagram-arrow{font-size:22px;line-height:1}"
}
```

## State is built in

Headless doesn't mean stateless. Actions, sessions, application state, threads,
run history, and credentials all live in SQL. Locally that's SQLite at
`data/app.db`; in production you set `DATABASE_URL`. See
[Deployment](/docs/deployment).

```an-callout
{
  "tone": "info",
  "body": "**Headless is still a real app.** The app-agent loop persists sessions, threads, runs, settings, and credentials in SQL — it is not a stateless prompt. You can add a UI later without touching your actions or state."
}
```

## Customize the UI

If you started from the Chat template, the UI is yours to edit. The chat itself
is one small route built on the `<AgentChatSurface>` component:

```tsx
// app/routes/_index.tsx
import { AgentChatSurface } from "@agent-native/core/client";

export default function ChatRoute() {
  return <AgentChatSurface mode="page" className="h-full" />;
}
```

- **`app/routes/_index.tsx`** — the chat page. Change the suggestions, empty
  state, and layout.
- **`app/root.tsx`** — the app shell. Add your own routes and screens around the
  agent.
- Drop the agent into any screen with `<AgentSidebar>`, hand work to it from a
  button with `sendToAgentChat()`, or run an action directly with
  `useActionMutation()`.

See [Drop-in Agent](/docs/drop-in-agent) for the full component set, and
[Native Chat UI](/docs/native-chat-ui) to render action results as tables,
charts, and typed cards instead of plain text.

**Started headless and want a UI later?** The Chat template _is_ the UI on-ramp —
its `app/` layer (React Router + Vite) is exactly what the headless scaffold
leaves out. The cleanest move is to start (or re-scaffold) from the Chat
template; your `actions/`, agent, and SQL state carry over unchanged. See
[Agent Surfaces](/docs/agent-surfaces) for every surface in between.

## Compose mini-apps

A big workspace is usually easier to reason about as a few focused apps than one
giant one. A `hubspot-pipeline` app can own CRM access, a `gong-evidence` app can
own transcripts, and a `deal-brief` app can call both over A2A:

```bash
pnpm agent-native agents list
pnpm agent-native invoke gong-evidence "Find transcript evidence for deal_123."
```

Each app keeps its own actions, agent, and state, and can discover its siblings.
See [Multi-App Workspaces](/docs/multi-app-workspace) and
[A2A Protocol](/docs/a2a-protocol).

## Project structure

```text
my-app/
  actions/         # Agent-callable actions
  app/             # React frontend (UI templates only; omitted when headless)
  server/          # Nitro API server (routes, plugins)
  .agents/         # Agent instructions and skills
  data/app.db      # Local SQLite state when DATABASE_URL is unset
```

## Where to go next

- **[Key Concepts](/docs/key-concepts)** — the core architecture: SQL, actions,
  sync, and context awareness.
- **[Actions](/docs/actions)** — the full action API: schemas, HTTP, auth, and
  approval.
- **[Agent Surfaces](/docs/agent-surfaces)** — headless, chat, embedded sidecar,
  and full app.
- **[Drop-in Agent](/docs/drop-in-agent)** — add the agent chat to any React app.
- **[Deployment](/docs/deployment)** — put your app on your own domain.
- **[FAQ](/docs/faq)** — setup and product questions.
