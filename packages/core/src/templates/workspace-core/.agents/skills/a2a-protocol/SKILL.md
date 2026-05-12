---
name: a2a-protocol
description: >-
  How agents call other agents via the A2A (agent-to-agent) JSON-RPC protocol.
  Use when enabling inter-agent communication, exposing agent skills to other
  agents, or calling external agents from scripts.
---

# A2A Protocol (Agent-to-Agent)

## Rule

Agents can call other agents using the A2A protocol. This is a JSON-RPC-based protocol for agent discovery and communication. Use it when work should go to a different agent entirely — not the local agent chat.

## Why

Agent-native apps don't exist in isolation. A mail agent might need analytics data. A calendar agent might need to search issues. A2A lets agents discover each other, send messages, and receive structured results — all over HTTP with bearer token auth.

## How to Enable A2A (Server Side)

Add `mountA2A()` to a server plugin:

```ts
// server/plugins/a2a.ts
import { mountA2A } from "@agent-native/core/a2a";

export default defineNitroPlugin((nitro) => {
  const app = nitro.h3App;

  mountA2A(app, {
    name: "Analytics Agent",
    description: "Queries analytics data across providers",
    version: "1.0.0",
    skills: [
      {
        id: "query-data",
        name: "Query Data",
        description: "Run analytics queries across connected data sources",
        tags: ["analytics", "data"],
        examples: ["What were last week's signups?", "Show conversion rates"],
      },
    ],
    apiKeyEnv: "A2A_API_KEY", // env var holding the bearer token
    streaming: true,          // enable message/stream method
  });
});
```

This mounts the agent-native A2A endpoints:

- `GET /.well-known/agent-card.json` — public agent discovery (no auth required)
- `POST /_agent-native/a2a` — primary JSON-RPC endpoint (bearer token auth required)

The client may fall back to `POST /a2a` for external or legacy peers that only
expose that simple path. New agent-native apps should document and call the
`/_agent-native/a2a` endpoint.

## The Config Object

```ts
interface A2AConfig {
  name: string;           // agent display name
  description: string;    // what this agent does
  version?: string;       // semver version (default: "1.0.0")
  skills: AgentSkill[];   // capabilities this agent exposes
  handler?: A2AHandler;   // custom message handler
  apiKeyEnv?: string;     // env var name for bearer token auth
  streaming?: boolean;    // enable streaming responses
}

interface AgentSkill {
  id: string;             // unique skill identifier
  name: string;           // human-readable name
  description: string;    // what this skill does
  tags?: string[];        // categorization tags
  examples?: string[];    // example prompts
}
```

## Agent Card

The agent card is auto-generated at `GET /.well-known/agent-card.json`. Other agents fetch this to discover what skills are available:

```json
{
  "name": "Analytics Agent",
  "description": "Queries analytics data across providers",
  "url": "https://analytics.example.com",
  "version": "1.0.0",
  "protocolVersion": "0.3",
  "capabilities": { "streaming": true },
  "skills": [
    {
      "id": "query-data",
      "name": "Query Data",
      "description": "Run analytics queries across connected data sources"
    }
  ]
}
```

## Calling Another Agent

### Simple: `callAgent()` (text in, text out)

```ts
import { callAgent } from "@agent-native/core/a2a";

const answer = await callAgent(
  "https://analytics.example.com",
  "What were last week's signups?",
  { apiKey: process.env.ANALYTICS_A2A_KEY },
);
// answer is a plain string
```

### Advanced: `A2AClient` (full control)

```ts
import { A2AClient } from "@agent-native/core/a2a";

const client = new A2AClient(
  "https://analytics.example.com",
  process.env.ANALYTICS_A2A_KEY,
);

// Discover agent capabilities
const card = await client.getAgentCard();

// Send a message and get a task back
const task = await client.send({
  role: "user",
  parts: [{ type: "text", text: "What were last week's signups?" }],
});
// task.status.state === "completed"
// task.status.message.parts[0].text === "Last week: 1,247 signups..."

// Stream responses
for await (const update of client.stream({
  role: "user",
  parts: [{ type: "text", text: "Detailed breakdown by day" }],
})) {
  console.log(update.status.state, update.status.message);
}
```

## JSON-RPC Methods

| Method           | Purpose                          | Auth required |
| ---------------- | -------------------------------- | ------------- |
| `message/send`   | Send a message, get a task back  | Yes           |
| `message/stream` | Send a message, stream responses | Yes           |
| `tasks/get`      | Get task status by ID            | Yes           |
| `tasks/cancel`   | Cancel a running task            | Yes           |

## Task Lifecycle

Tasks go through these states:

```
submitted → working → completed
                    → failed
                    → canceled
                    → input-required
```

- **submitted** — message received, not yet processing
- **working** — agent is processing the request
- **completed** — agent finished, result in `status.message`
- **failed** — agent encountered an error
- **canceled** — task was canceled via `tasks/cancel`
- **input-required** — agent needs more information from the caller

## Security

A2A uses bearer token auth. The server reads the token from the environment variable specified by `apiKeyEnv`:

- Set `A2A_API_KEY=my-secret-token` in the server's environment
- Callers pass it as `Authorization: Bearer my-secret-token`
- The agent card endpoint (`/.well-known/agent-card.json`) is public — no auth needed for discovery

## Message Parts

Messages contain typed parts:

| Part type | Fields                              | Use for                    |
| --------- | ----------------------------------- | -------------------------- |
| `text`    | `{ type: "text", text: "..." }`     | Natural language messages  |
| `file`    | `{ type: "file", file: { ... } }`   | Files (bytes or URI)       |
| `data`    | `{ type: "data", data: { ... } }`   | Structured JSON data       |

## Example: Cross-Agent Workflow

A mail agent calls an analytics agent to include data in an email draft:

```ts
// actions/draft-with-analytics.ts
import { callAgent } from "@agent-native/core/a2a";
import { writeAppState } from "@agent-native/core/application-state";

export default async function (args: string[]) {
  // Ask the analytics agent for data
  const stats = await callAgent(
    process.env.ANALYTICS_AGENT_URL!,
    "Summarize last week's key metrics in 3 bullet points",
    { apiKey: process.env.ANALYTICS_A2A_KEY },
  );

  // Create a draft with the analytics data
  await writeAppState("compose-analytics-report", {
    id: "analytics-report",
    to: "team@example.com",
    subject: "Weekly Analytics Summary",
    body: `Hi team,\n\nHere are last week's numbers:\n\n${stats}\n\nBest`,
    mode: "compose",
  });
}
```

## All Types

All types are exported from `@agent-native/core/a2a`:

```ts
import type {
  A2AConfig,
  A2AHandler,
  A2AHandlerContext,
  A2AHandlerResult,
  AgentCard,
  AgentSkill,
  AgentCapabilities,
  Task,
  TaskState,
  TaskStatus,
  Message,
  Part,
  TextPart,
  FilePart,
  DataPart,
  Artifact,
  JsonRpcRequest,
  JsonRpcResponse,
} from "@agent-native/core/a2a";
```

## Related Skills

- **delegate-to-agent** — For work the local agent handles. Use A2A when the work goes to a different agent.
- **scripts** — A2A calls typically happen in scripts
- **storing-data** — Results from A2A calls are stored in SQL like any other data
