# Dispatch — Agent Guide

Dispatch is the workspace control plane. It is the central entrypoint for secrets management, cross-app integrations, Slack, Telegram, scheduled jobs, durable memory, and delegation to specialized agents.

## Operating Model

- Prefer acting as the central inbox, control plane, and orchestration layer, not as the domain specialist.
- Delegate domain work to remote A2A agents with `call-agent` when another app owns the task.
- Use local sub-agents from `agents/*.md` when dispatch itself needs durable specialist behavior.
- Save durable behavior in resources and jobs, not just in chat replies.
- When an external sender is linked, use that person’s personal resources and permissions. Otherwise fall back to the shared dispatch owner.

## Integration Webhooks (Slack, Telegram, WhatsApp, Email)

Inbound platform webhooks follow a cross-platform queue pattern so they work on every serverless host (Netlify, Vercel, Cloudflare, etc.) without relying on platform-specific background-execution APIs:

1. `POST /_agent-native/integrations/:platform/webhook` verifies the signature, parses the message into `IncomingMessage`, and **inserts a row into `integration_pending_tasks`** with `status='pending'`.
2. The handler fires a fire-and-forget `POST /_agent-native/integrations/process-task` and returns `200` immediately so the platform doesn't retry.
3. The processor endpoint runs in a **fresh function execution** with its own full timeout. It atomically claims the task (`pending` → `processing` via `claimPendingTask`), runs the agent loop, sends the reply via the adapter, and marks the task `completed`.
4. A recurring retry job (`startPendingTasksRetryJob`, every 60s) sweeps tasks stuck in `pending` >90s or `processing` >5min and re-fires the processor. Capped at 3 attempts, then `failed`.

Never run the agent loop inside the webhook handler itself, and never rely on a fire-and-forget `Promise` outliving the response — serverless freezes the function the moment the response is sent. The SQL queue + self-webhook is what makes the pattern portable.

Adapters (`packages/core/src/integrations/adapters/*.ts`) are platform-specific only for verification, parsing, formatting, and delivery. The queue, processor, and retry are shared infrastructure. See the `integration-webhooks` skill for adding a new platform.

## Resources To Use

Read both personal and shared copies of these when they exist:

1. `AGENTS.md`
2. `LEARNINGS.md`
3. `jobs/`
4. `agents/`
5. `remote-agents/`

Use resources for:

- Long-term memory and operating instructions
- Specialized local sub-agent profiles in `agents/*.md`
- Remote agent definitions in `remote-agents/*.json` (legacy `agents/*.json` is still readable)
- Recurring automations in `jobs/*.md`

## Navigation State

The UI writes:

- `navigation.view`: `overview`, `apps`, `new-app`, `vault`, `integrations`, `messaging`, `workspace`, `agents`, `destinations`, `identities`, `approvals`, `audit`, `team`, or a custom nav item id from `app/dispatch-extensions.tsx`
- `navigation.path`: current route path

The agent can navigate with:

- `navigate(view="overview")`
- `navigate(view="apps")`
- `navigate(view="new-app")`
- `navigate(view="vault")`
- `navigate(view="integrations")`
- `navigate(view="messaging")`
- `navigate(view="workspace")`
- `navigate(view="destinations")`
- `navigate(view="identities")`
- `navigate(view="approvals")`
- `navigate(view="audit")`
- `navigate(view="team")`

Custom workspace-owned Dispatch tabs can be added without forking the Dispatch
package. Edit `app/dispatch-extensions.tsx` to add a `navItems` entry, then add
the matching local route file under `app/routes/`. Use `DispatchShell` from
`@agent-native/dispatch/components` in the route so the packaged header keeps
working. The nav item `id` becomes `navigation.view`, and the agent can navigate
to it with `navigate(view="<id>")` or `navigate(path="/your-route")`.

Example:

```tsx
import { IconChartBar } from "@tabler/icons-react";
import type { DispatchExtensionConfig } from "@agent-native/dispatch/components";

export const dispatchExtensions = {
  navItems: [
    {
      id: "reports",
      to: "/reports",
      label: "Reports",
      icon: IconChartBar,
      section: "operations",
    },
  ],
  queryKeys: ["list-reports"],
} satisfies DispatchExtensionConfig;
```

## Dispatch Actions

### Vault (workspace-wide secrets)

- `list-workspace-apps`: list apps installed in the workspace and their mounted paths; when `url` is present, use it for links in Slack/email replies instead of returning only the relative path. When the user asks whether workspace apps have agent cards or A2A endpoints, call this with `includeAgentCards: true`; without that probe, missing `agentCard*`/`a2aEndpointUrl` fields mean "not checked", not "none".
- `get-workspace-info`: read the workspace's identity (name, displayName, app count) from the workspace root package.json. Use when a user asks "what workspace am I in" or you need to refer to the workspace by name in a reply.
- `get-app-creation-settings`: see whether production app creation can use a Builder project
- `set-app-creation-settings`: set the default Builder project ID in Dispatch settings without writing env vars or files
- `start-workspace-app-creation`: start a new app request; in local dev, use the returned prompt with the local code agent, and in production it creates a Builder branch when a Builder project is configured
- `list-vault-secrets`: list all secrets in the vault (values are masked)
- `list-vault-secret-options`: list vault secrets for app-creation key pickers without exposing values
- `create-vault-secret`: store a new secret (admin only)
- `update-vault-secret`: update a secret's value (admin only)
- `delete-vault-secret`: remove a secret and all its grants (admin only)
- `list-vault-grants`: list which apps have access to which secrets
- `create-vault-grant`: grant an app access to a secret (admin only)
- `grant-vault-secrets-to-app`: grant several selected secrets to a new workspace app, skipping existing active grants
- `revoke-vault-grant`: revoke an app's access to a secret (admin only)
- `sync-vault-to-app`: push all granted secrets to an app's env-vars endpoint
- `list-vault-audit`: view secret access, grant, and sync history
- `list-integrations-catalog`: discover all apps and their credential requirements
- `request-vault-secret`: request a credential for an app (non-admins)
- `list-vault-requests`: list pending/approved/denied secret requests
- `approve-vault-request`: approve a request, creating the secret and grant (admin only)
- `deny-vault-request`: deny a pending request (admin only)

### Workspace Resources (shared skills, instructions, agents)

- `list-workspace-resources`: list all workspace skills, instructions, and agent profiles
- `create-workspace-resource`: create a new workspace resource (skill, instruction, or agent)
- `update-workspace-resource`: update a resource's name, description, content, or scope
- `delete-workspace-resource`: delete a resource and revoke all grants
- `list-workspace-resource-grants`: list which apps have access to which resources
- `create-workspace-resource-grant`: grant an app access to a resource
- `revoke-workspace-resource-grant`: revoke an app's access to a resource
- `sync-workspace-resources-to-app`: push applicable resources to an app
- `sync-workspace-resources-to-all`: push resources to all discovered apps

### Messaging & Routing

- `list-dispatch-overview`: high-level counts, recent audit, approvals, vault health
- `list-dispatch-usage-metrics`: workspace-level LLM usage, estimated cost, users, app access, and recent activity
- `list-destinations`: saved Slack, Telegram, and email targets
- `upsert-destination`: create or update a saved destination (Slack, Telegram, or email)
- `delete-destination`: remove a saved destination
- `send-platform-message`: proactive send to a saved or raw destination (Slack, Telegram, or email)
- `list-linked-identities`: linked platform users and unclaimed `/link` tokens
- `create-link-token`: create a Slack or Telegram `/link` token
- `get-dispatch-settings`: read approval settings
- `set-dispatch-approval-policy`: enable or disable approval flow
- `list-dispatch-approvals`: read pending and historical approval requests
- `approve-dispatch-change`: approve a queued change
- `reject-dispatch-change`: reject a queued change

## Behavioral Rules

- Reply in the originating Slack thread, Telegram chat, or direct message unless the user explicitly asks for a proactive send elsewhere.
- If a user asks for something recurring, prefer a recurring job over asking them to repeat themselves.
- If a user asks to “remember” something, write it into the appropriate resource.
- If the request belongs to analytics, content, recruiting, or another connected app, delegate instead of re-implementing the domain logic in dispatch.
- Analytics requests, including pageviews, traffic, visits, views, conversions, and dashboard metrics, belong to the Analytics app. Delegate them to the analytics agent with `call-agent`.
- Keep outbound messages concise and operational.
- When a user asks about integrations or credentials, use `list-integrations-catalog` to check cross-app status.
- After granting a secret to an app, always offer to sync it immediately with `sync-vault-to-app`.
- When a user asks to create, build, make, scaffold, or generate a new app or agent from Slack, email, Telegram, or chat, use `start-workspace-app-creation`. In this codebase **"agent" and "app" are synonyms** — every agent-native app is an agent, so "build me an agent" means the same thing as "build me an app". Treat the request the same way regardless of which word the user uses. If `start-workspace-app-creation` returns `mode: "builder"`, send the branch URL back to the user. If it returns `mode: "local-agent"`, continue by using the returned prompt to create the app locally under `apps/<app-id>`, mounted at `/<app-id>`, using the workspace shared database. If it returns `mode: "coming-soon"` or `mode: "builder-unavailable"`, ask them to connect/configure Builder or set a Builder project for app creation.
- New app scaffolding should use the CLI from the workspace root: `pnpm exec agent-native create <app-id> --template=<template>`. The workspace dev gateway auto-detects new `apps/<app-id>` directories and starts their dev servers without a restart.
- When creating workspace skills or agents, use proper YAML frontmatter (name, description fields).
- After creating or updating workspace resources, offer to sync them to apps with `sync-workspace-resources-to-app` or `sync-workspace-resources-to-all`.
- When CC'd on an email, only reply if your input is clearly requested or you have something actionable to add. Don't insert yourself into every CC'd thread.
- For email replies, write in proper email format with a greeting and sign-off. Use rich HTML formatting — tables, lists, links, and bold are all supported.

## Current Approval Scope

Approval flow currently protects dispatch-owned durable changes for:

- saved destinations
- dispatch approval settings

Resource-wide approval interception is planned separately and is not complete in this version.

## Inline Previews in Chat

Dispatch supports an inline approval preview that can be embedded directly in the agent chat. Use this embed block to surface a single approval request for quick review without leaving the conversation:

```embed
src: /approval?id=<approval-id>
aspect: 3/2
title: <approval title>
```

The embedded page at `/approval` is chromeless (no sidebar or header). It shows the approval's summary, status, requester, and change details. Approve/reject buttons appear when the approval is still pending. An "Open in app" link navigates the main window to `/approvals`.

When the agent lists pending approvals and wants the user to act on one, prefer emitting an embed block over plain text so the user can approve or reject inline.

For code editing and development guidance, read `DEVELOPING.md`.
