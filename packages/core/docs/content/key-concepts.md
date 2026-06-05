---
title: "Key Concepts"
description: "How agent-native apps work: the four-area checklist, SQL database, agent chat bridge, polling sync, actions, external-agent entry points, context awareness, and portability."
---

# Key Concepts

How agent-native apps work under the hood — the principles, the architecture, and why they're built this way.

## Why agent-native {#why-agent-native}

Teams today have four options for AI-powered work, and none of them are ideal:

1. **Chat apps** (Claude Projects, ChatGPT) — accessible but not built for structured workflows. No persistent UI, no dashboards, no team collaboration.
2. **Raw agent interfaces** (Claude Code, Cursor) — powerful but inaccessible to non-devs. No guardrails, no onboarding, no structured UI.
3. **Custom AI apps** — limited. The AI can't see what you see, can't react to what you click, and can't update the app itself. No conversation history, no rollback, no skills.
4. **Existing SaaS** (Amplitude, HubSpot, Google Slides) — bolting AI onto architectures that weren't designed for it. You can feel the seams.

Agent-native apps solve this by making the agent and the UI equal citizens of the same system. Think of it as Claude Code, but with buttons and visual interfaces. The agent can do anything the UI can do (via natural language), and the UI can trigger anything the agent can do (via buttons).

See [What Is Agent-Native?](/docs/what-is-agent-native) for the full vision and philosophy.

## The architecture {#the-architecture}

Every agent-native app is three things working together:

> **Agent** — Autonomous AI that reads data, writes data, runs actions, and modifies code. Customizable with skills and instructions.
>
> **Application** — Full React UI with dashboards, flows, and visualizations. Guided experiences your team can use.
>
> **Computer** — Database, browser, code execution. Agents work directly with SQL and tools — no MCPs needed.

Every app includes an embedded agent panel with chat and optional CLI terminal. Locally, you run `pnpm dev` and the agent is right there. In the cloud, Builder.io provides a managed frame with collaboration, visual editing, and managed infrastructure for teams.

Six rules govern the architecture:

1. **Data lives in SQL** — all app state lives in the database via Drizzle ORM
2. **All AI goes through the agent** — no inline LLM calls
3. **Actions for agent operations** — complex work runs as actions
4. **Live sync keeps the UI in sync** — database changes stream over SSE with polling as the universal fallback
5. **The agent can modify code** — the app evolves as you use it
6. **Application state in SQL** — ephemeral UI state lives in the database, readable by both agent and UI

## What you get for free {#what-you-get-for-free}

Adopting the framework is valuable mostly because of what you stop having to build. The moment your app follows the six rules, you inherit:

- **One action = every surface.** Every action defined with `defineAction()` is simultaneously an agent tool, a typesafe frontend hook (`useActionQuery` / `useActionMutation`), a framework-owned HTTP transport, a CLI command, an MCP tool for external clients, and an A2A tool for other agent-native apps. Optional `link` and `mcpApp` metadata add deep links and MCP Apps UI without a second implementation.
- **A full workspace per user.** Skills, shared `LEARNINGS.md`, personal `memory/MEMORY.md`, `AGENTS.md`, custom sub-agents, scheduled jobs, connected MCP servers — all SQL-backed, no dev-box required. See [Workspace](/docs/workspace).
- **Drop-in React components.** `<AgentPanel />` and `<AgentSidebar />` render chat + workspace anywhere in your app. See [Drop-in Agent](/docs/drop-in-agent).
- **Live sync between agent and UI.** Same-process writes stream immediately over `/_agent-native/events`; a lightweight poll keeps serverless, cron, and cross-process writes convergent. Mutating actions invalidate action-backed queries automatically, so agent-created records appear without a manual refresh. See [Live Sync](#polling-sync) below.
- **Auth, orgs, RBAC.** Better Auth with orgs/members/roles is wired in for every template. See [Authentication](/docs/authentication).
- **Context awareness.** The agent always knows what the user is looking at through the `navigation` app-state key. See [Context Awareness](/docs/context-awareness).
- **MCP client + server, both directions.** The app ingests MCP servers (local, remote, hub-shared) _and_ exposes its own actions as an MCP server. See [MCP Clients](/docs/mcp-clients) and [MCP Protocol](/docs/mcp-protocol).
- **Inter-app delegation.** Agents in different apps talk over [A2A](/docs/a2a-protocol). Same-origin deploys skip JWT; cross-origin uses a shared `A2A_SECRET`.
- **Sub-agent teams.** Spawn a sub-agent with its own thread and tools, surfaced as a chip inline in chat. See [Agent Teams](/docs/agent-teams).
- **Portability.** Any Drizzle-supported SQL database, any Nitro-compatible host (Node, Workers, Netlify, Vercel, Deno, Lambda, Bun).

That's the "and everything else" you'd otherwise be gluing together yourself.

## The four-area checklist {#four-area-checklist}

Every new feature must update all four areas. Skipping any one breaks the agent-native contract.

| Area             | Description                                                    |
| ---------------- | -------------------------------------------------------------- |
| **1. UI**        | Page, component, or dialog the user interacts with             |
| **2. Action**    | Agent-callable action in actions/ for the same operation       |
| **3. Skills**    | Update AGENTS.md and/or create a skill documenting the pattern |
| **4. App-State** | Navigation state, view-screen data, and navigate commands      |

A feature with only UI is invisible to the agent. A feature with only actions is invisible to the user. A feature without app-state means the agent is blind to what the user is doing.

## Data in SQL {#data-in-sql}

All application state lives in a SQL database via Drizzle ORM. The framework supports multiple databases — SQLite, Postgres (Neon, Supabase), Turso, Cloudflare D1. Users configure `DATABASE_URL` to choose their database.

Core SQL stores are auto-created and available in every template:

- `application_state` — ephemeral UI state (navigation, drafts, selections)
- `settings` — persistent key-value config
- `oauth_tokens` — OAuth credentials
- `sessions` — auth sessions

```ts
// Drizzle schema for domain data
import { table, text, integer } from "@agent-native/core/db/schema";

export const forms = table("forms", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  schema: text("schema").notNull(), // JSON
  ownerEmail: text("owner_email"),
  createdAt: integer("created_at").notNull(),
});
```

```bash
# Core actions for quick database inspection and one-off maintenance
pnpm action db-schema                                       # show all tables
pnpm action db-query --sql "SELECT * FROM forms"
pnpm action db-exec --sql "UPDATE forms SET status = ? WHERE id = ?" --args '["closed","form-1"]'
# Surgical find/replace on a large text column — sends a diff, not the whole value
pnpm action db-patch --table documents --column content \
  --where "id='doc-1'" --find "old heading" --replace "new heading"
```

## Agent chat bridge {#agent-chat-bridge}

The UI never calls an LLM directly. When a user clicks "Generate chart" or "Write summary", the UI sends a message to the agent via `postMessage`. The agent does the work — with full conversation history, skills, instructions, and the ability to iterate.

```ts
// In a React component — delegate AI work to the agent
import { sendToAgentChat } from "@agent-native/core";

sendToAgentChat({
  message: "Generate a chart showing signups by source",
  context: "Dashboard ID: main, date range: last 30 days",
  submit: true,
});
```

Why not call an LLM inline?

- **AI is non-deterministic.** You need conversation flow to give feedback and iterate — not one-shot buttons.
- **Context matters.** The agent has your full codebase, instructions, skills, and history. An inline call has none of that.
- **The agent can do more.** It can run actions, browse the web, modify code, and chain multiple steps together.
- **Headless execution.** Because everything goes through the agent, any app can be driven entirely from Slack, Telegram, or another agent via [A2A](/docs/a2a-protocol).

## Actions system {#actions-system}

When the agent needs to do something complex — call an API, process data, query the database — it runs an **action**. Actions are TypeScript files in `actions/` that export a default `defineAction()`:

```ts
// actions/fetch-data.ts
import { defineAction } from "@agent-native/core";
import { z } from "zod";

export default defineAction({
  description: "Fetch data from a source API.",
  schema: z.object({
    source: z.string().describe("Data source key, e.g. 'signups'"),
  }),
  run: async ({ source }) => {
    const res = await fetch(`https://api.example.com/${source}`);
    return await res.json();
  },
});
```

One `defineAction()` call gives you:

- **Agent tool** — the agent sees it with the zod-derived JSON Schema and can call it.
- **Frontend hook** — `useActionMutation("fetch-data")` with full TypeScript inference.
- **Framework transport** — auto-mounted behind the client hooks.
- **CLI** — `pnpm action fetch-data --source=signups` for scripting and agent dev loops.
- **MCP tool / A2A tool** — when MCP server or A2A is enabled, the same action shows up there too.

Same logic, one definition, wired to every consumer automatically. See [Actions](/docs/actions) for the full reference.

## Live sync {#polling-sync}

Database changes are synced to the UI through `useDbSync()`. Same-process writes stream over `/_agent-native/events`; `/_agent-native/poll` remains the cross-process and serverless fallback. When the agent writes to the database (application state, settings, or domain data), a version counter increments and the client invalidates the relevant React Query caches.

```ts
// Client: subscribe to agent/UI data changes once near the app shell
import { useDbSync } from "@agent-native/core";

useDbSync({ queryClient });
```

The flow is:

1. Agent runs an action that writes to the database
2. The server emits a change event with a source such as `"action"` or `"settings"`
3. `useDbSync` receives it over SSE or the polling fallback
4. `useActionQuery` hooks and source-versioned `useQuery` hooks refetch
5. Components render the new data without a page reload

This works in all deployment environments — including serverless and edge — because it uses the database, not in-memory state or file system watchers.

## Frames {#frames}

Agent-native apps include an embedded agent panel that provides the AI agent alongside the app UI. This is what makes the architecture work: the agent needs a computer (database, browser, code execution), and the app needs the agent for AI work.

> **Embedded Agent Panel** — Chat and optional CLI terminal built into every app. Supports Claude Code, Codex, Gemini, OpenCode, and Builder.io. Runs locally. Free and open source.
>
> **Cloud** — Deploy to any cloud with real-time collaboration, visual editing, roles and permissions. Best for teams.

## Context awareness {#context-awareness}

The agent always knows what the user is looking at. The UI writes a `navigation` key to application-state on every route change. The agent reads it via the `view-screen` action before acting.

See [Context Awareness](/docs/context-awareness) for the full pattern: navigation state, view-screen, navigate commands, and jitter prevention.

## One action, many protocols {#protocols}

Agent-native supports a lot of agent-facing protocols because different hosts standardize different pieces of the same workflow. App authors should not have to choose among them or rebuild the same operation for each client. The center of gravity stays the action system.

| Surface                 | What agent-native provides                                                                                             | What you write                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Agent tool calling      | The in-app agent sees actions as function tools with zod-derived JSON Schema.                                          | `defineAction()`                        |
| UI actions              | React calls the same action through `useActionMutation()` / `useActionQuery()`.                                        | The same action                         |
| HTTP and CLI            | Actions auto-mount at `/_agent-native/actions/:name` and run via `pnpm action <name>`.                                 | The same action                         |
| MCP server              | External MCP hosts get Streamable HTTP tools, the `ask-agent` meta-tool, and optional MCP Apps resources.              | The same action, plus optional `mcpApp` |
| MCP Auth                | Remote MCP OAuth, PKCE, dynamic client registration, refresh tokens, and `mcp:read` / `mcp:write` / `mcp:apps` scopes. | Nothing per action                      |
| A2A                     | Other agents discover the agent card and call the app over JSON-RPC tasks.                                             | The same actions and agent config       |
| Deep links              | Action results can round-trip users into the running UI through `/_agent-native/open` and `agentnative://open`.        | Optional `link` metadata                |
| MCP clients             | The app can also consume local, remote, or hub-shared MCP servers as `mcp__...` tools.                                 | `mcp.config.json` or settings           |
| Instructions and skills | `AGENTS.md`, skills, memory, slash commands, sub-agents, jobs, and automations live in the SQL-backed workspace.       | Workspace resources, not protocol glue  |
| Agent Web               | Public pages can publish `robots.txt`, `sitemap.xml`, `llms.txt`, markdown mirrors, and structured metadata.           | Route access plus `agentWeb` config     |
| Extensions              | Sandboxed mini-apps call app actions, persist extension data, and use proxied fetch helpers.                           | Extension HTML using `appAction()`      |

The practical rule is simple: implement domain operations as actions, add `readOnly`, `publicAgent`, `link`, or `mcpApp` metadata only when the surface needs it, and use skills/instructions for behavior. MCP, A2A, MCP Apps, MCP Auth, UI mutations, CLI commands, and deep-link handoffs are adapters around that same core.

## Agent modifies code {#agent-modifies-code}

This is a feature, not a bug. The agent can safely edit the app's source code: components, routes, styles, actions.

There's no shared codebase to break. You own the app, and the agent evolves it for you over time:

1. Fork a template (e.g. the analytics template)
2. Customize it by asking the agent
3. "Add a new chart type for cohort analysis" — the agent builds it
4. "Connect to our Stripe account" — the agent writes the integration
5. Your app keeps improving without manual development

## Database agnostic {#database-agnostic}

The framework supports portable Drizzle-backed SQL databases. Write app schemas with `@agent-native/core/db/schema` and app reads/writes with Drizzle's query builder so code can run across providers.

- **SQLite** — local dev fallback when `DATABASE_URL` is unset
- **Neon Postgres** — common in both dev and production
- **Turso** (libSQL) — edge-friendly SQLite-compatible
- **Supabase Postgres**
- **Cloudflare D1**
- **Plain Postgres**

Use Drizzle's portable query DSL for normal app code:

```ts
import { and, desc, eq } from "drizzle-orm";

const forms = await db
  .select()
  .from(schema.forms)
  .where(
    and(eq(schema.forms.ownerEmail, email), eq(schema.forms.status, "open")),
  )
  .orderBy(desc(schema.forms.createdAt));
```

Use raw SQL only for additive migrations, health checks, or one-off maintenance, and keep it parameterized and dialect-agnostic.

## Hosting agnostic {#hosting-agnostic}

The server runs on Nitro, which compiles to any deployment target:

- Node.js — local dev, traditional servers
- Cloudflare Workers/Pages
- Netlify Functions/Edge
- Vercel Serverless/Edge
- Deno Deploy
- AWS Lambda
- Bun

Never use Node-specific APIs (`fs`, `child_process`, `path`) in server routes or plugins. These don't exist in Workers/edge environments. Actions in `actions/` run in Node.js and can use Node APIs freely.

Never assume a persistent server process. Serverless and edge environments are stateless — no in-memory caches, no long-lived connections. Use the SQL database for all state.

## Workspace {#workspace}

Every user gets a personal **workspace** — instructions, skills, memory, custom sub-agents, scheduled jobs, and connected MCP servers — all stored in SQL rather than files. That makes Claude-Code-level customization viable inside multi-tenant SaaS without spinning up a container per user. See [Workspace](/docs/workspace).

## Dispatch {#dispatch}

**Dispatch** is the workspace control plane: a central inbox for Slack/email/Telegram, a shared secrets vault, scheduled jobs, and an orchestrator agent that delegates domain work to specialist apps over A2A. Run it alongside your domain apps when you have more than one. See [Dispatch](/docs/dispatch).

## Extensions {#extensions}

**Extensions** are sandboxed mini-apps the agent can create at runtime — Alpine.js HTML rendered inside an iframe, with built-in helpers for persistent storage (`extensionData`), calling app actions (`appAction`), and proxied external APIs (`extensionFetch`). No source-code changes, no schema migrations. (Distinct from LLM "tools" — the function-call surface area the agent uses, e.g. `defineAction` entries and MCP tools. See [Extensions](/docs/extensions).)

## A2A {#a2a}

Agent-to-agent (**A2A**) is how apps in the same workspace discover and call each other. Each app publishes an agent card with skill metadata; other agents can invoke its actions over JSON-RPC. Same-origin deploys skip JWT; cross-origin uses a shared secret. See [A2A Protocol](/docs/a2a-protocol).

## Deep dives {#deep-dives}

For detailed guidance on specific patterns:

- [What Is Agent-Native?](/docs/what-is-agent-native) — the vision and philosophy
- [Context Awareness](/docs/context-awareness) — navigation state, view-screen, navigate commands
- [Skills Guide](/docs/skills-guide) — framework skills, domain skills, creating custom skills
- [A2A Protocol](/docs/a2a-protocol) — agent-to-agent communication
- [Multi-App Workspace](/docs/multi-app-workspace) — host many apps in one monorepo with shared auth, skills, components, and credentials
