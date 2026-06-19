---
title: "Pure-Agent Apps"
description: "Apps where the agent is the whole product: the app-agent loop is the front door, and UI is added only when humans need it."
---

# Pure-Agent Apps

A pure-agent app is the minimal end of agent-native: the app-agent loop is the
product, not a dashboard. You send a request from the terminal, Slack, email, a
scheduled job, another agent, or Chat — "summarize my unread emails," "post the
daily metrics to Slack" — and the agent acts and returns the result wherever it
belongs. It is still a real app: actions, sessions, app state, history,
settings, credentials, and share records all live in SQL.

Reach for this shape when the work runs in the background, the output leaves the
app, the domain is one-shot, or you're prototyping. The agent still needs a UI —
not a dashboard, but a place for humans to supervise, configure, and steer it —
which is why even pure-agent apps usually mount the built-in Chat shell.

This is the **headless** product shape. The full decision guide, what ships in
the box, the scaffold, repo access, and run sharing now live in one place:

→ [**Agent Surfaces — Headless agent**](/docs/agent-surfaces#headless)

## What's next

- [**Agent Surfaces — Headless**](/docs/agent-surfaces#headless) — the full headless decision guide and APIs
- [**Getting Started**](/docs/getting-started) — create a chat app or headless agent first
- [**Dispatch**](/docs/template-dispatch) — the workspace template that's a great pure-agent starting point
- [**Messaging the agent**](/docs/messaging) — how users talk to the agent across web, Slack, Telegram, email
- [**Recurring Jobs**](/docs/recurring-jobs) — scheduled prompts the agent runs on its own
- [**Actions**](/docs/actions) — the tools your pure-agent will call
