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

```an-diagram title="Build, publish, collect" summary="The agent and the visual editor edit one SQL-backed form definition. The public fill page is unauthenticated, and submissions route server-side to your destinations."
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-col\"><div class=\"diagram-node\">Agent prompt<br><small class=\"diagram-muted\">\"add an NPS question\"</small></div><div class=\"diagram-node\">Visual editor<br><small class=\"diagram-muted\">labels, validation, order</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">create-form · update-form</span><small class=\"diagram-muted\">fields JSON, settings JSON</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">forms table<br><small class=\"diagram-muted\">SQL via Drizzle</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">Public fill page<br><small class=\"diagram-muted\">unauthenticated</small></div><div class=\"diagram-box\">responses<br><small class=\"diagram-muted\">+ Slack / webhook / Sheets</small></div></div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

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

### Useful prompts

- "Create a beta signup form with role, team size, and priority use case."
- "Add a required NPS question and a free-text follow-up."
- "Post every new response to the product Slack channel."
- "Summarize this week's submissions and group them by customer segment."
- "Make this form shorter without losing the fields we need for routing."

## For developers

The rest of this doc is for anyone forking the Forms template or extending it.

### Quick start

```bash
npx @agent-native/core@latest create my-forms --standalone --template forms
cd my-forms
pnpm install
pnpm dev
```

For a workspace with Forms alongside other apps:

```bash
npx @agent-native/core@latest create my-platform
```

Pick Forms and any other templates you want during the workspace setup.

### Key features (technical) {#key-features}

Forms are defined as JSON field arrays (`FormField[]`) and stored in a single `fields` column — no separate table per field type. This makes the schema additive and the agent's edits surgical: changing a field label is a JSON-patch on one column, not a row update across a join table. All field types (text, email, number, long text, select, multi-select, checkbox, radio, date, rating, scale) are handled by the renderer and editor without schema changes.

The public fill page is fully unauthenticated. `toPublicFormSettings` strips integration URLs and other owner-private settings before the form data reaches the browser, so secrets never leak to respondents.

Integrations (Slack, Discord, Google Sheets, webhooks) are stored as settings inside the form's `settings` JSON column and executed server-side at submission time.

### Data model

All data lives in SQL via Drizzle ORM. Schema: `templates/forms/server/db/schema.ts`. Forms carry the standard `ownableColumns` and a matching framework shares table, so they slot into the per-user / per-org sharing model.

| Table         | What it holds                                                                                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `forms`       | A form definition — `title`, `description`, unique `slug`, `fields` (JSON array of `FormField`), `settings` (JSON `FormSettings`), `status` (`draft` / `published` / `closed`), and a soft-delete `deleted_at` |
| `responses`   | One submission per row — `form_id`, `data` (JSON `{ fieldId: value }`), `submitted_at`, optional `ip` and `submitter_email`                                                                                    |
| `form_shares` | Framework shares table mapping principals (users or orgs) to roles (viewer, editor, admin) per form                                                                                                            |

The `fields` and `settings` JSON shapes are defined in `templates/forms/shared/types.ts` (`FormField`, `FormSettings`). Owner-private settings such as integration webhook URLs and allowed origins are stripped before any data reaches the public fill page via `toPublicFormSettings`.

```an-schema title="Forms data model" summary="Three tables. Fields and integrations are JSON columns on forms, so the agent's edits are surgical patches rather than cross-table row changes."
{
  "entities": [
    {
      "id": "forms",
      "name": "forms",
      "note": "A form definition (ownable)",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "title", "type": "string" },
        { "name": "description", "type": "string", "nullable": true },
        { "name": "slug", "type": "string", "note": "unique; public URL" },
        { "name": "fields", "type": "json", "note": "FormField[] — all field types" },
        { "name": "settings", "type": "json", "note": "FormSettings — integrations, etc." },
        { "name": "status", "type": "enum", "note": "draft | published | closed" },
        { "name": "deleted_at", "type": "datetime", "nullable": true, "note": "soft delete" },
        { "name": "owner_email", "type": "string" },
        { "name": "org_id", "type": "id", "nullable": true }
      ]
    },
    {
      "id": "responses",
      "name": "responses",
      "note": "One submission per row",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "form_id", "type": "id", "fk": "forms.id" },
        { "name": "data", "type": "json", "note": "{ fieldId: value }" },
        { "name": "submitted_at", "type": "datetime" },
        { "name": "ip", "type": "string", "nullable": true },
        { "name": "submitter_email", "type": "string", "nullable": true }
      ]
    },
    {
      "id": "form_shares",
      "name": "form_shares",
      "note": "Framework shares table — principals to roles per form",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "form_id", "type": "id", "fk": "forms.id" },
        { "name": "principal", "type": "string", "note": "user or org" },
        { "name": "role", "type": "enum", "note": "viewer | editor | admin" }
      ]
    }
  ],
  "relations": [
    { "from": "forms", "to": "responses", "kind": "1-n", "label": "has responses" },
    { "from": "forms", "to": "form_shares", "kind": "1-n", "label": "has share grants" }
  ]
}
```

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
