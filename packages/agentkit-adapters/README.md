# AgentKit Adapters

Provider-neutral deployment adapters for AgentKit, the agent interaction and
experience layer for Agent-Native. The HTTP adapter uses
versioned JSON envelopes for commands and resumable server-sent events for run
streams. Its server half is a standard Fetch handler, so the same contract runs
in Node, serverless, and edge hosts.

Agent-Native apps normally use `createAgentNativeAgentKitTransport()` from
`@agent-native/core/client/agent-chat`. Use this package when another backend
needs the portable AgentKit HTTP boundary or when a host intentionally exposes a
separate AgentKit route.

Commands are runtime-validated before they reach a backend, and identifiers in
route paths must match identifiers in versioned request envelopes. Mount the
handler behind the host application's authentication, authorization, rate
limits, and request-size policy. Persistence and identity remain host-owned.

## Client

```ts
import { createAgentKitHttpTransport } from "@agent-native/agentkit/http";

const transport = createAgentKitHttpTransport({
  baseUrl: "/_agent-native/agentkit",
  headers: async () => ({ Authorization: `Bearer ${await getToken()}` }),
  createCorrelationId: () => tracing.currentRequestId(),
});
```

`createAgentKitHttpTransport()` accepts a base URL, an optional Fetch
implementation, static or async headers, an optional correlation-id factory,
and an optional abort signal for the transport lifecycle. Every JSON response
is a versioned protocol envelope. HTTP failures throw `AgentKitHttpError` with
status, code, details, retryability, and the correlation id echoed by the
server. The same id is carried in JSON envelopes, request and response headers,
and SSE event envelopes for end-to-end tracing.

Each non-stream transport operation also accepts an optional request context.
Its signal cancels that Fetch request independently of the transport lifecycle,
and its correlation id overrides the factory for that operation. Aborted
preflight or in-flight work rejects with the typed, non-retryable
`request_aborted` protocol error.

## Server

```ts
import { createAgentKitHttpHandler } from "@agent-native/agentkit/http";

type RequestAuthority = {
  principalId: string;
  workspaceId: string;
  access: string[];
  auditId: string;
};

export const handleAgentKit = createAgentKitHttpHandler({
  basePath: "/_agent-native/agentkit",
  async resolveRequestContext(request): Promise<RequestAuthority> {
    return identity.authorize(request);
  },
  createTransport({ trusted }) {
    return agentRuntime.forRequest({
      principalId: trusted.principalId,
      workspaceId: trusted.workspaceId,
      access: trusted.access,
      auditId: trusted.auditId,
    });
  },
  onError: (error, request) => telemetry.capture(error, request),
});
```

The returned function accepts a standard `Request` and resolves a standard
`Response`. Request-scoped hosts use `resolveRequestContext` plus
`createTransport` so authenticated principal, workspace, access, and audit
state is resolved once and closed over by a dedicated transport. That trusted
value is structurally separate from protocol metadata: it is never parsed from
the client, passed in an operation context, or serialized into a response.
Resolver failures fail closed with an opaque server error unless the host throws
a typed `AgentKitHttpError`.

A transport returned by `createTransport` is request-owned by default. When it
implements `dispose()`, the handler calls it exactly once after a JSON request
succeeds or fails, or after an SSE body completes or its reader cancels. The
transport remains alive while the SSE body is being consumed. Resolver failures
do not create or dispose a transport. Set `transportOwnership: "borrowed"` only
when `createTransport` deliberately returns a host-managed or shared transport;
the handler will then leave its lifecycle to the host. Disposal failures are
reported through `onError` without replacing the established protocol result.

A static `transport` remains available when identity and access are genuinely
static for the mounted handler. Static transports are always borrowed and are
never disposed by the handler. Do not use that mode for a shared multi-tenant
runtime whose scope depends on ambient request state. The adapter does not
invent authentication, persistence, or tenant scope.
For non-stream routes, the handler passes `Request.signal` and the established
correlation id to backend transport work. A disconnect therefore cancels the
in-flight backend operation and maps to a typed 499 response when the runtime
can still produce one. SSE disconnects stop only the subscription iterator and
never call `cancelRun()`.
If the host error observer fails, the request still receives a typed opaque
error. Observer failure is reported separately and never replaces the response.

Optional routes return a typed `operation_unsupported` error with status 501.
Clients negotiate explicit capability state through
`POST /capabilities/discover`; `GET /capabilities` remains the legacy boolean
projection. Run streams require `text/event-stream`, validate safe integer
cursors and matching SSE ids, and accept `afterSequence` only when the transport
advertises durable resumability. Cancelling a response reader or disconnecting
the request aborts the backend subscription signal and closes its iterator.

Capability discovery negotiates the highest mutually supported protocol
version. Each requested capability reports `available`, `degraded`,
`unavailable`, or `unsupported`. The legacy boolean capability map remains a
compatibility projection. New clients should branch on the explicit discovery
state so temporary failure is not mistaken for permanent lack of support.

Run `assertAgentTransportConformance()` from
`@agent-native/agentkit/conformance` against every custom transport before
shipping. The suite verifies capability honesty, event ordering, terminal
state, replay, and snapshot consistency.

## Host responsibilities

- Authenticate before the Fetch handler receives a request.
- Scope thread and run operations to the current principal and workspace.
- Validate action payloads and enforce the same access checks used by direct
  application calls.
- Keep binary uploads in host storage and return portable file references.
- Advertise only capabilities the mounted transport can complete.

The adapter validates protocol shape and route identity. It does not turn a
thread id, action id, widget payload, or smart-object reference into authority.
