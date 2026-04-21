---
title: "Forms Template"
description: "Agent-native form builder — create, edit, and analyze forms through natural language, with a live preview and click-to-edit GUI."
---

# Forms

Forms is an agent-native form builder with a simple premise: everything the GUI can do, the agent can do, and vice versa. You can drag fields around in the editor, or you can type "add a 'how did you hear about us' dropdown with five options and make it required" — same result, same underlying data.

Think Typeform, but the form builder _is_ the agent.

## What it does {#what-it-does}

- **Build forms conversationally.** "Create a contact form," "add a NPS score question," "make the email field required." The agent updates the schema; the preview updates live.
- **Click-to-edit fine-tuning.** Every field in the preview is editable in place — label, placeholder, validation, conditional logic — with the usual GUI controls.
- **Field types** out of the box: short text, long text, email, phone, URL, number, date, single-select, multi-select, rating, file upload, section header, conditional branch.
- **Responses dashboard.** Per-response view + an aggregate dashboard the agent can pivot on request: "show me signups from the last 30 days grouped by source."
- **Agent-driven analysis.** Ask the agent to cluster free-text responses, extract sentiments, or draft a reply to everyone who scored the NPS below 7.
- **Publishing.** Public share link with embed snippet, branded thank-you page, webhook on submit.

## Why it's interesting {#why}

Forms is a clear example of the [ladder](/docs/what-is-agent-native#the-ladder) rung 3 payoff. The hard part of a form builder isn't the editor UI — it's everything around it: schema evolution, response analytics, conditional logic, publishing, notifications, integrations. Most of that is just prompting the agent, because every capability is an action the agent can call.

## Scaffolding {#scaffolding}

```bash
pnpm dlx @agent-native/core create my-forms --template forms --standalone
```

For a workspace with forms alongside other apps:

```bash
pnpm dlx @agent-native/core create my-platform  # pick Forms + other templates
```

## Customize it {#customize}

Ask the agent:

- "Add a new 'signature' field type that captures a drawn signature." It adds the schema entry, renders the component, handles storage.
- "When someone submits a form, post the response to our #signups Slack channel." It wires the webhook.
- "Add per-form access control — some are public, some require a login." It updates the publishing flow.

See [Cloneable SaaS](/docs/cloneable-saas) for the full clone → customize → deploy flow.

## What's next

- [**Cloneable SaaS**](/docs/cloneable-saas) — the clone-and-own model
- [**Actions**](/docs/actions) — the action system powering the builder
- [**Real-Time Sync**](/docs/real-time-collaboration) — how the preview stays in sync with agent edits
