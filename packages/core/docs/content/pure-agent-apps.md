---
title: "Pure-Agent Apps"
description: "Apps where the first product surface is the app-agent loop: define actions, run them locally, and add UI only when users need it."
---

# Pure-Agent Apps

This is the minimal end of agent-native: an app whose first user-facing surface is the agent loop, not a dashboard. For the full-UI end, start from a [template](/docs/cloneable-saas). If you are choosing between headless, chat-first, embedded, and full-app shapes, start with [Agent Surfaces](/docs/agent-surfaces).

Imagine opening an app and seeing just a chat. No dashboard. No sidebar full of menus. No forms. You ask for what you want - "summarize my unread emails," "post the daily metrics to Slack," "find the candidates who replied last week" - and the agent goes off and does it. The output shows up in chat, in Slack, in your inbox, wherever it belongs.

That's a pure-agent app. The agent _is_ the product.

It is still an app, not a stateless prompt. Actions, auth sessions, app state, thread history, run history, settings, credentials, and share records live in SQL. Locally that defaults to SQLite; hosted deployments should use a persistent SQL database.

## What it feels like to use one {#user-experience}

Most apps are built around a UI: a database table you browse, a form you fill, a chart you read. The agent is a sidekick.

In a pure-agent app, that's flipped. The chat is the front door. You type a request; the agent takes action; you see the result. Everything else — settings, history, what's currently running — is one click away, but most of the time you don't need it.

Examples of where this works really well:

- **Background workers** — a triage agent that watches your inbox and labels things, a daily-report agent that posts to Slack each morning, an on-call agent that responds to alerts.
- **One-shot helpers** — "research this company and write a one-pager," "scan my GitHub issues and tell me which ones look stale."
- **Channel-driven assistants** — agents you mostly talk to from Slack, Telegram, email, or another agent (via [A2A](/docs/a2a-protocol)). The "app" itself is mostly a control panel.
- **Internal tools** — an agent that knows your runbooks, your APIs, your conventions, and can act on them.

The hot take is "agents will replace apps." The honest version is "agents still need a UI — for humans to supervise, configure, and steer them." Pure-agent apps give you that UI without the dashboard sprawl.

## When this beats a traditional app {#when}

Pick the pure-agent pattern when:

- **The work happens in the background.** Most of the value is created while the user isn't looking.
- **The output leaves the app.** The agent posts to Slack, sends email, updates a third-party system. There's nothing to browse in-app — the value is elsewhere.
- **The domain is one-shot.** Research bot, summary generator, report writer. There's no persistent object that needs a list view.
- **You're prototyping.** Ship the agent now; add a richer UI later if it turns out users actually want one.

If your product is built around persistent objects users browse, pivot, and share - emails, events, documents, charts - pick a [template](/docs/cloneable-saas) instead. Those have full UIs _plus_ the agent.

## What ships in the box {#minimum-ui}

Every pure-agent app gets five built-in surfaces, all provided by the framework — you don't build them:

1. **Chat** — the main input. Users talk to the agent, steer it, queue tasks.
2. **Workspace** — skills, memory, instructions, custom sub-agents, connected MCP servers, scheduled jobs. Customize the agent's behavior without shipping code.
3. **Job history** — which scheduled jobs ran, when, whether they succeeded, what they did.
4. **Thread history** — every past conversation, each preserved with its tool calls and final output.
5. **Settings** — API keys, connected accounts, onboarding status.

Those five are usually enough. No analytics dashboard. No Kanban. No forms. Just: talk to it, see what it's done, configure how it behaves.

## Why you'd pick this over "an app with an AI sidebar" {#vs-traditional}

Two reasons:

1. **You don't have to build the UI.** A pure-agent app skips weeks of dashboard work. The chat handles input; the framework handles supervision and history; the agent handles output.
2. **It's channel-agnostic from day one.** The same agent that runs in your web UI also runs from Slack, Telegram, email, and other agents — because everything goes through the agent, not the UI. See [Messaging the agent](/docs/messaging) for how that works.

The trade-off: pure-agent apps don't give users a "browse-everything-at-a-glance" view. If your users need that, mix patterns: start pure-agent, add a small status page or list view if you discover users want one.

## Building one {#building}

If you're not a developer, you can usually start with the [Dispatch template](/docs/template-dispatch) — it's a workspace-style pure-agent app with Slack/Telegram, scheduled jobs, and shared secrets out of the box.

For developers who want the absolute minimum, start from a headless scaffold:

```bash
npx @agent-native/core@latest create my-agent --headless
```

This gives you the framework runtime, SQL-backed state, an `actions/` directory, and `pnpm agent` for running the local app-agent loop. Add one useful `defineAction()` and you have a real agent-native app. The same action can later render in chat, appear behind a button, expose an MCP tool, or move into a full UI without changing the core operation.

Use [**Chat**](/docs/template-chat) when you are ready to add a browser UI but do not want a domain template. Chat is the add-UI scaffold path, not the required default for a pure-agent app.

If you really want _zero_ custom UI except the agent, keep the app route focused on the built-in chat surface. The only thing the user sees is the chat. Everything else - job history, workspace, settings - is one click away in the panel's tabs.

### What you still get for free {#still-free}

Even with no custom UI, you still inherit every framework benefit:

- **Actions** as agent tools, HTTP endpoints, MCP tools, and A2A tools. External agents, Claude Desktop, and your own HTTP clients can drive the agent without going through the chat UI.
- **Recurring jobs** for scheduled work — "every morning at 7, summarize my unread emails and post to Slack."
- **The workspace** for per-user customization, skills, memory, MCP connections.
- **Sub-agent delegation** via [agent teams](/docs/agent-teams).
- **Portability** — deploys to any serverless host with any supported SQL database.
- **Multi-tenant by default** — each user gets their own workspace without a dev-box.

### Adding a tiny bit of UI {#tiny-ui}

Most pure-agent apps eventually want a little custom UI — not a dashboard, but maybe a status page, a job history, or a config screen. The [drop-in agent](/docs/drop-in-agent) components coexist with anything else you render. Add a single `/status` route that lists recent runs; keep everything else in the chat. That's usually enough.

Future UI-grafting tooling should use a distinct verb or namespace. `agent-native add` already means integration blueprints such as providers, channels, and sandbox adapters, so it should not also mean "add UI to this headless app."

## Repo access for cloud headless {#repo-access}

Local headless apps run against the folder on your machine. For cloud headless
apps that need repository access, the intended model is connector-scoped access:
a GitHub connector and token CRUD that can list repositories, search files, read
files, create or edit files, and delete files with the user's permission.

Do not design this as "clone the user's repo into our VM" or "give the agent a long-lived sandbox copy of the repo" as the primary model. Sandboxes are useful for isolated code execution, but repo access should be a provider integration with explicit tokens, scoped permissions, auditability, and revocation.

## Sharing sessions and runs {#sharing-runs}

Pure-agent work produces durable sessions and runs. Shareability should roll out in phases:

- **First:** read-only share links so a teammate can open a thread or run, inspect the sanitized transcript, outputs, and status, and follow along without taking control.
- **Later:** permissioned writable collaboration, such as continuing a run, editing schedules, approving actions, or changing configuration with explicit access checks.

That staged model keeps the first sharing surface useful without pretending collaborative control is solved before the permission model is ready.

## What's next

- [**Getting Started**](/docs/getting-started) — create a chat app or headless action first
- [**Agent Surfaces**](/docs/agent-surfaces) — choose headless, rich chat, embedded sidecar, or full app
- [**Messaging the agent**](/docs/messaging) — how users talk to the agent across web, Slack, Telegram, email
- [**Recurring Jobs**](/docs/recurring-jobs) — scheduled prompts the agent runs on its own
- [**Dispatch**](/docs/template-dispatch) — the workspace template that's a great starting point for pure-agent apps
- [**Drop-in Agent**](/docs/drop-in-agent) — mounting `<AgentPanel>` fullscreen or in a sidebar
- [**Actions**](/docs/actions) — the tools your pure-agent will call
- [**Workspace**](/docs/workspace) — the customization surface for skills, memory, and MCP servers
