---
title: "Dispatch Template"
description: "Dispatch is the workspace control plane — central inbox, cross-app orchestration, secrets vault, Slack/Telegram integration, and scheduled jobs."
---

# Dispatch

> **See also:** for the conceptual overview of what Dispatch does and when you want it, see [Dispatch](/docs/dispatch). This page is the template-specific reference.

Dispatch is the **workspace control plane**. Where other templates are domain apps (Mail, Calendar, Analytics), Dispatch is the app you run _alongside_ them to coordinate everything: a central inbox, a secrets vault, scheduled jobs, Slack/Telegram integration, and an orchestrator agent that delegates domain work to the right specialist app over [A2A](/docs/a2a-protocol).

<!-- screenshot:
  app: dispatch
  view: /overview
  shows: Overview with "What should we do next?" composer, prompt suggestions (Create a lightweight customer onboarding app / Ask Slides to draft a board update from our latest metrics / Schedule a Monday morning analytics digest), and the Workspace apps grid (Mail / Calendar / Slides / Analytics / Forms / Content + Create app placeholder) showing each mounted path + description
  account: screenshot-account (workspace seeded with the six sibling apps registered as A2A peers)
  capture: 1400x900 viewport, cropped 90px from bottom (final 1400x810)
-->

![Dispatch overview with the orchestrator chat and workspace apps grid](/screenshots/dispatch.png)

If you're running an [multi-app workspace](/docs/multi-app-workspace) with many apps, Dispatch is the glue.

## What it does {#what-it-does}

- **Central inbox.** Slack DMs, Telegram messages, email notifications, A2A requests from other agents — all land in one place. The Dispatch agent triages and either handles them itself or delegates. See [Messaging](/docs/messaging) for how to wire Slack, email, and Telegram into your workspace.
- **Orchestrator, not specialist.** Dispatch does _not_ try to be the email app or the analytics app. When someone asks "summarize last week's signups," Dispatch calls the analytics agent over A2A and returns the answer. When someone asks "draft a reply to Alice," Dispatch calls the mail agent.
- **Secrets vault.** A central store for API keys, OAuth tokens, and shared credentials. Apps in the workspace resolve secrets from Dispatch instead of duplicating them in every `.env`. Requests + approvals for sensitive access.
- **Workspace resources.** Global skills, guardrail instructions, custom agent profiles, and reference resources can be created once in Dispatch and shared to every app or granted to selected apps.
- **Integrations catalog.** One page showing every third-party integration — Slack, Telegram, SendGrid, Apollo, etc. — with a "configured / not configured / pending approval" status per app.
- **Scheduled jobs hub.** Cross-app [recurring jobs](/docs/recurring-jobs) live here: "every weekday at 7, pull yesterday's key metrics from analytics and draft a morning summary email."
- **Dreams.** Dispatch can review recent agent runs, failures, feedback, and successful patterns to propose memory, skill, job, and instruction improvements before anything durable is applied.
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
- **Review dream proposals.** Dispatch Dreams inspect prior agent runs and create source-backed proposals for what the workspace should remember, which stale notes should be cleaned up, and which repeated lessons should become skills or jobs.
- **Approve outbound actions before they fire.** Sending money, mass-emailing customers, or posting to a public Slack channel can be gated behind an admin OK.
- **See who has access to what.** Per-app grants, request queue, and an audit log of who used which secret when.
- **Route messages to the right specialist.** A Slack DM about analytics goes to the analytics agent; one about email goes to the mail agent — Dispatch picks.

## Architecture at a glance {#architecture}

_How it works under the hood (for developers)._

- **Orchestrator agent.** The chat is set up as a router: it reads `AGENTS.md`, `LEARNINGS.md`, and routes to specialist sub-agents or remote A2A agents.
- **Remote agent registry.** A2A manifests live in `remote-agents/*.json` — one per app. Dispatch calls them using the `call-agent` action. In a multi-app workspace, sibling apps under `apps/` are auto-discovered as A2A peers — no manual registration needed.
- **Vault schema.** Drizzle tables for secrets, grants, requests, approvals, and audit logs. See `server/db/schema.ts` in the template.
- **Slack / Telegram plugins.** Server plugins that register webhooks and forward incoming messages to the orchestrator agent.
- **MCP hub mode.** Dispatch can act as the workspace's [MCP hub](/docs/mcp-clients#hub) so every other app in the workspace pulls the same org-scope MCP server list.

## Dreams {#dreams}

Dreams are Dispatch's review loop for agent memory. A dream pass looks over existing agent runs, thread debug data, feedback, evals, and repeated tool failures, then writes a report with proposed changes. The proposals can target personal memory, shared workspace resources, skills, recurring jobs, or agent instructions, but shared and instruction-level changes stay reviewable rather than being applied silently.

Dream proposals are checked against the personal memory index, existing `memory/*.md` files, and shared `LEARNINGS.md` before they are saved. Duplicate lessons are skipped in the report, while likely stale personal memories are updated in place instead of producing parallel notes.

When Dispatch approval policy is enabled, applying a shared or team-wide dream proposal creates a pending approval request instead of writing immediately. Personal memory proposals can still be applied directly after review.

Use Dreams when you want to answer questions like "what did agents keep getting wrong this week?", "what should we remember?", or "which repeated lesson deserves a skill?" Inbound Slack, email, Telegram, WhatsApp, and web-derived evidence is treated as untrusted input, so proposals from those sources require review and provenance before they affect shared memory.

In the Dispatch UI, open **Dreams** to run a manual pass, review candidate threads, inspect the report, and apply or reject each proposal. Agents use the same workflow through actions:

- `list-dream-candidates` finds recent threads with grounded signals such as explicit user corrections, failed runs, tool errors, feedback, eval failures, and successful checkpointed workflows. Pass `sourceId: "all"` or `sourceIds` to scan multiple thread-debug sources; `sourceTimeoutMs` bounds each source and the response includes per-source health.
- `create-dream-report` creates the report and pending proposals. Multi-source reports include a Source Health section so partial scans are visible during review.
- `get-dream`, `apply-dream-proposal`, and `reject-dream-proposal` handle review.
- `ensure-dream-job` creates the safe recurring dream job once manual reports are useful.

## Scaffolding {#scaffolding}

```bash
pnpm dlx @agent-native/core create my-platform
# pick "Dispatch" in the multi-select picker, plus whichever domain apps you want
```

Dispatch is usually scaffolded into a workspace alongside the apps it coordinates. For a workspace, Dispatch's shared auth, database, and brand are inherited from the workspace core — see [Multi-App Workspace](/docs/multi-app-workspace).

## First local run {#first-local-run}

From the workspace root:

```bash
pnpm install
pnpm dev
```

Open the Dispatch URL printed by the dev server. Local development uses the same Better Auth sign-in flow as production. Create a local account with email + password; email verification is skipped in development, and the password is stored only in your local app database. There is no supported auth bypass in the default scaffold, because the agent, workspace resources, vault, and sharing model all rely on a real user session.

You can click through the Dispatch UI after signing in. To use the chat composer or run agent tasks, connect an LLM provider first:

1. Open **Settings**.
2. In **LLM**, either connect Builder.io or add your own provider key such as `ANTHROPIC_API_KEY`.
3. Return to **Overview** and try the composer.

## Customize it {#customize}

Dispatch is a full template like any other — see [Templates](/docs/cloneable-saas). Ask the agent to "add a new integration for Datadog" or "route Slack DMs from channel X to the issues agent" and it'll edit the routing config, add the webhook handler, and wire it up.

For workspace-specific management screens, add local React Router pages and
register them in `app/dispatch-extensions.tsx`. The generated workspace owns
only the extra tab and route; `@agent-native/dispatch` keeps owning the shell,
sidebar, built-in pages, and future package updates.

## What's next

- [**Messaging**](/docs/messaging) — connecting Slack, email, and Telegram so you can talk to your agent from anywhere
- [**Multi-App Workspace**](/docs/multi-app-workspace) — running Dispatch alongside multiple apps
- [**A2A Protocol**](/docs/a2a-protocol) — how Dispatch delegates to specialist agents
- [**MCP Clients — Hub Mode**](/docs/mcp-clients#hub) — sharing MCP servers across the workspace
- [**Recurring Jobs**](/docs/recurring-jobs) — scheduled tasks Dispatch runs
