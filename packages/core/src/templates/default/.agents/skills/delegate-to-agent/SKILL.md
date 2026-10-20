---
name: delegate-to-agent
description: >-
  Route user-facing AI work through the app's agent chat. Use when adding an
  AI-powered button, workflow, research task, generation flow, or follow-up.
scope: dev
---

# Delegate AI Work to Agent Chat

## Rule

Use the agent chat for work that needs AI reasoning, research, generation, or
multi-step decisions. Keep app actions deterministic; let the agent orchestrate
them so the user can see and steer the work.

## Start a visible agent turn

Call `sendToAgentChat()` from the UI and open the AgentSidebar for user-initiated
work:

```ts
import { sendToAgentChat } from "@agent-native/core/client/agent-chat";

sendToAgentChat({
  message: userRequest,
  context: JSON.stringify({ documentId }),
  submit: true,
  openSidebar: true,
});
```

Keep the user's request in `message`. Put only concise supporting context—such
as a selected record id, current view, or bounded excerpt—in `context`. Use
attachments or image fields for files and visuals; do not serialize full
records or credentials into a prompt. The agent should read private or large
data through the app's authorized actions.

Use `submit: true` when a clear user action already states the intent. Use
`submit: false` to open the composer with a prefill when the user should review
or complete the request. Do not auto-submit a generic generation prompt before
the user has supplied the request.

Reserve `background: true` with `openSidebar: false` for work the product
intentionally runs silently, such as a system-initiated task. A button that
asks the user to do AI work should open the sidebar.

## Keep the boundary clear

- Use focused actions for provider reads, validation, deterministic
  transformations, database writes, and other explicit operations.
- Let the agent choose and sequence those actions for AI-shaped workflows.
- Keep a user's freeform prompt in the AgentSidebar composer. Use controls for
  structured parameters; do not add a second prompt or follow-up textbox.
- Do not call model-provider SDKs, `completeText()`, or AI SDK generation
  functions from app UI, actions, or server helpers. Do not make an action a
  hidden second agent.

## Related skills

- `actions` — define deterministic operations shared by the UI and agent.
- `context-awareness` — provide navigation and selected-record context.
