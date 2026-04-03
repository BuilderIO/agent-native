# Agent-Native Framework

## Core Philosophy

Agent-native is a framework for building apps where the AI agent and the UI are equal partners. Everything the UI can do, the agent can do. Everything the agent can do, the UI can do. They share the same database, the same state, and they always stay in sync.

You don't think about "the agent" and "the app" separately — you think about them together. A feature isn't complete until both the UI and the agent can use it. A compose email flow has a UI for the user AND scripts the agent calls. A calendar event can be created from the UI OR by the agent, and either way the other side sees it immediately.

The agent can also see what the user is looking at. If an email is open, the agent knows which email. If a slide is selected, the agent knows which slide. If the user selects text and hits Cmd+I to focus the agent, the agent knows what text is selected and can act on just that.

## When Adding a Feature

Every new feature or integration MUST update all four areas. Skipping any one breaks the agent-native contract:

1. **UI** — The user-facing interface (component, route, page)
2. **Scripts** — Agent-callable operations in `scripts/` so the agent can do the same thing
3. **Skills / Instructions** — Update AGENTS.md and/or create skills if the feature introduces new patterns the agent needs to know
4. **Application State** — Expose navigation and selection state so the agent knows what the user is looking at

This applies to every feature: a new form builder, a new chart type, a new email filter. If the UI has it, there's a script for it. If the agent needs context, app-state provides it. If there's a non-obvious pattern, a skill documents it.

## Context Awareness

The agent must always know what the user is currently viewing. This is achieved through two mechanisms:

### Navigation State

The UI writes a `navigation` key to application-state on every route change:

```json
{ "view": "thread", "threadId": "abc123", "subject": "Re: Q3 Planning" }
```

The agent reads this before taking action: `readAppState("navigation")`.

### The view-screen Script

Every template should have a `view-screen` script that reads navigation state, fetches the relevant data, and returns a snapshot of what the user sees. This is the agent's eyes.

### The navigate Script

Every template should have a `navigate` script that writes a one-shot command to application-state, letting the agent switch views, open items, or focus elements. The UI processes the command and clears it.

### Jitter Prevention

When the agent writes to application-state, the UI updates via polling. But polling must NOT override the user's active edits. Only explicit agent writes should push changes to the UI. Templates use the `ignoreSource` option on `useFileWatcher()` with a per-tab ID so the UI ignores its own writes while still picking up agent and other-tab changes.

## The Six Rules

### 1. Data Lives in SQL

All app state lives in SQL via Drizzle ORM. Users choose their database by setting `DATABASE_URL`:

- **SQLite** — local dev default when `DATABASE_URL` is unset (fallback to `data/app.db`)
- **Neon Postgres**, **Turso** (libSQL), **Supabase Postgres**, **Cloudflare D1**, **plain Postgres**

**Never assume SQLite.** All SQL must be dialect-agnostic. Use the framework helpers:

- `getDbExec()` — auto-converts `?` params to `$1` for Postgres
- `isPostgres()` — runtime dialect check
- `intType()` — returns correct integer type for the dialect
- Drizzle ORM — generates dialect-correct SQL automatically

**Core SQL stores** (auto-created, available in all templates):

- `application_state` — ephemeral UI state (via `@agent-native/core/application-state`)
- `settings` — persistent KV config (via `@agent-native/core/settings`)
- `oauth_tokens` — OAuth credentials (via `@agent-native/core/oauth-tokens`)
- `sessions` — auth sessions

### 2. All AI Goes Through the Agent Chat

The UI never calls an LLM directly. When the user wants AI to do something, the UI sends a message via `sendToAgentChat()`. The agent does the work and writes results to the database.

### 3. Scripts for Agent Operations

When the agent needs to do something — query data, call APIs, process information — it runs a script via `pnpm script <name>`. Scripts live in `scripts/` and export a default async function. **Everything the UI can do, the agent can do via scripts.**

### 4. Polling Keeps the UI in Sync

Database changes sync to the UI via polling. The client `useFileWatcher()` hook polls `/_agent-native/poll` every 2 seconds and invalidates React Query caches when changes are detected. This works in all deployment environments including serverless and edge.

### 5. The Agent Can Modify Code

The agent can edit the app's own source code — components, routes, styles, scripts. This is a feature. Design your app expecting this.

### 6. Application State in SQL

Ephemeral UI state lives in the `application_state` table. Both agent and UI read and write it. When the agent writes state (e.g., a draft), the UI reacts via polling. When the user interacts with the UI, changes are written back so the agent can read them.

**Script helpers** (from `@agent-native/core/application-state`):

- `readAppState(key)` — read state for current session
- `writeAppState(key, value)` — write state (triggers UI sync)
- `deleteAppState(key)` — delete state
- `listAppState(prefix)` — list state by key prefix

## Portability

**This is a hard requirement. Never write code that only works on one database or one hosting platform.**

### Database Agnostic

The framework supports all SQL databases via Drizzle ORM. Never write SQLite-only syntax (`INSERT OR REPLACE`, `AUTOINCREMENT`, `datetime('now')`). When writing docs, say "SQL database" — not "SQLite".

### Hosting Agnostic

The server runs on **Nitro**, which compiles to any deployment target: Node.js, Cloudflare Workers/Pages, Netlify, Vercel, Deno Deploy, AWS Lambda, Bun.

Never use Node-specific APIs (`fs`, `child_process`, `path`) in server routes and plugins. Use Nitro abstractions. Scripts in `scripts/` run in Node.js and can use Node APIs freely.

Never assume a persistent server process. Use the SQL database for all state.

## Single-Tenant Model

Agent-native apps are single-tenant. Each deployment serves one organization. You fork the app, customize it, and deploy it for your team. Builder.io provides hosting and services that make this easy.

Per-user data isolation exists for multi-user organizations (via `owner_email` column convention and `AGENT_USER_EMAIL`), but large-scale multi-tenancy across organizations is not the architecture.

## A2A Protocol (Agent-to-Agent)

Agents can call other agents using the A2A protocol. From the mail app, you can tag the analytics agent to query data and include results in a draft. An agent discovers what other agents are available, calls them over the protocol, and shows results in the UI.

### Enabling A2A

```ts
import { enableA2A } from "@agent-native/core/a2a";

enableA2A(app, {
  name: "Analytics Agent",
  description: "Queries analytics data across providers",
  skills: [
    {
      id: "query-data",
      name: "Query Data",
      description: "Run analytics queries",
    },
  ],
  apiKeyEnv: "A2A_API_KEY",
});
```

This mounts:

- `GET /.well-known/agent-card.json` — public agent discovery (no auth)
- `POST /a2a` — JSON-RPC endpoint (bearer token auth)

### Calling Another Agent

```ts
import { callAgent, A2AClient } from "@agent-native/core/a2a";

// Simple: send text, get text back
const answer = await callAgent(
  "https://analytics.example.com",
  "What were last week's signups?",
  {
    apiKey: process.env.ANALYTICS_A2A_KEY,
  },
);

// Advanced: full client with streaming
const client = new A2AClient("https://analytics.example.com", apiKey);
const task = await client.send({
  role: "user",
  parts: [{ type: "text", text: "..." }],
});
```

## All-Agent Support

AGENTS.md is the universal standard for agent instructions. It works with any AI coding tool. The framework auto-creates symlinks so all tools read the same instructions:

- `CLAUDE.md` → `AGENTS.md` (Claude Code)
- `.cursorrules` → `AGENTS.md` (Cursor)
- `.windsurfrules` → `AGENTS.md` (Windsurf)
- `.claude/skills/` → `.agents/skills/` (Claude Code skills)

Run `agent-native setup-agents` to create all symlinks, or they're created automatically by `agent-native create`.

## Authentication

Auth is automatic and environment-driven via `autoMountAuth(app)`.

- **Dev mode**: Auth bypassed. `getSession()` returns `{ email: "local@localhost" }`.
- **Production** (`ACCESS_TOKEN` set): Auth middleware auto-mounts. Cookie-based sessions in SQL.
- **Bring your own auth**: Pass a custom `getSession` to `autoMountAuth(app, { getSession })`.

## Server Plugins

6 default plugins auto-mount when your app doesn't have a custom version in `server/plugins/`:

| Plugin        | Default behavior                                  | Customize when                              |
| ------------- | ------------------------------------------------- | ------------------------------------------- |
| `agent-chat`  | Agent chat endpoints                              | Custom `mentionProviders` or `systemPrompt` |
| `auth`        | Auth middleware                                   | Custom `publicPaths` or Google OAuth config |
| `core-routes` | `/_agent-native/poll`, `/_agent-native/ping`, etc | Custom `envKeys` or `sseRoute`              |
| `file-sync`   | File watcher sync                                 | Custom sync config                          |
| `resources`   | Resource CRUD                                     | Rarely                                      |
| `terminal`    | Terminal emulator                                 | Rarely                                      |

Only create plugin files for plugins you need to customize. Let defaults auto-mount.

### Framework Route Namespace: `/_agent-native/`

All framework-level routes live under the `/_agent-native/` prefix to avoid collisions with template-specific `/api/*` routes. Templates should NEVER create routes under `/_agent-native/` — that namespace is reserved for the framework.

**Auto-mounted framework routes** (no template boilerplate needed):

| Route                                                         | Purpose                                  |
| ------------------------------------------------------------- | ---------------------------------------- |
| `GET /_agent-native/poll`                                     | Polling endpoint for DB change detection |
| `GET /_agent-native/events`                                   | SSE endpoint for real-time sync          |
| `GET /_agent-native/ping`                                     | Health check                             |
| `GET/PUT/DELETE /_agent-native/application-state/:key`        | Application state CRUD                   |
| `GET/PUT/DELETE /_agent-native/application-state/compose/:id` | Compose draft CRUD                       |
| `POST /_agent-native/agent-chat`                              | Agent chat SSE endpoint                  |
| `GET /_agent-native/agent-chat/mentions`                      | Mention search for @-tagging             |
| `GET /_agent-native/env-status`                               | Env key configuration status             |
| `POST /_agent-native/env-vars`                                | Save env vars                            |

Templates define their own routes under `/api/*` (e.g., `/api/emails`, `/api/forms`). Never put template routes under `/_agent-native/`.

## Project Structure

```
app/                   # React frontend
  root.tsx             # HTML shell + global providers
  routes/              # File-based page routes
  components/          # UI components
  hooks/               # React hooks (including use-navigation-state.ts)
server/                # Nitro API server
  routes/api/          # File-based API routes
  plugins/             # Server plugins (startup logic)
  db/                  # Drizzle schema + DB connection
scripts/               # Agent-callable scripts (view-screen, navigate, domain ops)
.agents/skills/        # Agent skills — detailed guidance for patterns
```

## Skills

Agent skills in `.agents/skills/` provide detailed guidance. Read the relevant skill before making changes.

| Skill                 | When to use                                                   |
| --------------------- | ------------------------------------------------------------- |
| `storing-data`        | Adding data models, reading/writing config or state           |
| `real-time-sync`      | Wiring polling sync, debugging UI not updating, jitter issues |
| `delegate-to-agent`   | Delegating AI work from UI or scripts to the agent            |
| `scripts`             | Creating or running agent scripts                             |
| `self-modifying-code` | Editing app source, components, or styles                     |
| `create-skill`        | Adding new skills for the agent                               |
| `capture-learnings`   | Recording corrections and patterns                            |
| `frontend-design`     | Building or styling any web UI, components, or pages          |
| `adding-a-feature`    | Adding any new feature (the four-area checklist)              |
| `context-awareness`   | Exposing UI state to the agent, view-screen pattern           |
| `a2a-protocol`        | Enabling inter-agent communication                            |

**Always use shadcn/ui components** for standard UI patterns. Check `app/components/ui/` before building custom UI elements.

**Always use Tabler Icons** (`@tabler/icons-react`) for all icons. Never use other icon libraries.

## Scripts

Create `scripts/my-script.ts`:

```ts
import { parseArgs } from "@agent-native/core";
export default async function (args: string[]) {
  const { name } = parseArgs(args);
  // do work
}
```

Run with: `pnpm script my-script --name foo`

### Core Scripts (available automatically)

| Script      | Purpose                         | Example                                            |
| ----------- | ------------------------------- | -------------------------------------------------- |
| `db-schema` | Show all tables, columns, types | `pnpm script db-schema`                            |
| `db-query`  | Run a SELECT query              | `pnpm script db-query --sql "SELECT * FROM forms"` |
| `db-exec`   | Run INSERT/UPDATE/DELETE        | `pnpm script db-exec --sql "UPDATE forms SET ..."` |

Per-user data scoping is automatic in production mode via `AGENT_USER_EMAIL`.

## Conventions

- **TypeScript everywhere** — all code must be `.ts`/`.tsx`. Never `.js` or `.mjs`.
- **Prettier** — run `npx prettier --write <files>` after modifying source files.
- **Client-side rendering** — all app content renders client-side via the `ClientOnly` wrapper in `root.tsx`.
- **No inline SVGs** — use Tabler Icons from `@tabler/icons-react`.
- **No browser dialogs** — use shadcn AlertDialog instead of `window.confirm/alert/prompt`.
