# {{APP_TITLE}} Workspace Instructions

These instructions apply at the workspace root. App-specific behavior belongs
in `apps/<app>/AGENTS.md`; shared cross-app behavior belongs in
`packages/shared/AGENTS.md` or `packages/shared/.agents/skills/`.

## Workspace Scope

- Keep root changes focused on workspace orchestration, shared configuration,
  deploy settings, and monorepo tooling.
- Keep application routes, actions, server plugins, and app state inside the
  relevant `apps/<app>` directory unless multiple apps need the same behavior.
- Put reusable code in `packages/shared` only after at least two apps need it.
- Never copy live credentials, personal email addresses, customer data, or
  company-specific placeholder values into source files.

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
- Do not satisfy a new-app request by adding a route, page, component, or file
  to `apps/starter` or another existing app unless the user explicitly asks to
  modify that existing app.
- Treat first-party apps such as Mail, Calendar, Analytics, and Dispatch as
  existing hosted/connected neighbors available through links and A2A/default
  connected agents. For example, Mail, Calendar, and Analytics already exist at
  `https://mail.agent-native.com`, `https://calendar.agent-native.com`, and
  `https://analytics.agent-native.com`.
- If a new app needs to use Mail, Calendar, Analytics, or similar first-party
  data/agents, build only the genuinely new workflow and delegate/link to those
  existing apps. Do not create wrapper apps, child apps, nested template copies,
  or cloned Mail/Calendar/Analytics implementations inside the new app just to
  provide access.
- Only create a first-party app copy when the user explicitly asks for a
  customized fork/copy of that app. Otherwise prefer the hosted/shared app so
  base template improvements continue to flow automatically.
- Workspace apps are discovered from `apps/<app-id>/package.json`. There is no
  separate workspace app registry to edit for Dispatch to list the app.
- Use relative workspace links like `/<app-id>`. Never hardcode
  `localhost`, `127.0.0.1`, `8080`, `8100`, or any dev port in app cards,
  instructions, redirects, or navigation; the active workspace gateway/browser
  origin owns the port.
- React Router apps must preserve `APP_BASE_PATH` / `VITE_APP_BASE_PATH` in
  `app/entry.client.tsx` via `appBasePath()` so the app hydrates correctly
  when mounted at `/<app-id>`.
- Use the framework/template UI stack for standard UI: shadcn/ui components and
  `@tabler/icons-react`. Do not add `lucide-react` or another icon library.
- In local development, scaffold the app from the workspace root with
  `pnpm exec agent-native create <app-id> --template=<template>`. In production
  Dispatch posts the request to Builder branch creation; the Builder branch
  should still create the separate workspace app, not patch starter.

## Workspace Identity

Use the workspace root `.env` for shared identity and cross-app trust settings:

- `WORKSPACE_ORG_NAME` — human-readable organization name.
- `WORKSPACE_ORG_DOMAIN` — bare domain owned by the workspace, with no protocol
  or path.
- `WORKSPACE_OWNER_EMAIL` — initial owner/admin email for repairs and
  integration defaults.
- `A2A_SECRET` — shared secret for cross-app A2A signing. Generate with
  `openssl rand -hex 32` or `pnpm repair:workspace-org -- --name ...`.

`DISPATCH_DEFAULT_OWNER_EMAIL` is optional. Set it only for trusted,
single-workspace deployments where unlinked integration requests should run as
the workspace owner, and prefer the same value as `WORKSPACE_OWNER_EMAIL`.

## Org Repair

When asked to repair workspace org or A2A configuration:

1. Read `.env` first. Do not infer the organization, domain, owner email, or
   secret from old examples.
2. Run `pnpm repair:workspace-org -- --name "<org>" --domain example.com --owner-email owner@example.com`
   to create or update generic workspace identity values.
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
