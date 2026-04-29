---
title: "Forms Template"
description: "Agent-native form builder — create, edit, and analyze forms through natural language, with a live preview and click-to-edit GUI."
---

# Forms

A form builder where the form builder _is_ the agent. Drag fields around in the editor, or just say "add a 'how did you hear about us' dropdown with five options and make it required" — same result, same underlying data. Think Typeform, but you can build, edit, and analyze forms by talking to the agent.

When you open the app, you'll see a list of your forms on the left and the editor in the middle. Open a form and you can click any field to fine-tune it, or ask the agent to make changes for you.

## What you can do with it

- **Build forms conversationally.** "Create a contact form," "add an NPS score question," "make the email field required." The agent updates the schema and the preview updates live.
- **Click-to-edit fine-tuning.** Every field in the preview is editable in place — label, placeholder, validation, conditional logic — with the usual GUI controls.
- **Field types out of the box:** short text, long text, email, phone, URL, number, date, single-select, multi-select, rating, file upload, section header, conditional branch.
- **Responses dashboard.** Per-response view plus an aggregate dashboard the agent can pivot on request: "show me signups from the last 30 days grouped by source."
- **Agent-driven analysis.** Ask the agent to cluster free-text responses, extract sentiments, or draft a reply to everyone who scored the NPS below 7.
- **Publish anywhere.** Public share link, embed snippet, branded thank-you page, webhook on submit.

## Why it's interesting

The hard part of a form builder isn't the editor UI — it's everything around it: changing the questions after responses are already in, analyzing what people said, adding conditional logic, publishing, notifications, hooking it into Slack or your CRM. Most of that is just asking the agent. See [What is agent-native?](/docs/what-is-agent-native) for the bigger picture.

## For developers

### Scaffolding

```bash
pnpm dlx @agent-native/core create my-forms --template forms --standalone
```

For a workspace with forms alongside other apps:

```bash
pnpm dlx @agent-native/core create my-platform  # pick Forms + other templates
```

### Customize it

Ask the agent for the outcome you want:

- "Add a signature field where people can draw their name."
- "When someone submits this form, post it in our #signups Slack channel." (Connect Slack first via [Messaging](/docs/messaging).)
- "Make some forms public and others login-only."
- "Send everyone who scored below 5 a follow-up email asking what we could do better."

The agent figures out the schema changes, components, and storage on its own — you just describe the result you want. See [Cloneable SaaS](/docs/cloneable-saas) for the full clone, customize, deploy flow.

## What's next

- [**Cloneable SaaS**](/docs/cloneable-saas) — the clone-and-own model
- [**Actions**](/docs/actions) — the action system powering the builder
- [**Real-Time Sync**](/docs/real-time-collaboration) — how the preview stays in sync with agent edits
