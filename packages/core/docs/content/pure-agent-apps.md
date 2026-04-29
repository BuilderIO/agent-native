---
title: "Pure-Agent Apps"
description: "Apps where the agent is the whole product — open it, ask for what you want, and the agent does the rest."
---

# Pure-Agent Apps

Imagine opening an app and seeing… just a chat. No dashboard. No sidebar full of menus. No forms. You ask for what you want — "summarize my unread emails," "post the daily metrics to Slack," "find the candidates who replied last week" — and the agent goes off and does it. The output shows up in chat, in Slack, in your inbox, wherever it belongs.

That's a pure-agent app. The agent _is_ the product.

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

If your product is built around persistent objects users browse, pivot, and share — emails, events, documents, charts — pick a [cloneable SaaS](/docs/cloneable-saas) template instead. Those have full UIs _plus_ the agent.

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

For developers who want the absolute minimum, start from the **Starter** template:

```bash
pnpm dlx @agent-native/core create my-agent --template starter
```

Starter gives you the architecture, the agent panel, the workspace, auth, polling, and one example action — and nothing else. Add your own actions in `actions/`, connect any MCP servers you need, write the relevant skills into the workspace, and you're done.

If you really want _zero_ UI except the agent, `app/routes/index.tsx` can render `<AgentPanel defaultMode="chat" />` fullscreen. The only thing the user sees is the chat. Everything else — job history, workspace, settings — is one click away in the panel's tabs.

### What you still get for free {#still-free}

Even with no custom UI, you still inherit every framework benefit:

- **Actions** as agent tools, HTTP endpoints, MCP tools, and A2A tools. External agents, Claude Desktop, and your own HTTP clients can drive the agent without going through the chat UI.
- **Recurring jobs** for scheduled work — "every morning at 7, summarize my unread emails and post to Slack."
- **The workspace** for per-user customization, skills, memory, MCP connections.
- **Sub-agent delegation** via [agent teams](/docs/agent-teams).
- **Portability** — deploys to any serverless host, any SQL database.
- **Multi-tenant by default** — each user gets their own workspace without a dev-box.

### Adding a tiny bit of UI {#tiny-ui}

Most pure-agent apps eventually want a little custom UI — not a dashboard, but maybe a status page, a job history, or a config screen. The [drop-in agent](/docs/drop-in-agent) components coexist with anything else you render. Add a single `/status` route that lists recent runs; keep everything else in the chat. That's usually enough.

## What's next

- [**Getting Started**](/docs/getting-started) — clone the Starter template
- [**Messaging the agent**](/docs/messaging) — how users talk to the agent across web, Slack, Telegram, email
- [**Recurring Jobs**](/docs/recurring-jobs) — scheduled prompts the agent runs on its own
- [**Dispatch**](/docs/template-dispatch) — the workspace template that's a great starting point for pure-agent apps
- [**Drop-in Agent**](/docs/drop-in-agent) — mounting `<AgentPanel>` fullscreen or in a sidebar
- [**Actions**](/docs/actions) — the tools your pure-agent will call
- [**Workspace**](/docs/workspace) — the customization surface for skills, memory, and MCP servers
