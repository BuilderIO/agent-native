# {{APP_TITLE}} Workspace Instructions

Workspace-root guidance. Put app rules in `apps/<app>/AGENTS.md`; shared rules in `packages/shared/AGENTS.md` or its skills. Root `.agents/skills` links to `packages/shared/.agents/skills/`.

## Skills

Read the exact guide before deeper work; search with `rg --hidden --follow`. Shipped workspace skills:
`packages/shared/.agents/skills/a2a-protocol/SKILL.md`, `packages/shared/.agents/skills/actions/SKILL.md`, `packages/shared/.agents/skills/adding-a-feature/SKILL.md`, `packages/shared/.agents/skills/adding-workspace-apps/SKILL.md`, `packages/shared/.agents/skills/agent-native-docs/SKILL.md`, `packages/shared/.agents/skills/agent-native-toolkit/SKILL.md`, `packages/shared/.agents/skills/automations/SKILL.md`, `packages/shared/.agents/skills/build-an-app/SKILL.md`, `packages/shared/.agents/skills/client-side-routing/SKILL.md`, `packages/shared/.agents/skills/composable-mini-apps/SKILL.md`, `packages/shared/.agents/skills/context-awareness/SKILL.md`, `packages/shared/.agents/skills/customizing-agent-native/SKILL.md`, `packages/shared/.agents/skills/delegate-to-agent/SKILL.md`, `packages/shared/.agents/skills/external-agents/SKILL.md`, `packages/shared/.agents/skills/frontend-design/SKILL.md`, `packages/shared/.agents/skills/performance/SKILL.md`, `packages/shared/.agents/skills/portability/SKILL.md`, `packages/shared/.agents/skills/real-time-sync/SKILL.md`, `packages/shared/.agents/skills/recurring-jobs/SKILL.md`, `packages/shared/.agents/skills/reliable-mutations/SKILL.md`, `packages/shared/.agents/skills/secrets/SKILL.md`, `packages/shared/.agents/skills/security/SKILL.md`, `packages/shared/.agents/skills/self-modifying-code/SKILL.md`, `packages/shared/.agents/skills/shadcn-ui/SKILL.md`, `packages/shared/.agents/skills/sharing/SKILL.md`, `packages/shared/.agents/skills/storing-data/SKILL.md`, `packages/shared/.agents/skills/turn-into-app/SKILL.md`, `packages/shared/.agents/skills/turn-into-skill/SKILL.md`, `packages/shared/.agents/skills/workspace-conventions/SKILL.md`.

Before building common workspace or agent UI, read `agent-native-toolkit` at
`packages/shared/.agents/skills/agent-native-toolkit/SKILL.md`; for supported
customization, read `customizing-agent-native` at
`packages/shared/.agents/skills/customizing-agent-native/SKILL.md`.

## Framework docs

Use local version-matched docs only (no web research). From an app run:
`pnpm action docs-search --query "<topic>"`,
`pnpm action docs-search --slug "<slug>"`, or `pnpm action docs-search --list`.
Docs are in `node_modules/@agent-native/core/docs/`; optional template source
is in `node_modules/@agent-native/core-corpus/corpus/`. If search is unavailable,
read `node_modules/@agent-native/core/docs/AGENTS.md` and search its `content/`
with `rg`. See `packages/shared/AGENTS.md` for workspace conventions and
`workspace-conventions` for advanced doc lookup.


## Core rules

- Normal app data must flow through actions. Keep app code in `apps/<app>` and
  share only when multiple apps need it; do not add new apps to Chat unless asked.
- All AI work goes through the app agent. Keep actions deterministic and
  focused; send research, analysis, and generation to `AgentSidebar` through
  `sendToAgentChat({ openSidebar: true })` and keep follow-ups in the same thread.
- Use PostgreSQL-specific Drizzle schemas; SQL stores structured data, files use
  blob storage, and migrations stay additive.
- Before implementing an app that connects to an external service, inspect the
  workspace/provider connection catalog first; reuse its scoped resolver.
  Never hardcode credentials or private data.
- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
  Use shared controls and `Skeleton`s. Read `frontend-design` and `DESIGN.md`
  before visual work; keep shared chrome neutral.
- Use `/<app-id>` links; never hardcode localhost or a dev port.

## Resources

Use Files for requested content. Hide `agent_scratch`; grant Dispatch
resources to All apps only for global guidance.

## New workspace apps

- Keep reminders, digests, monitors, routing rules, and recurring workflows in
  Dispatch. Distinct products go in `apps/<app-id>` at `/<app-id>`; prefer
  focused A2A apps. Do not clone first-party apps or modify Chat unless asked.
- Dispatch discovers `apps/<app-id>/package.json`; include a clear `description`.
  Preserve `APP_BASE_PATH` / `VITE_APP_BASE_PATH` with `appBasePath()`. Scaffold
  from the workspace root: `pnpm exec agent-native create <app-id> --template=<template>`.
- Reuse provider connections and scoped resolvers. Framework apps use
  `resolveSecret`; workspace apps use the connector helper. Request missing
  keys through Dispatch vault, not a non-admin's `.env`.
- Verify `/<app-id>` on the workspace gateway serves the new app before saying
  it is created; app servers start lazily.

## Identity and repair

Workspace `.env` owns `WORKSPACE_ORG_NAME`, bare `WORKSPACE_ORG_DOMAIN`,
`WORKSPACE_OWNER_EMAIL`, and `A2A_SECRET`. `DISPATCH_DEFAULT_OWNER_EMAIL` is
optional only for trusted single-workspace deployments. Never create an org or
repoint `active-org-id`; update every app before rotating A2A.

For repair, read `.env`; validate with
`pnpm repair:workspace-org -- --name "<org>" --domain example.com --owner-email owner@example.com`;
prefer authenticated settings. If SQL is unavoidable, inspect schema and use
parameterized `INSERT`/`UPDATE`; never make destructive changes or unscoped
`DELETE`.

## Defaults and upgrades

Apps use English/no changelog by default; opt in via `agent-native.config.ts`.
Upgrade with `pnpm upgrade:agent-native` or `npx @agent-native/core@latest upgrade`;
after a manual core bump run `pnpm skills:update`. Never patch dependencies or
edit `node_modules/@agent-native/*`; see `self-modifying-code`.
