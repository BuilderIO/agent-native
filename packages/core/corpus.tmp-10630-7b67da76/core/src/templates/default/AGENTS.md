# {{APP_NAME}} — Agent Guide

This app follows the agent-native core philosophy: the agent and UI are equal partners. Everything the UI can do, the agent can do via actions. The agent always knows what you're looking at via application state. Use the framework docs lookup below for version-matched Agent Native documentation.

This is an **@agent-native/core** application -- the AI agent and UI share state through a SQL database, with SSE for in-process live sync and polling as the cross-process/serverless fallback.

### Core Principles

1. **Shared SQL database** -- All app state lives in SQL. SQL stores structured records, metadata, references, and searchable text; large files/blob payloads must use file/blob storage and persist only URLs, ids, or handles. Never store large base64, `data:` URLs, images, videos, audio, PDFs, ZIPs, screenshots, thumbnails, or session replay chunks in SQL, `application_state`, `settings`, or `resources`. Local SQLite at `data/app.db` is the zero-setup dev fallback; local PGlite is available as a Postgres-dialect opt-in with `DATABASE_URL=pglite:./data/pglite` after installing `@electric-sql/pglite`. Deployed apps need a persistent `DATABASE_URL` so data survives container/serverless restarts. Turso is optional, not required: Neon, Supabase, Turso/libSQL, plain Postgres, durable SQLite, D1 bindings, and Builder.io-managed environments are all valid when supported by the deploy. Core stores: `application_state`, `settings`, `oauth_tokens`, `sessions`, `resources`.
2. **AI through the right framework surface** -- Product workflows delegate to the agent via `sendToAgentChat()` / `agentChat.submit()`. Use `sendToAgentChat({ message, context, submit })` for simple UI handoffs and prefill/review flows; add `newTab: true, background: true, openSidebar: false` when the agent should work silently without focusing the sidebar. Only use the agent-chat context state helpers (`useAgentChatContext`, `setAgentChatContextItem`, `listAgentChatContext`, `removeAgentChatContextItem`, `clearAgentChatContext`) when the UI needs two-way sync with staged context chips. For rare server-side text transforms that intentionally need no tools, chat history, or run state, use `completeText()` from `@agent-native/core/server` inside an action instead of importing provider SDKs directly.
3. **Actions for app operations** -- `pnpm action <name>` dispatches to callable action files in `actions/`; `defineAction` also auto-exposes those operations at `/_agent-native/actions/:name` for the UI. Do not create custom REST routes that re-export actions.
4. **Live sync keeps the UI current** -- Database writes stream over `/_agent-native/events` first, with `/_agent-native/poll` as the fallback. **When you (the agent) write data, the UI must reflect the change without a manual refresh.** This is non-negotiable. Use `useActionQuery` / `useActionMutation` for action-backed data (preferred). If you use raw `useQuery`, fold `useChangeVersions([<source>, "action"])` into the key for targeted refreshes. See the `real-time-sync` and `adding-a-feature` skills.
5. **Agent can update code** -- The agent can modify this app's source code directly.
6. **No hardcoded secrets or private data** -- Never put API keys, tokens, webhook URLs, signing secrets, private Builder/internal data, customer data, or credential-looking literals in source, docs, tests, fixtures, prompts, screenshots, application state, action responses, or generated content. Use secrets/OAuth/runtime configuration and obvious placeholders in examples.

## Framework Docs Lookup

Version-matched Agent Native docs ship with `@agent-native/core` in
`node_modules/@agent-native/core/docs`. A source-only corpus of core and
first-party template patterns ships in `node_modules/@agent-native/core/corpus`.

- Use `pnpm action docs-search --query "<topic>"` to search framework docs,
  bundled `AGENTS.md`, and codebase skills.
- Use `pnpm action docs-search --slug <slug>` to read a full page. Start with
  `actions`, `database`, `context-awareness`, `client`, `automations`,
  `recurring-jobs`, `a2a-protocol`, `external-agents`, `mcp-protocol`,
  `sharing`, `security`, `pure-agent-apps`, or `agent-surfaces`.
- Use `pnpm action docs-search --list` to see everything available.
- Use `pnpm action source-search --query "<pattern>"` when you need current
  implementation examples or template best practices, and
  `pnpm action source-search --path <path>` to read a specific corpus file.
- If the action runner is unavailable, read
  `node_modules/@agent-native/core/docs/AGENTS.md` and search
  `node_modules/@agent-native/core/docs/content/` directly with `rg`. Search
  `node_modules/@agent-native/core/corpus/` for source examples.

Read these local package docs before implementing advanced Agent Native
features. Prefer this app's own `AGENTS.md` and `.agents/skills/` for
app-specific rules, then use the corpus for reusable framework/template
patterns.
To bring an older app current, run `pnpm upgrade:agent-native` or
`npx @agent-native/core@latest upgrade` from the app root. That bumps
`@agent-native/*` deps, installs, refreshes scaffold skills, and typechecks.
Do **not** add `pnpm.overrides` / patches against `@agent-native/*` or edit
`node_modules/@agent-native/*` when an upgrade fails — fix app code or ask.
See the `upgrade-agent-native` and `self-modifying-code` skills.
After a manual core bump only, `pnpm skills:update` (or
`npx @agent-native/core@latest skills update scaffold --project`) still
refreshes framework-provided `.agents/skills` and repairs `CLAUDE.md` /
`.claude/skills` compatibility links.

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

Resources are persistent files for notes, learnings, and context. Text resources
live in SQL; binary resource uploads require configured file storage and store
only the hosted URL/reference in SQL.

**At the start of every conversation, read these resources (workspace, shared, and personal scopes as relevant):**

1. **`AGENTS.md`** -- inherited workspace defaults, app/team instructions, and user-specific context.
2. **`LEARNINGS.md`** -- user preferences, corrections, and patterns. Read personal and shared scopes.

**Update the shared `LEARNINGS.md` when you learn something important for the
team.** Canonical destinations, request fields, metric definitions, routing
conventions, and corrections learned in Slack belong there with concise source
links. Shared scope resolves to the active organization. Personal preferences
and user-specific context go through `save-memory` into `memory/MEMORY.md`.
Built-in app chat agents use the `resources` tool with the `action` argument.
External CLI agents can use the equivalent `pnpm action resource-*` commands.

| Built-in agent tool call                                                | CLI equivalent                                                                         | Purpose                 |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------- |
| `resources` with `action: "read"`, `path`, optional `scope`             | `pnpm action resource-read --path <path> [--scope personal\|shared]`                   | Read a resource         |
| `resources` with `action: "write"`, `path`, `content`, optional `scope` | `pnpm action resource-write --path <path> --content <text> [--scope personal\|shared]` | Write/update a resource |
| `resources` with `action: "list"`, optional `prefix`/`scope`            | `pnpm action resource-list [--prefix <path>] [--scope personal\|shared\|all]`          | List resources          |
| `resources` with `action: "delete"`, `path`, optional `scope`           | `pnpm action resource-delete --path <path> [--scope personal\|shared]`                 | Delete a resource       |

## Application State

Ephemeral UI state is stored in the SQL `application_state` table, accessed via `readAppState(key)` and `writeAppState(key, value)` from `@agent-native/core/application-state`.

| State Key    | Purpose                                   | Direction                  |
| ------------ | ----------------------------------------- | -------------------------- |
| `navigation` | Current view                              | UI -> Agent (read-only)    |
| `navigate`   | Navigate command (one-shot, auto-deleted) | Agent -> UI (auto-deleted) |

The `navigation` key is written by the UI whenever the route changes. The `navigate` key is a one-shot command: the agent writes it, the UI reads and executes the navigation, then deletes it.

UI code should use `useAgentRouteState` / `useSemanticNavigationState` from
`@agent-native/core/client` for navigation sync instead of hand-written
`fetch("/_agent-native/application-state/...")` calls. Keep shareable filters
in URL query params; the framework exposes them as `<current-url>` and the
built-in agent can update them with `set-search-params`.

## Mounted Workspace Routing

This app may be mounted under `/<app-id>` in a workspace. Inside app source, React Router paths are app-local: use `<Link to="/review">` and `navigate("/review")`, not `/<app-id>/review`. The workspace gateway and `APP_BASE_PATH` add the mounted prefix in the browser; hardcoding it inside React Router links causes doubled URLs such as `/<app-id>/<app-id>/review`.

For raw paths outside React Router, use the core helpers: `appPath()` for static assets or normal hrefs, `appApiPath()` for legitimate route-only `/api/*` endpoints, and `agentNativePath()` for `/_agent-native/*`. Do not use `appApiPath()` to build action-backed CRUD wrappers.

## Agent Operations

**Always know what the user is currently viewing before you edit anything.** The user's view can change mid-conversation. Stale IDs lead to editing the wrong record.

### If you are the built-in agent-chat agent

A `<current-screen>` block is auto-injected into every user message with the current view, IDs, and selected item. You can trust it for the first action of a turn without calling `view-screen`. If the user says "this" or "now do X" after several tool calls, the user may have navigated — call `view-screen` again for a fresh snapshot.

### If you are an external CLI agent (Claude Code, Codex, Cursor, etc.)

You do NOT get auto-injected screen state. **Call `pnpm action view-screen` at the start of every task and before any edit** so you're acting on the IDs the user currently sees, not what was open earlier. Do not rely on cached context from previous turns.

### Actions

Use existing domain actions before reaching for SQL or custom routes. If a
capability is missing, add or extend a `defineAction` so both the agent and UI
share the same operation. Do not create `/api/*` routes that only call,
repackage, or proxy an action.

| Action        | Args                              | Purpose                         |
| ------------- | --------------------------------- | ------------------------------- |
| `view-screen` |                                   | See current UI state            |
| `navigate`    | `--view <name>` or `--path <url>` | Navigate the UI                 |
| `hello`       | `[--name <name>]`                 | Example script                  |
| `db-schema`   |                                   | Show all tables, columns, types |
| `db-query`    | `--sql "SELECT ..."`              | Run a SELECT query              |

**For data changes, pick the right surface:**

- Use domain actions first. They validate input, enforce access, and refresh the UI.
- Use `db-query` / `db-schema` for read-only inspection.
- Raw write SQL (`db-exec` / `db-patch`) is not part of the default agent surface. If this app explicitly opts into `databaseTools: "write"`, use those tools only for deliberate maintenance when no domain action exists.
- **Database admin (dev only):** in development, `db-admin-query` / `db-admin-mutate` / `db-admin-rows` / `db-admin-tables` / `db-admin-schema` give **unscoped, full-database** access to ANY table — including framework tables and tables without `owner_email`/`org_id`. Prefer these over `db-exec`/`db-query` for database-admin work and for any non-owner-scoped table: `db-exec`/`db-query` auto-scope to the current user and return **0 rows** on unscoped tables. These mirror the in-app Database admin UI, so prompts and the UI do the same thing.

## Skills

Skills in `.agents/skills/` provide detailed guidance for each architectural rule. Read them before making changes.

| Skill                  | When to read                                                                      |
| ---------------------- | --------------------------------------------------------------------------------- |
| `agent-native-docs`    | Before using advanced Agent Native framework APIs or generated-app features       |
| `adding-a-feature`     | **Read first when adding ANY new feature** — the four-area parity checklist       |
| `real-time-sync`       | Before wiring data fetching for anything the agent can mutate (must auto-refresh) |
| `storing-data`         | Before storing or reading any app state                                           |
| `internationalization` | Before adding or editing visible UI copy, prompts, toasts, labels, or formatting  |
| `delegate-to-agent`    | Before adding LLM calls or AI delegation                                          |
| `actions`              | Before creating or modifying actions                                              |
| `self-modifying-code`  | Before editing source, components, or styles                                      |
| `upgrade-agent-native` | Before updating an older app/branch or when tempted to patch `@agent-native/*`    |
| `capture-learnings`    | Before recording user preferences or corrections                                  |
| `frontend-design`      | Before building or restyling any UI component, page, or layout                    |
| `shadcn-ui`            | Before adding, updating, or debugging shadcn/ui components                        |
| `agent-engines`        | Before switching LLM providers or registering a custom engine                     |
| `notifications`        | Before surfacing alerts/progress to the user or adding channels                   |
| `progress`             | Before running any task that takes more than a few seconds                        |

## When Adding Features

**Read the `adding-a-feature` skill first** — it has the full four-area checklist (UI / Action / Skills / App-State). Quick summary:

1. **Add navigation state entries** — extend `app/hooks/use-navigation-state.ts` to track new routes with `useAgentRouteState`
2. **Enhance view-screen** — make the view-screen script return relevant context for the new view
3. **Create domain actions** — add actions in `actions/` for CRUD operations on new data models; do not create REST wrappers around those actions
4. **Wire UI for auto-refresh** — use `useActionQuery` / `useActionMutation` for normal CRUD. If a raw `useQuery` is unavoidable, fold `useChangeVersions([<source>, "action"])` into its key with `placeholderData`. When the agent mutates this data, the UI must reflect the change without a manual refresh. See `real-time-sync` skill.
5. **Create domain skills** — add `.agents/skills/<feature>/SKILL.md` documenting the data model, storage patterns, and agent operations
6. **Update this AGENTS.md** — add the new actions, state keys, and common tasks

---

For code editing and development guidance, read `DEVELOPING.md`.
