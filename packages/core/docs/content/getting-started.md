---
title: "Getting Started"
description: "Start with one headless action, or start with Chat when the conversation UI is the product."
---

# Getting Started

Agent-Native is for apps where an AI agent and any UI around it share the same
actions, data, and state. The smallest useful app can be just one action. The
first useful UI can be Chat. Both paths use the same runtime, so you can move
between them without rewriting the operation the agent calls.

Choose the first path that matches what you want to prove:

| Path                | Pick it when                                                                                                    | Creates                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Headless action** | You want the primitive first: one local action, the app-agent loop, CLI/HTTP/MCP/A2A, and no custom screen yet. | `actions/`, `.agents/`, runtime config, local SQLite state          |
| **Chat app**        | You want a browser app users can talk to immediately, with durable threads and tool-call UI.                    | Everything above, plus the Chat route, sidebar, auth, and live sync |

If you already know you want a finished domain app, go to
[Templates](/docs/cloneable-saas). If you are choosing between headless, chat,
embedded, or full app surfaces, go to [Agent Surfaces](/docs/agent-surfaces).

## Path 1: One headless action {#headless-action}

You'll need [Node.js 22 or newer](https://nodejs.org) and
[pnpm](https://pnpm.io) installed. Then run:

```bash
npx @agent-native/core@latest create my-agent --headless
cd my-agent
pnpm install
pnpm action hello --name Steve
pnpm agent "Call the hello action for Steve and explain what happened."
```

That is the primitive-first on-ramp: one action, no app screen, and the same
production app-agent loop used by chat, jobs, webhooks, and hosted runtimes.
The scaffold includes one example action:

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

Replace `hello` with the smallest real operation in your domain. That one
operation is then callable through the CLI, HTTP, MCP, A2A, scheduled jobs,
integration webhooks, and any future UI.

Headless does not mean stateless. Actions, auth/session data, application
state, threads, run history, credentials, and share records use SQL. Locally
that defaults to SQLite at `data/app.db`; in production you will usually set
`DATABASE_URL`. See [Deployment](/docs/deployment).

## Path 2: Chat app {#chat-app}

Use Chat when the first thing users need is a conversation UI with durable
threads and visible tool calls:

```bash
npx @agent-native/core@latest create my-chat-app --template chat
cd my-chat-app
pnpm install
pnpm dev
```

Open the local URL, then ask the chat what actions are available. The Chat
template includes the same `actions/hello.ts` shape as the headless scaffold,
plus a full-page chat route, the standard left sidebar, auth, live sync, and a
SQLite database at `data/app.db` unless you set `DATABASE_URL`.

Run the example action directly:

```bash
pnpm action hello --name Steve
```

Then run the same app-agent loop from the terminal:

```bash
pnpm agent "Call the hello action for Steve and explain what happened."
```

The chat UI, CLI, HTTP, MCP, A2A, jobs, and future screens all call the same
action surface.

## Move between paths {#move-between-paths}

Headless and Chat are not separate products. Start headless when you want the
operation first. Add Chat when a durable conversation UI helps users inspect,
approve, or continue the work. Start with Chat when the conversation itself is
the main workflow, then add screens only where structured UI clarifies the job.

For a deeper comparison, see [Agent Surfaces](/docs/agent-surfaces). For the
Chat template reference, see [Chat template](/docs/template-chat).

## Run against a connected repo {#connected-repo}

For a cloud headless app that works on repository files, connect GitHub through
the connector/token model rather than cloning a long-lived sandbox checkout.
The agent can list, search, read, create, update, and delete repository files
through provider-scoped credentials.

In local development, use the same shape with explicit environment variables:

```bash
GITHUB_REPOSITORY=owner/repo pnpm agent "Read README.md and suggest the next action."
```

The repo becomes context for the app-agent loop and `agent-native invoke`
calls. This path is for repository CRUD over the GitHub API. Use a sandbox or
Fusion-style code runtime only when you need true isolated code execution.

## Compose mini-apps {#compose-mini-apps}

Workspaces often become easier to reason about as several focused apps instead
of one giant app. A `hubspot-pipeline` app can own CRM access, a
`gong-evidence` app can own transcripts, and a `deal-brief` app can call both
through A2A.

From the CLI:

```bash
pnpm agent-native agents list
pnpm agent-native invoke gong-evidence "Find transcript evidence for deal_123."
```

From TypeScript:

```ts
import { agentNative } from "@agent-native/core/agent-native";

const agents = await agentNative.listAgents();
const result = await agentNative.invoke(
  "gong-evidence",
  "Find transcript evidence for deal_123.",
  { userEmail: "steve@example.com" },
);
```

For production agent-native apps, set `A2A_SECRET` in each app environment and
pass the caller identity (`userEmail`) so outbound calls are signed. Use
`apiKeyEnv` only for legacy external peers that expect a static bearer token.

See [A2A Protocol](/docs/a2a-protocol) and
[Pure Agent Apps](/docs/pure-agent-apps) for the full pattern.

## What just happened? {#what-just-happened}

You now have a real app-agent loop:

- `hello` is one action definition, available to the agent, CLI, HTTP, MCP,
  A2A, and any future UI.
- `pnpm agent` calls the production app-agent loop, not an external coding
  harness.
- Changes and history stay in sync because the runtime uses SQL-backed state,
  even when you have no custom UI yet.

That parity between agent and UI is the whole point. See
[What Is Agent-Native?](/docs/what-is-agent-native) for the bigger picture.

## Project structure {#project-structure}

Every agent-native app follows the same structure:

```text
my-app/
  actions/         # Agent-callable actions
  app/             # React frontend in UI templates; omitted in headless apps
  server/          # Nitro API server (routes, plugins)
  .agents/         # Agent instructions and skills
  data/app.db      # Local SQLite runtime state when DATABASE_URL is unset
```

Templates add domain-specific code on top: database schemas in `server/db/`,
API routes in `server/routes/api/`, and actions in `actions/`. See
[Creating Templates](/docs/creating-templates) when you are ready to build or
publish a reusable template.

## Common next moves {#next-docs}

Once your agent is running, the usual next step is small and concrete:

- **Add one real action** - replace `hello` with the smallest useful operation
  in your domain.
- **Open Chat when conversation helps** - ask "what actions do you have, and
  what can you do here?"
- **Connect a repo** - give the app-agent loop explicit GitHub repository
  context when file CRUD is the job.
- **Compose siblings** - split provider-heavy workflows into focused mini-apps
  and invoke them over A2A.
- **Deploy it** - see [Deployment](/docs/deployment) when you're ready to put
  the app on your own domain.

Useful follow-up docs:

- [Key Concepts](/docs/key-concepts) for the architecture: SQL, actions,
  polling sync, and context awareness
- [Agent Surfaces](/docs/agent-surfaces) for choosing headless, rich chat,
  embedded, and full-app surfaces
- [Workspace](/docs/workspace) for instructions, skills, memory, and per-user
  MCP connections
- [Messaging](/docs/messaging) for Slack, email, Telegram, and other ways to
  reach the agent
- [FAQ](/docs/faq) for setup and product questions
