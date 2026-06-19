---
title: "Getting Started"
description: "Create a headless agent app, run your first action, and watch the agent call it."
---

# Getting Started

Agent-Native apps give an AI agent and your UI the same actions, data, and
state. The smallest useful app is a single action — no screen required. Start
there, then add a UI only where it earns its place.

## Create your app

You'll need [Node.js 22+](https://nodejs.org) and [pnpm](https://pnpm.io).

```bash
npx @agent-native/core@latest create my-agent --headless
cd my-agent
pnpm install
```

This scaffolds a headless app with one example action and the full app-agent
loop — the same runtime that powers chat, jobs, webhooks, and hosted apps.

## Run your first action

Call the action directly from the CLI:

```bash
pnpm action hello --name Steve
```

Now ask the agent to call it for you:

```bash
pnpm agent "Call the hello action for Steve and explain what happened."
```

Same operation, two callers. That action is also reachable over HTTP, MCP, A2A,
scheduled jobs, and webhooks — and from any UI you add later. You define the
operation once; every surface gets it for free.

## The example action

```ts
// actions/hello.ts
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

export default defineAction({
  description: "Say hello from the local agent.",
  schema: z.object({
    name: z.string().default("world"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ name }) => {
    return { message: `Hello, ${name}!` };
  },
});
```

Replace `hello` with the smallest real operation in your domain. The agent, the
CLI, and every protocol surface pick it up automatically.

## State is built in

Headless doesn't mean stateless. Actions, sessions, application state, threads,
run history, and credentials all live in SQL. Locally that's SQLite at
`data/app.db`; in production you set `DATABASE_URL`. See
[Deployment](/docs/deployment).

## Add a UI when you want one

When users need a conversation to inspect, approve, or continue the work,
scaffold the Chat template instead. It's the same action surface plus a chat
route, sidebar, auth, and live sync:

```bash
npx @agent-native/core@latest create my-chat-app --template chat
cd my-chat-app && pnpm install && pnpm dev
```

Open the local URL and ask the chat what actions it has. For a finished domain
app, start from a [Template](/docs/cloneable-saas). To compare headless, chat,
embedded, and full-app surfaces, see [Agent Surfaces](/docs/agent-surfaces).

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
- **[Agent Surfaces](/docs/agent-surfaces)** — choosing headless, chat,
  embedded, and full-app surfaces.
- **[Workspace Connections](/docs/workspace-connections)** — give the agent a
  GitHub repo or other provider to work against.
- **[Multi-App Workspaces](/docs/multi-app-workspace)** and
  [A2A Protocol](/docs/a2a-protocol) — split provider-heavy work into focused
  mini-apps that call each other.
- **[Deployment](/docs/deployment)** — put your app on your own domain.
- **[FAQ](/docs/faq)** — setup and product questions.
