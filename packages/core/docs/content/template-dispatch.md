---
title: "Dispatch Template"
description: "Dispatch is the workspace control plane — central inbox, cross-app orchestration, secrets vault, Slack/Telegram integration, and scheduled jobs."
---

# Dispatch

Dispatch is the **workspace control plane**. Where other templates are domain apps (Mail, Calendar, Analytics), Dispatch is the app you run _alongside_ them to coordinate everything: a central inbox, a secrets vault, scheduled jobs, Slack/Telegram integration, and an orchestrator agent that delegates domain work to the right specialist app over [A2A](/docs/a2a-protocol).

If you're running an [multi-app workspace](/docs/multi-app-workspace) with many apps, Dispatch is the glue.

## What it does {#what-it-does}

- **Central inbox.** Slack DMs, Telegram messages, email notifications, A2A requests from other agents — all land in one place. The Dispatch agent triages and either handles them itself or delegates. See [Messaging](/docs/messaging) for how to wire Slack, email, and Telegram into your workspace.
- **Orchestrator, not specialist.** Dispatch does _not_ try to be the email app or the analytics app. When someone asks "summarize last week's signups," Dispatch calls the analytics agent over A2A and returns the answer. When someone asks "draft a reply to Alice," Dispatch calls the mail agent.
- **Secrets vault.** A central store for API keys, OAuth tokens, and shared credentials. Apps in the workspace resolve secrets from Dispatch instead of duplicating them in every `.env`. Requests + approvals for sensitive access.
- **Integrations catalog.** One page showing every third-party integration — Slack, Telegram, SendGrid, Apollo, etc. — with a "configured / not configured / pending approval" status per app.
- **Scheduled jobs hub.** Cross-app [recurring jobs](/docs/recurring-jobs) live here: "every weekday at 7, pull yesterday's key metrics from analytics and draft a morning summary email."
- **Approval flow.** Destructive or external actions (sending money, shipping an outbound email, posting to Slack at scale) can require an admin OK before they fire. Dispatch owns the queue.

## When to use it {#when-to-use}

Use Dispatch when:

- You have **two or more** agent-native apps in a workspace and want one place to coordinate between them.
- You need **centralized secrets** with per-app grants and an audit trail.
- You want a **messaging hub** that routes Slack or Telegram into the right domain agent.
- You want **scheduled jobs** that pull data from several apps.

Skip it for a single-app scaffold — use the [Starter template](/docs/template-starter) or any of the domain templates directly.

## What you'll do with it {#what-youll-do}

Day-to-day, Dispatch is the place admins and ops folks open to keep the workspace running:

- **Connect Slack, email, and Telegram** so people can message your agent from wherever they already work. See [Messaging](/docs/messaging) for the wiring steps.
- **Save shared secrets once.** API keys, OAuth tokens, and service credentials live in the vault and the other apps in your workspace pull from there instead of every team member juggling their own `.env`.
- **Set up recurring jobs.** "Every Monday at 7am, ask the analytics agent for last week's signups and email me a summary." See [Recurring Jobs](/docs/recurring-jobs).
- **Approve outbound actions before they fire.** Sending money, mass-emailing customers, or posting to a public Slack channel can be gated behind an admin OK.
- **See who has access to what.** Per-app grants, request queue, and an audit log of who used which secret when.
- **Route messages to the right specialist.** A Slack DM about analytics goes to the analytics agent; one about email goes to the mail agent — Dispatch picks.

## Architecture at a glance {#architecture}

_How it works under the hood (for developers)._

- **Orchestrator agent.** The chat is set up as a router: it reads `AGENTS.md`, `LEARNINGS.md`, and routes to specialist sub-agents or remote A2A agents.
- **Remote agent registry.** A2A manifests live in `remote-agents/*.json` — one per app. Dispatch calls them using the `call-agent` action.
- **Vault schema.** Drizzle tables for secrets, grants, requests, approvals, and audit logs. See `server/db/schema.ts` in the template.
- **Slack / Telegram plugins.** Server plugins that register webhooks and forward incoming messages to the orchestrator agent.
- **MCP hub mode.** Dispatch can act as the workspace's [MCP hub](/docs/mcp-clients#hub) so every other app in the workspace pulls the same org-scope MCP server list.

## Scaffolding {#scaffolding}

```bash
pnpm dlx @agent-native/core create my-platform
# pick "Dispatch" in the multi-select picker, plus whichever domain apps you want
```

Dispatch is usually scaffolded into a workspace alongside the apps it coordinates. For a workspace, Dispatch's shared auth, database, and brand are inherited from the workspace core — see [Multi-App Workspace](/docs/multi-app-workspace).

## Customize it {#customize}

Dispatch is a full cloneable SaaS like any other template — see [Cloneable SaaS](/docs/cloneable-saas). Ask the agent to "add a new integration for Datadog" or "route Slack DMs from channel X to the issues agent" and it'll edit the routing config, add the webhook handler, and wire it up.

## What's next

- [**Messaging**](/docs/messaging) — connecting Slack, email, and Telegram so you can talk to your agent from anywhere
- [**Multi-App Workspace**](/docs/multi-app-workspace) — running Dispatch alongside multiple apps
- [**A2A Protocol**](/docs/a2a-protocol) — how Dispatch delegates to specialist agents
- [**MCP Clients — Hub Mode**](/docs/mcp-clients#hub) — sharing MCP servers across the workspace
- [**Recurring Jobs**](/docs/recurring-jobs) — scheduled tasks Dispatch runs
