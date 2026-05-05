# Agent-Native Framework

## Core Philosophy

Agent-native is a framework for building apps where the AI agent and the UI are equal partners. Everything the UI can do, the agent can do. Everything the agent can do, the UI can do. They share the same database, the same state, and they always stay in sync.

The agent can also see what the user is looking at. If an email is open, the agent knows which email. If a slide is selected, the agent knows which slide. If the user selects text and hits Cmd+I to focus the agent, the agent knows what text is selected and can act on just that.

## The Six Rules

1. **Data lives in SQL** — via Drizzle ORM. Any SQL database (SQLite/Postgres/D1/Turso/Supabase/Neon). See `portability` skill.
2. **All AI goes through the agent chat** — the UI never calls an LLM directly. Use `sendToAgentChat()`. See `delegate-to-agent`.
3. **Actions are the single source of truth** — define once in `actions/`; the agent calls them as tools, the frontend calls them as HTTP endpoints at `/_agent-native/actions/:name`. See `actions`.
4. **Polling keeps the UI in sync** — `useDbSync()` polls `/_agent-native/poll` every 2s and invalidates React Query caches. Works on all serverless/edge hosts. See `real-time-sync`.
5. **The agent can modify code** — components, routes, styles, actions. Design expecting this. See `self-modifying-code`.
6. **Application state in SQL** — ephemeral UI state in `application_state`. Both sides read and write. See `storing-data`.

## Adding a Feature — The Four Areas

Every new feature MUST update all four areas. Skipping any one breaks the agent-native contract. See `adding-a-feature` for the full checklist.

1. **UI** — the user-facing component/route/page
2. **Actions** — operations in `actions/` using `defineAction` (serve both agent and frontend)
3. **Skills / Instructions** — update AGENTS.md and/or add a skill if the feature introduces a pattern
4. **Application State** — expose navigation and selection so the agent knows what the user sees

If a feature needs user-facing setup (API keys, OAuth), register an onboarding step. See `onboarding`.

MCP servers reach the agent from three sources: local stdio servers in `mcp.config.json`, remote HTTP servers added per-user or per-org via the settings UI, and the workspace MCP hub (Dispatch template) when enabled. Tools appear in the registry prefixed `mcp__<server-id>__`. Compose with them where possible (e.g. delegate browser automation to `mcp__claude-in-chrome__*`).

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

Agent skills in `.agents/skills/` provide detailed guidance. Read the relevant skill before making changes — these are the source of truth for how to do things in this codebase.

| Skill                  | When to use                                                   |
| ---------------------- | ------------------------------------------------------------- |
| `adding-a-feature`     | Adding any new feature (the four-area checklist)              |
| `actions`              | Creating or running agent actions                             |
| `storing-data`         | Adding data models, reading/writing config or state           |
| `real-time-sync`       | Wiring polling sync, debugging UI not updating, jitter issues |
| `real-time-collab`     | Multi-user collaborative editing with Yjs CRDT + live cursors |
| `context-awareness`    | Exposing UI state to the agent, view-screen pattern           |
| `client-side-routing`  | Adding routes without remounting the app shell                |
| `delegate-to-agent`    | Delegating AI work from UI or actions to the agent            |
| `self-modifying-code`  | Editing app source, components, or styles                     |
| `portability`          | Keeping code database- and hosting-agnostic                   |
| `server-plugins`       | Framework plugins and the `/_agent-native/` namespace         |
| `authentication`       | Auth modes, sessions, orgs, protecting routes                 |
| `security`             | Input validation, SQL injection, XSS, secrets, data scoping   |
| `a2a-protocol`         | Enabling inter-agent communication                            |
| `recurring-jobs`       | Scheduled tasks the agent runs on a cron schedule             |
| `onboarding`           | Registering setup steps for API keys / OAuth                  |
| `secrets`              | Declaratively register API keys the template needs            |
| `automations`          | Event-triggered and schedule-triggered automations            |
| `integration-webhooks` | Cross-platform webhook → SQL queue → processor pattern        |
| `observability`        | Agent traces, evals, feedback, experiments, and dashboard     |
| `tracking`             | Server-side analytics with pluggable providers                |
| `sharing`              | Per-user / per-org sharing and access checks on resources     |
| `voice-transcription`  | Voice dictation in the agent composer (Whisper / browser)     |
| `frontend-design`      | Building or styling any web UI, components, or pages          |
| `create-skill`         | Adding new skills for the agent                               |
| `tools`                | Creating, editing, and managing sandboxed mini-app tools      |
| `capture-learnings`    | Recording corrections and patterns                            |

## All-Agent Support

`AGENTS.md` is the universal standard. It works with any AI coding tool. The framework creates symlinks so every tool reads the same instructions:

- `CLAUDE.md` → `AGENTS.md` (Claude Code)
- `.claude/skills/` → `.agents/skills/` (Claude Code skills)

Run `agent-native setup-agents` to create all symlinks (done automatically by `agent-native create`).

## Conventions

- **Publishable npm packages use changesets — every PR that touches `packages/<core|dispatch|scheduling|pinpoint>/**` must include a `.changeset/*.md`.** The `changeset-check` CI job blocks PRs that change source in a publishable package without one. To add a changeset, run `pnpm changeset add` (interactive) or write `.changeset/<short-slug>.md` directly:

  ```md
  ---
  "@agent-native/dispatch": patch
  ---

  One-line summary of the change for the changelog.
  ```

  Bump types: `patch` (bugfix / docs), `minor` (additive), `major` (breaking). One PR can declare multiple packages and mix bump types. The changeset file becomes part of the PR diff. On merge to `main`, `changesets/action` either opens a "Version Packages" PR (consuming the changesets into version bumps + changelog updates) or, when that PR merges, runs `pnpm changeset publish` to push to npm via OIDC trusted publisher. **Do NOT bump `package.json` versions manually — changesets does that.** If `babysit-pr` sees the `changeset-check` job fail, it parses the missing-package list and writes the `.changeset/*.md` for you. Templates and other private packages are skipped automatically (they don't ship to npm). Desktop-app stays version-triggered (electron-builder publishes binaries, not npm — see `packages/desktop-app/package.json`).
- **Actions first** — use `defineAction` for new operations; only create `/api/` routes for file uploads, streaming, webhooks, or OAuth callbacks.
- **Integration webhooks (Slack/Telegram/etc.) use the queue pattern.** The webhook handler verifies and enqueues to `integration_pending_tasks`, returns 200 immediately, then a self-fired `POST /_agent-native/integrations/_process-task` runs the agent loop in a fresh function execution. A 60s recurring job retries stuck tasks. This works on every serverless host — never use Netlify Background Functions, Cloudflare `waitUntil`, Vercel `after()`, or fire-and-forget promises after `return`. See `integration-webhooks` skill.
- **TypeScript everywhere** — all code must be `.ts`/`.tsx`. Never `.js` or `.mjs`.
- **Prettier** — run `npx prettier --write <files>` after modifying source files.
- **SSR for public pages, CSR for logged-in pages.** Any page a visitor can see without logging in — homepages, landing pages, docs, marketing, pricing — must server-side render so crawlers get real HTML. Logged-in app pages use client-side rendering via the `ClientOnly` wrapper in `root.tsx` to keep things simple. Never wrap public/SEO-critical content in `ClientOnly`. If a client-only component (e.g. `AgentSidebar`) needs to appear on a public page, render the page content directly and add the component as a client-only progressive enhancement (render children on server, mount the wrapper after hydration).
- **shadcn/ui components** for standard UI. Check `app/components/ui/` before building custom.
- **Tabler Icons** (`@tabler/icons-react`) for all icons. **Never use emojis as icons** — not in buttons, not in avatars, not in labels, not in toasts/notifications, not in outbound messages (Slack, email). No other icon libraries, no inline SVGs. Emojis are fine when they are _user-authored content_ (a document title emoji picker, a reaction the user chose, a user-picked space icon) — the rule is about icons the UI picks, not data the user picks.
- **No browser dialogs** — use shadcn AlertDialog instead of `window.confirm/alert/prompt`.
- **Public template list is a strict allow-list — never widen it without flipping `hidden:false` first.** The single source of truth is `packages/shared-app-config/templates.ts` (entries with `hidden: false`). Today the public set is exactly: **mail, calendar, content, slides, videos, clips, analytics, dispatch, forms, design** — plus `starter` for the CLI only. Hidden templates (calls, meeting-notes, voice, scheduling, issues, recruiting, macros) MUST NOT appear on the homepage, in the docs sidebar, in docs pages, or in the CLI catalog. Surfaces that hardcode their own list — `packages/docs/app/components/TemplateCard.tsx`, `packages/docs/app/components/docsNavItems.ts`, docs pages `packages/core/docs/content/template-*.md`, and the CLI duplicate `packages/core/src/cli/templates-meta.ts` — must only reference allow-listed slugs. To make a hidden template public: flip `hidden: false` in `packages/shared-app-config/templates.ts` AND `packages/core/src/cli/templates-meta.ts`, then add it to the surfaces above. To hide one: flip `hidden: true` in both files; the guard will then point you at every surface that still mentions it. `scripts/guard-template-list.mjs` (CI + `pnpm prep`) enforces this — adding a slug that isn't in the allow-list will fail the build. _This guard exists because agents kept re-adding the hidden templates (calls, meeting-notes, voice, scheduling, issues, recruiting, macros) to the homepage and sidebar during overnight sweeps. Do not disable it._
- **No breaking database changes — ever.** Hosted templates share their prod DB across every deploy context (preview, branch, prod). Any destructive SQL that runs in any build will overwrite live user data. Symptoms we've already hit in production: users losing accounts, dashboards silently emptied, sessions invalidated. Hard rules:
  - **Schema edits must be strictly additive.** Add new columns/tables, never rename or drop. If a column is wrong, add the replacement alongside it, dual-write from the application, migrate readers, and only retire the old column once every deploy that reads it is gone. Same for tables.
  - **Never rename an existing table or column** in a single step — not via Drizzle, not via raw SQL, not via `drizzle-kit push`. A rename looks like drop+create to the diff tool and wipes the table.
  - **Do not use `drizzle-kit push` against production databases.** Template schemas only define domain tables, not framework tables (`user`, `session`, `account`, `application_state`, etc.). Push sees the framework tables as "not in schema" and drops them. Schema changes go through `runMigrations` in each template's `server/plugins/db.ts` — additive SQL only. _This happened on 2026-04-21 (nine templates, framework tables dropped in prod, see PR #252). Two automated guards now enforce it: `scripts/guard-no-drizzle-push.mjs` (CI + `pnpm prep`) blocks `drizzle-kit push` in any `netlify.toml` or build/install/deploy script, and `createDrizzleConfig` in `packages/core/src/db/drizzle-config.ts` throws at runtime if `drizzle-kit push` is invoked against a Neon URL. Do not disable either._
  - **No `DROP TABLE`, no `DROP COLUMN`, no `TRUNCATE`, no `DELETE` without a WHERE, no destructive `ALTER`** in any migration, plugin startup, or action. Not even with `IF EXISTS`. If you think you need one, stop and ask.
  - **No auth-adapter swaps without a data-migration plan.** Switching auth libraries or renaming identity tables (e.g. plural `users/sessions/accounts` → singular `user/session/account`) leaves the new tables empty and strands every existing user's identity. If auth tables change shape, a data-copy migration ships in the same change and is verified against a staging DB first.
  - **Skip schema changes entirely when in doubt.** A redundant column alongside an old one is cheap; breaking live data is not recoverable beyond Neon's 6-hour PITR window.
- **No unscoped queries on ownable resources — ever.** Tables that include `...ownableColumns()` carry per-user/org data. Every read MUST go through `accessFilter(table, sharesTable)` (lists), `resolveAccess("<type>", id)` (read-by-id), or `assertAccess("<type>", id, role)` (writes). Custom Nitro routes must wrap their work in `runWithRequestContext({ userEmail, orgId }, fn)` after reading the session via `getSession(event)` — `runWithRequestContext` only auto-runs for actions auto-mounted at `/_agent-native/actions/...`, not for hand-written `/api/*` routes. _This happened on 2026-04-28: a slides user signed up via Google and saw decks owned by other users because `templates/slides/server/handlers/decks.ts` ran `db.select().from(schema.decks)` with no access filter. The action `list-decks.ts` used `accessFilter` correctly, but the HTTP handler bypassed it._ `scripts/guard-no-unscoped-queries.mjs` (CI + `pnpm prep`) statically scans every `templates/*/server/`, `templates/*/actions/`, and `packages/*/src/` file for queries against ownable tables and fails the build if no access helper appears in the same file. Last-resort opt-out is the marker comment `// guard:allow-unscoped — <reason>`; reviewers should push back on every new opt-out. See the `security` skill for code patterns.
- **Optimistic UI by default** — the UI must feel instant. NEVER `await` a server round-trip before updating the screen or navigating. Default pattern for any mutation:
  1. Generate a client-side id (nanoid) if the new entity needs one.
  2. Update the React Query cache optimistically via `queryClient.setQueryData(...)` (or the mutation's `onMutate`).
  3. Navigate / close the dialog / show the new row **immediately**.
  4. Fire the mutation in the background; in `onError` roll back the cache + toast, in `onSuccess` replace optimistic entry with server value.
  5. Never block a click with a spinner unless the user is performing a destructive/irreversible action (payment, delete, publish).
     Same for navigation: a link click must navigate on press — never `await` a fetch before `navigate()`. Preload data into the cache first (via `queryClient.prefetchQuery` on hover/focus) if the target page depends on it. Treat any "loading spinner after click" as a bug to fix, not a feature.

## Tools

Tools are mini sandboxed Alpine.js apps that run inside iframes. The agent can create, edit, and manage them at runtime without modifying the app's source code. See the `tools` skill for full patterns.

**IMPORTANT:** When a user asks to "create a tool" or "make a ... tool", use the `create-tool` action with Alpine.js HTML content. Do NOT create React components, actions, or schema changes.

### Tool Capabilities

Tools are 100% self-contained. They have FULL access to app data, external APIs, and their own persistent storage — **without any source code changes, new files, Builder, or schema migrations.**

| Helper                                      | Purpose                | Example                                       |
| ------------------------------------------- | ---------------------- | --------------------------------------------- |
| `toolData.set(collection, id, data, opts?)` | Persist data per-tool  | `toolData.set('notes', id, { text: '...' })`  |
| `toolData.list(collection, opts?)`          | List persisted items   | `toolData.list('notes', { scope: 'all' })`    |
| `toolData.get(collection, id, opts?)`       | Get a single item      | `toolData.get('notes', 'note-1')`             |
| `toolData.remove(collection, id, opts?)`    | Delete persisted item  | `toolData.remove('notes', 'note-1')`          |
| `appAction(name, params)`                   | Call any app action    | `appAction('list-emails', { view: 'inbox' })` |
| `dbQuery(sql, args)`                        | Read from SQL          | `dbQuery('SELECT * FROM tools')`              |
| `dbExec(sql, args)`                         | Write to SQL           | `dbExec('INSERT INTO ...')`                   |
| `appFetch(path, options)`                   | Call any app endpoint  | `appFetch('/api/settings')`                   |
| `toolFetch(url, options)`                   | External API via proxy | `toolFetch('https://api.github.com/...')`     |

**`toolData` is a built-in per-tool key-value store with user/org scoping.** When a user asks to "add persistence", "save data", or "remember state" in a tool, use `toolData` — no SQL schema, no new tables, no source code, no Builder. Data is automatically scoped by tool ID. All methods accept an optional `{ scope }` option: `'user'` (default, private), `'org'` (shared with org), or `'all'` (list/get only — returns both).

**NEVER suggest Builder, source code changes, or new files for tool modifications.** All tool changes go through `update-tool-content` (to edit the Alpine.js HTML) or `toolData` (to persist data).

### How it works

- Tools are stored in the `tools` SQL table and rendered via `GET /_agent-native/tools/:id/render` inside a sandboxed iframe.
- `toolFetch()` proxies API calls through `POST /_agent-native/tools/proxy`, which injects encrypted secrets (`${keys.NAME}` pattern) and enforces SSRF protections.
- Tools inherit the main app's Tailwind v4 theme automatically.
- Sharing uses the standard framework model (`ownableColumns()` + `createSharesTable()`): private by default, shareable with org or specific users.

### Agent actions for tools

| Action        | What it does                                                  |
| ------------- | ------------------------------------------------------------- |
| `create-tool` | Create a new tool (name, description, Alpine.js HTML content) |
| `update-tool` | Update a tool — use `patches` array for find/replace diffs    |
| `navigate`    | Navigate to `--view=tools` or `--view=tools --toolId=<id>`    |

### Routes

| Method | Path                              | Purpose                                      |
| ------ | --------------------------------- | -------------------------------------------- |
| GET    | `/_agent-native/tools`            | List tools (filtered by ownership + sharing) |
| POST   | `/_agent-native/tools`            | Create a tool                                |
| GET    | `/_agent-native/tools/:id`        | Get a tool                                   |
| PUT    | `/_agent-native/tools/:id`        | Update (supports `patches` for diffing)      |
| DELETE | `/_agent-native/tools/:id`        | Delete a tool                                |
| GET    | `/_agent-native/tools/:id/render` | Render HTML for iframe                       |
| POST   | `/_agent-native/tools/proxy`      | Authenticated proxy with secret injection    |

### Secrets for tools

Tools reference secrets via `${keys.NAME}` in `toolFetch()` headers and body. Create ad-hoc secrets via `POST /_agent-native/secrets/adhoc` with a `urlAllowlist` to restrict which domains the secret can be sent to.

## Auto-Memory

The agent proactively saves learnings to `LEARNINGS.md` when users correct it, share preferences, or reveal patterns. This is part of the system prompt in `agent-chat-plugin.ts` (FRAMEWORK_CORE section).
