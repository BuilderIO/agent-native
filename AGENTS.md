# Agent-Native Framework

## What This Is

Agent-native is a framework for building apps where an AI agent is a first-class citizen alongside the UI. Think Next.js, but the AI agent can read data, write data, run scripts, and even modify the app's own code.

## The Six Rules

Every agent-native app follows these rules. Violating them breaks the architecture.

### 1. Data lives in SQL

All app state lives in SQLite (`data/app.db`) via Drizzle ORM or the core SQL stores. SQLite works locally out of the box and can be upgraded to a cloud database (Turso, Neon, Supabase, D1) by setting `DATABASE_URL`. Local and production behave identically — no filesystem dependency for data.

**Core SQL stores** (auto-created, available in all templates):

- `application_state` — ephemeral UI state (via `@agent-native/core/application-state`)
- `settings` — persistent KV config (via `@agent-native/core/settings`)
- `oauth_tokens` — OAuth credentials (via `@agent-native/core/oauth-tokens`)
- `sessions` — auth sessions

**Do:** Use Drizzle for structured domain data (forms, bookings, compositions). Use the `settings` store for app config. Use `application-state` for ephemeral UI state. Use `oauth-tokens` for credentials.
**Don't:** Use JSON files for data storage. Don't use localStorage for app state. Don't store state only in memory.

### 2. All AI goes through the agent chat

The UI never calls an LLM directly. When the user wants AI to do something, the UI sends a message to the agent via the chat bridge (`sendToAgentChat()`). The agent does the work and writes results to the database.

**Do:** Use `sendToAgentChat()` from the client, `agentChat.submit()` from scripts.
**Don't:** Import an AI SDK in client or server code. No `openai.chat()`, no `anthropic.messages()`, no inline LLM calls anywhere.

### 3. Scripts for agent operations

When the agent needs to do something — query data, call APIs, process information — it runs a script via `pnpm script <name>`. Scripts live in `scripts/` and export a default async function. **Everything the UI can do, the agent can do via scripts and the shared database.**

**Do:** Create focused scripts for discrete operations. Parse args with `parseArgs()`. Use scripts to list, search, create, and manage data — not just for background tasks.
**Don't:** Put complex logic inline in agent chat. Keep scripts small and composable. Don't say "I don't have access" — check the scripts and database first.

### 4. SSE keeps the UI in sync

Server-Sent Events stream database changes to the UI in real-time. When the agent writes to the database (application state, settings, or domain data), the SSE handler broadcasts the change. The client `useFileWatcher()` hook invalidates React Query caches on changes. SSE events have a `source` field: `"app-state"` or `"settings"`.

### 5. The agent can modify code

The agent can edit the app's own source code — components, routes, styles, scripts. This is a feature. Design your app expecting this.

### 6. Application state in SQL

Ephemeral UI state lives in the `application_state` SQL table, keyed by session ID and key. Both the agent and the UI can read and write application state. When the agent writes state (e.g., a compose draft), the UI reacts via SSE and updates accordingly. When the user interacts with the UI, changes are written back so the agent can read them.

**Do:** Use `writeAppState(key, value)` from scripts, `appStatePut(sessionId, key, value)` from server code. Use `readAppState(key)` to read state.
**Don't:** Use application-state for persistent data — use the `settings` store instead. Don't store secrets here.

**Script helpers** (from `@agent-native/core/application-state`):

- `readAppState(key)` — read state for current session
- `writeAppState(key, value)` — write state (triggers SSE)
- `deleteAppState(key)` — delete state (triggers SSE)
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
data/                  # App data (SQLite DB at data/app.db)
react-router.config.ts # React Router framework config
```

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

Most templates use SQLite via Drizzle ORM. These core scripts are available automatically — no local script files needed:

| Script      | Purpose                         | Example                                            |
| ----------- | ------------------------------- | -------------------------------------------------- |
| `db-schema` | Show all tables, columns, types | `pnpm script db-schema`                            |
| `db-query`  | Run a SELECT query              | `pnpm script db-query --sql "SELECT * FROM forms"` |
| `db-exec`   | Run INSERT/UPDATE/DELETE        | `pnpm script db-exec --sql "UPDATE forms SET ..."` |

Use `db-schema` first to understand the data model, then `db-query` and `db-exec` to read and write data. Scripts read `DATABASE_URL` from env (defaults to `file:./data/app.db`). Use `--db <path>` to override, and `--format json` for structured output.

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
| `real-time-sync`      | Wiring SSE, debugging UI not updating                |
| `delegate-to-agent`   | Delegating AI work from UI or scripts to the agent   |
| `scripts`             | Creating or running agent scripts                    |
| `self-modifying-code` | Editing app source, components, or styles            |
| `create-skill`        | Adding new skills for the agent                      |
| `capture-learnings`   | Recording corrections and patterns                   |
| `frontend-design`     | Building or styling any web UI, components, or pages |

The **`frontend-design`** skill (sourced from [Anthropic's skills library](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)) applies whenever the agent generates or modifies UI. It enforces distinctive, production-grade aesthetics — avoiding generic AI-generated design patterns like purple gradients, overused fonts, and cookie-cutter layouts.
