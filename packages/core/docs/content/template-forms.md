---
title: "Forms Template"
description: "Agent-native form builder — create, edit, publish, and route form submissions through natural language plus a visual editor."
---

# Forms

Forms is an agent-native form builder. Describe the form you want, refine it in the editor, and publish a public form that stores submissions in your own SQL database.

When you open the app, you see your forms, the current editor, and a live preview. The agent can create a form from a prompt, update field labels and options, change validation, and connect submission destinations using the same actions the UI uses.

## What you can do with it

- **Build forms conversationally.** "Create a contact form," "add an NPS score question," "make the email field required." The agent updates the form schema and the preview updates from SQL-backed state.
- **Fine-tune visually.** Edit labels, placeholders, required state, options, and field order from the builder UI when you want direct control.
- **Use the shipped field types.** Text, email, number, long text, select, multi-select, checkbox, radio, date, rating, and scale fields are supported out of the box.
- **Collect responses.** Each submission is stored in SQL with a per-response detail view and a dashboard for reviewing entries.
- **Route submissions.** Send submission payloads to webhooks, Slack, Discord, or Google Sheets using the built-in integrations.
- **Publish public forms.** Share a public form URL and show a thank-you message after submission.

## Why it's interesting

The useful part of an agent-native form builder is that setup and iteration happen in the same place. You can ask the agent to add fields, adjust copy, connect Slack notifications, or inspect the submission data, while the UI remains the direct editor for the same SQL records.

See [What is agent-native?](/docs/what-is-agent-native) for the broader framework model.

## For Developers

### Scaffolding

```bash
pnpm dlx @agent-native/core create my-forms --template forms --standalone
```

For a workspace with Forms alongside other apps:

```bash
pnpm dlx @agent-native/core create my-platform
```

Pick Forms and any other templates you want during the workspace setup.

### Customize It

Ask the agent for shipped behavior first:

- "Add a required radio field for preferred contact method."
- "Post every new submission to Slack." Connect Slack first via [Messaging](/docs/messaging).
- "Add a webhook destination for our CRM."
- "Create a customer feedback form with a 1-10 scale and a long-text follow-up."
- "Make some forms public and others login-only."

If you need new capabilities such as file uploads, signatures, or custom field widgets, treat them as template extensions: add the SQL shape, actions, UI editor controls, public renderer support, and agent instructions together. See [Creating Templates](/docs/creating-templates) for the current build pattern.

## What's Next

- [**Cloneable SaaS**](/docs/cloneable-saas) — the clone-and-own model
- [**Actions**](/docs/actions) — the action system powering the builder
- [**Messaging**](/docs/messaging) — Slack and other submission destinations
