---
name: a2a-protocol
description: >-
  How agent-native apps discover, authenticate with, and call each other over
  A2A. Use when connecting one app to another, debugging a remote agent that
  won't authenticate, exposing skills to peers, or calling agents from scripts.
scope: dev
metadata:
  internal: true
---

# A2A Protocol (Agent-to-Agent)

## Rule

Agents call other agents over A2A, a JSON-RPC protocol for discovery and
delegation. Use it when work belongs to a different agent entirely — not the
local agent chat.

**No workarounds when A2A feels flaky.** The strong default is `ask_app` (or
`call-agent`) working reliably, full stop — not apps reaching around it. Do
not have app A generate and execute raw SQL against app B's database, and do
not expose B's internal tools directly to A as a substitute for delegation.
The receiving agent has context, skills, and guardrails the caller doesn't;
bypassing it to work around a flaky A2A call reintroduces exactly the bugs A2A
exists to prevent, and makes the real reliability problem invisible instead of
fixing it. If A2A delegation is unreliable, fix A2A — file it as a bug in the
delegation path (timeout handling, retries, typed terminal states), don't
route around it app by app.

Connecting app A to app B is two independent things, and both must be true:

1. **B is registered on A** as a `remote-agents/<id>.json` resource.
2. **A and B share a secret**, so A's signed JWT verifies on B.

Neither is a code change, and neither is symmetric. Registering B on A does not
let B call A.

## A2A is already mounted

`createAgentChatPlugin` calls `mountA2A` for every app, so a generated app
already serves:

- `GET /.well-known/agent-card.json` — public discovery, with a larger
  authenticated capability view for verified sibling callers
- `POST /_agent-native/a2a` — JSON-RPC, authenticated

Do not add a `mountA2A` server plugin to enable A2A; it is on. Hand-mounting is
only for a bespoke card or a custom handler (see **Custom mount** below).

The client falls back to `POST /a2a` for external peers that only expose that
path. New agent-native apps should call `/_agent-native/a2a`.

## Registering a remote agent

A remote agent is **a row in the resources table, not a file on disk**. Path
`remote-agents/<id>.json`, owner `SHARED_OWNER`, content:

```json
{
  "id": "analytics",
  "name": "Analytics",
  "description": "Queries analytics data across providers",
  "url": "https://analytics.example.com",
  "color": "#6B7280"
}
```

`url` is the only required field. `parseRemoteAgentManifest` accepts **only**
these five keys — there is no `apiKey`, `env`, `skills`, or `token` field, and
anything else is silently dropped.

Four ways to create it, all writing the same row:

| Surface | Where |
| --- | --- |
| Settings → Manage agent → Connected Agents (A2A) | any app with the settings panel |
| Agent page → Connections | apps mounting `AgentTabsPage` |
| Dispatch → Agents → Add external agent | workspace dispatch |
| The agent itself | `resources` tool, `action: "write"`, `--scope shared` |

The last one matters for template apps with no Code tab: "connect me to
https://analytics.example.com" is a complete instruction. `remote-agents/` is
whitelisted as a durable control path, so the write is workspace-scoped, and it
takes effect on the next `discoverAgents()` call with no restart.

First-party templates are seeded automatically and overlaid on top of manifests,
so `Mail`, `Calendar`, and friends appear without registration. In dev they
resolve to `http://localhost:<devPort>`; a manifest pointing at localhost is
ignored in production.

`call-agent` also accepts a raw URL, which skips registration entirely — useful
for one-off calls, useless for @-mentions.

### Checking a peer

`GET /_agent-native/agents/probe?url=<base>` reads the peer's card and makes one
authenticated no-op call, returning `reachable` and `authorized` as independent
fields. Omit `url` to probe every registered peer. Reachable-but-unauthorized is
the failure worth looking for: local dev runs the receiver unauthenticated, so a
mismatched secret only surfaces after deploy. The Connected Agents settings
section calls this on add and on open.

## Authentication

A2A authenticates with a **short-lived JWT the caller signs**, not a stored
bearer key. `Authorization: Bearer <jwt>`; claims carry the caller's email and
org domain; HS256; 15-minute default TTL. There is no per-peer API key
anywhere in the system, which is why the manifest has no field for one.

Two secrets can sign it:

| Secret | Scope | How it is set |
| --- | --- | --- |
| `A2A_SECRET` | whole deployment | env var, **never auto-generated** |
| org `a2a_secret` | one organization | auto-generated on org creation; Team page UI |

The org secret is the managed path: **Team page → A2A secret** (owner only)
reveals, copies, regenerates, and pushes it to every discovered peer. Rotation
is tolerated — the caller tries both secrets in order and sticks to whichever
worked.

`A2A_SECRET` is the deploy-level path. `workspace-deploy` refuses a production
workspace deploy without it and prints the generator command. Peers that must
trust each other need the *same* value on both sides.

With no secret configured at all:

| Runtime | Result |
| --- | --- |
| local dev | open, one-time console warning |
| production | `503` — "A2A authentication not configured" |
| production, secret set, bad/absent token | `401` |

"Production" is detected broadly (NODE_ENV, Netlify, Lambda, Vercel, Render,
Fly, Cloud Run, …) and unrecognized deployed hosts fail closed unless the
request is genuine loopback or `A2A_ALLOW_UNSIGNED_INTERNAL=1`.

`A2AConfig.apiKeyEnv` still exists for static bearer auth against non-agent-native
peers, but the framework's own mount never sets it. Do not reach for it when
debugging a connection between two agent-native apps — the answer there is
always the shared secret.

Never hardcode either secret in source, docs, prompts, app state, action
descriptions, client bundles, or examples. Read them from runtime config; never
log or return them.

## Advertising what this agent can do

Card `skills` are derived from actions marked `publicAgent`; do not maintain a
second capability registry. Anonymous callers see only explicitly public-safe
reads. Verified sibling callers see two concise kinds of capability:

- Authenticated read-only actions selected by connector policy include their
  input schemas and may be invoked directly.
- Authenticated writes marked `publicAgent: { expose: true, readOnly: false,
  requiresAuth: true }` are advertised without schemas as message-only
  capabilities. A sibling delegates an objective; the receiving agent chooses
  and validates its own local actions.

`agentTool: false` and `externalAgents.denyActions` remove an action from both
authenticated paths. An app that marks no actions still publishes
`"skills": []`, and natural-language delegation still works because the
receiver loads its own instructions, skills, data dictionary, credentials, and
tools. Expose stable user-facing capabilities, not internal implementation
actions.

## Calling another agent

Natural-language delegation is the default for agent-to-agent work. Tell the
receiving specialist the objective, relevant IDs/date range, and desired result
shape. The receiver owns source selection, schemas, queries, joins, SQL, and
provider-specific details. Do not switch to a direct action merely because a
delegated run is slow or flaky; fix the A2A path instead.

### Simple: `callAgent()` (text in, text out)

```ts
import { callAgent, resolveA2ACallerAuth } from "@agent-native/core/a2a";

const auth = await resolveA2ACallerAuth();
const answer = await callAgent(
  "https://analytics.example.com",
  "What were last week's signups?",
  auth,
);
// answer is a plain string
```

`callAgent` signs nothing on its own — with no `userEmail`/`orgSecret` in opts
it calls **unauthenticated**, which silently works in local dev and 401s in
production. `resolveA2ACallerAuth()` pulls the authenticated email, org domain,
and org secret out of request context; pass them explicitly only from CLI or
cron, where there is no request.

### Explicit machine-contract exception: `invokeAgentAction()`

Use direct invocation only when a trusted integration already specifies the
exact receiver-owned semantic read action and complete arguments. It is an
optional machine API, not an agent-performance shortcut or fallback for failed
message delegation:

```ts
import { invokeAgentAction } from "@agent-native/core/a2a";

const { result } = await invokeAgentAction({
  target: "analytics",
  action: "gong-calls",
  input: { company: "Acme", days: 90, includeTranscripts: true },
  userEmail,
  orgDomain,
  orgSecret,
});
```

The receiver still owns schema validation, credentials, access scoping, audit
attribution, and exposure policy. Direct invocation is available only for
cataloged, authenticated, explicitly exposed read-only actions that do not
require approval. Its JWT is audience-bound to the receiving app's exact base
URL, including a workspace path such as `/content`. Use normal message
delegation whenever the receiver must interpret the request, choose a
source, consult its data dictionary, plan, synthesize, join data, or perform a
multi-step workflow.

Inside an agent loop, `call-agent` exposes the same path with `action` + `input`;
omit `message` and `taskId` in that mode.

### Retry safety and trace linkage

`call-agent` automatically derives an owner-scoped idempotency key from the
originating turn, target, and exact message. If a retry reaches the receiver
after the caller timed out, asynchronous `message/send` returns the existing
active or completed task instead of starting a duplicate agent run. Failed and
canceled tasks release the key for an intentional retry; synchronous calls are
never deduplicated. Lower-level clients may pass an
`idempotencyKey` explicitly; keep it stable for the same logical submission and
change it when the work changes. Dedupe is scoped to the JWT-authenticated
owner and verified org, and keys are limited to 128 characters.

The caller also forwards bounded correlation metadata (`callerApp`,
`callerThreadId`, `parentRunId`, `parentTurnId`, and direct-read
`invocationId`). These fields
are telemetry hints only. Receivers must continue to derive identity,
ownership, org scope, access, and approval from the verified request context.
Delegated model loops emit `$ai_generation` with A2A/MCP lineage, while direct
reads emit the content-free `$a2a_read_invoke` event; neither event includes
action arguments or results.

### Advanced: `A2AClient` (full control)

```ts
import { A2AClient, resolveA2ACallerAuth } from "@agent-native/core/a2a";

// The second argument is the bearer token itself, not a signing secret.
const { apiKey, apiKeyFallbacks } = await resolveA2ACallerAuth();
const client = new A2AClient("https://analytics.example.com", apiKey, {
  fallbackApiKeys: apiKeyFallbacks,
});

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

### Agent activity in delegated chat

Agent Native peers attach a bounded `data` part with
`kind: "agent-native/agent-activity"` to in-progress and terminal task status
messages. It contains the same user-visible reasoning summaries shown in the
receiving app, tool names and completion states, elapsed time, and progressive
response text. It never includes tool inputs, tool results, credentials, or
hidden provider reasoning.

`call-agent` reads this optional part while it polls an asynchronous task and
renders the remote work as a nested agent run. Unknown A2A peers do not need to
implement the extension: their ordinary status and final text still render in
the same nested block. Treat activity data as untrusted presentation content;
never use it for identity, authorization, approval, routing, or artifact
validation.

### Carrying explicit chat authorization

When the authenticated caller has an exact consequential action that the user
explicitly authorized in the originating chat, pass the tool name and complete
input as `approvedActions`. The receiver accepts these grants only from a
JWT-verified user identity, converts each one to the same content-addressed key
as its local approval gate, and consumes it once:

```ts
await client.send(message, {
  async: true,
  approvedActions: [
    {
      tool: "send-email",
      input: { to, subject, body, attachments },
    },
  ],
});
```

Never infer authorization from request prose or broaden the input. A changed
recipient, body, attachment, or tool produces a different key and follows the
receiver's normal approval-required path. Static API keys and unsigned callers
cannot carry these grants.

## JSON-RPC Methods

| Method           | Purpose                          | Auth required |
| ---------------- | -------------------------------- | ------------- |
| `message/send`   | Send a message, get a task back  | Yes           |
| `message/stream` | Send a message, stream responses | Yes           |
| `actions/invoke` | Invoke one exposed read action   | Yes, JWT      |
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

## Message Parts

Messages contain typed parts:

| Part type | Fields                              | Use for                    |
| --------- | ----------------------------------- | -------------------------- |
| `text`    | `{ type: "text", text: "..." }`     | Natural language messages  |
| `file`    | `{ type: "file", file: { ... } }`   | Files (bytes or URI)       |
| `data`    | `{ type: "data", data: { ... } }`   | Structured JSON data       |

## Custom mount

Only when the default card is wrong for the app — a curated skill list, a
non-agent handler, or static bearer auth against an external peer:

```ts
// server/plugins/a2a.ts
import { mountA2A } from "@agent-native/core/a2a";

export default defineNitroPlugin((nitro) => {
  mountA2A(nitro, {
    appId: "analytics",
    name: "Analytics Agent",
    description: "Queries analytics data across providers",
    skills: [
      {
        id: "query-data",
        name: "Query Data",
        description: "Run analytics queries across connected data sources",
        tags: ["analytics", "data"],
        examples: ["What were last week's signups?", "Show conversion rates"],
      },
    ],
    streaming: true,
  });
});
```

Config also carries `handler`, `publicSkillsOnly`, `durableBackgroundRuns`,
`executeReadOnlyAction`, `executeApproval`, and `apiKeyEnv`. See `A2AConfig` in
`@agent-native/core/a2a` for the full shape.

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
- **authentication** — Org creation, membership, and where the org secret lives.
- **actions** — A2A calls typically happen inside actions; `publicAgent` marks what peers can see.
- **storing-data** — Results from A2A calls are stored in SQL like any other data.
</content>
</invoke>
