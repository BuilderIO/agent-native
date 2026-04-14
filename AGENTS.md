# Agent-Native Framework

## Core Philosophy

Agent-native is a framework for building apps where the AI agent and the UI are equal partners. Everything the UI can do, the agent can do. Everything the agent can do, the UI can do. They share the same database, the same state, and they always stay in sync.

You don't think about "the agent" and "the app" separately — you think about them together. A feature isn't complete until both the UI and the agent can use it. A compose email flow has a UI for the user AND actions the agent calls. A calendar event can be created from the UI OR by the agent, and either way the other side sees it immediately.

The agent can also see what the user is looking at. If an email is open, the agent knows which email. If a slide is selected, the agent knows which slide. If the user selects text and hits Cmd+I to focus the agent, the agent knows what text is selected and can act on just that.

## When Adding a Feature

Every new feature or integration MUST update all four areas. Skipping any one breaks the agent-native contract:

1. **UI** — The user-facing interface (component, route, page)
2. **Actions** — Operations in `actions/` using `defineAction`. Actions serve double duty: the agent calls them as tools, and the frontend calls them as HTTP endpoints at `/_agent-native/actions/:name`. You typically don't need separate `/api/` routes anymore.
3. **Skills / Instructions** — Update AGENTS.md and/or create skills if the feature introduces new patterns the agent needs to know
4. **Application State** — Expose navigation and selection state so the agent knows what the user is looking at

This applies to every feature: a new form builder, a new chart type, a new email filter. If the UI has it, there's an action for it. If the agent needs context, app-state provides it. If there's a non-obvious pattern, a skill documents it.

When a user configures local MCP servers in `mcp.config.json` (see [mcp-clients](./packages/docs/content/mcp-clients.md)), their tools appear in the agent's registry with the `mcp__<server-id>__` prefix and are usable like any other action. Design features to compose with those tools — e.g. a browser-automation workflow can delegate to `mcp__claude-in-chrome__navigate` / `click` if present rather than reimplementing every capability in-template.

### Onboarding

If the feature requires user-facing setup (API keys, OAuth, connecting a third-party service), register an onboarding step so it shows up in the agent sidebar's setup checklist:

```ts
import { registerOnboardingStep } from "@agent-native/core/onboarding";

registerOnboardingStep({
  id: "gmail",
  order: 100,
  title: "Connect Gmail",
  description: "Grant read/send access.",
  methods: [
    {
      id: "oauth",
      kind: "link",
      primary: true,
      label: "Sign in with Google",
      payload: { url: "/_agent-native/google/auth-url" },
    },
  ],
  isComplete: () => !!process.env.GMAIL_REFRESH_TOKEN,
});
```

See `packages/docs/content/onboarding.md` for method kinds and built-in steps.

## Context Awareness

The agent must always know what the user is currently viewing. This is achieved through two mechanisms:

### Navigation State

The UI writes a `navigation` key to application-state on every route change:

```json
{ "view": "thread", "threadId": "abc123", "subject": "Re: Q3 Planning" }
```

The agent reads this before taking action: `readAppState("navigation")`.

### Auto-Injected Screen Context

The framework automatically runs the template's `view-screen` action before each agent chat message and includes the result as a `<current-screen>` block in the user's message. This means the agent always knows what the user is looking at without needing to call `view-screen` explicitly. If no `view-screen` action is registered, the raw navigation state is included instead.

### The view-screen Action

Every template should have a `view-screen` action that reads navigation state, fetches the relevant data, and returns a snapshot of what the user sees. This action is automatically called by the framework to provide context — agents only need to call it manually for a refreshed snapshot mid-conversation.

### The navigate Action

Every template should have a `navigate` action that writes a one-shot command to application-state, letting the agent switch views, open items, or focus elements. The UI processes the command and clears it.

### Jitter Prevention

When the agent writes to application-state, the UI updates via polling. But polling must NOT override the user's active edits. Only explicit agent writes should push changes to the UI. Templates use the `ignoreSource` option on `useDbSync()` with a per-tab ID so the UI ignores its own writes while still picking up agent and other-tab changes.

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

### 3. Actions Are the Single Source of Truth

Actions are the **single source of truth** for all app operations. Define them once in `actions/` — the agent calls them as tools, and the framework auto-exposes them as HTTP endpoints at `/_agent-native/actions/:name` for the frontend.

```
┌─────────────┐     ┌─────────────────────────────────┐     ┌─────────────┐
│  Frontend   │     │         actions/                 │     │  AI Agent   │
│  (React)    │────▶│  defineAction({ run, http })     │◀────│  (Claude)   │
│             │     │                                  │     │             │
│ useAction   │     │  Single source of truth for      │     │ Tool calls  │
│ Query/      │     │  all app operations              │     │             │
│ Mutation    │     └─────────────────────────────────┘     └─────────────┘
│             │       │                           │
│             │       ▼                           ▼
│             │  /_agent-native/actions/:name   Agent tool
│             │  (auto-mounted HTTP)            invocation
└─────────────┘
```

**Everything the UI can do, the agent can do — through the same action.** No more duplicating logic between `/api/` routes and actions.

### 4. Polling Keeps the UI in Sync

Database changes sync to the UI via polling. The client `useDbSync()` hook polls `/_agent-native/poll` every 2 seconds and invalidates React Query caches when changes are detected. This works in all deployment environments including serverless and edge.

### 5. The Agent Can Modify Code

The agent can edit the app's own source code — components, routes, styles, actions. This is a feature. Design your app expecting this.

### 6. Application State in SQL

Ephemeral UI state lives in the `application_state` table. Both agent and UI read and write it. When the agent writes state (e.g., a draft), the UI reacts via polling. When the user interacts with the UI, changes are written back so the agent can read them.

**Action helpers** (from `@agent-native/core/application-state`):

- `readAppState(key)` — read state for current session
- `writeAppState(key, value)` — write state (triggers UI sync)
- `deleteAppState(key)` — delete state
- `listAppState(prefix)` — list state by key prefix

## Portability

**This is a hard requirement. Never write code that only works on one database or one hosting platform.**

### Database Agnostic

The framework supports all SQL databases via Drizzle ORM. Templates must work with SQLite (the default when `DATABASE_URL` is unset) AND Postgres (when `DATABASE_URL` points to a Postgres instance) without any code changes.

**Use the dialect-agnostic schema helpers** from `@agent-native/core/db/schema`:

```ts
import {
  table,
  text,
  integer,
  real,
  now,
  sql,
} from "@agent-native/core/db/schema";

export const meals = table("meals", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  calories: integer("calories").notNull(),
  weight: real("weight"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(now()),
});
```

Available helpers:

| Helper    | Purpose                                                                                   |
| --------- | ----------------------------------------------------------------------------------------- |
| `table`   | Define a table — delegates to `pgTable` or `sqliteTable` based on dialect                 |
| `text`    | Text column — works identically in both dialects, supports `{ enum: [...] }`              |
| `integer` | Integer column — `{ mode: "boolean" }` maps to Postgres `boolean` automatically           |
| `real`    | Float column — maps to `real` on SQLite, `double precision` on Postgres                   |
| `now`     | Dialect-agnostic current timestamp — use with `.default(now())` on text timestamp columns |
| `sql`     | Re-exported from `drizzle-orm` for raw SQL expressions                                    |

**NEVER import from `drizzle-orm/sqlite-core` or `drizzle-orm/pg-core` directly in template code.** These are internal to the framework's schema adapter. Always use `@agent-native/core/db/schema` instead.

Other framework helpers for raw SQL:

- `getDbExec()` — auto-converts `?` params to `$1` for Postgres
- `isPostgres()` — runtime dialect check
- `intType()` — returns correct integer type for the dialect

Never write SQLite-only syntax (`INSERT OR REPLACE`, `AUTOINCREMENT`, `datetime('now')`). When writing docs, say "SQL database" — not "SQLite".

### Hosting Agnostic

The server runs on **Nitro** with **H3** as the HTTP framework. It compiles to any deployment target: Node.js, Cloudflare Workers/Pages, Netlify, Vercel, Deno Deploy, AWS Lambda, Bun. Templates must be deployable to any Nitro-supported target without code changes.

**Never use Express.** All server code uses H3/Nitro — `defineEventHandler`, `readBody`, `getMethod`, `setResponseHeader`, etc. Express is not a dependency. If you see Express types or patterns anywhere, replace them with H3 equivalents.

**Never put platform-specific config files inside templates.** Files like `netlify.toml`, `wrangler.toml`, `vercel.json`, and `netlify/functions/` do not belong in template source. Platform configuration lives in CI/hosting dashboards or in deployment-specific repos, not in the template.

Never use Node-specific APIs (`fs`, `child_process`, `path`) in server routes and plugins. Use Nitro abstractions. Actions in `actions/` run in Node.js and can use Node APIs freely.

Never assume a persistent server process. Use the SQL database for all state.

## Data Scoping

In production mode, the framework automatically restricts agent SQL queries (via `db-query` and `db-exec`) to the current user's data using temporary views. This is enforced at the SQL level — agents cannot bypass it.

### Per-User Scoping (`owner_email`)

Every template table that stores user-specific data **must** have an `owner_email` text column. The framework:

1. Detects tables with `owner_email` via schema introspection
2. Creates temp views with `WHERE owner_email = <current user>` before each query
3. Auto-injects `owner_email` into INSERT statements

The current user is resolved from `AGENT_USER_EMAIL` (set automatically from the session).

### Per-Org Scoping (`org_id`)

For multi-org apps (e.g., recruiting), tables can also include an `org_id` text column. When `AGENT_ORG_ID` is set:

1. Tables with `org_id` get an additional `WHERE org_id = <current org>` clause
2. When both `owner_email` and `org_id` are present, both filters apply (AND)
3. `org_id` is auto-injected into INSERT statements

Templates enable org scoping by providing a `resolveOrgId` callback in their agent-chat plugin:

```ts
createAgentChatPlugin({
  resolveOrgId: async (event) => {
    const ctx = await getOrgContext(event);
    return ctx.orgId;
  },
});
```

### Schema Validation

Run `pnpm action db-check-scoping` to verify all template tables have proper ownership columns. Use `--require-org` for multi-org apps. Tables without scoping columns are accessible to all users.

### Column Conventions

| Column        | Purpose                 | Required                        |
| ------------- | ----------------------- | ------------------------------- |
| `owner_email` | Per-user data isolation | Yes, for all user-facing tables |
| `org_id`      | Per-org data isolation  | Yes, for multi-org apps         |

**Hard rule: every new template table with user data must have `owner_email`.** Multi-org templates must also include `org_id`.

## A2A Protocol (Agent-to-Agent)

Agents can call other agents using the A2A protocol. From the mail app, you can tag the analytics agent to query data and include results in a draft. An agent discovers what other agents are available, calls them over the protocol, and shows results in the UI.

### Auto-Mounted A2A

A2A is **auto-mounted** by the agent-chat plugin. Every app automatically gets:

- `GET /.well-known/agent-card.json` — public agent card with skills derived from registered scripts
- `POST /_agent-native/a2a` — JSON-RPC endpoint

No setup needed. The agent card is auto-generated from your template's scripts. For custom configuration, use `mountA2A()` from `@agent-native/core/a2a` in a server plugin.

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

## Real-Time Collaboration

The framework provides multi-user collaborative editing via Yjs CRDT, allowing the AI agent and multiple human users to edit the same document simultaneously — like Google Docs or Notion.

### How It Works

- **Yjs Y.Doc** stores the document as a `Y.XmlFragment` (ProseMirror node tree)
- **TipTap's Collaboration extension** binds the editor to the Y.XmlFragment via `ySyncPlugin`
- **CollaborationCaret extension** renders remote users' cursors with names and colors
- **Polling** (every 2s) syncs Y.Doc updates and awareness state between clients and server
- **SQL `_collab_docs` table** persists Yjs state as base64-encoded binary (works across SQLite/Postgres)

### Agent + Human Real-Time Collaboration

The agent and human users are equal participants in collaborative editing:

1. **Human edits** flow through TipTap → ySyncPlugin → Y.XmlFragment → server via `POST /_agent-native/collab/:docId/update`
2. **Agent edits** flow through `edit-document` action → server search-replace endpoint → Y.XmlFragment mutation → poll update → all clients
3. Both produce minimal Yjs operations that merge cleanly — the agent's edits appear in the user's editor without destroying their cursor position, selection, or undo history

The `edit-document` action uses surgical search-and-replace on Y.XmlText nodes within the Y.XmlFragment tree, producing the smallest possible Yjs update. This is more efficient than regenerating entire documents.

### Enabling Collaboration

Templates opt into collaboration by:

1. Installing `@tiptap/extension-collaboration`, `@tiptap/extension-collaboration-caret`, `@tiptap/y-tiptap`
2. Adding a collab server plugin: `createCollabPlugin({ table, contentColumn, idColumn })`
3. Using the `useCollaborativeDoc` client hook for Y.Doc management
4. Adding Collaboration + CollaborationCaret extensions to TipTap
5. Adding the packages to `optimizeDeps.include` in `vite.config.ts`

See the `real-time-collab` skill for detailed setup instructions and common pitfalls.

### Collab Routes

All collab routes are auto-mounted under `/_agent-native/collab/`:

| Route                                              | Purpose                                |
| -------------------------------------------------- | -------------------------------------- |
| `GET /_agent-native/collab/:docId/state`           | Fetch full Y.Doc state                 |
| `POST /_agent-native/collab/:docId/update`         | Apply client Yjs update                |
| `POST /_agent-native/collab/:docId/text`           | Apply full text (diff-based)           |
| `POST /_agent-native/collab/:docId/search-replace` | Surgical find/replace in Y.XmlFragment |
| `POST /_agent-native/collab/:docId/awareness`      | Sync cursor/presence state             |
| `GET /_agent-native/collab/:docId/users`           | List active users                      |

## All-Agent Support

AGENTS.md is the universal standard for agent instructions. It works with any AI coding tool. The framework auto-creates symlinks so all tools read the same instructions:

- `CLAUDE.md` → `AGENTS.md` (Claude Code)
- `.cursorrules` → `AGENTS.md` (Cursor)
- `.windsurfrules` → `AGENTS.md` (Windsurf)
- `.claude/skills/` → `.agents/skills/` (Claude Code skills)

Run `agent-native setup-agents` to create all symlinks, or they're created automatically by `agent-native create`.

## Authentication

Auth is powered by **Better Auth** with account-first design. Users create an account on first visit.

- **Development mode**: Auth is automatically bypassed. `getSession()` falls back to `{ email: "local@localhost" }` when no other auth method succeeds — no configuration needed.
- **Default (production)**: Better Auth with email/password + social providers (Google, GitHub). Organizations built in.
- **`AUTH_MODE=local`**: Explicit escape hatch for any environment. `getSession()` returns `{ email: "local@localhost" }`. Set in `.env` or via the onboarding page's "Use locally" button.
- Upgrading from `local@localhost` to a real account should preserve SQL-backed workspace data. The built-in migration moves `application_state`, user-scoped `settings`, `oauth_tokens`, and any template table that uses `owner_email`. Templates with legacy global settings can also provide an app-level `POST /api/local-migration` route for one-time re-homing during the upgrade flow.
- **`ACCESS_TOKEN`/`ACCESS_TOKENS`**: Simple token-based auth for production deployments.
- **Bring your own auth**: Pass a custom `getSession` to `autoMountAuth(app, { getSession })`.
- **`AUTH_DISABLED=true`**: Skip auth entirely (for apps behind infrastructure-level auth like Cloudflare Access).

### Organizations

Better Auth's organization plugin is built into the framework. Every app supports creating orgs, inviting members, and role-based access (owner/admin/member). The active organization flows automatically: `session.orgId` → `AGENT_ORG_ID` → SQL scoping.

### Builder Browser Access

Apps can connect to Builder through the `cli-auth` flow and persist shared browser credentials in `.env`. When connected, agents can use the built-in `get-browser-connection` tool to provision a real browser session via AI Services without each app wiring a separate browser integration.

### A2A Identity

Set `A2A_SECRET` (same value) on all apps that need to verify each other's identity. Outbound A2A calls are signed with JWTs; inbound calls are verified cryptographically. Without `A2A_SECRET`, A2A calls are unauthenticated (fine for local dev).

## Server Plugins

5 default plugins auto-mount when your app doesn't have a custom version in `server/plugins/`:

| Plugin        | Default behavior                                  | Customize when                              |
| ------------- | ------------------------------------------------- | ------------------------------------------- |
| `agent-chat`  | Agent chat endpoints                              | Custom `mentionProviders` or `systemPrompt` |
| `auth`        | Auth middleware                                   | Custom `publicPaths` or Google OAuth config |
| `core-routes` | `/_agent-native/poll`, `/_agent-native/ping`, etc | Custom `envKeys` or `sseRoute`              |
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
| `/_agent-native/auth/*`                                       | Authentication (login, session, logout)  |
| `/_agent-native/google/*`                                     | Google OAuth (callback, auth-url, etc.)  |
| `/_agent-native/resources/*`                                  | Resource CRUD                            |
| `/_agent-native/actions/:name`                                | Auto-mounted action endpoints            |
| `/_agent-native/available-clis`                               | Available CLI tools                      |
| `/_agent-native/agent-terminal-info`                          | Terminal connection info                 |

**Hard rule: ALL framework routes go under `/_agent-native/`.** Templates own `/api/*` for their domain routes. Never put framework routes under `/api/`. Never put template routes under `/_agent-native/`.

**Actions-first approach:** For standard CRUD and data operations, use `defineAction` in `actions/` — the framework auto-mounts them as HTTP endpoints. Only create custom `/api/*` routes for things actions can't do: file uploads with multipart form data, streaming responses, webhooks from external services, or OAuth callbacks.

The Nitro Vite plugin handles both `/api/` and `/_agent-native/` prefixes via file-based routing in `server/routes/`. If you add a new framework route prefix, add routes under the appropriate `server/routes/` directory.

## Project Structure

```
app/                   # React frontend
  root.tsx             # HTML shell + global providers
  routes/              # File-based page routes
  components/          # UI components
  hooks/               # React hooks (including use-navigation-state.ts)
server/                # Nitro API server
  routes/api/          # Custom API routes (file uploads, streaming, webhooks only)
  plugins/             # Server plugins (startup logic)
  db/                  # Drizzle schema + DB connection
actions/               # App operations (agent tools + auto-mounted HTTP endpoints)
.generated/            # Auto-generated types (action-types.d.ts) — gitignored
.agents/skills/        # Agent skills — detailed guidance for patterns
```

## Skills

Agent skills in `.agents/skills/` provide detailed guidance. Read the relevant skill before making changes.

| Skill                 | When to use                                                   |
| --------------------- | ------------------------------------------------------------- |
| `storing-data`        | Adding data models, reading/writing config or state           |
| `real-time-sync`      | Wiring polling sync, debugging UI not updating, jitter issues |
| `delegate-to-agent`   | Delegating AI work from UI or actions to the agent            |
| `actions`             | Creating or running agent actions                             |
| `self-modifying-code` | Editing app source, components, or styles                     |
| `create-skill`        | Adding new skills for the agent                               |
| `capture-learnings`   | Recording corrections and patterns                            |
| `frontend-design`     | Building or styling any web UI, components, or pages          |
| `adding-a-feature`    | Adding any new feature (the four-area checklist)              |
| `context-awareness`   | Exposing UI state to the agent, view-screen pattern           |
| `a2a-protocol`        | Enabling inter-agent communication                            |
| `real-time-collab`    | Multi-user collaborative editing with Yjs CRDT + live cursors |
| `security`            | Data scoping (owner_email, org_id), auth model, A2A security  |

**Always use shadcn/ui components** for standard UI patterns. Check `app/components/ui/` before building custom UI elements.

**Always use Tabler Icons** (`@tabler/icons-react`) for all icons. Never use other icon libraries.

## Recurring Jobs

The framework supports recurring jobs — scheduled tasks that the agent executes automatically on a cron schedule. Jobs are stored as resource files under `jobs/` with YAML frontmatter for scheduling metadata.

### How it works

1. User asks for something recurring via the agent chat
2. Agent uses `create-job` tool to write a job file at `jobs/<name>.md`
3. A scheduler polls every 60 seconds, finds due jobs, and executes them via `runAgentLoop`
4. Job results are saved as chat threads

### Job tools (built into the framework)

| Tool         | Purpose                                                    |
| ------------ | ---------------------------------------------------------- |
| `create-job` | Create a recurring job (name, cron schedule, instructions) |
| `list-jobs`  | List all jobs and their status                             |
| `update-job` | Update schedule, instructions, or toggle enabled           |

### Key files

| File                                  | Purpose                                                  |
| ------------------------------------- | -------------------------------------------------------- |
| `packages/core/src/jobs/cron.ts`      | Cron parsing (nextOccurrence, isValidCron, describeCron) |
| `packages/core/src/jobs/scheduler.ts` | Job execution engine (processRecurringJobs)              |
| `packages/core/src/jobs/tools.ts`     | Agent tools (create-job, list-jobs, update-job)          |

### Auto-Memory

The agent proactively saves learnings to `LEARNINGS.md` when users correct it, share preferences, or reveal patterns. This is part of the system prompt in `agent-chat-plugin.ts` (FRAMEWORK_CORE section).

## Actions

Actions are the primary way to add operations to your app. Define them once — the agent calls them as tools, and the framework auto-exposes them as HTTP endpoints at `/_agent-native/actions/:name`.

Create `actions/list-events.ts`:

```ts
import { z } from "zod";
import { defineAction } from "@agent-native/core";

export default defineAction({
  description: "List calendar events",
  schema: z.object({
    from: z.string().describe("Start date (ISO)"),
    to: z.string().describe("End date (ISO)"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    // args is fully typed: { from: string; to: string }
    const events = await fetchEvents(args.from, args.to);
    return events;
  },
});
```

The `schema` field accepts a Zod schema (or any Standard Schema-compatible library like Valibot or ArkType). It provides runtime validation, TypeScript type inference for `run()` args, and auto-generated JSON Schema for the agent's tool definition. `zod` is a dependency of all templates.

Use `.describe()` for parameter descriptions, `.optional()` for optional params, and `z.coerce.number()` / `z.coerce.boolean()` for params that arrive as strings from HTTP. Invalid inputs get clear error messages (400 for HTTP, error result for agent).

The legacy `parameters` field (plain JSON Schema) still works as a fallback but does not provide runtime validation or type inference.

The agent calls this as a tool. The frontend calls it via `useActionQuery("list-events", { from, to })`.

### Action HTTP Options

| Option                     | Effect                                                        |
| -------------------------- | ------------------------------------------------------------- |
| _(omitted)_                | Auto-exposed as `POST /_agent-native/actions/:name` (default) |
| `http: { method: "GET" }`  | Exposed as `GET` — use for read-only actions                  |
| `http: false`              | Agent-only — never exposed as HTTP                            |
| `http: { path: "custom" }` | Override the route path (default is the action filename)      |

### Frontend Hooks (End-to-End Type Safety)

Action types are **automatically inferred** from the `defineAction` schema and return type — similar to tRPC. A Vite plugin generates `.generated/action-types.d.ts` which augments the `ActionRegistry` interface, giving `useActionQuery` and `useActionMutation` full type inference for action names, parameters, and return types.

```ts
import { useActionQuery, useActionMutation } from "@agent-native/core/client";

// Types are inferred from the action's schema + run() return type — no manual generic needed
const { data } = useActionQuery("list-events", { from, to });
//      ^? CalendarEvent[]  (inferred from actions/list-events.ts)

// Mutations too — params are typed from the Zod schema
const { mutate } = useActionMutation("create-event");
mutate({ title: "Standup", date: "2025-01-15" });
```

**Do NOT use manual type generics** like `useActionQuery<Event[]>(...)`. The types are inferred automatically. If you need to transform the data shape, use the `select` option instead.

The `.generated/action-types.d.ts` file is auto-generated by the Vite plugin on dev server start and when action files are added/removed. It's gitignored. The `tsconfig.json` `include` array must contain `".generated/**/*"` and `"actions/**/*"` for type inference to work.

`useActionQuery` wraps React Query's `useQuery`. `useActionMutation` wraps `useMutation` and auto-invalidates action query caches on success.

### Legacy Format

Actions can also use the legacy export format with `parseArgs`:

```ts
import { parseArgs } from "@agent-native/core";
export default async function (args: string[]) {
  const { name } = parseArgs(args);
  // do work
}
```

Run with: `pnpm action my-action --name foo`

Legacy actions are still auto-exposed as HTTP endpoints (POST by default). Use `defineAction` for new actions — it provides better typing, parameter validation, and explicit HTTP control.

### Core Actions (available automatically)

| Action             | Purpose                                                          | Example                                                                                         |
| ------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `db-schema`        | Show all tables, columns, types                                  | `pnpm action db-schema`                                                                         |
| `db-query`         | Run a SELECT query                                               | `pnpm action db-query --sql "SELECT * FROM forms"`                                              |
| `db-exec`          | Run INSERT/UPDATE/DELETE                                         | `pnpm action db-exec --sql "UPDATE forms SET ..."`                                              |
| `db-patch`         | Surgical search/replace on a large text column (token-efficient) | `pnpm action db-patch --table decks --column data --where "id='d1'" --find "Q3" --replace "Q4"` |
| `db-check-scoping` | Validate ownership columns exist                                 | `pnpm action db-check-scoping --require-org`                                                    |

Per-user data scoping is automatic in production mode via `AGENT_USER_EMAIL` — it applies to every one of these tools (including `db-patch`'s read and write).

#### When to pick which SQL tool

- **Short field or multi-column write** — use `db-exec UPDATE` (e.g. `SET status = 'published'`, or `SET calories = calories + 50`).
- **Change a small slice of a large text/JSON column** — use `db-patch`. Instead of re-sending the whole column (which burns tokens on multi-kilobyte documents, slide HTML, dashboard/form JSON), the agent sends `{find, replace}` pairs and the script applies them server-side. Targets exactly one row per call — narrow `--where` by primary key.
- **A template-specific action exists** (e.g. `edit-document`, `update-slide`) — always prefer that action. It encodes business rules and pushes live Yjs updates to any open collaborative editor; raw SQL does neither. `db-patch` is the generic fallback for tables without a bespoke edit action.
- **Read** — `db-query`. Don't re-add `WHERE owner_email = ...` — scoping already applies it.

## Security

These rules apply to ALL generated code. The framework provides strong security primitives — use them.

- **Input validation** — Use `defineAction` with a Zod `schema:` for every action. The framework validates input automatically and returns clear error messages. The legacy `parameters:` format has no runtime validation — do not use it for new code.
- **SQL injection** — Never concatenate user input into SQL strings. The framework's `db-query`/`db-exec` tools use parameterized queries (`?` placeholders). Drizzle ORM is always safe. If you must write raw SQL, use `{ sql: "... WHERE id = ?", args: [id] }`.
- **XSS** — Never use `dangerouslySetInnerHTML`, `innerHTML`, `eval()`, or `document.write()` with user-controlled content. React auto-escapes JSX by default — trust it. For rich text editing, use TipTap (framework dependency). For rendering markdown, use `react-markdown`.
- **Secrets** — API keys and credentials go in `.env` only (gitignored). OAuth tokens go in the `oauth_tokens` store via `saveOAuthTokens()`. Never store secrets in `settings`, `application_state`, source code, or action responses sent to the client.
- **Auth** — Use `defineAction` for all operations (auto-protected by the auth guard). If you must create custom `/api/` routes, always call `getSession(event)` and reject requests without a session. Never create unprotected routes that modify data.
- **Data scoping** — Every table with user data needs an `owner_email` column. The framework auto-scopes all queries in production so users only see their own data. Run `pnpm action db-check-scoping` to verify. Read the `security` skill for the full model.

## Conventions

- **Actions first** — for any new operation, create a `defineAction` in `actions/`. It serves both the agent (tool) and the frontend (HTTP endpoint). Only create `/api/` routes for special cases (file uploads, streaming, webhooks).
- **TypeScript everywhere** — all code must be `.ts`/`.tsx`. Never `.js` or `.mjs`.
- **Prettier** — run `npx prettier --write <files>` after modifying source files.
- **Client-side rendering** — all app content renders client-side via the `ClientOnly` wrapper in `root.tsx`.
- **No inline SVGs** — use Tabler Icons from `@tabler/icons-react`.
- **No browser dialogs** — use shadcn AlertDialog instead of `window.confirm/alert/prompt`.
