# AgentKit Client

The framework-agnostic controller for AgentKit, the agent interaction and
experience layer for Agent-Native. It owns deterministic event reduction,
optimistic user messages, sequence replay, reconnects, approvals, actions,
suggestions, and message queues. It does not own agent execution, persistence,
authentication, authorization, application state, or presentation.

UI bindings consume its immutable snapshot through `subscribe()` and
`getSnapshot()`.

```ts
import { createAgentKitClient } from "@agent-native/agentkit-client";

const client = createAgentKitClient({ transport });
const thread = await client.openThread("thread-1");
const run = await client.sendMessage({
  threadId: "thread-1",
  text: "Review the workspace",
});
await run.completed;
thread.release();
```

`createAgentKitClient()` accepts one options object:

- **transport**: the only owner of remote thread and run operations.
- **transportOwnership**: `"borrowed"` by default; use `"owned"` only when the
  client exclusively owns the transport lifecycle.
- **upload**: an optional binary upload driver. Binary bodies never enter the
  event protocol.
- **createId** and **now**: injectable deterministic primitives for hosts and
  tests.
- **reconnect**: the retry count and delay for reattaching to resumable streams.
- **onError**: an observer for terminal controller failures.

The transport is the only remote owner. Do not combine a client with another
message store, queue reducer, approval store, or stream reader for the same
conversation.

Call `openThread()` before rendering a persisted conversation. Concurrent opens
share one load and return independent leases. Hydration restores durable
message and activity projections, fetches missing active-run checkpoints, and
reattaches every active run once. Releasing the last lease aborts those local
subscriptions and reconnect waits without cancelling remote work.
`loadThread()` remains available for hosts that own lifecycle separately.

Before the first run, the controller negotiates protocol and capability status
through `discoverCapabilities` (or the legacy static capability map). Optional
operations fail with typed capability or operation errors; unavailable,
unsupported, and omitted capabilities are never treated as successful no-ops.
All mutations are exposed through the controller, including thread, queue,
approval, action, upload, feedback, cancellation, and deletion operations.

Every non-stream controller method accepts an optional final request context:

```ts
const request = new AbortController();
await client.sendMessage(
  { threadId: "thread-1", text: "Review the workspace" },
  { signal: request.signal, correlationId: "workspace-review-42" },
);
```

The client propagates that context through capability preflight and the selected
transport operation. Preflight and in-flight cancellation reject with a typed,
non-retryable `request_aborted` protocol error. Disposing the client aborts its
outstanding requests and local subscriptions; ending a subscription never
calls `cancelRun()` or cancels durable remote work.

The client accepts only validated protocol events and reduces them into an
immutable snapshot. It preserves tool deltas, actions, upload progress,
approval ownership, widgets, annotations, task groups, artifacts, agent-authored
suggestions, the current agent roster, append-only collaboration interactions,
agent-scoped activity, and queue state. Update and removal events replace or
delete their stable projection identity, so reconnect replay is idempotent.
Streams are isolated by thread and run,
reconnect after the last accepted sequence, and fail if they close without an
explicit completed, failed, or cancelled event. `resubscribeRun()` retries only
the subscription; it never retries terminal execution or replays a prompt.

User messages stay visible and are marked `error` when run creation fails. A
stream failure after run acceptance does not relabel the accepted message.
`cancelRun()` waits for server acceptance, updates the local run projection,
and aborts the live subscription or pending reconnect immediately.

The controller has no React, DOM, storage, or provider dependency. Alternate
web, native, terminal, and test clients can subscribe to the same behavioral
source of truth.
Call and await `shutdown()` or its `dispose()` alias when a client leaves its
application lifecycle. Cleanup is idempotent: an owned client awaits transport
disposal exactly once, while a borrowed client never disposes the shared
transport. React-managed clients dispose automatically.

For an advanced React composition, pass the same controller to
`AgentKitRoot`. AgentKit treats an injected controller as host-owned:

```tsx
import { AgentKitRoot } from "@agent-native/agentkit-react/headless";

const client = createAgentKitClient({ transport });

<AgentKitRoot controller={client} threadId="thread-1">
  <ProductConversation />
</AgentKitRoot>;
```

Use `openThread(threadId)` for non-React renderers and release its lease when
the surface closes. `sendMessage(input)` returns an `AgentRunHandle` with a
stable `runId`, a `completed` promise, and `cancel()`.
