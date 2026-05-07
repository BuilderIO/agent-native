# {{APP_TITLE}} Workspace Instructions

These instructions apply to every app in the {{APP_TITLE}} workspace. Keep
only rules that should be shared across all apps here. App-specific behavior
belongs in that app's own `AGENTS.md` or `.agents/skills/` directory.

## Shared Context

Add company, product, compliance, or support-context notes that every app
agent should know.

## Shared Conventions

- Put shared code in `packages/shared` only when multiple apps need it.
- Keep app-specific screens, actions, state, and skills inside `apps/<app>`.
- Store shared runtime configuration in the workspace root `.env`; use
  `apps/<app>/.env` only for app-specific overrides.
- Prefer framework defaults until the workspace has a real custom rule,
  component, plugin, action, or skill to share.

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
`apps/starter` or another existing app unless the user explicitly asks to modify
that existing app.

Workspace apps are discovered from `apps/<app-name>/package.json`. There is no
separate workspace app registry to edit for Dispatch to list the app. Use
relative workspace links like `/<app-name>` and never hardcode `localhost`,
`127.0.0.1`, `8080`, `8100`, or any dev port in app cards, instructions,
redirects, or navigation; the active workspace gateway/browser origin owns the
port. React Router apps must preserve `APP_BASE_PATH` / `VITE_APP_BASE_PATH` in
`app/entry.client.tsx` via `appBasePath()` so the app hydrates correctly when
mounted at `/<app-name>`.

In local development, run
`pnpm exec agent-native create <app-name> --template=<template>` from the
workspace root. In production, Dispatch posts new-app requests to Builder
branch creation; Builder should still scaffold the separate workspace app. The
workspace dev gateway (`pnpm dev`) detects new `apps/<app-name>` directories
automatically.
