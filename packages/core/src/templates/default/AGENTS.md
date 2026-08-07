# {{APP_NAME}} — Agent Guide

This is an agent-native app: the UI and agent share SQL state and the same
action surface. Use the app's existing patterns before adding new ones.

## Skills

Read the matching skill before implementation. Before building common workspace or agent UI, read `agent-native-toolkit` and `customizing-agent-native` for the
configure → compose → eject ladder. Start with `actions` for app operations,
`storing-data` for persistence, `real-time-sync` for live updates, and
`security` for auth, access, and secrets. Use `adding-a-feature` for new
cross-cutting work and `self-modifying-code` when changing app source.

## Core rules

- Store structured state in SQL through Drizzle; store large files in configured
  file/blob storage and persist only URLs, ids, or opaque handles.
- Normal app data must flow through actions.
- Do not create `/api/*` routes that only call, repackage, or proxy an action.
- Define app operations with `defineAction` in `actions/`. The agent and UI
  call the same action surface; do not duplicate an action with a JSON route.
- If you are about to add `server/routes/api/`, stop and write an action
  instead, except for uploads, streaming, webhooks, OAuth callbacks, public
  unauthenticated URLs, or non-JSON responses.
- Keep database code provider-agnostic and migrations additive. Do not use
  adapter-only database methods or production schema push commands.
- All user-facing AI work goes through the agent chat. UI and server code do
  not call model providers or inline LLM APIs directly, or hide AI-shaped
  multi-step work in one action.
  Keep actions deterministic and focused; use the AgentSidebar for research,
  analysis, generation, recommendation, synthesis, and follow-ups in the same
  thread.
- Keep domain workflows on named routes and preserve the scaffold's full-page
  chat route. Use the right AgentSidebar for contextual AI and open it when a
  domain button hands work to the agent.
- Keep the first viewport focused: one primary action, progressive disclosure,
  concise copy, and no generic Chat label for a domain page. Never use sparkle,
  wand, magic, or robot icons as AI affordances.
- Use a sans-first SaaS hierarchy with one restrained visual cue; reserve serif
  type for content previews. Give the AgentSidebar a subtle surface/divider
  boundary, and stack original/generated review vertically by default.
- Before visual work, read `frontend-design` and fill in `DESIGN.md` with the
  product mode, visual direction, palette family, type, composition, and
  anti-references. Preserve existing brand tokens and do not default every app
  to warm beige plus terracotta or copy a sibling app's accent.
- Every AI-labeled button must call `sendToAgentChat()` with
  `openSidebar: true`; label deterministic local actions as local or preview.
- Keep application state in SQL so the agent can read navigation, selection,
  and focused-object context.
- Never hardcode keys, tokens, webhook URLs, private data, or credential-like
  literals. Use secrets, OAuth, or obvious placeholders.
- A missing or unreadable value must stay distinguishable from success. Throw or
  return an explicit error instead of silently falling back to an empty value.

## Application state

Use the existing `application_state` helpers for navigation and selection. Keep
the shape small and explicit; include the current route/view and the selected
object id when the UI has one.

## Actions

Actions in `actions/` are callable from the agent, UI hooks, HTTP, MCP, A2A,
and CLI where enabled. Validate inputs with Zod, return structured data, and
scope reads and writes to the signed-in user or organization. Prefer
`useActionQuery` and `useActionMutation` in browser code.

## Authentication and access

Auth is real Better Auth in development and production. Use `getSession()` or
the shared request context and fail closed when there is no session. Never use a
sentinel identity such as `local@localhost`. Tables with ownable columns need
scoped reads and writes through the framework access helpers.

## UI and sync

Use the shared toolkit and shadcn primitives for standard controls. Keep UI
optimistic where safe, roll back failed mutations, and use `useDbSync()` or
action query invalidation to reflect agent writes without a manual refresh.

## Documentation lookup

Version-matched docs and source examples ship with `@agent-native/core`. Use
`pnpm action docs-search --query "<topic>"` and
`pnpm action source-search --query "<pattern>"`; read the relevant local skill
before relying on a framework API. Do not edit `node_modules` or deep-import
private package internals.

## Verification

Match checks to the change: run the existing focused tests, typecheck, and
formatter. For a user-facing template change, record a changelog entry from
the app with `agent-native changelog add` when appropriate.
