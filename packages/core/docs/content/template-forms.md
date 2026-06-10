---
title: "Forms"
description: "Agent-native form builder — create, edit, publish, and route form submissions through natural language plus a visual editor."
---

# Forms

Forms is an agent-native form builder. Describe the form you want, refine it in the editor, and publish a public form that stores submissions in your own SQL database.

<!-- screenshot:
  app: forms
  view: /forms/<id>
  shows: Editor for a "Beta signup" form — sidebar with 5 forms (Beta signup selected, Customer feedback Q3, Job application Engineering, Event RSVP, New customer onboarding); editor pane with title, description, and field cards (Full name, Work email, Your role, Team size, What problem are you hoping to solve?); Edit/Results/Settings/Integrations tabs and Share + Unpublish buttons; agent sidebar with form-related suggestions
  account: screenshot-account (forms authored on this account via the standard build flow, with realistic response counts seeded by submitting through the public URL)
  capture: 1400x800 viewport, cropped 90px from bottom (final 1400x710)
-->

![Forms editor with a form open and the agent sidebar](/screenshots/forms.png)

When you open the app, you see your forms, the current editor, and a live preview. The agent can create a form from a prompt, update field labels and options, change validation, and connect submission destinations using the same actions the UI uses.

## What you can do with it

- **Build forms conversationally.** "Create a contact form," "add an NPS score question," "make the email field required." The agent updates the form schema and the preview updates from SQL-backed state.
- **Fine-tune visually.** Edit labels, placeholders, required state, options, and field order from the builder UI when you want direct control.
- **Use the shipped field types.** Text, email, number, long text, select, multi-select, checkbox, radio, date, rating, and scale fields are supported out of the box.
- **Collect responses.** Each submission is stored in SQL with a per-response detail view and a dashboard for reviewing entries.
- **Route submissions.** Send submission payloads to webhooks, Slack, Discord, or Google Sheets using the built-in integrations.
- **Publish public forms.** Share a public form URL and show a thank-you message after submission.

## Getting started

Live demo: [forms.agent-native.com](https://forms.agent-native.com).

1. **Create a form from a prompt.** Ask for the form you want, including the
   audience and what should happen after submission.
2. **Refine in the editor.** Adjust labels, validation, choices, and order in
   the visual builder when direct editing is faster.
3. **Publish and share.** Use the public form URL for respondents, then watch
   results arrive in the Responses view.
4. **Connect destinations.** Route new submissions to Slack, Discord, Google
   Sheets, webhooks, or your own extension point.

## Useful prompts

- "Create a beta signup form with role, team size, and priority use case."
- "Add a required NPS question and a free-text follow-up."
- "Post every new response to the product Slack channel."
- "Summarize this week's submissions and group them by customer segment."
- "Make this form shorter without losing the fields we need for routing."

## Why it's interesting

Three things make Forms a good showcase of the framework:

1. **Single SQL record, two editors.** The form's `fields` JSON column is the source of truth for both the visual builder and the agent. Ask the agent to add a field and the builder re-renders — no sync step, no separate "AI draft" state.
2. **Public and private surfaces from one schema.** The same form row serves authenticated editors (full field + settings access) and anonymous respondents (public fill page with secrets stripped). `toPublicFormSettings` handles the split at the action layer.
3. **Integrations as settings, not infrastructure.** Slack, Discord, Google Sheets, and webhook destinations are stored as JSON in the form's settings column and executed server-side at submission time — adding a new integration type is an action-layer change, not a schema migration.

See [What is agent-native?](/docs/what-is-agent-native) for the broader framework model.

## For developers

### Scaffolding

```bash
npx @agent-native/core@latest create my-forms --standalone --template forms
```

For a workspace with Forms alongside other apps:

```bash
npx @agent-native/core@latest create my-platform
```

Pick Forms and any other templates you want during the workspace setup.

### Data model

All data lives in SQL via Drizzle ORM. Schema: `templates/forms/server/db/schema.ts`. Forms carry the standard `ownableColumns` and a matching framework shares table, so they slot into the per-user / per-org sharing model.

| Table         | What it holds                                                                                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `forms`       | A form definition — `title`, `description`, unique `slug`, `fields` (JSON array of `FormField`), `settings` (JSON `FormSettings`), `status` (`draft` / `published` / `closed`), and a soft-delete `deleted_at` |
| `responses`   | One submission per row — `form_id`, `data` (JSON `{ fieldId: value }`), `submitted_at`, optional `ip` and `submitter_email`                                                                                    |
| `form_shares` | Framework shares table mapping principals (users or orgs) to roles (viewer, editor, admin) per form                                                                                                            |

The `fields` and `settings` JSON shapes are defined in `templates/forms/shared/types.ts` (`FormField`, `FormSettings`). Owner-private settings such as integration webhook URLs and allowed origins are stripped before any data reaches the public fill page via `toPublicFormSettings`.

### Key features (technical) {#key-features}

Forms are defined as JSON field arrays (`FormField[]`) and stored in a single `fields` column — no separate table per field type. This makes the schema additive and the agent's edits surgical: changing a field label is a JSON-patch on one column, not a row update across a join table. All field types (text, email, number, long text, select, multi-select, checkbox, radio, date, rating, scale) are handled by the renderer and editor without schema changes.

The public fill page is fully unauthenticated. `toPublicFormSettings` strips integration URLs and other owner-private settings before the form data reaches the browser, so secrets never leak to respondents.

Integrations (Slack, Discord, Google Sheets, webhooks) are stored as settings inside the form's `settings` JSON column and executed server-side at submission time.

### Key actions

Every operation is a TypeScript file in `templates/forms/actions/`, auto-mounted at `POST /_agent-native/actions/:name`:

- `create-form` — create a new form (title, description, fields, settings)
- `update-form` — update fields, settings, or status
- `get-form` — retrieve a form by id or slug
- `list-forms` — list accessible forms
- `delete-form` — soft-delete (sets `deleted_at`)
- `restore-form` — restore a soft-deleted form
- `list-responses` — list submissions for a form with optional filters
- `export-responses` — export responses as CSV or JSON

### Customizing it

Ask the agent for shipped behavior first:

- "Add a required radio field for preferred contact method."
- "Post every new submission to Slack." Connect Slack first via [Messaging](/docs/messaging).
- "Add a webhook destination for our CRM."
- "Create a customer feedback form with a 1-10 scale and a long-text follow-up."
- "Make some forms public and others login-only."

If you need new capabilities such as file uploads, signatures, or custom field widgets, treat them as template extensions: add the SQL shape, actions, UI editor controls, public renderer support, and agent instructions together. See [Creating Templates](/docs/creating-templates) for the current build pattern.

## What's next

- [**Templates**](/docs/cloneable-saas) — the clone-and-own model
- [**Actions**](/docs/actions) — the action system powering the builder
- [**Messaging**](/docs/messaging) — Slack and other submission destinations
