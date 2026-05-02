# {{APP_TITLE}} — Enterprise Agent Instructions

These instructions apply to **every app** in the {{APP_TITLE}} workspace. The
framework auto-injects this file into each app's agent system prompt as a
`<resource name="AGENTS.md" scope="workspace">` block. Individual apps can
add their own template-specific AGENTS.md on top.

## Company context

Write a short paragraph here describing your company and what you do. The
agent reads this first so every response can be grounded in the same
business context without you having to repeat it per app.

## Shared conventions

- **All cross-app state lives in the shared database.** Apps in this
  workspace share `DATABASE_URL` by default, so a record created by one
  app can be read by another as long as it respects the `owner_email` and
  `org_id` scoping conventions.
- **All API secrets come from scoped credential storage.** Never hardcode a
  token or read `process.env` for user/org credentials in production. Call
  `resolveCompanyCredential("KEY", { userEmail, orgId })` from
  `@{{APP_NAME}}/shared/credentials`, or omit the context only when the
  current request/action already has agent-native request context. The helper
  reads per-user credentials first and org-shared credentials second.
- **UI chrome comes from the workspace core.** Wrap every screen in
  `<AuthenticatedLayout>` from `@{{APP_NAME}}/shared/client`. Don't
  re-implement the brand header, sidebar, or org switcher per app.
- **Design system.** If the app needs a button, dialog, or form control,
  import from our internal design system package (if you have one) or
  from the shared UI re-exports in `@{{APP_NAME}}/shared/client`.

## Compliance and policy

List any enterprise-wide rules the agent must follow — data handling, PII
guidelines, approval flows, deployment constraints. The agent will apply
these to every decision it makes in every app.

Example rules:

- Never expose raw customer email addresses in logs.
- Any action that modifies data must first be shown to the user with a
  preview and wait for confirmation.
- Never make network calls to anything outside `*.{{APP_NAME}}.com` or
  the approved third-party allowlist.

## How to add a new app

```bash
pnpm exec agent-native create <app-name> --template=starter
```

Run this from the workspace root. The CLI detects the workspace and creates
`apps/<app-name>` with the workspace shared package already connected. Use a
different template when useful, for example `--template=analytics` or
`--template=forms`.

The workspace dev command is a gateway:

```bash
pnpm dev
```

It opens Dispatch at `/dispatch`, serves every app at `/<app-name>`, and
auto-detects newly-created app directories. After creating an app, do not
restart the dev server unless the gateway reports an error; wait for it to
start the new app process, then open `/<app-name>`.

The new app will automatically inherit:

1. The workspace auth plugin (Better Auth + company SSO)
2. The agent chat plugin with this AGENTS.md pre-loaded
3. Every skill in `packages/shared/skills/`
4. Every action in `packages/shared/actions/`
5. The shared Tailwind preset and React components

The only files the new app needs to own are its own routes/screens and any
template-specific actions.
