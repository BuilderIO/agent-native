---
title: "Chat Template"
description: "A minimal chat-first agent-native app: durable chat threads, actions, application state, live sync, auth, and room to add your own UI."
---

# Chat Template

Chat is the basic agent-native app starting point. It gives you a clean ChatGPT-style shell with chat at the center, a threads list on the left, standard app navigation, auth, live sync, actions, and one example action. Start here when you want a real browser app you can build on without committing to a domain template.

If you want the smallest action-only runtime with no browser UI, start with [Pure-Agent Apps](/docs/pure-agent-apps). If you want a finished domain product shape, start from [Calendar](/docs/template-calendar), [Mail](/docs/template-mail), [Content](/docs/template-content), [Forms](/docs/template-forms), [Analytics](/docs/template-analytics), or another domain template.

<!-- screenshot:
  app: chat
  view: /
  shows: Full-page chat app with standard left sidebar, chat threads on the left, centered composer, suggested prompts, and no domain data
  account: screenshot-account (no domain data needed — chat ships with no seed schema)
  capture: 1400x800 viewport, cropped 90px from bottom (final 1400x710)
-->

![Chat template with a full-page agent chat surface and thread sidebar](/screenshots/chat.png)

## What's in it {#whats-in-it}

- **Full-page chat** on `/` using the framework chat surface and durable chat threads.
- **Thread list in the app sidebar** so users can create, reopen, rename, pin, and archive chats.
- **Agent chat plugin** pre-configured so the chat talks to the built-in app-agent loop once your agent credentials are set.
- **Auth** via Better Auth — login, signup, sessions, organizations. The same flow runs locally and in production; in development email verification is skipped.
- **Actions directory** with one example (`actions/hello.ts`) plus the standard `view-screen` and `navigate` actions.
- **The framework's core tables** for application state, settings, sessions, resources, chat threads, run history, and other runtime state.
- **Live sync** (`useDbSync`) already wired so UI auto-refreshes when the agent writes to SQL.
- **AGENTS.md** with chat-first guidance for adding actions, routes, skills, and application state.

## What's _not_ in it {#not-in-it}

- No domain tables or seed data.
- No dashboards, lists, charts, forms, or provider integrations.
- No domain-specific actions beyond the example stub.

That's the point. Chat is a thin, useful default shell for your own agent, not a domain product pretending to be generic.

## When to pick it {#when-to-pick}

- **You want a basic app users can talk to immediately** and then extend with actions and UI.
- **You have a headless app that needs chat** as the first browser surface.
- **You want to plug your own agent backend into a familiar chat UI** while keeping Agent-Native's actions, state, auth, and deployment shape.
- **You are prototyping a custom internal tool** that does not match a domain template.

## Scaffolding {#scaffolding}

```bash
npx @agent-native/core@latest create my-chat-app --template chat
cd my-chat-app
pnpm install
pnpm dev
```

Or start with no UI and add a chat surface later:

```bash
npx @agent-native/core@latest create my-agent --headless
```

From there, copy the Chat template's `/` route and sidebar thread list into your app, or scaffold a Chat app and move your headless actions into its `actions/` directory. The key invariant stays the same: actions are the shared surface for chat, UI, HTTP, MCP, A2A, and CLI.

## Use your own agent backend {#own-agent-backend}

The template uses the built-in app-agent loop by default. To connect a custom backend, swap the chat runtime behind the agent chat plugin instead of rewriting the UI. The Chat route should stay a thin renderer around the shared chat surface; the backend choice belongs in the server plugin/runtime adapter.

Use this when your model orchestration already lives elsewhere, but you still want an app with auth, threads, actions, UI state, and deployable pages.

## First edits {#first-edits}

After scaffolding, ask the agent:

> Add a data model for `notes`. A note has an id, title, body, and owner. Render a notes page at `/notes`, add create/list actions, and keep chat able to create notes.

The agent should add a Drizzle schema, actions, route, navigation, and instructions. Then you can use the notes feature from either the UI or chat.

## What's next

- [**Getting Started**](/docs) — choose between headless, chat, and domain templates
- [**Agent Surfaces**](/docs/agent-surfaces) — headless, chat, embedded, and full-app patterns
- [**Actions**](/docs/actions) — the action system chat and UI both call
- [**Native Chat UI**](/docs/native-chat-ui) — chat surface primitives and runtime options
- [**Pure-Agent Apps**](/docs/pure-agent-apps) — action-only apps that can grow into Chat later
