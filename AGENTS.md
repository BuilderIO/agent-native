# Agent-Native Framework

## What This Is

Agent-native is a framework for building apps where an AI agent is a first-class citizen alongside the UI. Think Next.js, but the AI agent can read data, write data, run scripts, and even modify the app's own code.

## The Six Rules

Every agent-native app follows these rules. Violating them breaks the architecture.

### 1. Data lives in SQL

All app state lives in SQL via Drizzle ORM or the core SQL stores. **The database is NOT always SQLite.** Users configure `DATABASE_URL` to any supported provider — Neon Postgres, Turso, Supabase, Cloudflare D1, plain Postgres, or SQLite. In local dev without `DATABASE_URL`, SQLite (`data/app.db`) is used as a fallback, but **never assume SQLite**. Many users (including the project maintainer) use Neon Postgres in both dev and production.

**All SQL must be dialect-agnostic.** Use the `getDbExec()` abstraction from `@agent-native/core/db/client` which handles parameter conversion (`?` → `$1`) and dialect differences automatically. For syntax that differs between SQLite and Postgres (e.g., `INSERT OR REPLACE` vs `ON CONFLICT DO UPDATE`, `INTEGER` vs `BIGINT`), use the helpers: `isPostgres()`, `intType()`. Never write raw SQLite-only syntax.

The framework is multi-tenant — multiple users share the same database, with data isolation handled by user-scoped keys and `AGENT_USER_EMAIL`.

**Core SQL stores** (auto-created, available in all templates):

- `application_state` — ephemeral UI state (via `@agent-native/core/application-state`)
- `settings` — persistent KV config (via `@agent-native/core/settings`)
- `oauth_tokens` — OAuth credentials (via `@agent-native/core/oauth-tokens`)
- `sessions` — auth sessions

**Do:** Use Drizzle for structured domain data (forms, bookings, compositions). Use the `settings` store for app config. Use `application-state` for ephemeral UI state. Use `oauth-tokens` for credentials. Use `isPostgres()` to branch SQL when dialects differ.
**Don't:** Use JSON files for data storage. Don't use localStorage for app state. Don't store state only in memory. **Don't assume SQLite** — always write SQL that works on both SQLite and Postgres.

### 2. All AI goes through the agent chat

The UI never calls an LLM directly. When the user wants AI to do something, the UI sends a message to the agent via the chat bridge (`sendToAgentChat()`). The agent does the work and writes results to the database.

**Do:** Use `sendToAgentChat()` from the client, `agentChat.submit()` from scripts.
**Don't:** Import an AI SDK in client or server code. No `openai.chat()`, no `anthropic.messages()`, no inline LLM calls anywhere.

### 3. Scripts for agent operations

When the agent needs to do something — query data, call APIs, process information — it runs a script via `pnpm script <name>`. Scripts live in `scripts/` and export a default async function. **Everything the UI can do, the agent can do via scripts and the shared database.**

**Do:** Create focused scripts for discrete operations. Parse args with `parseArgs()`. Use scripts to list, search, create, and manage data — not just for background tasks.
**Don't:** Put complex logic inline in agent chat. Keep scripts small and composable. Don't say "I don't have access" — check the scripts and database first.

### 4. Polling keeps the UI in sync

Database changes are synced to the UI via lightweight polling. When the agent writes to the database (application state, settings, or domain data), a version counter increments. The client `useFileWatcher()` hook polls `/api/poll` every 2 seconds and invalidates React Query caches when changes are detected. Events have a `source` field: `"app-state"`, `"settings"`, or `"resources"`. This works in all deployment environments including serverless and edge.

### 5. The agent can modify code

The agent can edit the app's own source code — components, routes, styles, scripts. This is a feature. Design your app expecting this.

### 6. Application state in SQL

Ephemeral UI state lives in the `application_state` SQL table, keyed by session ID and key. Both the agent and the UI can read and write application state. When the agent writes state (e.g., a compose draft), the UI reacts via polling and updates accordingly. When the user interacts with the UI, changes are written back so the agent can read them.

**Do:** Use `writeAppState(key, value)` from scripts, `appStatePut(sessionId, key, value)` from server code. Use `readAppState(key)` to read state.
**Don't:** Use application-state for persistent data — use the `settings` store instead. Don't store secrets here.

**Script helpers** (from `@agent-native/core/application-state`):

- `readAppState(key)` — read state for current session
- `writeAppState(key, value)` — write state (triggers UI sync)
- `deleteAppState(key)` — delete state (triggers UI sync)
- `listAppState(prefix)` — list state by key prefix

## Authentication

Auth is automatic and environment-driven. Templates include a `server/plugins/auth.ts` Nitro plugin that calls `autoMountAuth(app)` at startup.

- **Dev mode** (`NODE_ENV !== "production"`): Auth is bypassed. `getSession()` returns `{ email: "local@localhost" }`. No login page.
- **Production** (`ACCESS_TOKEN` set): Auth middleware mounts automatically. Login page for unauthenticated visitors. Cookie-based sessions stored in SQL.
- **Production** (no token, no `AUTH_DISABLED=true`): Server refuses to start with a clear error.

**Key APIs:**

- Server: `getSession(event)` from `@agent-native/core/server` — returns `AuthSession | null`
- Client: `useSession()` from `@agent-native/core` — returns `{ session, isLoading }`
- Routes: `GET /api/auth/session`, `POST /api/auth/login`, `POST /api/auth/logout`

**Bring your own auth**: Pass a custom `getSession` function to `autoMountAuth(app, { getSession: ... })` to plug in Auth.js, Clerk, or any auth system. Templates don't change.

See [docs/auth.md](docs/auth.md) for the full guide.

## Project Structure

```
app/                   # React frontend
  root.tsx             # HTML shell + global providers
  entry.client.tsx     # Client hydration entry
  routes.ts            # Route config — flatRoutes()
  routes/              # File-based page routes (auto-discovered)
  components/          # UI components
  hooks/               # React hooks
  lib/                 # Utilities
server/                # Nitro API server
  routes/
    api/               # File-based API routes (auto-discovered)
    [...page].get.ts   # SSR catch-all (delegates to React Router)
  plugins/             # Server plugins (startup logic, DB migrations)
  db/                  # Drizzle schema + DB connection (getDb singleton)
  lib/                 # Shared server modules
  handlers/            # Route handler modules (for larger apps)
shared/                # Isomorphic code (client + server)
scripts/               # Agent-callable scripts
data/                  # App data (local SQLite fallback at data/app.db)
react-router.config.ts # React Router framework config
```

## Client-Side-First Rendering

All app content renders **client-side only**. The server renders only the HTML shell (`<html>`, `<head>` with meta tags, `<body>` with scripts) plus a loading spinner. This is enforced by the `ClientOnly` wrapper in every template's `root.tsx`:

```tsx
import { ClientOnly, DefaultSpinner } from "@agent-native/core/client";

export default function Root() {
  return (
    <ClientOnly fallback={<DefaultSpinner />}>
      {/* All providers and <Outlet /> go inside ClientOnly */}
    </ClientOnly>
  );
}
```

**Why:** This prevents hydration mismatches. The server never renders app components, so `window`, `localStorage`, `new Date()`, `next-themes`, and any browser API are safe to use anywhere in app code.

**Do:** Keep the `ClientOnly` wrapper in `root.tsx`. Use `window`, `localStorage`, browser APIs freely in components.
**Don't:** Remove `ClientOnly` from `root.tsx`. Don't add server-side data fetching in route loaders (use React Query client-side instead).

Route `meta()` functions still work for SEO — they're resolved at the `Layout` level which is server-rendered.

## Scripts

Create `scripts/my-script.ts`:

```ts
import { parseArgs } from "@agent-native/core";
export default async function (args: string[]) {
  const { name } = parseArgs(args);
  // do work — query DB, call APIs
}
```

Run with: `pnpm script my-script --name foo`

## Database Scripts (Core)

These core scripts are available automatically — no local script files needed:

| Script      | Purpose                         | Example                                            |
| ----------- | ------------------------------- | -------------------------------------------------- |
| `db-schema` | Show all tables, columns, types | `pnpm script db-schema`                            |
| `db-query`  | Run a SELECT query              | `pnpm script db-query --sql "SELECT * FROM forms"` |
| `db-exec`   | Run INSERT/UPDATE/DELETE        | `pnpm script db-exec --sql "UPDATE forms SET ..."` |

Use `db-schema` first to understand the data model, then `db-query` and `db-exec` to read and write data. Scripts read `DATABASE_URL` from env (Postgres, Turso, or SQLite — falls back to `file:./data/app.db` only when unset). Use `--db <path>` to override, and `--format json` for structured output.

### Multi-tenant data scoping

In production mode, `db-query` and `db-exec` automatically scope data to the current user (`AGENT_USER_EMAIL`). This is transparent — the agent's SQL runs unmodified, but only sees/affects the current user's rows.

**How it works:** Before running the agent's SQL, temporary views are created that shadow real tables with a `WHERE` filter on the user's identity. Temp views take precedence over real tables in both SQLite and Postgres, so the SQL runs against filtered data.

**Convention for template tables:** Add an `owner_email TEXT` column to any table that stores per-user data. The scoping system will automatically detect it and filter.

**Core tables** are handled automatically with their existing scoping patterns:

- `settings` — filtered by key prefix (`u:<email>:`)
- `application_state` — filtered by `session_id`
- `oauth_tokens` — filtered by `owner`
- `sessions` — filtered by `email`

For `db-exec` INSERTs, `owner_email` is auto-injected if the target table uses the convention and the column isn't already in the statement.

In dev mode, no scoping is applied — all data is visible.

Local scripts in `scripts/` always take priority over core scripts. Run `pnpm script --help` to see all available scripts.

## TypeScript Everywhere

All code in this project — including standalone scripts in `scripts/` — must be TypeScript (`.ts`). Never use `.js` or `.mjs` files. Node 22+ runs `.ts` files natively via type stripping (`node scripts/foo.ts`), so no compilation step or `tsx` is needed for scripts.

## Prettier After Writing Files

After writing or modifying any source file (`.ts`, `.tsx`, `.js`, `.jsx`, `.json`, `.css`, `.md`, `.yaml`, `.yml`, `.html`), always run Prettier on those specific files before committing:

```bash
npx prettier --write path/to/file1.ts path/to/file2.tsx
```

This keeps CI green — the `fmt:check` step in CI will reject unformatted code. Run Prettier on the specific files you changed, not the entire repo.

## Image Output

Never save screenshots, images, or other binary artifacts to the repository root or directly inside package directories. Save them to a temporary directory or use an ephemeral path.

## Skills

Agent skills in `.agents/skills/` provide detailed guidance for architectural rules and design patterns. Read the relevant skill before making changes.

| Skill                 | When to use                                          |
| --------------------- | ---------------------------------------------------- |
| `storing-data`        | Adding data models, reading/writing config or state  |
| `real-time-sync`      | Wiring polling sync, debugging UI not updating       |
| `delegate-to-agent`   | Delegating AI work from UI or scripts to the agent   |
| `scripts`             | Creating or running agent scripts                    |
| `self-modifying-code` | Editing app source, components, or styles            |
| `create-skill`        | Adding new skills for the agent                      |
| `capture-learnings`   | Recording corrections and patterns                   |
| `frontend-design`     | Building or styling any web UI, components, or pages |
| `ship`                | Commit, prep, push, check CI, fix PR feedback        |

The **`frontend-design`** skill (sourced from [Anthropic's skills library](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)) applies whenever the agent generates or modifies UI. It enforces distinctive, production-grade aesthetics — avoiding generic AI-generated design patterns like purple gradients, overused fonts, and cookie-cutter layouts.

**Always use shadcn/ui components** for standard UI patterns — Tabs, Dialog, Button, DropdownMenu, Select, Popover, Input, Textarea, Badge, Card, etc. Every template includes shadcn components in `app/components/ui/`. Never create custom one-off implementations when a shadcn component exists. Check `app/components/ui/` before building custom UI elements.

## Icons

Always use **Tabler Icons** (`@tabler/icons-react`) for all icons in the core client package.
Never define custom inline SVG icon components. Import directly from the library:

```tsx
import { IconMessage, IconPlus, IconX } from "@tabler/icons-react";

// Usage — pass size and className as needed:
<IconMessage size={14} className="text-muted-foreground" />;
```

Browse available icons at https://tabler.io/icons
