---
title: "A2A Protocol"
description: "Agent-to-agent communication via JSON-RPC: discovery, messaging, streaming, and task management."
---

# A2A Protocol

Agent-to-agent communication over HTTP. Agents discover each other, send messages, and receive structured results.

## Overview {#overview}

A2A (agent-to-agent) is a JSON-RPC protocol for inter-agent communication. A mail agent can ask an analytics agent to run a query. A calendar agent can search issues in a project management agent. Each agent exposes its capabilities via an agent card and accepts work via a standard JSON-RPC endpoint.

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

| Method           | Description                               | Key params            |
| ---------------- | ----------------------------------------- | --------------------- |
| `message/send`   | Send a message, get a completed task back | `message, contextId?` |
| `message/stream` | Send a message, receive SSE task updates  | `message, contextId?` |
| `tasks/get`      | Fetch a task by ID                        | `id`                  |
| `tasks/cancel`   | Cancel a running task                     | `id`                  |

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

## Agent mentions {#agent-mentions}

You can `@`-mention agents directly in the chat composer. Connected agents use A2A: when you mention a connected agent, the server makes an A2A call to that agent and weaves the response into your conversation context.

Custom workspace agents are different: they run locally inside the current app/runtime rather than over A2A.

See [Agent Mentions](/docs/agent-mentions) for details on how mentions work, how to add agents, and how to create custom mention providers.

## Messaging integrations {#messaging-integrations}

Agents can also be reached from external messaging platforms like Slack, Telegram, and WhatsApp. Users send messages on those platforms and the agent responds in the same thread, using the same tools and actions as the web chat.

See [Integrations](/docs/integrations) for setup details on each platform.

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
