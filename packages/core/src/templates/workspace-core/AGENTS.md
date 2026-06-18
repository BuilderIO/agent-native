# {{APP_TITLE}} Workspace Instructions

These instructions apply to every app in the {{APP_TITLE}} workspace. Keep
only rules that should be shared across all apps here. App-specific behavior
belongs in that app's own `AGENTS.md` or `.agents/skills/` directory.

## Framework Docs Lookup

Version-matched Agent Native docs ship with `@agent-native/core` in
`node_modules/@agent-native/core/docs`.

- From an app directory, use `pnpm action docs-search --query "<topic>"`,
  `pnpm action docs-search --slug <slug>`, or `pnpm action docs-search --list`.
- If the action runner is unavailable, read
  `node_modules/@agent-native/core/docs/AGENTS.md` and search
  `node_modules/@agent-native/core/docs/content/` directly with `rg`.
- For advanced workspace features, start with `workspace`, `multi-app-workspace`,
  `a2a-protocol`, `pure-agent-apps`, `automations`, `recurring-jobs`,
  `external-agents`, `mcp-protocol`, `sharing`, and `security`.

Use package docs for framework APIs, and use this `AGENTS.md` plus
`.agents/skills/` for workspace-specific conventions.

## Shared Context

Add company, product, compliance, or support-context notes that every app
agent should know.

## Shared Conventions

- All AI/LLM behavior goes through the app's agent chat. UI and server code
  must not call model providers, AI SDK `generateText()` / `streamText()`, or
  other inline LLM APIs directly. Use `sendToAgentChat()` for local app-agent
  work, including hidden `context` and `submit: false` prefill/review flows.
  Only use `useAgentChatContext`, `setAgentChatContextItem`,
  `listAgentChatContext`, `removeAgentChatContextItem`, and
  `clearAgentChatContext` when UI needs two-way sync with staged context chips.
  Read `.agents/skills/delegate-to-agent/SKILL.md` before building agent-driven
  UI or "AI" features.
- Put shared code in `packages/shared` only when multiple apps need it.
- Keep app-specific screens, actions, state, and skills inside `apps/<app>`.
- Store shared runtime configuration in the workspace root `.env`; use
  `apps/<app>/.env` only for app-specific overrides. Never hardcode API keys,
  tokens, webhook URLs, signing secrets, private Builder/internal data, customer
  data, or credential-looking literals in source, docs, prompts, fixtures,
  application state, action responses, or generated app content. Use
  secrets/OAuth/runtime configuration and obvious placeholders in examples.
- Prefer framework defaults until the workspace has a real custom rule,
  component, plugin, action, or skill to share.
- Keep the Workspace files view for user-authored or user-requested resources.
  Agents may create hidden `agent_scratch` resources for temporary working
  notes, scripts, task plans, or intermediate outputs, but should promote them
  to normal workspace visibility only when the user explicitly asks to keep or
  manage the file.
- Runtime-editable global resources can be managed from Dispatch Resources.
  Use `AGENTS.md` or `instructions/<slug>.md` for always-on guardrails,
  `skills/<slug>/SKILL.md` for workspace skills, `context/<slug>.md` for
  personas/positioning/messaging/company facts/brand guidelines, and
  `agents/<slug>.md` for custom agent profiles. Scope them to All apps when
  every workspace app should inherit them. All-app resources are inherited at
  runtime; do not copy or sync them into individual apps.

## Adding Apps

When a user asks from Dispatch chat or by tagging `@agent-native` in Slack to
create, build, make, scaffold, or generate an "agent", classify the ask first.
Simple Dispatch-native behavior such as a reminder, digest, monitor, routing
rule, saved instruction, or recurring workflow can stay in Dispatch as a
recurring job/resource/destination. Robust unique products or teammates that
need their own UI, data model, actions, integrations, or domain workflow should
become a separate workspace app under `apps/<app-name>`, mounted at
`/<app-name>`.

Do not implement a new app by adding a route, page, component, or file to
`apps/chat` or another existing app unless the user explicitly asks to modify
that existing app.

Dispatch vault access is workspace-wide by default: every saved vault key is
available to every workspace app. Only create or request per-app vault grants
when Dispatch's vault access setting is switched to manual mode.

Workspace apps are discovered from `apps/<app-name>/package.json`. There is no
separate workspace app registry to edit for Dispatch to list the app. Always
save a concise, human-readable `description` there; Dispatch lists and A2A
connected-agent context use the app name plus description so agents know what
the app does. Use relative workspace links like `/<app-name>` and never
hardcode `localhost`, `127.0.0.1`, `8080`, `8100`, or any dev port in app
cards, instructions, redirects, or navigation; the active workspace
gateway/browser origin owns the port. React Router apps must preserve
`APP_BASE_PATH` / `VITE_APP_BASE_PATH` in
`app/entry.client.tsx` via `appBasePath()` so the app hydrates correctly when
mounted at `/<app-name>`. Use the framework/template UI stack for standard UI:
shadcn/ui components and `@tabler/icons-react`. Do not add `lucide-react` or
another icon library. Read `.agents/skills/shadcn-ui/SKILL.md` before adding,
updating, or debugging shadcn components.

Normal app data must flow through actions. For CRUD that the agent can perform,
create `defineAction` files in `actions/`, mark reads with
`http: { method: "GET" }`, and call them from React with `useActionQuery` /
`useActionMutation`. Do not add duplicate JSON CRUD routes under `/api/*` for
the same data unless the route is for uploads, streaming, webhooks, OAuth, or
another route-only concern. Do not add routes whose main job is to wrap,
proxy, or re-export an action; the action endpoint already exists at
`/_agent-native/actions/:name`. Action-backed UI is what makes agent-created or
agent-edited records appear without a manual refresh.

App database code must be provider-agnostic. Define schemas with
`@agent-native/core/db/schema` helpers and write app reads/writes with Drizzle's
query builder and portable `drizzle-orm` operators. Do not import from
`drizzle-orm/sqlite-core` or `drizzle-orm/pg-core` in app templates. Keep raw SQL
for additive migrations, health checks, or carefully scoped maintenance, and
never write SQLite-only or Postgres-only product code.

In local development, run
`pnpm exec agent-native create <app-name> --template=<template>` from the
workspace root. In production, Dispatch posts new-app requests to Builder
branch creation; Builder should still scaffold the separate workspace app. The
workspace dev gateway (`pnpm dev`) detects new `apps/<app-name>` directories
automatically.

When using the chat template, treat it as scaffolding only. The finished app
must be branded as the requested app, with its own home screen, navigation,
package metadata, manifest, and domain workflow. Do not leave visible
`Chat`, `Starter`, `Blank app`, `Start building`, or `New app` UI in a chat-derived
app.
