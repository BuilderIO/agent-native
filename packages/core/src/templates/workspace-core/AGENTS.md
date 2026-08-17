# {{APP_TITLE}} Workspace Instructions

These instructions apply to every app in the {{APP_TITLE}} workspace. Keep
only rules that should be shared across all apps here. App-specific behavior
belongs in that app's own `AGENTS.md` or `.agents/skills/` directory.

## Skills

Read the matching skill in `.agents/skills/` before working in that area.

| Skill | Read before |
| --- | --- |
| `workspace-conventions` | Shared vs app-owned code, file/blob storage, env and secrets, scratch files, Dispatch Resources |
| `adding-a-feature` | Adding a cross-cutting feature or capability |
| `agent-native-docs` | Looking up version-matched framework docs, slugs, or the bundled source corpus |
| `agent-native-toolkit` | Building workspace or agent UI, app chrome, settings, sharing, or collaboration |
| `customizing-agent-native` | Adapting, overriding, or ejecting shared framework UI |
| `delegate-to-agent` | Building agent-driven UI or any "AI" feature |
| `actions` | Adding or changing an app operation the agent and UI share |
| `frontend-design` | Any user-facing UI change |
| `real-time-sync` | Keeping UI queries current after agent or action writes |
| `shadcn-ui` | Adding, updating, or debugging a shadcn/ui primitive |
| `security`, `sharing` | Access scoping, ownable data, and sharing user-authored resources |
| `secrets`, `storing-data` | Credentials or persisted application data |
| `self-modifying-code` | Agent-editable app source and protected paths |

This is the complete default inherited set. Feature flags, translations,
changelogs, integrations, automations, A2A workflows, and release/promotion
helpers stay available as opt-in skills for the apps that use them.

## Shared Context

Add company, product, compliance, or support-context notes that every app
agent should know.

## Core Rules

- All AI/LLM behavior goes through the app's agent chat. UI and server code must
  not call model providers or AI SDK `generateText()` / `streamText()` directly;
  use `sendToAgentChat()`. Keep actions deterministic and focused. Research,
  analysis, generation, recommendation, and synthesis open the AgentSidebar with
  `sendToAgentChat({ openSidebar: true })` and stay in the same thread — never a
  second freeform textbox. Read `delegate-to-agent` first.
- Keep domain workflows on named routes and preserve the scaffold's full-page
  chat route.
- Keep the first viewport focused: one primary action, progressive disclosure,
  concise copy, and domain-specific navigation. Never use sparkle, wand,
  magic, or robot icons as AI affordances.
- Data loads use layout-matching `Skeleton` geometry, never a
  generic "Loading..." label. Reserve `Spinner` for brief mutations, uploads,
  and progress actions.
- Before visual work, read `frontend-design` and the workspace/app `DESIGN.md`.
  Keep shared chrome semantic and neutral, then choose an app-specific visual
  direction and palette family instead of copying a sibling app by default.
- Every AI-labeled button must call `sendToAgentChat()` with
  `openSidebar: true`; label deterministic local actions as local or preview.
- Normal app data must flow through actions. Define `defineAction` files in
  `actions/`, mark reads with `http: { method: "GET" }`, and call them from React
  with `useActionQuery` / `useActionMutation`. Do not add `/api/*` routes that
  duplicate, wrap, proxy, or re-export an action.
- Keep app-specific screens, actions, state, and skills inside `apps/<app>`. Put
  shared code in `packages/shared` only when multiple apps need it.
- App database code must be provider-agnostic: `@agent-native/core/db/schema`
  helpers plus Drizzle's query builder. Never import `drizzle-orm/sqlite-core`
  or `drizzle-orm/pg-core` from an app.
- SQL is for structured records, metadata, references, and searchable text.
  Large files and blob payloads belong in configured file/blob storage; persist
  only URLs, ids, or handles.
- Never hardcode API keys, tokens, webhook URLs, signing secrets, private
  Builder/internal data, customer data, or credential-looking literals anywhere,
  including application state, action responses, and generated app content. Use
  secrets/OAuth/runtime configuration and obvious placeholders.
- Never hardcode `localhost`, `127.0.0.1`, or a dev port. Use relative workspace
  links like `/<app-name>`; the workspace gateway origin owns the port.
- Do not implement a new app by adding routes, pages, or files to `apps/chat` or
  another existing app unless the user explicitly asks to modify that app. Read
  `adding-workspace-apps` first.
- Prefer framework defaults until the workspace has a real custom rule,
  component, plugin, action, or skill to share.
- Before building common workspace or agent UI, read `agent-native-toolkit` to
  inventory existing public kits and installed package seams. Read
  `customizing-agent-native` before adapting shared UI: configure → compose →
  eject the smallest unit → propose a shared seam. Never edit `node_modules`.

## Framework Docs

Version-matched Agent Native docs and a source-only corpus of core and
first-party template patterns ship with `@agent-native/core`. From an app
directory, use `pnpm action docs-search --query "<topic>"` and
`pnpm action source-search --query "<pattern>"`. Read `workspace-conventions`
for slugs, the `--list` / `--slug` / `--path` options, and the `rg` fallback.
Use package docs for framework APIs, the corpus for reusable patterns, and this
file plus `.agents/skills/` for workspace-specific conventions.

## Actions

| Action | Purpose |
| --- | --- |
| `docs-search` | Search version-matched framework docs by query or slug, or list |
| `source-search` | Search the bundled core/template source corpus by pattern or path |
