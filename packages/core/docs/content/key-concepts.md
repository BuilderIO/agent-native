---
title: "Key Concepts"
description: "How agent-native apps work: the four-area checklist, SQL database, agent chat bridge, polling sync, actions, context awareness, and portability."
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
4. **Polling keeps the UI in sync** — database changes sync via lightweight polling
5. **The agent can modify code** — the app evolves as you use it
6. **Application state in SQL** — ephemeral UI state lives in the database, readable by both agent and UI

## What you get for free {#what-you-get-for-free}

Adopting the framework is valuable mostly because of what you stop having to build. The moment your app follows the six rules, you inherit:

- **One action = four surfaces.** Every action defined with `defineAction()` is simultaneously an agent tool, a typesafe frontend mutation (`useActionMutation("name")`), an HTTP endpoint at `/_agent-native/actions/:name`, and an MCP tool (when MCP is enabled). External agents can call it over [A2A](/docs/a2a-protocol) too. One implementation, four consumers.
- **A full workspace per user.** Skills, memory (`learnings.md`), `AGENTS.md`, custom sub-agents, scheduled jobs, connected MCP servers — all SQL-backed, per-user, no dev-box required. See [Workspace](/docs/workspace).
- **Drop-in React components.** `<AgentPanel />` and `<AgentSidebar />` render chat + workspace anywhere in your app. See [Drop-in Agent](/docs/drop-in-agent).
- **Live sync between agent and UI.** A 2-second poll invalidates React Query caches whenever the agent writes to the DB. No WebSockets, no serverless-unfriendly long-lived connections. See [Polling Sync](#polling-sync) below.
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
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const forms = sqliteTable("forms", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  schema: text("schema").notNull(), // JSON
  ownerEmail: text("owner_email"),
  createdAt: integer("created_at").notNull(),
});
```

```bash
# Core actions for quick database access
pnpm action db-schema                                       # show all tables
pnpm action db-query --sql "SELECT * FROM forms"
pnpm action db-exec --sql "INSERT INTO forms ..."
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
- **Frontend mutation** — `useActionMutation("fetch-data")` with full TypeScript inference.
- **HTTP endpoint** — `POST /_agent-native/actions/fetch-data` (auto-mounted).
- **CLI** — `pnpm action fetch-data --source=signups` for scripting and agent dev loops.
- **MCP tool / A2A tool** — when MCP server or A2A is enabled, the same action shows up there too.

Same logic, one definition, wired to every consumer automatically. See [Actions](/docs/actions) for the full reference.

## Polling sync {#polling-sync}

Database changes are synced to the UI via lightweight polling. When the agent writes to the database (application state, settings, or domain data), a version counter increments. The client `useDbSync()` hook (formerly `useFileWatcher`) polls `/_agent-native/poll` every 2 seconds and invalidates React Query caches when changes are detected.

```ts
// Client: invalidate caches on database changes
import { useDbSync } from "@agent-native/core";

useDbSync({
  queryClient,
  queryKeys: ["app-state", "settings", "forms"],
});
```

The flow is:

1. Agent runs an action that writes to the database
2. Version counter increments
3. `useDbSync` detects the new version on next poll
4. React Query caches are invalidated
5. Components re-fetch and render the new data

This works in all deployment environments — including serverless and edge — because it uses the database, not in-memory state or file system watchers.

## Frames {#frames}

Agent-native apps include an embedded agent panel that provides the AI agent alongside the app UI. This is what makes the architecture work: the agent needs a computer (database, browser, code execution), and the app needs the agent for AI work.

> **Embedded Agent Panel** — Chat and optional CLI terminal built into every app. Supports Claude Code, Codex, Gemini, OpenCode, and Builder.io. Runs locally. Free and open source.
>
> **Cloud** — Deploy to any cloud with real-time collaboration, visual editing, roles and permissions. Best for teams.

## Context awareness {#context-awareness}

The agent always knows what the user is looking at. The UI writes a `navigation` key to application-state on every route change. The agent reads it via the `view-screen` action before acting.

See [Context Awareness](/docs/context-awareness) for the full pattern: navigation state, view-screen, navigate commands, and jitter prevention.

## Actions, MCP, and A2A — one surface, many protocols {#protocols}

Every action you define automatically becomes available over multiple protocols — you don't pick one. The framework runs both an MCP server and an A2A peer for your app, with actions feeding both.

- **Actions first.** Write the logic once as an action. Use `fetch()` and any SDK you want inside — no wrapper layer.
- **MCP for the outside world.** Your actions show up as MCP tools to Claude Desktop, ChatGPT's remote-MCP support, and any other MCP client. Your app also _consumes_ MCP servers — local, remote, or from a workspace hub. See [MCP Clients](/docs/mcp-clients) and [MCP Protocol](/docs/mcp-protocol).
- **A2A for other agents.** Other agent-native apps discover and call your actions over [A2A](/docs/a2a-protocol) — same-origin deploys skip JWT entirely.
- **CLIs still work.** `pnpm action <name>` and direct shell tools (`ffmpeg`, `gh`, `aws`) remain available whenever they're the simplest path.

## Agent modifies code {#agent-modifies-code}

This is a feature, not a bug. The agent can safely edit the app's source code: components, routes, styles, actions.

There's no shared codebase to break. You own the app, and the agent evolves it for you over time:

1. Fork a template (e.g. the analytics template)
2. Customize it by asking the agent
3. "Add a new chart type for cohort analysis" — the agent builds it
4. "Connect to our Stripe account" — the agent writes the integration
5. Your app keeps improving without manual development

## Database agnostic {#database-agnostic}

The framework supports every Drizzle-supported database. Never write SQL that only works on one dialect.

- **SQLite** — local dev fallback when `DATABASE_URL` is unset
- **Neon Postgres** — common in both dev and production
- **Turso** (libSQL) — edge-friendly SQLite-compatible
- **Supabase Postgres**
- **Cloudflare D1**
- **Plain Postgres**

Use the framework helpers for dialect-agnostic SQL:

```ts
import { getDbExec, isPostgres, intType } from "@agent-native/core/db/client";

// getDbExec() auto-converts ? params to $1 for Postgres
const client = getDbExec();
await client.execute({
  sql: "SELECT * FROM forms WHERE owner_email = ?",
  args: [email],
});

// Branch when syntax differs
const upsert = isPostgres()
  ? "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2"
  : "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)";
```

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

## Deep dives {#deep-dives}

For detailed guidance on specific patterns:

- [What Is Agent-Native?](/docs/what-is-agent-native) — the vision and philosophy
- [Context Awareness](/docs/context-awareness) — navigation state, view-screen, navigate commands
- [Skills Guide](/docs/skills-guide) — framework skills, domain skills, creating custom skills
- [A2A Protocol](/docs/a2a-protocol) — agent-to-agent communication
- [Enterprise Workspace](/docs/enterprise-workspace) — host many apps in one monorepo with shared auth, skills, components, and credentials
