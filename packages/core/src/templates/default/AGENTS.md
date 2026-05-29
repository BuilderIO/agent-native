# {{APP_NAME}} — Agent Guide

This app follows the agent-native core philosophy: the agent and UI are equal partners. Everything the UI can do, the agent can do via actions. The agent always knows what you're looking at via application state. See the root AGENTS.md for full framework documentation.

This is an **@agent-native/core** application -- the AI agent and UI share state through a SQL database, with SSE for in-process live sync and polling as the cross-process/serverless fallback.

### Core Principles

1. **Shared SQL database** -- All app state lives in SQL. Local SQLite at `data/app.db` is the zero-setup dev fallback; deployed apps need a persistent `DATABASE_URL` so data survives container/serverless restarts. Turso is optional, not required: Neon, Supabase, Turso/libSQL, plain Postgres, durable SQLite, D1 bindings, and Builder.io-managed environments are all valid when supported by the deploy. Core stores: `application_state`, `settings`, `oauth_tokens`, `sessions`, `resources`.
2. **All AI through agent chat** -- No inline LLM calls. UI delegates to the AI via `sendToAgentChat()` / `agentChat.submit()`.
3. **Actions for agent operations** -- `pnpm action <name>` dispatches to callable action files in `actions/`.
4. **Live sync keeps the UI current** -- Database writes stream over `/_agent-native/events` first, with `/_agent-native/poll` as the fallback. **When you (the agent) write data, the UI must reflect the change without a manual refresh.** This is non-negotiable. Use `useActionQuery` / `useActionMutation` for action-backed data (preferred). If you use raw `useQuery`, fold `useChangeVersions([<source>, "action"])` into the key for targeted refreshes. See the `real-time-sync` and `adding-a-feature` skills.
5. **Agent can update code** -- The agent can modify this app's source code directly.

### Database Code

- Define tables with `@agent-native/core/db/schema` helpers (`table`, `text`, `integer`, `real`, `now`, sharing helpers), never `drizzle-orm/sqlite-core` or `drizzle-orm/pg-core`.
- Use Drizzle's query builder (`db.select`, `db.insert`, `db.update`, `db.delete`) plus portable operators from `drizzle-orm` (`eq`, `and`, `or`, `inArray`, `desc`, etc.) for app reads and writes.
- Keep raw SQL out of normal actions, handlers, and stores. Use it only for additive migrations, health checks, or last-resort maintenance, and keep it parameterized and dialect-agnostic.
- Do not write SQLite-only or Postgres-only syntax in product code. The same app should run on SQLite, Postgres, libSQL/Turso, D1, and other supported Drizzle backends.

### Authentication

Auth is real Better Auth in every environment — there is **no dev bypass**:

- **Development**: the same Better Auth flow as production. On first run the framework auto-creates a throwaway dev account and signs you in (so you are not stuck at a login wall). `getSession()` returns the signed-in user or `null` — it never returns a `local@localhost` sentinel.
- **Production**: Better Auth with email/password + social providers; organizations built in.

Use `getSession(event)` server-side and `useSession()` client-side. When there is no session, **throw or return 401** — never fall back to `local@localhost` (that pools every unauthenticated request into one shared tenant).

## Resources

Resources are SQL-backed persistent files for notes, learnings, and context.

**At the start of every conversation, read these resources (workspace, shared, and personal scopes as relevant):**

1. **`AGENTS.md`** -- inherited workspace defaults, app/team instructions, and user-specific context.
2. **`LEARNINGS.md`** -- user preferences, corrections, and patterns. Read personal and shared scopes.

**Update `LEARNINGS.md` when you learn something important.**

| Action            | Args                                                        | Purpose                 |
| ----------------- | ----------------------------------------------------------- | ----------------------- |
| `resource-read`   | `--path <path> [--scope personal\|shared]`                  | Read a resource         |
| `resource-write`  | `--path <path> --content <text> [--scope personal\|shared]` | Write/update a resource |
| `resource-list`   | `[--prefix <path>] [--scope personal\|shared\|all]`         | List resources          |
| `resource-delete` | `--path <path> [--scope personal\|shared]`                  | Delete a resource       |

## Application State

Ephemeral UI state is stored in the SQL `application_state` table, accessed via `readAppState(key)` and `writeAppState(key, value)` from `@agent-native/core/application-state`.

| State Key    | Purpose                                   | Direction                  |
| ------------ | ----------------------------------------- | -------------------------- |
| `navigation` | Current view                              | UI -> Agent (read-only)    |
| `navigate`   | Navigate command (one-shot, auto-deleted) | Agent -> UI (auto-deleted) |

The `navigation` key is written by the UI whenever the route changes. The `navigate` key is a one-shot command: the agent writes it, the UI reads and executes the navigation, then deletes it.

## Mounted Workspace Routing

This app may be mounted under `/<app-id>` in a workspace. Inside app source, React Router paths are app-local: use `<Link to="/review">` and `navigate("/review")`, not `/<app-id>/review`. The workspace gateway and `APP_BASE_PATH` add the mounted prefix in the browser; hardcoding it inside React Router links causes doubled URLs such as `/<app-id>/<app-id>/review`.

For raw paths outside React Router, use the core helpers: `appPath()` for static assets or normal hrefs, `appApiPath()` for `/api/*`, and `agentNativePath()` for `/_agent-native/*`.

## Agent Operations

**Always know what the user is currently viewing before you edit anything.** The user's view can change mid-conversation. Stale IDs lead to editing the wrong record.

### If you are the built-in agent-chat agent

A `<current-screen>` block is auto-injected into every user message with the current view, IDs, and selected item. You can trust it for the first action of a turn without calling `view-screen`. If the user says "this" or "now do X" after several tool calls, the user may have navigated — call `view-screen` again for a fresh snapshot.

### If you are an external CLI agent (Claude Code, Codex, Cursor, etc.)

You do NOT get auto-injected screen state. **Call `pnpm action view-screen` at the start of every task and before any edit** so you're acting on the IDs the user currently sees, not what was open earlier. Do not rely on cached context from previous turns.

### Actions

| Action        | Args                                                                           | Purpose                                                                                 |
| ------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `view-screen` |                                                                                | See current UI state                                                                    |
| `navigate`    | `--view <name>` or `--path <url>`                                              | Navigate the UI                                                                         |
| `hello`       | `[--name <name>]`                                                              | Example script                                                                          |
| `db-schema`   |                                                                                | Show all tables, columns, types                                                         |
| `db-query`    | `--sql "SELECT ..."`                                                           | Run a SELECT query                                                                      |
| `db-exec`     | `--sql "UPDATE ..."`                                                           | Last-resort ad-hoc maintenance; prefer domain actions and Drizzle code for product work |
| `db-patch`    | `--table <t> --column <c> --where "<clause>" --find "<old>" --replace "<new>"` | Surgical search/replace on a large text column — sends a diff instead of the full value |

**For one-off maintenance, pick the right SQL tool:**

- Use domain actions first. They validate input, enforce access, and refresh the UI.
- Use `db-exec UPDATE` only when no domain action exists and you need a small ad-hoc change.
- Use `db-patch` when you only need to tweak a small slice of a **large** text/JSON column (documents, slide HTML, dashboard/form JSON). It saves tokens by sending `{find, replace}` instead of re-transmitting the whole column. Targets exactly one row per call — narrow `--where` by primary key. Supports `--edits '[{find,replace},...]'` for batch edits and `--all` for replace-every-occurrence.
- If a template-specific action exists (e.g. `edit-document`, `update-slide`), prefer it — those also push live updates to any open collaborative editor.
- **Database admin (dev only):** in development, `db-admin-query` / `db-admin-mutate` / `db-admin-rows` / `db-admin-tables` / `db-admin-schema` give **unscoped, full-database** access to ANY table — including framework tables and tables without `owner_email`/`org_id`. Prefer these over `db-exec`/`db-query` for database-admin work and for any non-owner-scoped table: `db-exec`/`db-query` auto-scope to the current user and return **0 rows** on unscoped tables. These mirror the in-app Database admin UI, so prompts and the UI do the same thing.

## Skills

Skills in `.agents/skills/` provide detailed guidance for each architectural rule. Read them before making changes.

| Skill                 | When to read                                                                      |
| --------------------- | --------------------------------------------------------------------------------- |
| `adding-a-feature`    | **Read first when adding ANY new feature** — the four-area parity checklist       |
| `real-time-sync`      | Before wiring data fetching for anything the agent can mutate (must auto-refresh) |
| `storing-data`        | Before storing or reading any app state                                           |
| `delegate-to-agent`   | Before adding LLM calls or AI delegation                                          |
| `actions`             | Before creating or modifying actions                                              |
| `self-modifying-code` | Before editing source, components, or styles                                      |
| `capture-learnings`   | Before recording user preferences or corrections                                  |
| `frontend-design`     | Before building or restyling any UI component, page, or layout                    |
| `shadcn-ui`           | Before adding, updating, or debugging shadcn/ui components                        |
| `agent-engines`       | Before switching LLM providers or registering a custom engine                     |
| `notifications`       | Before surfacing alerts/progress to the user or adding channels                   |
| `progress`            | Before running any task that takes more than a few seconds                        |

## When Adding Features

**Read the `adding-a-feature` skill first** — it has the full four-area checklist (UI / Action / Skills / App-State). Quick summary:

1. **Add navigation state entries** — extend `app/hooks/use-navigation-state.ts` to track new routes
2. **Enhance view-screen** — make the view-screen script return relevant context for the new view
3. **Create domain actions** — add actions in `actions/` for CRUD operations on new data models
4. **Wire UI for auto-refresh** — use `useActionQuery` / `useActionMutation` for normal CRUD. If a raw `useQuery` is unavoidable, fold `useChangeVersions([<source>, "action"])` into its key with `placeholderData`. When the agent mutates this data, the UI must reflect the change without a manual refresh. See `real-time-sync` skill.
5. **Create domain skills** — add `.agents/skills/<feature>/SKILL.md` documenting the data model, storage patterns, and agent operations
6. **Update this AGENTS.md** — add the new actions, state keys, and common tasks

---

For code editing and development guidance, read `DEVELOPING.md`.
