# Forms — Agent Guide

Forms is an agent-native form builder and response workspace. The agent creates,
edits, publishes, shares, and analyzes forms through actions and SQL-backed state.
The first screen is the chat: start by helping the user build, set up, inspect,
or analyze their form workspace, then navigate into app views when a richer
editor or table is useful.

Detailed building, publishing, response, storage, and UI rules live in
`.agents/skills/`.

## Core Rules

- Store large file/blob payloads in configured file/blob storage, not SQL: no
  base64, `data:` URLs, images, video/audio, PDFs, ZIPs, screenshots,
  thumbnails, or replay chunks in app tables, `application_state`, `settings`,
  or `resources`; persist URLs, ids, or handles instead.
- Never hardcode API keys, tokens, webhook URLs, signing secrets, private Builder/internal data, customer data, or credential-looking literals. Use secrets/OAuth/runtime configuration and obvious placeholders in examples.
- Use actions for form lifecycle, fields, publishing, responses, navigation,
  sharing, and database work. Do not bypass ownable access checks.
- In dev, call actions with `pnpm action <name>`; in production, use native
  tools. The action schema is authoritative.
- Use `view-screen` when the active form, selected field, publish state, or
  response table is unclear.
- For response analytics, call `response-insights` instead of inventing SQL.
  Pass `displayMode: "chart"` for chart-only requests, `displayMode: "table"`
  only when the user asks for a table/rows, and `displayMode: "insights"` for
  combined dashboard/report requests.
- For form setup/configuration previews, call `preview-form`. It returns a
  native inline summary/table and an "Open editor" expansion path.
- For an anonymous feedback form or survey, create all fields in one
  `create-form` call with `status: "published"`, verify the persisted form, and
  return the action's exact public `/f/<slug>` response URL rather than only
  the private editor link.
- Form UX should stay focused: clear labels, sensible validation, minimal
  required fields, and progressive disclosure for advanced settings.
- Public form submission endpoints must be intentionally public; keep management
  routes authenticated.
- Use framework sharing actions for forms and response resources.

## Application State

- `navigation` exposes home chat, builder, published form, responses,
  response-insights, selected field, and builder tab context
  (`activeTab`: `edit`, `responses`, `settings`, or `integrations`).
- `navigate` moves the UI between home, forms, builder, responses,
  response-insights, preview, and team/settings-style views. For builder
  sub-tabs, call `navigate` with `view=form`, the form ID, and
  `tab=edit|responses|settings|integrations`.

## Chat-First Workflow

- The `/` route is the primary chat surface. Use it to ask clarifying questions,
  create or edit forms, explain setup, and surface response insights.
- When the user needs a focused workspace, call `navigate` to open `/forms`,
  `/forms/:id?tab=edit`, `/forms/:id?tab=responses`,
  `/forms/:id?tab=settings`, `/forms/:id?tab=integrations`,
  `/forms/:id/responses`, or `/response-insights`.
- When the user asks to see, open, or view all responses for a form, navigate to
  the responses view instead of rendering response rows in chat. Use the current
  form from `view-screen` or an @-tagged form ID.
- For setup questions, inspect the current state first. Use `db-status` and
  `db-connect` for database/cloud setup, and form actions for publishing,
  fields, sharing, and response review.
- When the user @-tags a form, use the referenced form ID directly with
  `preview-form`, `response-insights`, `list-responses`, or `navigate`.
- For tables or charts in chat, use typed action results. `response-insights`
  is the first-party path for native response tables and submission charts, but
  do not include both unless the user asked for both; iframe/MCP App rendering
  is only a fallback for external hosts.

## Skills

Read the relevant skill before deeper work:

- `form-building` for schema/field creation and edits.
- `form-publishing` for public forms, submission behavior, and sharing.
- `form-responses` for response review and analysis.
- `storing-data`, `real-time-sync`, `security`, `actions`, `frontend-design`,
  and `shadcn-ui` for framework work.
