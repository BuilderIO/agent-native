# Forms — Agent Guide

Forms is an agent-native form builder and response workspace. The agent creates,
edits, publishes, shares, and analyzes forms through actions and SQL-backed state.

Detailed building, publishing, response, storage, and UI rules live in
`.agents/skills/`.

## Core Rules

- Never hardcode API keys, tokens, webhook URLs, signing secrets, private Builder/internal data, customer data, or credential-looking literals. Use secrets/OAuth/runtime configuration and obvious placeholders in examples.
- Use actions for form lifecycle, fields, publishing, responses, navigation,
  sharing, and database work. Do not bypass ownable access checks.
- In dev, call actions with `pnpm action <name>`; in production, use native
  tools. The action schema is authoritative.
- Use `view-screen` when the active form, selected field, publish state, or
  response table is unclear.
- Form UX should stay focused: clear labels, sensible validation, minimal
  required fields, and progressive disclosure for advanced settings.
- Public form submission endpoints must be intentionally public; keep management
  routes authenticated.
- Use framework sharing actions for forms and response resources.

## Application State

- `navigation` exposes builder, published form, responses, selected field, and
  settings context.
- `navigate` moves the UI between builder, responses, preview, and settings.

## Skills

Read the relevant skill before deeper work:

- `form-building` for schema/field creation and edits.
- `form-publishing` for public forms, submission behavior, and sharing.
- `form-responses` for response review and analysis.
- `storing-data`, `real-time-sync`, `security`, `actions`, `frontend-design`,
  and `shadcn-ui` for framework work.
