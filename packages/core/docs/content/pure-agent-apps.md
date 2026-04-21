---
title: "Pure-Agent Apps"
description: "Build an agent without a heavy UI — just the agent plus a minimal observability/management surface. All the framework benefits, none of the dashboard work."
---

# Pure-Agent Apps

Not every agent-native app needs a full SaaS-style interface. Sometimes the agent _is_ the product. A support triage agent. A daily report generator. A research bot. An email auto-responder. An ops runbook executor.

For these, the "app" is mostly just the agent doing work in the background. You still want a UI — but a minimal one, focused on **observability, management, and steering** rather than hand-crafted dashboards and forms.

This is the "agents benefit from a UI even when there's no rich app around them" pattern. The hot take is "agents will replace apps." The reality is "every agent eventually needs a UI for humans to supervise, configure, and debug it." Agent-native gives you that UI for free.

## The minimum viable UI {#minimum-ui}

A pure-agent app ships with five surfaces, all provided by the framework — you don't build them:

1. **Chat** — the main input. Users talk to the agent, steer it, queue tasks. (`<AgentSidebar>` or `<AgentPanel>`)
2. **Workspace** — skills, memory (`learnings.md`), `AGENTS.md`, custom sub-agents, connected MCP servers, scheduled jobs. Customize the agent's behavior without shipping code. (Workspace tab in the sidebar)
3. **Job history** — which scheduled jobs ran, when, whether they succeeded, what they did. (Workspace tab → `jobs/`)
4. **Thread history** — every past conversation, each preserved with its tool calls and final output. (Chat tab)
5. **Settings** — API keys, connected accounts, onboarding status. (Sidebar settings)

Those five together are enough UI for most pure-agent use cases. No analytics dashboard. No Kanban. No forms. Just: talk to it, see what it's done, configure how it behaves.

## When to pick this pattern {#when-to-pick}

Pure-agent makes sense when:

- **The work happens in the background.** Scheduled jobs, webhook-triggered handlers, Slack/Telegram responders. Users rarely sit in the app.
- **The output leaves the app.** The agent posts to Slack, sends email, writes to a third-party system. There's nothing to view in-app; the value is elsewhere.
- **The domain is one-shot.** A research bot that returns a report. No persistent object to dashboard.
- **You're prototyping.** Ship the agent now; add a rich UI only when you've proven users need it.

Pick a full [cloneable SaaS](/docs/cloneable-saas) template instead when the app has real persistent objects (emails, events, documents, charts) users need to browse, pivot, and share.

## The minimal scaffold {#scaffold}

Start from the **Starter** template:

```bash
pnpm dlx @agent-native/core create my-agent --template starter
```

Starter gives you the six-rules architecture, the agent panel, the workspace, auth, polling, and one example action — and nothing else. Add your own actions in `actions/`, connect any MCP servers you need, write the relevant skills into the workspace, and you're done. The "UI" is the agent sidebar — which is already complete.

If you really want _zero_ UI except the agent, `app/routes/index.tsx` can just render `<AgentPanel defaultMode="chat" />` fullscreen. The only thing the user sees is the chat. Everything else — job history, workspace, settings — is one click away in the panel's tabs.

## What you still get for free {#still-free}

Even with no custom UI, you still inherit every framework benefit:

- **Actions** as agent tools + HTTP endpoints + MCP tools + A2A tools. External agents, Claude Desktop, and your own HTTP clients can drive the agent without going through the chat UI.
- **Recurring jobs** for scheduled work — "every morning at 7 summarize my unread emails and post to Slack."
- **The workspace** for per-user customization, skills, memory, MCP connections.
- **Sub-agent delegation** via [agent teams](/docs/agent-teams).
- **Portability** — deploys to any serverless host, any SQL database.
- **Multi-tenant by default** — each user gets their own workspace without a dev-box.

## Adding a tiny bit of UI {#tiny-ui}

Most "pure-agent" apps eventually want a little bit of custom UI — not a dashboard, but maybe a status page, a job history, or a config screen. The [drop-in agent](/docs/drop-in-agent) components coexist with anything else you render. Add a single `/status` route that lists recent runs; keep everything else in the chat. That's usually enough.

## What's next

- [**Recurring Jobs**](/docs/recurring-jobs) — scheduled prompts the agent runs on its own
- [**Drop-in Agent**](/docs/drop-in-agent) — mounting `<AgentPanel>` fullscreen or in a sidebar
- [**Actions**](/docs/actions) — the tools your pure-agent will call
- [**Workspace**](/docs/workspace) — the customization surface for skills, memory, and MCP servers
