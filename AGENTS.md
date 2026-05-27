# Agent-Native Framework

## Core Philosophy

Agent-native is a framework for building apps where the AI agent and the UI are equal partners. Everything the UI can do, the agent can do. Everything the agent can do, the UI can do. They share the same database, the same state, and they always stay in sync.

The agent can also see what the user is looking at. If an email is open, the agent knows which email. If a slide is selected, the agent knows which slide. If the user selects text and hits Cmd+I to focus the agent, the agent knows what text is selected and can act on just that.

## Response Status Indicator

Every final response must end with a status block so the user can quickly tell whether they need to act:

```md
---

⠀
🟢 Implemented the requested change
```

Use exactly `---`, then one blank line, then a line containing only the braille blank character `⠀`, then one status line.

- **🟢 Green means the requested coding/work unit is actually finished.** Use green when the implementation or concrete task is complete on the current branch, even if routine ship steps like commit, PR, deploy, or CI remain.
- **🟡 Yellow means something non-routine is still pending.** Use yellow when the response is only advice, a proposal, or a recommended plan and still needs the user's "go ahead" before implementation; when coding work is intentionally left incomplete; when a specific manual configuration step is needed; or when monitoring/verification is still in progress.
- **🔴 Red means the work cannot continue without user input.** Use red only for a hard blocker such as a missing credential, required decision, or unanswered question.

Do not mark advisory-only answers green. If the user asked "what should we do?" and the answer is a recommendation that still needs approval before code changes, the status must be yellow.

## The Six Rules

1. **Data lives in SQL** — via Drizzle ORM. Use the framework schema helpers and Drizzle query builder so app code stays provider-agnostic; raw SQL is only for additive migrations, health checks, or one-off maintenance. Local SQLite is only the zero-setup dev fallback; deployed apps need a persistent `DATABASE_URL`. Do not imply Turso is required: Neon, Supabase, Turso/libSQL, plain Postgres, durable SQLite, D1 bindings, and Builder.io-managed environments are all valid when supported by the deploy. See `portability` and `storing-data` skills.
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

| Skill                  | When to use                                                     |
| ---------------------- | --------------------------------------------------------------- |
| `address-feedback`     | Triage feedback docs into bugs to fix and UX proposals          |
| `adding-a-feature`     | Adding any new feature (the four-area checklist)                |
| `actions`              | Creating or running agent actions                               |
| `storing-data`         | Adding data models, reading/writing config or state             |
| `real-time-sync`       | Wiring polling sync, debugging UI not updating, jitter issues   |
| `real-time-collab`     | Multi-user collaborative editing with Yjs CRDT + live cursors   |
| `context-awareness`    | Exposing UI state to the agent, view-screen pattern             |
| `client-side-routing`  | Adding routes without remounting the app shell                  |
| `delegate-to-agent`    | Delegating AI work from UI or actions to the agent              |
| `self-modifying-code`  | Editing app source, components, or styles                       |
| `portability`          | Keeping code database- and hosting-agnostic                     |
| `server-plugins`       | Framework plugins and the `/_agent-native/` namespace           |
| `authentication`       | Auth modes, sessions, orgs, protecting routes                   |
| `security`             | Input validation, SQL injection, XSS, secrets, data scoping     |
| `a2a-protocol`         | Enabling inter-agent communication                              |
| `external-agents`      | Connecting Claude Code/Cowork/Codex; deep links; `link` builder |
| `recurring-jobs`       | Scheduled tasks the agent runs on a cron schedule               |
| `onboarding`           | Registering setup steps for API keys / OAuth                    |
| `secrets`              | Declaratively register API keys the template needs              |
| `automations`          | Event-triggered and schedule-triggered automations              |
| `integration-webhooks` | Cross-platform webhook → SQL queue → processor pattern          |
| `observability`        | Agent traces, evals, feedback, experiments, and dashboard       |
| `tracking`             | Server-side analytics with pluggable providers                  |
| `sharing`              | Per-user / per-org sharing and access checks on resources       |
| `voice-transcription`  | Voice dictation in the agent composer (Whisper / browser)       |
| `frontend-design`      | Building or styling any web UI, components, or pages            |
| `shadcn-ui`            | shadcn/ui components, CLI, composition, theming, and registries |
| `create-skill`         | Adding new skills for the agent                                 |
| `extensions`           | Creating, editing, and managing sandboxed mini-app extensions   |
| `capture-learnings`    | Recording corrections and patterns                              |

## All-Agent Support

`AGENTS.md` is the universal standard. It works with any AI coding tool. The framework creates symlinks so every tool reads the same instructions:

- `CLAUDE.md` → `AGENTS.md` (Claude Code)
- `.claude/skills/` → `.agents/skills/` (Claude Code skills)

Run `agent-native setup-agents` to create all symlinks (done automatically by `agent-native create`).

## Conventions

- **Never create or switch git branches unless the user explicitly asks — ever.** Multiple agents work on this repo concurrently, and they share one working tree. Branching off mid-flow strands other agents' uncommitted work (the `/new-branch` skill stashes uncommitted changes, and orphaned stashes pile up — we've already lost real work this way: babysit-pr stashed concurrent agents' Sentry instrumentation under `babysit-tickN-concurrent-work-*` names on 2026-05-05, leaving Sentry capture in clips and a new `analytics.ts` API stuck in a stash entry while the PR shipped without them; the in-file comment in `templates/clips/actions/finalize-recording.ts` even read _"the PR adding `captureRouteError` here lives in a sibling branch"_, but that sibling branch's work was the orphaned stash). Hard rules:
  - Default behavior is **stay on the current branch**. Treat the current branch as load-bearing — even if its name looks unusual (`ai_*`, `claude/*`, `codex/*`, `changes-N`, `updates-N`, `pr-NNN`, etc.). Those are platform-managed or other agents' branches; moving off them looks like work-loss to whoever started them.
  - **Do not invoke `/new-branch`**, `git checkout -b`, `git checkout <other-branch>`, `git switch`, or `git worktree add` on your own initiative. The `/new-branch` skill is user-invocable only — its frontmatter says so for a reason.
  - **Do not stash, force-push, reset --hard, branch -D, or rebase** on your own initiative. Each of these has been a vector for losing concurrent work.
  - **Commit instead of stashing.** If the working tree has a mix of your changes and another agent's, `git status` and ask which to keep — never stash to "clean up." Stashes get orphaned; commits are durable and visible to other agents.
  - **If the current branch genuinely looks wrong** (e.g. `git status` shows you're on `main` and about to commit there), stop and ask the user before moving. The user knows the shape of their concurrent agent setup; you don't.
  - **If the user's request seems to require a new branch** (e.g. "open a PR for X"), proceed on the current branch unless they explicitly say "from a fresh branch." Most PR/ship workflows in this repo are designed to push the current branch, not branch-then-push.
  - **Builder.io / Fusion environments** assign branches like `ai_*` or task-specific names from the platform side. Never move off them — the platform's UI tracks the user's work by that branch.

- **Publishable npm packages use changesets.** Every PR that touches source in `packages/core`, `packages/dispatch`, `packages/scheduling`, or `packages/pinpoint` must include a `.changeset/<slug>.md`. The `changeset-check` CI job blocks PRs that change source in a publishable package without one. To add a changeset, run `pnpm changeset add` (interactive) or write `.changeset/<short-slug>.md` directly:

  ```md
  ---
  "@agent-native/dispatch": patch
  ---

  One-line summary of the change for the changelog.
  ```

  Bump types: `patch` (bugfix / docs), `minor` (additive), `major` (breaking). One PR can declare multiple packages and mix bump types. The changeset file becomes part of the PR diff. On merge to `main`, `changesets/action` either opens a "Version Packages" PR (consuming the changesets into version bumps + changelog updates) or, when that PR merges, runs `pnpm changeset publish` to push to npm via OIDC trusted publisher. **Do NOT bump `package.json` versions manually — changesets does that.** If `babysit-pr` sees the `changeset-check` job fail, it parses the missing-package list and writes the `.changeset/*.md` for you. Templates and other private packages are skipped automatically (they don't ship to npm). Desktop-app stays version-triggered (electron-builder publishes binaries, not npm — see `packages/desktop-app/package.json`).

- **Actions first** — use `defineAction` for new operations; only create `/api/` routes for file uploads, streaming, webhooks, or OAuth callbacks.
- **Integration webhooks (Slack/Telegram/etc.) use the queue pattern.** The webhook handler verifies and enqueues to `integration_pending_tasks`, returns 200 immediately, then a self-fired `POST /_agent-native/integrations/_process-task` runs the agent loop in a fresh function execution. A 60s recurring job retries stuck tasks. This works on every serverless host — never use Netlify Background Functions, Cloudflare `waitUntil`, Vercel `after()`, or fire-and-forget promises after `return`. See `integration-webhooks` skill.
- **Reusable workspace integrations are a framework primitive.** Shared provider connections own provider identity, non-secret account metadata, credential ref names, per-app grants, and readiness summaries. Dispatch is the usual control plane for connecting, repairing, auditing, and granting them, and for distributing/approving shared workspace resources; the vault/secrets layer owns actual values. Domain apps still own app-specific source config, provider readers, cursors, and interpretation: Brain owns ingestion/distillation/review/search/citations, while Analytics owns data-source choice, metric definitions, dashboards, and analyses. Do not copy provider tokens into each app when a workspace connection can be granted instead, and do not claim workspace connections make OAuth flows or provider data readers universal unless that shared runtime exists.
- **Workspace apps are internal by default, with route-level public/private overrides.** In an app's `package.json`, use `"agent-native": { "workspaceApp": { "audience": "public", "protectedPaths": ["/admin"] } }` for a public site with login-only management pages, or keep the default internal audience and add `"publicPaths": ["/", "/share"]` for selected public pages. These knobs only affect read-only page navigation. `/_agent-native/*` and `/api/*` stay authenticated unless the app explicitly lists public routes in `createAuthPlugin({ publicPaths: [...] })`. Use auth plugin `publicPaths` only for public form submissions, booking APIs, webhooks, embeds, and other intentional public endpoints.
- **TypeScript everywhere** — all code must be `.ts`/`.tsx`. Never `.js` or `.mjs`.
- **Prettier** — run `npx prettier --write <files>` after modifying source files.
- **SSR for public pages, CSR for logged-in pages.** Any page a visitor can see without logging in — homepages, landing pages, docs, marketing, pricing — must server-side render so crawlers get real HTML. Logged-in app pages use client-side rendering via the `ClientOnly` wrapper in `root.tsx` to keep things simple. Never wrap public/SEO-critical content in `ClientOnly`. If a client-only component (e.g. `AgentSidebar`) needs to appear on a public page, render the page content directly and add the component as a client-only progressive enhancement (render children on server, mount the wrapper after hydration).
- **Always use shadcn/ui components for standard UI** — `app/components/ui/` (templates) or `packages/core/src/client/components/ui/` (framework). Available primitives include `Button`, `Dialog`, `AlertDialog`, `Popover`, `DropdownMenu`, `Tooltip`, `Sheet`, `Tabs`, `Select`, `Collapsible`, `Accordion`, `HoverCard`, `Command`, etc. **Never build a custom dropdown / menu / popover with `position: absolute` + a manual click-outside `useEffect`** — those get clipped by ancestor `overflow-hidden` / stacking contexts (no `z-index` will save them) and lack the keyboard nav, focus trap, and animations users expect. Use `<DropdownMenu>` for action menus (Rename / Delete / "⋯" overflow), `<Popover>` for transient panels (color pickers, share dialogs, filters), `<Dialog>` for modals, `<AlertDialog>` for confirmations. If a needed shadcn primitive is missing in a package, install it via `npx shadcn@latest add <name>` (templates) or copy from another template + add the matching `@radix-ui/react-*` dep (framework packages) — don't roll your own.
- **Tabler Icons** (`@tabler/icons-react`) for all icons. **Never use emojis as icons** — not in buttons, not in avatars, not in labels, not in toasts/notifications, not in outbound messages (Slack, email). No other icon libraries, no inline SVGs. Avoid sparkle and wand icons in first-party UI; they are overused. For chat / agent affordances, use a message-style icon instead. Emojis are fine when they are _user-authored content_ (a document title emoji picker, a reaction the user chose, a user-picked space icon) — the rule is about icons the UI picks, not data the user picks.
- **No browser dialogs** — use shadcn AlertDialog instead of `window.confirm/alert/prompt`.
- **Agent input surfaces use the shared composer.** Every UI that accepts a prompt
  for an agent must reuse the framework composer stack:
  `AgentComposerFrame`, `PromptComposer`, and `TiptapComposer`. Do not build a
  one-off textarea/chatfield, upload picker, voice control, model/mode picker,
  slash-command parser, or Enter-to-submit behavior. Host-specific UIs such as
  Agent-Native Code may add narrow slots around the shared composer — for
  example Auto/Plan controls or cwd/project metadata — but the input field,
  attachment pipeline, references, skills, voice dictation, draft behavior, and
  keyboard semantics stay shared. Slash commands come from project
  `.agents/commands` and `.agents/skills`; do not hardcode a separate command
  registry in a prompt surface.
- **Background agents reuse the shared run harness.** Hosted/background agent work
  must go through the core `run-manager` / `agent-teams` infrastructure so runs
  share SQL persistence, streaming, aborts, heartbeats, resume, and stuck-run
  behavior. Agent-Native Code is the local long-running exception today; new
  Code-adjacent surfaces should use the `@agent-native/core/code-agents`
  background-run adapter/foundation to bridge those local sessions instead of
  inventing another runner. Do not introduce a second background-agent harness
  for a new UI.
- **Template UX stays clean, minimal, and intuitive** — this is a high priority across all templates. Treat every important screen as a focused working surface, not a place to accumulate fixes as extra visible controls. When acting on feedback, especially broad prompts like "fix what you agree with," judge each suggestion through visual hierarchy, user intent, and progressive disclosure before changing the UI. Prefer clarifying primary actions, reducing competing elements, tightening layout, and moving secondary or rare actions into menus, sheets, tabs, or advanced sections. Do not solve feedback by adding more buttons, toolbars, badges, panels, helper text, filters, or always-visible options to important screens unless that added surface is genuinely the clearest path for the main workflow. If a fix would make a core screen busier, look for a cleaner interaction model or ask before adding clutter.
- **Progressive disclosure by default** — UIs should reveal complexity gradually, not dump every option on screen at once. Lead with the primary action and most-used info; hide the rest behind reveals. Concrete patterns: shadcn `Collapsible` / `Accordion` for grouped settings, `Popover` for secondary actions (share, filters, color pickers, "more options"), `DropdownMenu` overflow (`⋯`) for tertiary toolbar items, `Sheet` / side drawer for full-detail editing of a row, `HoverCard` or expand-on-click for card details, "Show advanced" toggles for optional form fields, tabs to split a long surface into focused sections. Anti-patterns we keep regressing into: a settings page that dumps 20 fields in one flat column, a form that shows every optional field upfront, a toolbar where every button has equal visual weight, a card that prints every metadata field instead of summary + expandable details, a dialog the size of the screen because the form has 15 fields, an empty state that scaffolds the full UI instead of one clear CTA. Rule of thumb: if a first-time user wouldn't need it in the first 5 seconds, collapse it. When in doubt, default to hiding — it's much cheaper to expose later than to declutter a busy screen.
- **Public template list is a strict allow-list — never widen it without flipping `hidden:false` first.** The single source of truth is `packages/shared-app-config/templates.ts` (entries with `hidden: false`). Today the public allow-list is exactly: **calendar, content, slides, videos, clips, analytics, mail, dispatch, forms, design, brain, assets** — plus `starter` for the CLI only. The featured/default set is narrower: **calendar, content, slides, clips, analytics, mail, dispatch, forms, design, brain, assets** — plus `starter` for the CLI/default-app fallback. Videos is scaffoldable by explicit slug, but it is not featured on the homepage, `/templates`, docs sidebar, CLI picker, or desktop/mobile default tabs. Hidden templates (calls, meeting-notes, voice, scheduling, issues, recruiting, macros) MUST NOT appear on the homepage, in the docs sidebar, in docs pages, or in the CLI catalog. Surfaces that hardcode their own list — `packages/docs/app/components/TemplateCard.tsx`, `packages/docs/app/components/docsNavItems.ts`, docs pages `packages/core/docs/content/template-*.md`, and the CLI duplicate `packages/core/src/cli/templates-meta.ts` — must only reference allow-listed slugs. To make a hidden template public: flip `hidden: false` in `packages/shared-app-config/templates.ts` AND `packages/core/src/cli/templates-meta.ts`, then add it to the surfaces above. To hide one: flip `hidden: true` in both files; the guard will then point you at every surface that still mentions it. `scripts/guard-template-list.mjs` (CI + `pnpm prep`) enforces this — adding a slug that isn't in the allow-list will fail the build. _This guard exists because agents kept re-adding the hidden templates (calls, meeting-notes, voice, scheduling, issues, recruiting, macros) to the homepage and sidebar during overnight sweeps. Do not disable it._
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

## Extensions

Extensions are mini sandboxed Alpine.js apps that run inside iframes. The agent can create, edit, and manage them at runtime without modifying the app's source code. See the `extensions` skill for full patterns.

> **Extensions vs. LLM tools.** This codebase uses the word "tool" in two distinct senses. _Extensions_ (this primitive) are user-facing sandboxed mini-apps. _LLM tools_ are the function-calling primitives the agent invokes — `tool: { description, parameters }` on an `ActionEntry`, MCP tools (`mcp__<server-id>__*`), and entries in the agent's tool registry. Both exist in this codebase; never confuse them. Physical SQL tables (`tools`, `tool_data`, `tool_shares`, `tool_history`, `tool_id`, `tool_consents`, `tool_slots`, `tool_slot_installs`) keep their original names — only the user-facing primitive concept and the Drizzle export names (`extensions`, `extensionData`, `extensionShares`) use the new term.

**IMPORTANT:** When a user asks to "create an extension" or "make a ... extension" (or the older "create a tool" / "make a tool" phrasing), use the `create-extension` action with Alpine.js HTML content. Do NOT create React components, actions, or schema changes.

### Extension Capabilities

Extensions are 100% self-contained. They have FULL access to app data, external APIs, and their own persistent storage — **without any source code changes, new files, Builder, or schema migrations.**

| Helper                                           | Purpose                                                   | Example                                                   |
| ------------------------------------------------ | --------------------------------------------------------- | --------------------------------------------------------- |
| `extensionData.set(collection, id, data, opts?)` | Persist data per-extension                                | `extensionData.set('notes', id, { text: '...' })`         |
| `extensionData.list(collection, opts?)`          | List persisted items                                      | `extensionData.list('notes', { scope: 'all' })`           |
| `extensionData.get(collection, id, opts?)`       | Get a single item                                         | `extensionData.get('notes', 'note-1')`                    |
| `extensionData.remove(collection, id, opts?)`    | Delete persisted item                                     | `extensionData.remove('notes', 'note-1')`                 |
| `appAction(name, params)`                        | Call any app action                                       | `appAction('list-emails', { view: 'inbox' })`             |
| `dbQuery(sql, args)`                             | Read from SQL                                             | `dbQuery('SELECT * FROM tools')`                          |
| `dbExec(sql, args)`                              | Write to SQL                                              | `dbExec('INSERT INTO ...')`                               |
| `appFetch(path, options)`                        | Call allowed framework endpoints under `/_agent-native/*` | `appFetch('/_agent-native/application-state/navigation')` |
| `extensionFetch(url, options)`                   | External API via proxy                                    | `extensionFetch('https://api.github.com/...')`            |

> Legacy aliases `toolFetch` and `toolData` are still exposed inside the iframe for backward compatibility with existing extension HTML — prefer the `extension*` names in new code.

Use `appAction(name, params)` for template data/actions such as `list-events` or `list-emails`. Extension `appFetch()` is limited to framework `/_agent-native/*` endpoints; template `/api/*` routes are intentionally blocked by the iframe bridge.

**`extensionData` is a built-in per-extension key-value store with user/org scoping.** When a user asks to "add persistence", "save data", or "remember state" in an extension, use `extensionData` — no SQL schema, no new tables, no source code, no Builder. Data is automatically scoped by extension ID. All methods accept an optional `{ scope }` option: `'user'` (default, private), `'org'` (shared with org), or `'all'` (list/get only — returns both).

**NEVER suggest Builder, source code changes, or new files for extension modifications.** All extension changes go through `update-extension` (to edit the Alpine.js HTML or metadata) or `extensionData` (to persist data).

### How it works

- Extensions are stored in the `tools` SQL table (Drizzle export `extensions`) and rendered via `GET /_agent-native/extensions/:id/render` inside a sandboxed iframe.
- Extension snapshots are stored in `tool_history`; use history actions or the viewer History popover to inspect diffs and restore older content.
- `extensionFetch()` proxies API calls through `POST /_agent-native/extensions/proxy`, which injects encrypted secrets (`${keys.NAME}` pattern) and enforces SSRF protections.
- Extensions inherit the main app's Tailwind v4 theme automatically.
- Sharing uses the standard framework model (`ownableColumns()` + `createSharesTable()`): private by default, shareable with org or specific users. The shares table is `tool_shares` in SQL (Drizzle export `extensionShares`).
- **Extensions cannot be public, and individual user shares must target an org member or pending invitee.** Extension HTML executes inside an iframe but calls actions / SQL / the secrets-injecting proxy as the _viewer_, so a public extension would let any signed-in user run arbitrary code with someone else's credentials, and a cross-org user share would do the same for outsiders. The extension registration sets `allowPublic: false` and `requireOrgMemberForUserShares: true` (see `packages/core/src/extensions/store.ts`); `set-resource-visibility('public')` and `share-resource` reject those calls, `updateExtension` rejects `visibility: "public"` directly, the share popover hides the "Public" option, and `scripts/guard-extension-no-public.mjs` (CI + `pnpm prep`) statically enforces both flags. Do not weaken either flag without replacing the trust model first.

### Agent actions for extensions

| Action                              | What it does                                                              |
| ----------------------------------- | ------------------------------------------------------------------------- |
| `create-extension`                  | Create a new extension (name, description, Alpine.js HTML content)        |
| `update-extension`                  | Update an extension — use `patches`/`edits` for targeted HTML changes     |
| `list-extension-history`            | List saved history versions for an extension                              |
| `get-extension-history-version`     | Inspect one saved version with a previous-version diff                    |
| `restore-extension-history-version` | Restore name, description, icon, and HTML content from a saved version    |
| `navigate`                          | Navigate to `--view=extensions` or `--view=extensions --extensionId=<id>` |

### Routes

| Method | Path                                                     | Purpose                                           |
| ------ | -------------------------------------------------------- | ------------------------------------------------- |
| GET    | `/_agent-native/extensions`                              | List extensions (filtered by ownership + sharing) |
| POST   | `/_agent-native/extensions`                              | Create an extension                               |
| GET    | `/_agent-native/extensions/:id`                          | Get an extension                                  |
| PUT    | `/_agent-native/extensions/:id`                          | Update (supports `patches` for diffing)           |
| DELETE | `/_agent-native/extensions/:id`                          | Delete an extension                               |
| GET    | `/_agent-native/extensions/:id/render`                   | Render HTML for iframe                            |
| GET    | `/_agent-native/extensions/:id/history`                  | List saved extension versions                     |
| GET    | `/_agent-native/extensions/:id/history/:version`         | Get one version and diff                          |
| POST   | `/_agent-native/extensions/:id/history/:version/restore` | Restore a version                                 |
| POST   | `/_agent-native/extensions/proxy`                        | Authenticated proxy with secret injection         |

### Secrets for extensions

Extensions reference secrets via `${keys.NAME}` in `extensionFetch()` headers and body. Create ad-hoc secrets via `POST /_agent-native/secrets/adhoc` with a `urlAllowlist` to restrict which domains the secret can be sent to.

## Auto-Memory

The agent proactively saves learnings to `LEARNINGS.md` when users correct it, share preferences, or reveal patterns. This is part of the system prompt in `agent-chat-plugin.ts` (FRAMEWORK_CORE section).
