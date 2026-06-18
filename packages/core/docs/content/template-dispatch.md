---
title: "Dispatch"
description: "Dispatch is the workspace control plane — central inbox, cross-app orchestration, secrets vault, Slack/Telegram integration, and scheduled jobs."
---

# Dispatch

> **See also:** for the conceptual overview of what Dispatch does and when you want it, see [Dispatch](/docs/dispatch). This page is the template-specific reference.

Dispatch is the **workspace control plane**. Where other templates are domain apps (Mail, Calendar, Analytics, Brain), Dispatch is the app you run _alongside_ them to coordinate everything: a central inbox, a secrets vault, scheduled jobs, Slack/Telegram integration, and an orchestrator agent that delegates domain work to the right specialist app over [A2A](/docs/a2a-protocol).

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
- **Workspace resources.** Global skills, guardrail instructions, custom agent profiles, reference resources, and HTTP MCP servers can be created once in Dispatch. All-app resources are inherited at runtime by every app with no copy or manual sync step; selected grants are for app-specific exceptions.
- **Reusable integrations.** One place to connect provider accounts, track
  credential refs, and grant apps access. Dispatch owns provider identity and
  app grants; domain apps still own app-specific source choices such as Brain's
  Slack channel allow-list or Analytics' metric/dashboard configuration.
- **Scheduled jobs hub.** Cross-app [recurring jobs](/docs/recurring-jobs) live here: "every weekday at 7, pull yesterday's key metrics from analytics and draft a morning summary email."
- **Dreams.** Dispatch can review recent agent runs, failures, feedback, and successful patterns to propose memory, skill, job, and instruction improvements before anything durable is applied.
- **Approval flow.** Destructive or external actions (sending money, shipping an outbound email, posting to Slack at scale) can require an admin OK before they fire. Dispatch owns the queue.

## When to use it {#when-to-use}

Use Dispatch when:

- You have **two or more** agent-native apps in a workspace and want one place to coordinate between them.
- You need **centralized secrets** with per-app grants and an audit trail.
- You want a **messaging hub** that routes Slack or Telegram into the right domain agent.
- You want **scheduled jobs** that pull data from several apps.

Skip it for a single-app scaffold — use the [Chat template](/docs/template-chat) or any of the domain templates directly.

Live demo: [dispatch.agent-native.com](https://dispatch.agent-native.com).

## What you'll do with it {#what-youll-do}

Day-to-day, Dispatch is the place admins and ops folks open to keep the workspace running:

- **Connect Slack, email, and Telegram** so people can message your agent from wherever they already work. See [Messaging](/docs/messaging) for the wiring steps.
- **Save shared secrets once.** API keys, OAuth tokens, and service credentials live in the vault and the other apps in your workspace pull from there instead of every team member juggling their own `.env`.
- **Connect providers once.** Reusable integrations store safe account metadata
  and credential references, then grant apps such as Brain, Analytics, Mail, or
  Dispatch access without copying raw secrets. App-specific source
  configuration stays in the app that uses the provider.
- **Expose one MCP connector.** Add
  `https://dispatch.agent-native.com/_agent-native/mcp` in Claude, ChatGPT,
  Codex, Cursor, or another MCP host, then choose which workspace apps the
  connector can reach from Dispatch's **Agents** page. Use a direct app URL
  only when that host should be isolated to one app.
- **Keep company context global.** Put personas, positioning, messaging, company facts, brand guidelines, and guardrails in Dispatch Resources once, then preview the effective workspace -> app/org -> personal stack for any app/user or inspect the stack from an app card's Context view.
- **Set up recurring jobs.** "Every Monday at 7am, ask the analytics agent for last week's signups and email me a summary." See [Recurring Jobs](/docs/recurring-jobs).
- **Review dream proposals.** Dispatch Dreams inspect prior agent runs and create source-backed proposals for what the workspace should remember, which stale notes should be cleaned up, and which repeated lessons should become skills or jobs.
- **Approve outbound actions before they fire.** Sending money, mass-emailing customers, or posting to a public Slack channel can be gated behind an admin OK.
- **See who has access to what.** Per-app grants, request queue, and an audit log of who used which secret when.
- **Route messages to the right specialist.** A Slack DM about analytics goes to the analytics agent; one about email goes to the mail agent — Dispatch picks.

## Architecture at a glance {#architecture}

_How it works under the hood (for developers)._

- **Orchestrator agent.** The chat is set up as a router: it reads `AGENTS.md`, `LEARNINGS.md`, and routes to specialist sub-agents or remote A2A agents.
- **Remote agent registry.** A2A agent manifests are workspace-runtime entries (not a checked-in template source folder): in a multi-app workspace, sibling apps under `apps/` are auto-discovered as A2A peers — no manual registration needed. Dispatch calls them using the `call-agent` action.
- **Vault schema.** Drizzle tables for secrets, grants, requests, approvals, and audit logs. These live in the `@agent-native/dispatch` package (`packages/dispatch/src/db/schema.ts`) and are re-exported into the template via `templates/dispatch/server/db/index.ts` — there is no template-local `server/db/schema.ts`. Dispatch's runtime ships in the package, not in template source (consistent with the note below that `@agent-native/dispatch` owns the shell, sidebar, and built-in pages).
- **Slack / Telegram plugins.** Server plugins that register webhooks and forward incoming messages to the orchestrator agent.
- **Workspace MCP resources.** Add HTTP MCP server definitions under `mcp-servers/*.json` in Resources, then scope them to All apps or selected app grants just like skills and context.
- **MCP hub mode.** Dispatch can still act as the workspace's [MCP hub](/docs/mcp-clients#hub) so every other app in the workspace pulls the same org-scope MCP server list. Separately, Dispatch's own `/_agent-native/mcp` endpoint is the recommended external MCP connector for Claude, ChatGPT, and other hosts that should reach multiple workspace apps.

## Dreams {#dreams}

Dreams are Dispatch's review loop for agent memory. A dream pass looks over existing agent runs, thread debug data, feedback, evals, and repeated tool failures, then writes a report with proposed changes. The proposals can target personal memory, shared `LEARNINGS.md`, workspace instructions, workspace skills, workspace knowledge, workspace agents, or recurring jobs, but shared and workspace-level changes stay reviewable rather than being applied silently.

Dream proposals are checked against the personal memory index, existing `memory/*.md` files, and shared `LEARNINGS.md` before they are saved. Duplicate lessons are skipped in the report, while likely stale personal memories are updated in place instead of producing parallel notes. Within a report, Dreams also deduplicate repeated evidence by thread, signal type, and normalized quote, strip injected context from user-correction detection, and summarize raw eval/tool rows into human-readable bullets before they appear in proposal text. When a pass finds signals but intentionally creates no proposals, the report includes guardrail notes explaining which evidence was suppressed.

When Dispatch approval policy is enabled, applying a shared or team-wide dream proposal creates a pending approval request instead of writing immediately. Creating, updating, or deleting an All-app workspace resource also queues an approval request. Personal memory proposals and selected-only resource edits can still be applied directly after review.

Use Dreams when you want to answer questions like "what did agents keep getting wrong this week?", "what should we remember?", or "which repeated lesson deserves a skill?" Inbound Slack, email, Telegram, WhatsApp, and web-derived evidence is treated as untrusted input, so proposals from those sources require review and provenance before they affect shared memory. Workspace-instruction proposals require durable evidence spanning at least two threads or two source apps; eval-only noise, account setup issues, quota limits, and single-app UI wording corrections stay out of global instructions.

### Dream input validation boundaries

Because evidence is collected from external, untrusted sources (such as chat transcripts, webhooks, and third-party integrations), the Dream processor enforces strict input validation boundaries to prevent prompt injection and payload-size attacks:

- **Byte Size Limits:** Individual thread payloads are capped at a maximum of 10KB of text content per message, and candidate scans are truncated if they exceed 100KB in total to prevent context exhaustion.
- **Sanitization:** All text inputs are sanitized to strip control characters, binary payloads, and non-printable Unicode ranges.
- **Schema Validation:** Inbound debug data and thread history are parsed against strict Zod schemas before being compiled into LLM prompts. Any candidate structure that fails schema validation is immediately discarded from the processing batch.
- **Escaping:** All user-provided text chunks are dynamically escaped when formatted into the prompt templates to prevent prompt injections (e.g., trying to hijack the Dream loop to write arbitrary instructions).

In the Dispatch UI, open **Dreams** to run a manual pass, review candidate threads, inspect the report, and open each proposal's review sheet before applying or rejecting it. Use **Settings** to edit the recurring cron schedule, source scope, timeout/concurrency limits, candidate limit, and minimum candidate threshold; use **Ensure schedule** after saving when you want the `jobs/dispatch-dream.md` recurring job materialized from those settings. The review sheet shows approval behavior, the current target content, proposed content, and source evidence. Agents use the same workflow through actions:

- `list-dream-candidates` finds recent threads with grounded signals such as explicit user corrections, failed runs, tool errors, feedback, eval failures, and successful checkpointed workflows. Pass `sourceId: "all"` or `sourceIds` to scan multiple thread-debug sources; `sourceTimeoutMs`, `sourceConcurrency`, `sourceStartStaggerMs`, `threadConcurrency`, and `threadTimeoutMs` keep production scans partial and bounded, and the response includes per-source health.
- `create-dream-report` creates the report and pending proposals. Multi-source reports include a Source Health section so partial scans are visible during review. Repeated corrections and recurring failures can become workspace-resource proposals such as `workspace-instruction`; repeated successful checkpointed workflows can become `workspace-skill` proposals.
- `get-dream-settings` and `set-dream-settings` read and update the recurring dream schedule, source scope, timeout/concurrency controls, limit, and minimum candidate threshold.
- `get-dream`, `preview-dream-proposal`, `apply-dream-proposal`, and `reject-dream-proposal` handle review.
- `ensure-dream-job` creates the safe recurring dream job once manual reports are useful.

The Dispatch template's local action runner also exposes packaged Dispatch actions, so in development you can run the same workflow from `apps/dispatch`:

```bash
pnpm action get-dream-settings
pnpm action set-dream-settings --enabled true --schedule "0 9 * * 1" --allSources true --limit 8
pnpm action create-dream-report --allSources true --sourceTimeoutMs 30000 --limit 8
```

## Scaffolding {#scaffolding}

```bash
npx @agent-native/core@latest create my-platform
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

## Customizing it {#customize}

Dispatch is a full template like any other — see [Templates](/docs/cloneable-saas). Ask the agent to "add a new integration for Datadog" or "route Slack DMs from channel X to the analytics agent" and it'll edit the routing config, add the webhook handler, and wire it up.

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
