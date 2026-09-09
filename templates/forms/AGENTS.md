# Forms — Agent Guide

Forms is an agent-native form builder and response workspace. The agent creates,
edits, publishes, shares, and analyzes forms through actions and SQL-backed state.
The first screen is the chat: start by helping the user build, set up, inspect,
or analyze their form workspace, then navigate into app views when a richer
editor or table is useful.

## Skills

Read the relevant skill before deeper work:

- `form-building` for schema/field creation and edits.
- `form-publishing` for public forms, submission behavior, and sharing.
- `form-responses` for response review and analysis.

## Actions

| Action | Purpose |
| --- | --- |
| `view-screen` | Re-read the active form, selected field, or response table |
| `navigate` | Move between home, builder, responses, response-insights, settings |
| `create-form` | Create a form with fields; status defaults to draft |
| `update-form` | Change title, settings, or status (publish with `status: "published"`) |
| `patch-form-fields` | Upsert or reorder individual fields without a full rewrite |
| `list-forms` / `get-form` | List forms / read one form's definition |
| `preview-form` | Inline setup summary with an open-editor link |
| `response-insights` | Chart, table, or combined response analytics |
| `list-responses` / `export-responses` | Read or export submissions |

## Core Rules

- Store large file/blob payloads in configured file/blob storage, not SQL: no
  base64, `data:` URLs, images, video/audio, PDFs, ZIPs, screenshots,
  thumbnails, or replay chunks in app tables, `application_state`, `settings`,
  or `resources`; persist URLs, ids, or handles instead.
- Never hardcode API keys, tokens, webhook URLs, signing secrets, private Builder/internal data, customer data, or credential-looking literals. Use secrets/OAuth/runtime configuration and obvious placeholders in examples.
- For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver.
- Use actions for form lifecycle, fields, publishing, responses, navigation,
  sharing, and database work. Do not bypass ownable access checks. The action
  schema is authoritative when a parameter is unclear.
- Use `view-screen` when the active form, selected field, publish state, or
  response table is unclear.
- For response analytics and setup previews, follow `form-responses`
  (`response-insights` displayMode, `preview-form`); never invent SQL.
- For product usage, agent-native signup, conversion, app-wide event, or other
  data-owned-by-sibling questions, use `describe-workspace-apps` when ownership
  is unclear, then delegate a narrow natural-language question with `call-agent`
  to the owning app. In workspaces with Analytics, it normally owns first-party
  signup, conversion, and app-usage metrics. Do not invent SQL or query another
  app's database.
- For publishing, `publicUrl`, `slug`, and anonymous-mode rules, follow
  `form-publishing`; always copy the returned `publicUrl` verbatim.
- `settings.emailOnNewResponses: true` (via `create-form`/`update-form`) emails
  the form owner per response through the configured email provider
  (`RESEND_API_KEY`/`SENDGRID_API_KEY`); a submission can still succeed if
  delivery fails, so check server logs when debugging.
- Conditional-field rules (`conditional: { fieldId, operator, value }`) and
  hidden-field handling follow `form-building`.
- Form integrations (webhook/Slack/Discord/Google Sheets) follow
  `form-publishing`; they are separate from the managed Slack/Messaging
  connection.
- Form UX should stay focused: clear labels, sensible validation, minimal
  required fields, and progressive disclosure for advanced settings.
- Public form submission endpoints must be intentionally public; keep management
  routes authenticated.
- Use framework sharing actions for forms and response resources.

## Application State

- `navigation` exposes the `/home` chat, builder, published form, responses,
  response-insights, and builder tab context (`activeTab`: `edit`,
  `responses`, `settings`, or `integrations`); `view-screen` reports the
  selected field as `form.selection`.
- `navigate` moves the UI between home, forms, builder, responses,
  response-insights, preview, and team/settings-style views. For builder
  sub-tabs, call `navigate` with `view=form`, the form ID, and
  `tab=edit|responses|settings|integrations`.

## Chat-First Workflow

- The `/home` route is the primary chat surface. Use it to ask clarifying
  questions, create or edit forms, explain setup, and surface response insights.
  The public `/` route is reserved for the SSR marketing page.
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

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`; read
`customizing-agent-native` before adapting shared UI.
