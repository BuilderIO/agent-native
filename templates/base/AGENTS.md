# Base — Agent Guide

Un-opinionated blank agent-native starter. `/` starts as an empty screen; grow
this into a to-do list, an SEO app, or anything else. Actions carry the
capabilities. Do not leave "Base", "Chat", "Starter", or "Blank app" traces
in the finished product — use the app's real name.

## Skills

Read the matching skill before implementation. Before building common workspace or
agent UI, read `agent-native-toolkit` and `customizing-agent-native` for the
configure → compose → eject ladder.

The default skill surface is small. Promotion, learning, provider, and release
workflows are optional; enable the matching skill only when this app uses that
workflow.

**Do not add internationalization or changelog support unless the user
explicitly asks.** This template ships English-only UI copy inline — no
`app/i18n/`, LanguagePicker, `CHANGELOG.md`, or What's New. If the user asks
for translation / localisation / internationalization, read the
`internationalization` skill (docs-search / `agent-native-docs`) and add only
what they asked for. If they ask for changelogs or What's New, read the
`changelog` skill the same way.

The `docs-search` action reads the version-matched framework docs bundled with
  `@agent-native/core`; `source-search` reads core and first-party template
  implementations. Prefer both over memory when package APIs, actions, or agent
  surfaces are involved.

## Core Rules

- Follow the root framework contract: data in SQL, actions first, application
  state for navigation/selection, and shared agent chat for AI work.
- Store large file/blob payloads in configured file/blob storage, not SQL: no
  base64, `data:` URLs, images, video/audio, PDFs, ZIPs, screenshots,
  thumbnails, or replay chunks in app tables, `application_state`, `settings`,
  or `resources`; persist URLs, ids, or handles instead.
- Never hardcode API keys, tokens, webhook URLs, signing secrets, private
  Builder/internal data, customer data, or credential-looking literals. Use
  secrets/OAuth/runtime configuration and obvious placeholders in examples.
- For external integrations, inspect the workspace/provider connection catalog
  first. Reuse an existing connection and its scoped credential resolver; only
  use app-local vault/OAuth/settings primitives when no reusable connection
  exists. Keep custom setup UI provider-specific and never duplicate storage.
- Keep actions deterministic and focused. Research, analysis, generation,
  recommendation, and synthesis start in the AgentSidebar and let the agent
  orchestrate its tools; follow-ups stay in the same thread rather than moving
  the user to a second freeform prompt box.
- Never fabricate. If an action fails or data is missing, say so and recover
  instead of inventing a result or claiming success.
- Verify a write before reporting it done — re-read the row or the screen.
- Use `view-screen` or application state when the user's visible context
  matters.

## Lightweight defaults

This template does not ship locale catalogs or changelog files. Add them only
when the user asks.

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
formatter. Add a changelog entry only when the user asks and `changelog.enabled`
is true in the app's `agent-native.config.ts`.
