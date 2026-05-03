---
title: "A2A Protocol"
description: "Agent-to-agent communication via JSON-RPC: discovery, messaging, streaming, and task management."
---

# A2A Protocol

Agent-to-agent communication over HTTP. Agents discover each other, send messages, and receive structured results.

## Overview {#overview}

A2A (agent-to-agent) is a JSON-RPC protocol for inter-agent communication. A mail agent can ask an analytics agent to run a query. A calendar agent can search issues in a project management agent. Each agent exposes its capabilities via an agent card and accepts work via a standard JSON-RPC endpoint.

A2A is the substrate for cross-app delegation in this framework — most prominently for [Dispatch](/docs/dispatch), which routes a single inbound message (Slack, email, etc.) to whichever app in the workspace is best suited to handle it.

Key concepts:

- **Agent card** — public metadata at `/.well-known/agent-card.json` describing skills and capabilities
- **JSON-RPC** — all communication goes through `POST /a2a` with standard JSON-RPC 2.0
- **Tasks** — each message creates a task with a lifecycle (submitted, working, completed, failed, canceled)
- **Bearer auth** — optional API key authentication via environment variable

## Server setup {#server-setup}

Call `mountA2A()` in a server plugin to expose the A2A endpoints:

```ts
// server/plugins/a2a.ts
import { mountA2A } from "@agent-native/core/a2a";

export default defineNitroPlugin((nitro) => {
  mountA2A(nitro.h3App, {
    name: "Analytics Agent",
    description: "Runs analytics queries and returns chart data",
    skills: [
      {
        id: "run-query",
        name: "Run Query",
        description: "Execute a SQL query against the analytics database",
        tags: ["analytics", "sql"],
        examples: ["Show me signups by source this month"],
      },
    ],
    apiKeyEnv: "A2A_API_KEY", // env var name for bearer token
    streaming: true, // enable message/stream
  });
});
```

This mounts two endpoints: `GET /.well-known/agent-card.json` (public, no auth) and `POST /a2a` (authenticated JSON-RPC).

## Agent card {#agent-card}

The agent card is auto-generated from your config and served at `/.well-known/agent-card.json`. Other agents fetch it to discover your agent's skills.

### Per-tenant skill filtering {#agent-card-filtering}

The card endpoint is public, so the framework redacts skills whose IDs reveal per-user or per-org integrations before serving it. Any skill whose id starts with `mcp__user_<emailhash>_…` or `mcp__org_<orgid>_…` is dropped from the published card. Operator-controlled stdio MCP tools (loaded from `mcp.config.json`) and template-defined skills stay visible. This prevents an unauthenticated caller from fingerprinting which tenants exist or which integrations they have connected. See `packages/core/src/a2a/server.ts`.

```json
{
  "name": "Analytics Agent",
  "description": "Runs analytics queries and returns chart data",
  "url": "https://analytics.example.com",
  "version": "1.0.0",
  "protocolVersion": "0.3",
  "capabilities": {
    "streaming": true,
    "pushNotifications": false,
    "stateTransitionHistory": true
  },
  "skills": [
    {
      "id": "run-query",
      "name": "Run Query",
      "description": "Execute a SQL query against the analytics database",
      "tags": ["analytics", "sql"],
      "examples": ["Show me signups by source this month"]
    }
  ],
  "securitySchemes": {
    "apiKey": { "type": "http", "scheme": "bearer" }
  },
  "security": [{ "apiKey": [] }]
}
```

## JSON-RPC methods {#json-rpc-methods}

All methods are called via `POST /a2a` with JSON-RPC 2.0 format:

| Method           | Description                                                                                                           | Key params                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `message/send`   | Send a message and wait for the completed task. Pass `async: true` to return immediately in `working` state and poll. | `message, contextId?, async?` |
| `message/stream` | Send a message, receive SSE task updates                                                                              | `message, contextId?`         |
| `tasks/get`      | Fetch a task by ID — used to poll an async task to completion                                                         | `id`                          |
| `tasks/cancel`   | Cancel a running task                                                                                                 | `id`                          |

When `message/send` is called with `async: true`, the JSON-RPC handler enqueues the task and self-fires a POST to an internal `/_agent-native/a2a/_process-task` route so the handler runs in a fresh function execution with its own full timeout. This route is authenticated with an HMAC token bound to the task ID (5-minute lifetime, signed with `A2A_SECRET`). It is mounted before the `/_agent-native/a2a` JSON-RPC route so h3's prefix matching does not swallow it.

Messages contain typed parts:

```json
{
  "role": "user",
  "parts": [
    { "type": "text", "text": "Show signups by source" },
    { "type": "data", "data": { "dateRange": "last-30d" } },
    {
      "type": "file",
      "file": { "name": "report.csv", "mimeType": "text/csv", "bytes": "..." }
    }
  ]
}
```

## Client {#client}

The `A2AClient` class handles discovery, messaging, and streaming:

```ts
import { A2AClient } from "@agent-native/core/a2a";

const client = new A2AClient("https://analytics.example.com", "my-api-key");

// Discover agent capabilities
const card = await client.getAgentCard();
console.log(card.skills);

// Send a message and get a completed task
const task = await client.send({
  role: "user",
  parts: [{ type: "text", text: "Show signups by source this month" }],
});
console.log(task.status.state); // "completed"
console.log(task.status.message); // agent's response

// Stream responses for long-running work
for await (const update of client.stream({
  role: "user",
  parts: [{ type: "text", text: "Generate a full quarterly report" }],
})) {
  console.log(update.status.state, update.status.message);
}
```

## Convenience helper {#convenience-helper}

For simple text-in/text-out calls, use `callAgent()`:

```ts
import { callAgent } from "@agent-native/core/a2a";

// One-shot: send text, get text back
const response = await callAgent(
  "https://analytics.example.com",
  "How many signups last week?",
  { apiKey: process.env.ANALYTICS_API_KEY },
);
console.log(response); // "There were 1,247 signups last week..."
```

## Task lifecycle {#task-lifecycle}

Each message creates a task that moves through these states:

`submitted` → `working` → `completed` | `failed` | `canceled`

| State            | Meaning                                        |
| ---------------- | ---------------------------------------------- |
| `submitted`      | Task created, queued for processing            |
| `working`        | Handler is processing the message              |
| `completed`      | Handler finished successfully                  |
| `failed`         | Handler threw an error                         |
| `canceled`       | Task was canceled via tasks/cancel             |
| `input-required` | Handler needs more information from the caller |

Tasks persist in the `a2a_tasks` SQL table and can be retrieved later via `tasks/get`.

## Security {#security}

Set `apiKeyEnv` in your config to the name of an environment variable containing the expected bearer token:

```ts
// Config
mountA2A(app, {
  // ...
  apiKeyEnv: "A2A_API_KEY", // reads process.env.A2A_API_KEY
});

// Client calls with the matching key
const client = new A2AClient(url, process.env.A2A_API_KEY);
```

The agent card endpoint is always public (no auth) so other agents can discover capabilities. The `/a2a` JSON-RPC endpoint requires a valid bearer token when `apiKeyEnv` is set. In dev mode (no env var configured), auth is skipped.

### Auth policy boundary {#auth-policy}

Bearer validation runs at the request boundary — in the JSON-RPC handler — before the agent loop ever sees the message. The shared helpers in `packages/core/src/a2a/auth-policy.ts` decide what the deployment requires:

- `isA2AProductionRuntime()` returns `true` on Netlify, AWS Lambda, Cloudflare Pages/Workers, Vercel, Render, Fly, and Cloud Run — even when `NODE_ENV` isn't `"production"`. Some serverless providers don't set `NODE_ENV` consistently, so the policy reads provider-specific flags too.
- `hasConfiguredA2ASecret()` returns `true` when `A2A_SECRET` is set.
- `shouldAdvertiseJwtA2AAuth()` is what the agent card uses to decide whether to publish a `jwtBearer` security scheme.

The production policy is strict: in any production runtime, the async `_process-task` route refuses to dispatch unless `A2A_SECRET` is configured (returns 503), and the JSON-RPC endpoint refuses unauthenticated calls. The dev fallback (warn once, allow) only fires when no production flag is set.

This boundary matters because the agent loop accepts free-form input from a remote caller. Putting the bearer check inside the loop, or relying on a tool to enforce it, would let prompt-injection or a buggy handler bypass auth. Keeping it at the HTTP boundary means a token failure short-circuits before any LLM call.

JWT verification (`verifyA2AToken` in `server.ts`) accepts tokens signed with either the global `A2A_SECRET` or an org-scoped secret looked up from SQL via the token's `org_domain` claim, and enforces the token's own `aud`/`iss` claims when present.

## Continuations {#continuations}

When an agent calls a remote A2A peer that doesn't return immediately, the framework polls `tasks/get` until the task settles. This is wired through `A2AClient.sendAndWait`, which is the default mode used by the `callAgent()` helper.

```ts
// Default: async + poll (safe on serverless hosts)
const reply = await callAgent(url, "Generate the quarterly report", {
  userEmail: session.user.email,
});

// Single-shot blocking POST (avoid on Netlify/Vercel for slow handlers)
const reply2 = await callAgent(url, "Quick lookup", { async: false });
```

For inbound continuations triggered by a messaging integration (Slack, email), the framework persists the continuation in SQL and processes it out-of-band:

- A row is written to the `a2a_continuations` table when the integration handler hands off to a remote agent.
- A self-fired `POST /_agent-native/integrations/process-a2a-continuation` claims the row, calls `tasks/get` on the remote agent, and either delivers the reply to the integration adapter or reschedules.
- If the remote task is still working, the row is rescheduled and re-dispatched. The poll budget is **bounded by ~10 minutes of remote work** (`MAX_REMOTE_WORK_MS`) and **6 dispatch attempts** (`MAX_ATTEMPTS`); after either limit, the continuation is failed with a clear error and the user gets a "the agent didn't respond in time" reply.
- A recurring sweeper (`claimDueA2AContinuations`) re-claims any continuation rows that were left in flight when the previous function execution died. Even if the calling app crashes mid-poll, the next sweep tick resumes the work.

Defined in `packages/core/src/integrations/a2a-continuation-processor.ts`. The same retry job pattern is used for integration webhook tasks (`pending-tasks-retry-job.ts`, capped at 3 attempts).

## Workspace A2A {#workspace-a2a}

In a multi-app workspace deployed to a single Netlify site (see [multi-app workspace](/docs/multi-app-workspace)), every app under `apps/<id>/` is auto-registered as an A2A peer:

- A shared `A2A_SECRET` is mounted into every app's environment at build time.
- Cross-app calls are same-origin — `https://workspace.example.com/apps/analytics` calls `https://workspace.example.com/apps/mail` — so there is no DNS, CORS, or per-pair JWT setup.
- Outbound calls signed with the shared secret carry the caller's email as `sub` and (when present) the org domain. The receiver's JWT verifier accepts either the shared secret or the org-scoped secret from SQL, in that order.
- Agent discovery walks the workspace registry rather than relying on the operator to wire each peer by hand. See `discoverAgents` in `packages/core/src/server/agent-discovery.ts` and the org refresh path in `packages/core/src/org/handlers.ts`.

External A2A — calls to agents outside your workspace — still uses the bearer-token model (`apiKeyEnv` + `A2AClient(url, apiKey)`). Workspace A2A is layered on top; nothing about external peers changes.

## Serverless gotchas {#serverless}

**Never rely on a fire-and-forget `Promise` outliving the response.** Serverless functions (Netlify, Vercel, AWS Lambda, Cloud Run) freeze the moment the response body is flushed — sometimes before the TCP handshake of an unawaited `fetch(...)` even completes. Patterns that work locally on Node will silently drop work in production.

The framework's pattern, used by both A2A async dispatch and the [integration webhook queue](/docs/messaging), is:

1. Accept the request, persist what needs to happen to SQL, return 200 immediately.
2. Self-fire a `POST` to a separate framework route (`/_agent-native/a2a/_process-task` or `/_agent-native/integrations/process-task`) so the actual work runs in a **fresh function execution** with its own full timeout.
3. Authenticate the self-fire with an HMAC token bound to the row id, signed with `A2A_SECRET`.
4. A recurring retry job sweeps any rows that were claimed but not finished, so a crashed function doesn't strand the work.

When you write your own A2A handler or integration adapter, follow the same shape. Don't attach work to a detached promise after `return`. The `integration-webhooks` skill is the canonical reference.

## Agent mentions {#agent-mentions}

You can `@`-mention agents directly in the chat composer. Connected agents use A2A: when you mention a connected agent, the server makes an A2A call to that agent and weaves the response into your conversation context.

Custom workspace agents are different: they run locally inside the current app/runtime rather than over A2A.

See [Agent Mentions](/docs/agent-mentions) for details on how mentions work, how to add agents, and how to create custom mention providers.

## Messaging integrations {#messaging-integrations}

Agents can also be reached from external messaging platforms like Slack, email, Telegram, and WhatsApp. Users send messages on those platforms and the agent responds in the same thread, using the same tools and actions as the web chat.

See [Messaging](/docs/messaging) for setup details on each platform.

## Example: cross-agent query {#example}

A mail agent needs analytics data. The analytics agent exposes a "run-query" skill via A2A:

```ts
// In the mail agent's actions/get-analytics.ts
import { callAgent } from "@agent-native/core/a2a";

export default async function (args: string[]) {
  const response = await callAgent(
    "https://analytics.example.com",
    "How many emails were sent last week by category?",
    { apiKey: process.env.ANALYTICS_API_KEY },
  );

  console.log(response);
  // The mail agent can now use this data in its response
}
```

The analytics agent receives the message, runs the query via its handler, and returns the result. The mail agent's script gets the text response back. No shared database, no direct API calls — just agent-to-agent communication.
