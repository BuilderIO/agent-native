# {{APP_TITLE}} Workspace Instructions

These instructions apply at the workspace root. App-specific behavior belongs
in `apps/<app>/AGENTS.md`; shared cross-app behavior belongs in
`packages/shared/AGENTS.md` or `packages/shared/.agents/skills/`.
The root `.agents/skills` path points at the shared package's skills so local
coding agents can discover the same workspace-wide guidance from the root.

## Framework Docs Lookup

Version-matched Agent Native docs ship with `@agent-native/core` in
`node_modules/@agent-native/core/docs`. A source-only corpus of core and
first-party template patterns ships in `node_modules/@agent-native/core/corpus`.

- From an app directory, use `pnpm action docs-search --query "<topic>"`,
  `pnpm action docs-search --slug <slug>`, or `pnpm action docs-search --list`.
  Use `pnpm action source-search --query "<pattern>"` or
  `pnpm action source-search --path <path>` when source examples matter.
- From the workspace root, read `node_modules/@agent-native/core/docs/AGENTS.md`
  and search `node_modules/@agent-native/core/docs/content/` directly with `rg`.
  Search `node_modules/@agent-native/core/corpus/` for core and template source
  examples.
- For advanced workspace features, start with `workspace`, `multi-app-workspace`,
  `a2a-protocol`, `pure-agent-apps`, `automations`, `recurring-jobs`,
  `external-agents`, `mcp-protocol`, `sharing`, and `security`.

Use package docs for framework APIs, the package corpus for reusable
framework/template patterns, and `packages/shared/AGENTS.md` plus
`packages/shared/.agents/skills/` for workspace-specific conventions.
After updating `@agent-native/core`, run `pnpm skills:update` or
`npx @agent-native/core@latest skills update scaffold --project` from the
workspace root to refresh framework-provided shared skills and repair
`CLAUDE.md` / `.claude/skills` compatibility links.

## Core Agent Rule

- All AI/LLM behavior goes through the app's agent chat. UI and server code
  must not call model providers, AI SDK `generateText()` / `streamText()`, or
  other inline LLM APIs directly. Use `sendToAgentChat()` for local app-agent
  work, including hidden `context` and `submit: false` prefill/review flows.
  Only use `useAgentChatContext`, `setAgentChatContextItem`,
  `listAgentChatContext`, `removeAgentChatContextItem`, and
  `clearAgentChatContext` when UI needs two-way sync with staged context chips.
  Read `packages/shared/.agents/skills/delegate-to-agent/SKILL.md` before
  building agent-driven UI or "AI" features.

## Workspace Resources

- The Workspace files view is for user-authored or user-requested resources
  they intentionally add, edit, or manage.
- Agents may use hidden `agent_scratch` resources for temporary working notes,
  scripts, task plans, or intermediate outputs. Keep those scratch files hidden
  by default and promote them only when the user explicitly asks to keep or
  manage the file.
- Durable instructions, skills, jobs, memories, custom agents, and files the
  user explicitly asked to save belong in normal workspace visibility.
- Runtime-editable global resources are managed from Dispatch Resources. Use
  `AGENTS.md` or `instructions/<slug>.md` for always-on guardrails,
  `skills/<slug>/SKILL.md` for workspace skills, `context/<slug>.md` for
  personas/positioning/messaging/company facts/brand guidelines, and
  `agents/<slug>.md` for custom agent profiles.
- Set Dispatch resources to All apps when every workspace app should inherit
  them. Use selected-app grants only for resources that should not be global.

## Workspace Scope

- Keep root changes focused on workspace orchestration, shared configuration,
  deploy settings, and monorepo tooling.
- Keep application routes, actions, server plugins, and app state inside the
  relevant `apps/<app>` directory unless multiple apps need the same behavior.
- Put reusable code in `packages/shared` only after at least two apps need it.
- Never copy live credentials, API keys, tokens, webhook URLs, signing secrets,
  personal email addresses, customer data, private Builder/internal data, or
  company-specific placeholder values into source files, docs, prompts,
  fixtures, application state, action responses, or generated app content. Use
  secrets/OAuth/runtime configuration and obvious placeholders in examples.

## New Workspace Apps

- When a user asks from Dispatch chat or by tagging `@agent-native` in Slack to
  create, build, make, scaffold, or generate an "agent", classify the ask
  first. Simple Dispatch-native behavior such as a reminder, digest, monitor,
  routing rule, saved instruction, or recurring workflow can stay in Dispatch
  as a recurring job/resource/destination. Robust unique products or teammates
  that need their own UI, data model, actions, integrations, or domain workflow
  should become a separate workspace app under `apps/<app-id>`, mounted at
  `/<app-id>`.
- When a user explicitly asks for a new app or workspace app, create the
  separate workspace app.
- For composable workflows, prefer many one-job headless or small-UI apps that
  discover and call sibling apps over A2A. Read
  `packages/shared/.agents/skills/composable-mini-apps/SKILL.md` before
  designing cross-app orchestration.
- Dispatch vault access is workspace-wide by default: every saved vault key is
  available to every workspace app. Only create or request per-app vault grants
  when Dispatch's vault access setting is switched to manual mode.
- Do not satisfy a new-app request by adding a route, page, component, or file
  to `apps/chat` or another existing app unless the user explicitly asks to
  modify that existing app.
- Treat first-party apps such as Mail, Calendar, Analytics, Brain, Assets, and Dispatch as
  existing hosted/connected neighbors available through links and A2A/default
  connected agents. For example, Mail, Calendar, Analytics, Brain, and Assets already exist at
  `https://mail.agent-native.com`, `https://calendar.agent-native.com`, and
  `https://analytics.agent-native.com`, `https://brain.agent-native.com`, and
  `https://assets.agent-native.com`.
- If a new app needs to use Mail, Calendar, Analytics, Brain, Assets, or similar first-party
  data/agents, build only the genuinely new workflow and delegate/link to those
  existing apps. Do not create wrapper apps, child apps, nested template copies,
  or cloned Mail/Calendar/Analytics/Brain/Assets implementations inside the new app just to
  provide access.
- Only create a first-party app copy when the user explicitly asks for a
  customized fork/copy of that app. Otherwise prefer the hosted/shared app so
  base template improvements continue to flow automatically.
- Workspace apps are discovered from `apps/<app-id>/package.json`. There is no
  separate workspace app registry to edit for Dispatch to list the app.
- Always save a concise, human-readable `description` in the generated app's
  `apps/<app-id>/package.json`. Dispatch lists and A2A connected-agent context
  use the app name plus this description so other agents understand what the app
  does. Dispatch users can later edit the displayed name/description from the
  Apps page without changing source.
- All sibling workspace apps are accessible by default over A2A through
  `call-agent`. Agents receive a compact list of available app names and
  descriptions in prompt context; use tool search or app-specific actions only
  when more detail is needed.
- Use relative workspace links like `/<app-id>`. Never hardcode
  `localhost`, `127.0.0.1`, `8080`, `8100`, or any dev port in app cards,
  instructions, redirects, or navigation; the active workspace gateway/browser
  origin owns the port.
- React Router apps must preserve `APP_BASE_PATH` / `VITE_APP_BASE_PATH` in
  `app/entry.client.tsx` via `appBasePath()` so the app hydrates correctly
  when mounted at `/<app-id>`.
- Use the framework/template UI stack for standard UI: shadcn/ui components and
  `@tabler/icons-react`. Do not add `lucide-react` or another icon library.
  Read `packages/shared/.agents/skills/shadcn-ui/SKILL.md` before adding,
  updating, or debugging shadcn components.
- Normal app data must flow through actions. For CRUD that the agent can
  perform, create `defineAction` files in `actions/`, mark reads with
  `http: { method: "GET" }`, and call them from React with `useActionQuery` /
  `useActionMutation`. Do not add duplicate JSON CRUD routes under `/api/*`
  for the same data unless the route is for uploads, streaming, webhooks,
  OAuth, or another route-only concern. Do not add routes whose main job is to
  wrap, proxy, or re-export an action; the action endpoint already exists at
  `/_agent-native/actions/:name`. Action-backed UI is what makes agent-created
  or agent-edited records appear without a manual refresh.
- App database code must be provider-agnostic. Define schemas with
  `@agent-native/core/db/schema` helpers and write app reads/writes with
  Drizzle's query builder and portable `drizzle-orm` operators. Do not import
  from `drizzle-orm/sqlite-core` or `drizzle-orm/pg-core` in app templates.
  Keep raw SQL for additive migrations, health checks, or carefully scoped
  maintenance, and never write SQLite-only or Postgres-only product code.
- In local development, scaffold the app from the workspace root with
  `pnpm exec agent-native create <app-id> --template=<template>`. In production
  Dispatch posts the request to Builder branch creation; the Builder branch
  should still create the separate workspace app, not patch chat. The local
  workspace gateway detects new app directories automatically and starts each
  app server lazily on first visit.
- When using the chat template, treat it as scaffolding only. The finished
  app must be branded as the requested app, with its own home screen,
  navigation, package metadata, manifest, and domain workflow. Do not leave
  visible `Chat`, `Starter`, `Blank app`, `Start building`, or `New app` UI in
  a chat-derived app.

## Workspace Identity

Use the workspace root `.env` for shared identity and cross-app trust settings:

- `WORKSPACE_ORG_NAME` — human-readable organization name.
- `WORKSPACE_ORG_DOMAIN` — bare domain owned by the workspace, with no protocol
  or path.
- `WORKSPACE_OWNER_EMAIL` — initial owner/admin email for repairs and
  integration defaults.
- `A2A_SECRET` — shared secret for cross-app A2A signing. Generate with
  `openssl rand -hex 32` and configure through your deployment/scoped secret
  manager.

`DISPATCH_DEFAULT_OWNER_EMAIL` is optional. Set it only for trusted,
single-workspace deployments where unlinked integration requests should run as
the workspace owner, and prefer the same value as `WORKSPACE_OWNER_EMAIL`.

## Org Repair

When asked to repair workspace org or A2A configuration:

1. Read `.env` first. Do not infer the organization, domain, owner email, or
   secret from old examples.
2. Run `pnpm repair:workspace-org -- --name "<org>" --domain example.com --owner-email owner@example.com`
   to validate generic workspace identity values without writing `.env`.
3. Prefer the app's organization settings UI or authenticated org routes for
   changing `allowed_domain` and `a2a_secret`.
4. If direct SQL is unavoidable, inspect the live schema first and use only
   parameterized `INSERT` or `UPDATE` statements. Ensure the target org has
   `organizations.name`, `organizations.allowed_domain`,
   `organizations.a2a_secret`, and an `org_members` owner row for
   `WORKSPACE_OWNER_EMAIL`.
5. Never use `DROP`, `TRUNCATE`, destructive `ALTER`, or an unscoped
   `DELETE`. Do not rotate `A2A_SECRET` without updating every app that trusts
   it.
