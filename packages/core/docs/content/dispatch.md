---
title: "Dispatch"
description: "The workspace control plane: secrets vault, integration hub, cross-app delegate, and central inbox for Slack, email, Telegram, WhatsApp."
---

# Dispatch

Dispatch is the central app that sits in front of every other app in your workspace and handles secrets, integrations, messaging, and cross-app delegation. It is the **workspace control plane** — the single agent your team talks to, the single place credentials live, and the single router that decides which specialist app should handle a given request.

Without Dispatch, every app in a multi-app workspace ends up re-implementing the same plumbing: its own Slack bot, its own secret store, its own scheduled jobs, its own copy of the workspace's instructions. Rotating one API key turns into ten redeployments. Adding a new policy turns into ten copy-pastes. Dispatch centralizes all of that in one app so the others stay focused on their domain.

> Dispatch is shipped as a first-party template. This page covers the **concept** — what it is, why you'd want it, and how it fits into a workspace. For the scaffolded app itself (routes, screens, agent guide), see the [Dispatch template](/templates/dispatch).

## When you want Dispatch {#when}

Reach for Dispatch when any of these are true:

- You're running a [multi-app workspace](/docs/multi-app-workspace) — mail, calendar, analytics, content, recruiting — and you don't want one Slack bot per app.
- You want **one inbox for "the agent"** so users DM a single bot and the right specialist app picks up the work behind the scenes.
- You have **workspace-wide secrets** (Stripe key, OpenAI key, third-party API tokens) that several apps need but you'd rather grant per-app than copy into every `.env`.
- You want a **runtime approval flow** in front of sensitive changes (saved destinations, policy edits) so non-admins can request and admins can sign off without a code deploy.
- You want **shared skills, instructions, and agent profiles** that every app in the workspace inherits — change once, reach all.

If you're running a single template standalone, you don't need Dispatch — each template can wire its own messaging integrations directly. See [Messaging](/docs/messaging) for the standalone setup.

## What Dispatch does {#what-it-does}

Five capabilities, all sitting on top of the same workspace database the other apps use.

### Central inbox

Slack, email, Telegram, and WhatsApp all flow into Dispatch's agent loop. Connect each platform once in **Settings → Messaging** and every channel reaches the same agent with the same memory and tools. A Slack DM and an email to `agent@yourcompany.com` end up as two surfaces on one conversation history, not two disconnected bots.

See [Messaging](/docs/messaging) for the credentials and webhook URLs for each platform.

### Secret vault

Store credentials once in Dispatch's vault and grant them to the apps that need them. Non-admins can **request** a secret for an app; admins **approve**, which creates the secret + grant in one step. Every read, grant, sync, and rotation is captured in an audit log. `sync-vault-to-app` pushes granted secrets into the target app's env so you don't have to redeploy or re-paste anything.

This is what makes "rotate the OpenAI key" a one-click operation across ten apps instead of ten PRs.

### Cross-app delegation

Dispatch auto-discovers the other apps in your workspace as A2A peers — no manual registration, no per-app config. When a user asks "summarize last week's signups" in Slack, Dispatch recognizes that as an analytics request and calls the analytics app over [A2A](/docs/a2a-protocol). When they ask "draft a reply to Alice", it routes to the mail app. Dispatch posts the final answer back in the originating thread.

The behavioral rule lives in the dispatch agent's instructions: domain work belongs to the domain app. Dispatch is the orchestrator, not the specialist.

### Workspace resources

Skills, agent profiles, and instructions can be authored once in Dispatch and granted out to the rest of the workspace. `sync-workspace-resources-to-all` pushes them to every app's `.agents/` directory so every agent in every app picks them up. This is how a team-wide change ("always use British English in customer-facing replies") propagates without editing ten repos.

### Approval flow

Dispatch can gate sensitive runtime changes behind admin review. Today this covers **saved destinations** (the Slack channels and email addresses the agent can proactively send to) and **dispatch approval policy** itself. When the policy is enabled, the change is queued and the agent surfaces an inline approval preview directly in chat — admins approve or reject without leaving the conversation. Resource-wide approval interception is planned but not yet shipped.

## How a Slack message flows through Dispatch {#flow}

Walk through one example end-to-end. A user DMs the bot: _"summarize last week's signups."_

1. **Slack → webhook.** Slack `POST`s to `/_agent-native/integrations/slack/webhook` on the Dispatch app. The handler verifies the signature and **inserts a row into `integration_pending_tasks`**, then fires a self-targeted `POST` to its own processor and returns `200` immediately so Slack doesn't retry.
2. **Fresh processor execution.** The processor endpoint runs in a brand-new function execution with its own full timeout. It atomically claims the task and starts the agent loop.
3. **Dispatch agent decides.** The agent reads the message, recognizes "signups" as an analytics intent, and invokes `call-agent` against the analytics app's [A2A endpoint](/docs/a2a-protocol). The actual SQL work runs over there.
4. **Reply posted in thread.** The analytics agent returns a result. Dispatch formats it and posts back into the same Slack thread the user wrote in, using the linked identity if there is one (so the agent acts with the requester's permissions, not the workspace owner's).
5. **Recovery if anything dies.** If the processor crashes mid-flight — A2A timeout, downstream agent error, function freeze — a retry job sweeps stuck tasks every 60 seconds and re-fires the processor. Up to three attempts before the task is marked `failed`. The user still gets a reply on the next sweep instead of the message disappearing into the void.

The same flow applies for email, Telegram, and WhatsApp — only the adapter changes.

## Reliability story {#reliability}

The whole pipeline is built to survive on every serverless host (Netlify, Vercel, Cloudflare Workers) without leaning on platform-specific background-execution APIs.

- **Webhook → SQL queue → fresh-execution processor.** The agent loop never runs inside the webhook handler. The handler's only job is to verify, enqueue, and return 200. A separate fresh execution drains the queue, so a slow agent run can never tie up the inbound webhook or cause the platform to retry.
- **A2A continuation polling.** When Dispatch delegates to another app, it polls the downstream task with a bounded timeout. If the downstream agent takes too long or crashes, Dispatch records the continuation and the retry job picks it up — the user's Slack reply still arrives.
- **Auto-signed cross-app A2A.** Hosted multi-app workspaces auto-generate per-app A2A credentials at deploy time, so apps in the same workspace can call each other without you ever pasting a JWT secret. Dispatch's agent-discovery layer reads those creds from the workspace database so newly added apps appear as callable peers automatically.

This is the recently-hardened story — see PRs #439, #441, and #443 for the underlying changes. Conceptually: every step that crosses a network or a process boundary is recoverable.

## Setup {#setup}

Three short steps:

1. **Scaffold a workspace that includes Dispatch.** Run `pnpm dlx @agent-native/core create my-company-platform` and pick `dispatch` alongside whatever domain templates you want. Dispatch lives at `apps/dispatch` and the rest of the apps sit beside it. See [Multi-App Workspace](/docs/multi-app-workspace).
2. **Connect messaging.** Open **Settings → Messaging** in Dispatch and click connect for Slack, Email, Telegram, or WhatsApp. The form fields match the env vars in the [Messaging](/docs/messaging) doc — refer there for what each platform needs.
3. **Add other apps.** Run `agent-native add-app` from the workspace root for each domain app. They auto-appear as A2A peers in Dispatch's `list-workspace-apps` — no manual registration, no agent-card editing. Dispatch will start delegating to them as soon as their agent cards are reachable.

Then add credentials to the vault, grant them to the apps that need them, and (optionally) author workspace skills under **Resources** and sync them out.

## See also {#see-also}

- [Dispatch template](/templates/dispatch) — the actual scaffolded app, with its full action catalog and agent guide
- [Messaging](/docs/messaging) — connecting Slack, email, Telegram, WhatsApp
- [A2A Protocol](/docs/a2a-protocol) — how cross-app delegation works under the hood
- [Multi-App Workspace](/docs/multi-app-workspace) — the deployment shape Dispatch is built for
- [Workspace Management](/docs/workspace-management) — git/GitHub governance that pairs with Dispatch's runtime governance
