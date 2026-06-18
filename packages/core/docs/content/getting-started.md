---
title: "Getting Started"
description: "Create the smallest useful agent-native app: one action, one local runtime, and one app-agent loop."
---

# Getting Started

Agent-Native is for apps where an AI agent and any UI around it share the same actions, data, and state. The smallest useful app is not a dashboard. It is one durable action the agent can call, backed by the local runtime.

Start primitive-first: define the work as an action, run it through the app-agent loop, then add UI only when the workflow needs a durable surface.

Use this guide when you want the smallest thing that works. If you already know you want a finished app, go to [Templates](/docs/cloneable-saas); if you are choosing between headless, chat, embedded, or full app, go to [Agent Surfaces](/docs/agent-surfaces). Otherwise, keep going.

## Create a minimal agent {#create-your-agent}

You'll need [Node.js 22 or newer](https://nodejs.org) and [pnpm](https://pnpm.io) installed. Then run:

```bash
npx @agent-native/core@latest create my-agent --headless
cd my-agent
pnpm install
```

This creates the smallest local Agent-Native app: an `actions/` folder, the framework runtime, and a SQLite database at `data/app.db` unless you set `DATABASE_URL`. It intentionally has no custom React app or dev server yet.

Add one action:

```ts
// actions/hello.ts
import { defineAction } from "@agent-native/core";
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

Run it directly:

```bash
pnpm action hello --name Steve
```

Then run the app-agent loop from the same folder:

```bash
pnpm agent "Call the hello action for Steve and explain what happened."
```

That is the local app-agent loop. For "run an agent against this folder" work, start here before reaching for external coding harnesses; the agent runs against the actions, instructions, and runtime in the app you are developing.

### Agent credentials {#agent-credentials}

In local development the headless agent command reads provider credentials from your environment, such as `ANTHROPIC_API_KEY` in a `.env` file in the project root. Browser chat surfaces can also use configured agent credentials. The full loop is not stateless: actions, auth/session data, application state, threads, and run history use SQL. Locally that defaults to SQLite; in production you will usually point `DATABASE_URL` at Postgres or another persistent SQL database. See [Deployment](/docs/deployment).

## What just happened? {#what-just-happened}

You now have a real local app-agent loop:

- `hello` is one action definition, available to the agent, CLI, HTTP, MCP, A2A, and any future UI.
- `pnpm agent` calls the same production app-agent loop used by chat, jobs, webhooks, and hosted runtimes.
- Changes and history stay in sync because the local runtime uses SQL-backed state, even when you have no custom UI yet.

That parity between agent and UI is the whole point. See [What Is Agent-Native?](/docs/what-is-agent-native) for the bigger picture.

## Project structure {#project-structure}

Every agent-native app — whether from a template or from scratch — follows the same structure:

```text
my-app/
  actions/         # Agent-callable actions
  app/             # Optional React frontend (routes, components, hooks)
  server/          # Nitro API server (routes, plugins)
  .agents/         # Agent instructions and skills
  data/app.db      # Local SQLite runtime state when DATABASE_URL is unset
```

Templates add domain-specific code on top: database schemas in `server/db/`, API routes in `server/routes/api/`, and actions in `actions/`. See [Creating Templates](/docs/creating-templates) when you are ready to build or publish a reusable template.

## Common next moves {#next-docs}

Once your agent is running, the usual next step is small and concrete:

- **Ask the built-in agent what it can do** — open the agent panel and type "what actions do you have, and what can you do here?" This verifies that the app-agent loop is connected.
- **Add one real action** — replace `hello` with the smallest useful operation in your domain.
- **Add UI only when it clarifies the work** — use [Agent Surfaces](/docs/agent-surfaces) to choose between headless, chat, embedded, and full-app surfaces.
- **Deploy it** — see [Deployment](/docs/deployment) when you're ready to put the app on your own domain.

Useful follow-up docs:

- [Key Concepts](/docs/key-concepts) for the architecture: SQL, actions, polling sync, and context awareness
- [Agent Surfaces](/docs/agent-surfaces) for choosing headless, rich chat, embedded sidecar, or full app
- [Workspace](/docs/workspace) for instructions, skills, memory, and per-user MCP connections
- [Messaging](/docs/messaging) for Slack, email, Telegram, and other ways to reach the agent
- [FAQ](/docs/faq) for setup and product questions
