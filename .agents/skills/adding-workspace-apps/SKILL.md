---
name: adding-workspace-apps
description: >-
  How to add an app to an Agent Native workspace: classifying an "agent"
  request, scaffolding `apps/<app-name>`, app discovery and descriptions,
  mounting and base paths, action-first data, and finishing a chat-template app.
  Use when asked to create, build, scaffold, or generate a new agent or app in a
  workspace.
---

# Adding Workspace Apps

## Classify The Ask First

When a user asks from Dispatch chat or through `@agent-native` in Slack or
Telegram to create, build, make, scaffold, or generate an "agent", classify
the ask first.
Simple Dispatch-native behavior such as a reminder, digest, monitor, routing
rule, saved instruction, or recurring workflow can stay in Dispatch as a
recurring job/resource/destination. Robust unique products or teammates that
need their own UI, data model, actions, integrations, or domain workflow should
become a separate workspace app under `apps/<app-name>`, mounted at
`/<app-name>`.

## Where The App Lives

Do not implement a new app by adding a route, page, component, or file to
`apps/chat` or another existing app unless the user explicitly asks to modify
that existing app.

## Vault Access

Dispatch vault access is workspace-wide by default: every saved vault key is
available to every workspace app. Only create or request per-app vault grants
when Dispatch's vault access setting is switched to manual mode.

## Discovery, Links, And The UI Stack

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

## App Data Goes Through Actions

Normal app data must flow through actions. For CRUD that the agent can perform,
create `defineAction` files in `actions/`, mark reads with
`http: { method: "GET" }`, and call them from React with `useActionQuery` /
`useActionMutation`. Do not add duplicate JSON CRUD routes under `/api/*` for
the same data unless the route is for uploads, streaming, webhooks, OAuth, or
another route-only concern. Do not add routes whose main job is to wrap,
proxy, or re-export an action; the action endpoint already exists at
`/_agent-native/actions/:name`. Action-backed UI is what makes agent-created or
agent-edited records appear without a manual refresh.

## Database Portability

App database code must be provider-agnostic. Define schemas with
`@agent-native/core/db/schema` helpers and write app reads/writes with Drizzle's
query builder and portable `drizzle-orm` operators. Do not import from
`drizzle-orm/sqlite-core` or `drizzle-orm/pg-core` in app templates. Keep raw SQL
for additive migrations, health checks, or carefully scoped maintenance, and
never write SQLite-only or Postgres-only product code. Do not use SQL as object
storage; file bytes belong in upload/private-blob providers with only references
saved to app tables.

## Scaffolding

In local development, run
`pnpm exec agent-native create <app-name> --template=<template>` from the
workspace root. In production, Dispatch posts new-app requests to Builder
branch creation; Builder should still scaffold the separate workspace app. The
workspace dev gateway (`pnpm dev`) detects new `apps/<app-name>` directories
automatically.

## Finishing A Chat-Template App

When using the chat template, treat it as scaffolding only. The finished app
must be branded as the requested app, with its own home screen, navigation,
package metadata, manifest, and domain workflow. Do not leave visible
`Chat`, `Starter`, `Blank app`, `Start building`, or `New app` UI in a chat-derived
app.

## Related Skills

- **workspace-conventions** — Shared workspace rules this workflow assumes.
- **actions** — How to define the app operations the agent and UI share.
- **composable-mini-apps** — Splitting work across focused sibling apps.
- **portability** — Keeping database and hosting assumptions provider-agnostic.
- **shadcn-ui** — Adding and upgrading the UI primitives.
