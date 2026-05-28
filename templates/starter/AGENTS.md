# {{APP_NAME}} — Agent Guide

This app follows the agent-native core philosophy: the agent and UI are equal partners. Everything the UI can do, the agent can do via actions. The agent always knows what you're looking at via application state. See the root AGENTS.md for full framework documentation.

This is an **@agent-native/core** application -- the AI agent and UI share state through a SQL database, with SSE for in-process live sync and polling as the cross-process/serverless fallback. Local SQLite at `data/app.db` is only the zero-setup dev fallback; deployed apps need a persistent `DATABASE_URL` so data survives container/serverless restarts. Turso is optional, not required: Neon, Supabase, Turso/libSQL, plain Postgres, durable SQLite, D1 bindings, and Builder.io-managed environments are all valid when supported by the deploy. **When you (the agent) write data, the UI must reflect the change without a manual refresh.** This is non-negotiable. Use `useActionQuery` / `useActionMutation` for action-backed data (preferred). If you use raw `useQuery`, fold `useChangeVersions([<source>, "action"])` into the key for targeted refreshes. See the `real-time-sync` and `adding-a-feature` skills.

## Database Code

- Define tables with `@agent-native/core/db/schema` helpers (`table`, `text`, `integer`, `real`, `now`, sharing helpers), never `drizzle-orm/sqlite-core` or `drizzle-orm/pg-core`.
- Use Drizzle's query builder (`db.select`, `db.insert`, `db.update`, `db.delete`) plus portable operators from `drizzle-orm` (`eq`, `and`, `or`, `inArray`, `desc`, etc.) for app reads and writes.
- Keep raw SQL out of normal actions, handlers, and stores. Use it only for additive migrations, health checks, or last-resort maintenance, and keep it parameterized and dialect-agnostic.
- Do not write SQLite-only or Postgres-only syntax in product code. The same app should run on SQLite, Postgres, libSQL/Turso, D1, and other supported Drizzle backends.

## Resources

Resources are SQL-backed persistent files for storing notes, learnings, and context.

**At the start of every conversation, read these resources (both personal and shared scopes):**

1. **`AGENTS.md`** — user-specific context. Read both `--scope personal` and `--scope shared`.
2. **`LEARNINGS.md`** — app memory with user preferences and corrections. Read both scopes.

**Update `LEARNINGS.md` when you learn something important.**

### Resource scripts

| Action            | Args                                           | Purpose                 |
| ----------------- | ---------------------------------------------- | ----------------------- |
| `resource-read`   | `--name <name> [--scope personal\|shared]`     | Read a resource         |
| `resource-write`  | `--name <name> --content <text> [--scope ...]` | Write/update a resource |
| `resource-list`   | `[--scope personal\|shared]`                   | List all resources      |
| `resource-delete` | `--name <name> [--scope personal\|shared]`     | Delete a resource       |

## Application State

Ephemeral UI state is stored in the SQL `application_state` table, accessed via `readAppState(key)` and `writeAppState(key, value)` from `@agent-native/core/application-state`.

| State Key    | Purpose                                   | Direction                  |
| ------------ | ----------------------------------------- | -------------------------- |
| `navigation` | Current view (`home`, `extensions`, etc.) | UI -> Agent (read-only)    |
| `navigate`   | Navigate command (one-shot, auto-deleted) | Agent -> UI (auto-deleted) |

## Starter Customization

This app is a blank scaffold for the app the user actually wants. When the user
asks to build, make, create, or customize this app from the starter, edit this
app in place and make it feel like their app:

- Replace generic home, navigation, page titles, package metadata, manifest
  text, and any starter-only copy with the requested product's real name and
  workflow.
- Do not leave visible `Starter`, `Blank app`, or app-creation affordances in a
  finished starter-derived app.
- Keep extension creation inside this app for one-off widgets or panels, but do
  not expose a `New app` route/button from this app.

If the user explicitly asks for a separate workspace app instead of customizing
this app, create it from Dispatch or the workspace root. Keep separate workspace
apps under `apps/<app-id>`, mount them at `/<app-id>`, use the shared workspace
database/hosting model, and namespace any new domain tables so apps do not
collide. Save a concise generated description in `apps/<app-id>/package.json`
so Dispatch and A2A connected-agent context can describe what the app does.

## Mounted Workspace Routing

This app may be mounted at a workspace path such as `/starter` or the generated
app id. Inside app source, React Router paths are app-local: use
`<Link to="/review">` and `navigate("/review")`, not
`/<app-id>/review`. The workspace gateway and `APP_BASE_PATH` add the mounted
prefix in the browser; hardcoding it inside React Router links causes doubled
URLs such as `/<app-id>/<app-id>/review`.

For raw paths outside React Router, use the core helpers: `appPath()` for static assets or normal hrefs, `appApiPath()` for `/api/*`, and `agentNativePath()` for `/_agent-native/*`.

## Agent Operations

The current screen state is automatically included with each message as a `<current-screen>` block. You don't need to call `view-screen` before every action — use it only when you need a refreshed snapshot mid-conversation.

**Running actions from the frame:** The terminal cwd is the framework root. Always `cd` to this template's root before running any action:

```bash
cd templates/starter && pnpm action <name> [args]
```

`.env` is loaded automatically — **never manually set `DATABASE_URL` or other env vars**.

### Actions

| Action        | Args                              | Purpose                         |
| ------------- | --------------------------------- | ------------------------------- |
| `view-screen` |                                   | See current UI state            |
| `navigate`    | `--view <name>` or `--path <url>` | Navigate the UI                 |
| `hello`       | `[--name <name>]`                 | Example script                  |
| `db-schema`   |                                   | Show all tables, columns, types |
| `db-query`    | `--sql "SELECT ..."`              | Run a SELECT query              |
| `db-exec`     | `--sql "UPDATE ..."`              | Last-resort ad-hoc maintenance  |

Use domain actions first. They validate input, enforce access, and refresh the UI. Reach for `db-exec` only when no domain action exists and you need a small one-off maintenance change.

## Skills

| Skill                 | When to read                                                                      |
| --------------------- | --------------------------------------------------------------------------------- |
| `adding-a-feature`    | **Read first when adding ANY new feature** — the four-area parity checklist       |
| `real-time-sync`      | Before wiring data fetching for anything the agent can mutate (must auto-refresh) |
| `storing-data`        | Before storing or reading any app state                                           |
| `delegate-to-agent`   | Before adding LLM calls or AI delegation                                          |
| `actions`             | Before creating or modifying actions                                              |
| `self-modifying-code` | Before editing source, components, or styles                                      |
| `frontend-design`     | Before building or restyling any UI component, page, or layout                    |
| `shadcn-ui`           | Before adding, updating, or debugging shadcn/ui components                        |

## When Adding Features

**Read the `adding-a-feature` skill first** — it has the full four-area checklist (UI / Action / Skills / App-State). Quick summary:

1. **Add navigation state entries** — extend `use-navigation-state.ts` to track new routes
2. **Enhance view-screen** — make the view-screen action return relevant context for the new view
3. **Create domain actions** — add actions for CRUD operations on new data models
4. **Wire UI for auto-refresh** — use `useActionQuery` / `useActionMutation` for normal CRUD. If a raw `useQuery` is unavoidable, fold `useChangeVersions([<source>, "action"])` into its key with `placeholderData`. When the agent mutates this data, the UI must reflect the change without a manual refresh. See `real-time-sync` skill.
5. **Create domain skills** — add `.agents/skills/<feature>/SKILL.md` documenting the data model, storage patterns, and agent operations
6. **Update this AGENTS.md** — add the new actions, state keys, and common tasks

### Authentication

This template uses the framework's default auth — Better Auth, with email/password and optional Google / GitHub social providers. New users create an account on first visit. Use `getSession(event)` server-side and `useSession()` client-side.

See the `authentication` skill for the full mode matrix (`AUTH_MODE=local` for solo dev, `ACCESS_TOKEN` for shared-token deploys, `AUTH_DISABLED` for infrastructure auth, BYOA for custom providers) and the `security` skill for per-user / per-org data scoping.

### UI Components

**Always use shadcn/ui components** from `app/components/ui/` for all standard UI patterns (dialogs, popovers, dropdowns, tooltips, buttons, etc). Never build custom modals or dropdowns with absolute/fixed positioning — use the shadcn primitives instead.

**Always use Tabler Icons** (`@tabler/icons-react`) for all icons. Never use other icon libraries.

**Never use browser dialogs** (`window.confirm`, `window.alert`, `window.prompt`) — use shadcn AlertDialog instead.

---

For code editing and development guidance, read `DEVELOPING.md`.
