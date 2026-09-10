# AgentKit

Agent-Native is the application framework and execution platform. It owns
actions, SQL data, application state, agent execution, authentication, access
control, and deployment. AgentKit is its agent interaction and experience layer:
the portable conversation protocol, the deterministic headless client,
transports, React bindings, and composable agent UI. Toolkit supplies the
semantic design-system and workspace building blocks that AgentKit composes
with.

AgentKit stays provider-neutral. An Agent-Native app uses the first-party Core
adapter. Another backend implements `AgentTransport` directly or exposes the
versioned HTTP contract. Persistence, authorization, file storage, and agent
execution always stay outside this package.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full ownership, invariant, and
extension model.

## Package layout

AgentKit ships as one package with explicit subpaths. Each subpath is a separate
module graph, so a server, native client, or alternate renderer that imports the
root or `/protocol` never loads React, Toolkit, or markdown code.

| Import                                                                                | Contents                                                                                                                         | Loads React |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `@agent-native/agentkit`                                                              | Headless client and protocol types: deterministic reduction, optimistic mutations, reconnect, replay, approvals, actions, queues | No          |
| `@agent-native/agentkit/protocol`                                                     | Wire contract only: versioned types, runtime validators, lifecycle semantics                                                     | No          |
| `@agent-native/agentkit/http`                                                         | Fetch-compatible HTTP transport and server handler with resumable server-sent events                                             | No          |
| `@agent-native/agentkit/conformance`                                                  | Executable transport invariants for custom and remote transports                                                                 | No          |
| `@agent-native/agentkit/react`                                                        | Provider, hooks, control API, slots, registries, composer integration, accessible defaults                                       | Yes         |
| `@agent-native/agentkit/react/{root,chat,components,context,headless,streaming-text}` | Focused React entries                                                                                                            | Yes         |
| `@agent-native/agentkit/react/styles.css`                                             | Standalone stylesheet                                                                                                            | No          |

AgentKit previously published six packages. Replace the old specifiers with
these subpaths: `agentkit-protocol` becomes `agentkit/protocol`,
`agentkit-adapters` becomes `agentkit/http`, `agentkit-conformance` becomes
`agentkit/conformance`, `agentkit-react` becomes `agentkit/react`, and
`agentkit-client` becomes the root `@agent-native/agentkit` import. The root
also re-exports the protocol, so `/protocol` is reserved for code that must not
pull in the client.

## Install

```bash
pnpm add @agent-native/agentkit @agent-native/core
```

Generated Chat apps already include a compatible version. Core is needed only
for the first-party Agent-Native transport. `react` and `react-dom` 19 are
optional peer dependencies required only by the `/react` entries.

## Minimal React integration

`AgentChat` owns one AgentKit client, loads the thread, reconnects active work,
and disposes the client when it unmounts.

```tsx
import { AgentChat } from "@agent-native/agentkit/react";
import "@agent-native/agentkit/react/styles.css";
import { createAgentNativeAgentKitTransport } from "@agent-native/core/client/agent-chat";
import { useMemo } from "react";

export function Conversation({ threadId }: { threadId: string }) {
  const transport = useMemo(
    () => createAgentNativeAgentKitTransport({ threadId, surface: "app" }),
    [threadId],
  );

  return (
    <AgentChat
      transport={transport}
      clientOptions={{ transportOwnership: "owned" }}
      threadId={threadId}
      title="Workspace review"
    />
  );
}
```

The ownership option tells the managed client to dispose this exclusively
created transport on replacement or unmount; omit it for application-level
shared transports. This adapter uses the built-in `/_agent-native/agent-chat`
runtime, which restores durable history, streams runs, continues approved tool
calls, and persists the message queue, so the app adds no second fetch or
event-stream layer.

The reference experience includes a persistent composer, recessed message queue,
agent-authored suggestions, buffered streaming, progressive task and activity
disclosure, approval and choice cards, interactive widgets, attachments,
annotations, feedback, forking, and multi-agent collaboration activity.
Capability discovery runs before the first command, so unsupported features
render as absent rather than as broken controls.

### Client source and lifecycle

`AgentChat` accepts exactly one client source:

- **`endpoint`** creates and owns the HTTP transport and the client. The
  optional `http` prop forwards the full transport contract: `fetch`, static or
  async `headers`, `createCorrelationId`, and a lifecycle `signal` whose abort
  releases in-flight commands and run subscriptions owned by the mounted
  surface.
- **`transport`** leaves the transport host-owned by default and manages only
  the client. Set `clientOptions={{ transportOwnership: "owned" }}` when the
  transport exists solely for this surface.
- **`client`** is caller-owned, including final disposal.

Managed clients are disposed when their endpoint, transport, or mounted surface
changes; caller-owned clients are never disposed by React. Changing `threadId`
keeps the managed client and exchanges its active thread lease, so one shell
preserves cross-thread execution state without rebuilding its controller. Active
runs are resubscribed when a thread opens, and obsolete loads cannot report
errors after their lease releases. Set `load="manual"` only when an advanced
host coordinates loading and leases itself. All modes are safe to server-render
because network work starts in effects, and React Strict Mode replays share the
same managed lease rather than duplicating thread loads.

Shells that let users navigate away from active work can set
`clientOptions={{ retainActiveRunsOnThreadRelease: true }}` to keep accepted run
subscriptions
alive after the last visible lease releases, ending on the run's terminal event
or client disposal. Pair it with `useAgentChatRunningThreads()` from
`@agent-native/core/client/agent-chat` to render per-thread progress in rails or
tabs: `workingThreadIds` ends at the first visible assistant response, while
`runningThreadIds` remains active until the transport reaches a terminal event.

### Contextual connection requests

When an action cannot continue without a workspace integration, the runtime
emits a typed connection request instead of relying on assistant prose. The
request identifies only the provider, reason, and blocked run. AgentKit renders
an inline card, and the host performs setup through its trusted connection
catalog:

```tsx
<AgentChat
  transport={transport}
  threadId={threadId}
  onConnectionRequest={async ({ provider, reason }) => {
    const connection = await workspaceConnections.connect(provider, { reason });
    return connection
      ? { status: "connected", connectionId: connection.id }
      : { status: "declined" };
  }}
/>
```

Use `slots.connectionRequest` when the product has a richer catalog-native card.
The slot receives the typed request and its run id, and resolves it through
`useAgentKitControl().resolveConnectionRequest(...)`. See
[Connection requests](#connection-requests) for the replay-safe lifecycle, the
reason taxonomy, and the delegated-agent case.

Agent-Native Chat replaces the generic card with Core's MCP connection surface,
which resolves the provider through the workspace catalog, preserves the exact
run across OAuth, and resumes it after setup. Agent-authored values never supply
OAuth URLs, credentials, or scopes, and an existing connection may still require
a separate human approval before an action runs.

### Approvals and activity display

Choice approvals render an **Other** option by default, revealing a focused text
field that submits as `response.other`
(see [Approval decisions](#approval-decisions)). Localize the affordance through
the `approvalOther` and `approvalOtherPlaceholder` labels, or replace the
surface with `slots.approval`.

Active execution segments show a quiet `Working for {{duration}}` timer that
settles to `Worked for {{duration}}`, and consecutive equivalent default
activities cluster into one counted row that preserves every underlying trace
record when expanded. Default activity rows use semantic icons for reasoning,
search, reading, editing, commands, checks, MCP calls, connections, navigation,
delegation, and approval; adapters should emit an explicit `activity.kind`
whenever they know the operation; `inferAgentActivityKind()` is the fallback.

## Provider-neutral HTTP integration

The HTTP adapter uses versioned JSON envelopes for commands and resumable
server-sent events for run streams. Its server half is a standard Fetch handler,
so the same contract runs in Node, serverless, and edge hosts. Agent-Native apps
normally use `createAgentNativeAgentKitTransport()`; use `/http` when another
backend needs the portable AgentKit boundary, or when a host intentionally
exposes a separate AgentKit route. In React, `AgentChat`'s `endpoint` mode
consumes a mounted `createAgentKitHttpHandler()` route directly.

### Client transport

```ts
import { createAgentKitHttpTransport } from "@agent-native/agentkit/http";

const transport = createAgentKitHttpTransport({
  baseUrl: "/_agent-native/agentkit",
  headers: async () => ({ Authorization: `Bearer ${await getToken()}` }),
  createCorrelationId: () => tracing.currentRequestId(),
});
```

`createAgentKitHttpTransport()` accepts a base URL, an optional Fetch
implementation, static or async headers, an optional correlation-id factory, and
an optional abort signal for the transport lifecycle. Every JSON response is a
versioned protocol envelope. HTTP failures throw `AgentKitHttpError` with
status, code, details, retryability, and the correlation id echoed by the
server; that id is carried in JSON envelopes, request and response headers, and
SSE event envelopes for end-to-end tracing. Each non-stream operation also
accepts a request context whose signal cancels that Fetch request independently
of the transport lifecycle and whose correlation id overrides the factory.

### Server handler

```ts
import { createAgentKitHttpHandler } from "@agent-native/agentkit/http";

export const handleAgentKit = createAgentKitHttpHandler({
  basePath: "/_agent-native/agentkit",
  resolveRequestContext: (request) => identity.authorize(request),
  createTransport: ({ trusted }) => agentRuntime.forRequest(trusted),
  onError: (error, request) => telemetry.capture(error, request),
});
```

The returned function accepts a standard `Request` and resolves a standard
`Response`. Request-scoped hosts pair `resolveRequestContext` with
`createTransport` so authenticated principal, workspace, access, and audit state
resolves once and is closed over by a dedicated transport. That trusted value is
structurally separate from protocol metadata: it is never parsed from the
client, passed in an operation context, or serialized into a response. Resolver
failures fail closed with an opaque server error unless the host throws a typed
`AgentKitHttpError`.

A transport returned by `createTransport` is request-owned by default. When it
implements `dispose()`, the handler calls it exactly once after a JSON request
succeeds or fails, or after an SSE body completes or its reader cancels; the
transport stays alive while the SSE body is being consumed. Resolver failures
neither create nor dispose a transport. Set `transportOwnership: "borrowed"`
only when `createTransport` deliberately returns a host-managed or shared
transport. Disposal failures are reported through `onError` without replacing
the established protocol result. A static `transport` remains available when
identity and access are genuinely static for the mounted handler; static
transports are always borrowed, and that mode is wrong for a multi-tenant
runtime whose scope depends on ambient request state.

For non-stream routes the handler passes `Request.signal` and the established
correlation id to backend work, so a disconnect cancels the in-flight backend
operation and maps to a typed 499 response when the runtime can still produce
one. SSE disconnects stop only the subscription iterator and never call
`cancelRun()`. If the host error observer fails, the request still receives a
typed opaque error; observer failure is reported separately. Optional routes
return a typed `operation_unsupported` error with status 501, clients negotiate
explicit capability state through `POST /capabilities/discover` while
`GET /capabilities` remains the legacy boolean projection, and run streams
require `text/event-stream`, validate safe integer cursors and matching SSE ids,
and accept `afterSequence` only when the transport advertises durable
resumability.

### Host responsibilities

- Authenticate before the Fetch handler receives a request.
- Scope thread and run operations to the current principal and workspace.
- Validate action payloads and enforce the same access checks used by direct
  application calls.
- Keep binary uploads in host storage and return portable file references.
- Advertise only capabilities the mounted transport can complete.

Commands are runtime-validated before they reach a backend, and identifiers in
route paths must match identifiers in versioned request envelopes. The adapter
validates protocol shape and route identity; it does not turn a thread id,
action id, widget payload, or smart-object reference into authority.

## Compose an advanced product

Create a controller when the application needs dependency injection, a native
transport, custom upload behavior, or more than one coordinated view.
`AgentKitRoot` owns controller selection and lifecycle, `AgentKitChat` is a
reference surface rather than a required shell, slots replace broad regions, and
registries select renderers for domain-specific values.

```tsx
import { createAgentKitClient } from "@agent-native/agentkit";
import { AgentKitRoot } from "@agent-native/agentkit/react/headless";

const controller = createAgentKitClient({ transport });

<AgentKitRoot
  controller={controller}
  threadId={threadId}
  labels={localizedLabels}
  slots={{
    emptyState: NewConversation,
    messageSupplement: ProductMessageContext,
    approval: ProductApproval,
    runFailure: ProductRunFailure,
  }}
  registry={{
    agents: { external: ConnectedAgentIdentity },
    agentInteractions: { delegated: DelegationActivity },
    activities: { deploy: DeploymentActivity },
    tasks: { deployment: DeploymentTask },
    tools: { "query-database": QueryActivity },
    widgets: { chart: ChartWidget, picker: RecordPicker },
    messageParts: { "x-workflow": WorkflowPart },
  }}
  onOpenObject={(object) => workspace.open(object)}
  onThreadForked={(thread) => workspace.openThread(thread.id)}
  onRenderError={(failure) => telemetry.capture(failure)}
  onClientEffect={(effect) => effects.dispatch(effect)}
>
  <ProductConversation />
</AgentKitRoot>;
```

`AgentKitRoot` accepts `threadId`, children, and exactly one client source:
`endpoint` creates a managed HTTP transport and controller with optional `http`
configuration, `transport` creates a managed controller around a host-owned
transport with optional `clientOptions`, and `controller` uses the host's
existing `AgentKitController`. In controller mode `AgentKitRoot` opens and
releases the active thread lease while the host eventually disposes the
controller; with `load="manual"` the host owns both steps.

The `react/headless` entry excludes the reference transcript and rich composer,
so a custom client bundle loads only the regions it renders. `AgentKitProvider`
is the lower-level context boundary it exports: it accepts a controller, thread
id, slots, registry, labels, and host callbacks, but does not load a thread or
dispose a controller. Prefer `AgentKitRoot` unless the host already owns those
lifecycle steps.

`AgentChat` passes labels, registries, object handlers, renderer slots, and
`composerProps` through unchanged. Region slots cover the header, toolbar,
transcript, and footer, plus `messageSupplement`, `messageActions`, and `file`.
`messageSupplement` adds trusted host-owned contextual UI after a message
without replacing its content or action behavior. Behavioral queue and
suggestion slots receive the same client-backed handlers as the defaults, so
presentation changes without forking behavior. AgentKit injects no default
commands or skills, upload controls appear only when the backend advertises
uploads, and uploads always flow through `AgentKitClient.uploadFiles`. Widgets
call stable framework actions and smart objects ask the host to navigate;
neither reaches into product routes.

Thread forking renders only when the backend advertises the capability and the
host provides `onThreadForked`, and feedback controls follow the same contract.
AgentKit never renders an inert control merely because a transport method exists
in a type. Feedback selection is optimistic and rolls back on transport failure,
and a fork stays pending until the durable thread exists.

### One controller, one stream owner

An application must have exactly one behavioral owner for a conversation. Pick a
single source (`endpoint`, `transport`, or `client` on `AgentChat`, or
`controller` on `AgentKitRoot` and `AgentKitProvider`) and share that controller
across every coordinated view. Never create another client for the same live
thread. When adopting AgentKit inside an existing chat runtime, project that
runtime through `AgentKitController` instead of opening a second SSE connection
or maintaining a parallel queue, approval store, or optimistic message list.

### Renderer isolation

Messages, activity, approvals, headers, connection errors, and composers are
isolated by `AgentKitErrorBoundary`, so a broken host slot or agent-authored
widget cannot unmount the rest of the conversation. Users see the localized
`renderError` label, and `onRenderError` receives the original error, surface,
thread id, and React component stack. The boundary is public for product-owned
regions.

### Failure and mutation behavior

Terminal `run.failed` events render beside the run that failed, and connection
failures render separately. Approvals, widget actions, queue controls, uploads,
and sends expose pending and typed error states. The composer preserves its
draft when submission fails.

AgentKit intentionally provides no generic retry button, because replaying agent
work can duplicate side effects. A product that owns an idempotent recovery
action renders it explicitly through `slots.runFailure`, using `error.retryable`
and `error.metadata?.idempotencyKey` to decide, and `useAgentKitMutation()` for
pending and error state. `control.resubscribe(runId)` only reattaches to an
existing stream after a connection loss; it never reruns a prompt.

### Hooks

- `useAgentThread(threadId?)` returns the normalized projection for the context
  thread or an explicitly requested one.
- `useAgentKitControl(threadId?)` binds conversation commands to the same.
- `useAgentRun(runId)` returns one run lifecycle.
- `useAgentCapabilities()` exposes negotiated backend behavior.
- `useAgentConnection()` exposes connection and typed error state.
- `useAgentRoster()` and `useAgentParticipant(id)` select agent identity.
- `useAgentInteractions(filter)` selects append-only collaboration evidence.
- `useAgentKitSnapshot()` and `useAgentKitSelector()` power custom surfaces.
- `useAgentKitMutation(fn)` provides race-safe pending and error state for host
  actions.

```tsx
function ProductConversation() {
  const thread = useAgentThread();
  const control = useAgentKitControl();

  return (
    <ProductTranscript
      messages={thread.messages}
      onSend={(text) => void control.send(text)}
    />
  );
}
```

`useAgentKitMutation()` returns `execute()`, `reset()`, `status`, `pending`, and
`error`; `execute()` takes the same arguments as the supplied async function,
and only the latest invocation owns the visible status. Use
`useAgentKitSelector(selector, isEqual?)` for a focused derived value and
`useAgentKitSnapshot()` only when a surface needs the complete client snapshot.
`useAgentRun(runId?)` and `useAgentParticipant(agentId?)` return `undefined`
when no matching value exists.

### Streaming and formatting

`AgentStreamingText` smooths uneven network chunks per message and preserves
grapheme clusters. Its reset key prevents a later response from inheriting a
previous message's buffer. Plain text is the default: a backend must set
`format: "markdown"`, and a host must intentionally supply a rich-text slot,
before authored emphasis is interpreted.

Reasoning defaults to a compact expandable row and hidden reasoning is never
rendered. Agents may provide a concise `label` such as "Reviewed release
boundaries" for completed reasoning, with the localized `reasoning` label as the
active fallback. Activities describe safe execution evidence instead of exposing
private chain-of-thought.

Agent-authored suggestions replace the suggestion row after each turn, using a
concise single-line `label` for the pill and an optional longer `prompt` to
submit. The shared composer exposes a named multiline textbox through
`labels.composerLabel`; `composerPlaceholder` is visual guidance and does not
substitute for the accessible name.

### Slash discovery

AgentKit exposes slash discovery without inventing product semantics. Pass
`slashCommands`, `slashSkills`, `includeDefaultSlashCommands`,
`includeDefaultSlashSkills`, and `onSlashCommand` to `AgentKitComposer`. Omit
unavailable commands and skills; empty integration or skill states are not
injected into the conversation.

### Semantic styling

The standalone stylesheet uses semantic host tokens and exposes two focused
overrides, `--agentkit-chat-background` and `--agentkit-composer-background`.
Components inherit host foreground, muted, border, primary, destructive,
success, focus, and radius tokens. Composer, overlay, and control depth use the
registered `--agent-kit-*-elevation` semantic tokens and fall back to no shadow.
No product palette is embedded in the package.

## Headless client

The root import is the framework-agnostic controller. It owns deterministic
event reduction, optimistic user messages, sequence replay, reconnects,
approvals, actions, suggestions, and message queues. It does not own agent
execution, persistence, authentication, authorization, application state, or
presentation, and it has no React, DOM, storage, or provider dependency, so web,
native, terminal, and test clients subscribe to the same behavioral source of
truth through `subscribe()` and `getSnapshot()`.

```ts
import { createAgentKitClient } from "@agent-native/agentkit";

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
- **createId** and **now**: injectable deterministic primitives for tests.
- **reconnect**: the retry count and delay for reattaching to resumable streams.
- **retainActiveRunsOnThreadRelease**: keeps accepted run subscriptions alive
  after the last thread lease releases.
- **onError**: an observer for terminal controller failures.

The transport is the only remote owner: do not combine a client with another
message store, queue reducer, approval store, or stream reader for the same
conversation. Call `openThread()` before rendering a persisted conversation.
Concurrent opens share one load and return independent leases. Hydration
restores durable message and activity projections, fetches missing active-run
checkpoints, and reattaches every active run once. Releasing the last lease
aborts those local subscriptions and reconnect waits without cancelling remote
work. `loadThread()` remains available for hosts that own lifecycle separately,
and `sendMessage(input)` returns an `AgentRunHandle` with a stable `runId`, a
`completed` promise, and `cancel()`.

Before the first run the controller negotiates protocol and capability status
through `discoverCapabilities`, or the legacy static capability map. Optional
operations fail with typed capability or operation errors; unavailable,
unsupported, and omitted capabilities are never treated as successful no-ops.
Every mutation is exposed through the controller, including thread, queue,
approval, action, upload, feedback, cancellation, and deletion operations.

Every non-stream controller method takes an optional final request context of
`{ signal, correlationId }` that propagates through capability preflight and the
selected transport operation, rejecting with a typed, non-retryable
`request_aborted` error. Disposing the client aborts its outstanding requests
and local subscriptions, while ending a subscription never calls `cancelRun()`
or cancels durable remote work.

The client accepts only validated protocol events and reduces them into an
immutable snapshot preserving tool deltas, actions, upload progress, approval
ownership, widgets, annotations, task groups, artifacts, agent-authored
suggestions, the current agent roster, append-only collaboration interactions,
agent-scoped activity, and queue state. Update and removal events replace or
delete their stable projection identity, so reconnect replay is idempotent.
Streams are isolated by thread and run, reconnect after the last accepted
sequence, and fail if they close without an explicit completed, failed, or
cancelled event. `resubscribeRun()` retries only the subscription. User messages
stay visible and are marked `error` when run creation fails; a stream failure
after run acceptance does not relabel the accepted message. `cancelRun()` waits
for server acceptance, updates the local run projection, and aborts the live
subscription or pending reconnect immediately.

Call and await `shutdown()` or its `dispose()` alias when a client leaves its
application lifecycle. Cleanup is idempotent: an owned client awaits transport
disposal exactly once, a borrowed client never disposes the shared transport,
and React-managed clients dispose automatically.

## Protocol reference

`@agent-native/agentkit/protocol` is the dependency-free wire contract between
an agent backend and AgentKit clients: messages, streamed events, tool calls,
activities, delegable tasks, approvals, widgets, annotations, artifacts,
capabilities, runs, threads, queues, and transport operations. Runtime
validators and versioned envelopes are exported beside the TypeScript types, and
every network adapter parses commands and events at its trust boundary.
Compile-time types are not a substitute for protocol validation.

Core provides two first-party adapters:
`createAgentNativeAgentKitTransport()` binds AgentKit to the production
Agent-Native thread, queue, approval, and streaming runtime, and
`createAgentKitProtocolAdapter()` adapts a host-owned Core `AgentChatRuntime`.

### Design principles

- The core event union covers common agent behavior without hiding richer
  backend capabilities, and `x-*` extension events and capability keys carry
  backend-specific features without coupling the base protocol to one provider.
- IDs and timestamps are strings, so hosts can choose UUIDs, database IDs, or
  another stable format.
- Widgets carry serializable data and action payloads. The host decides how to
  render them and routes stable action identifiers through `invokeAction`.
- Activities and smart-object references preserve compact agent progress while
  letting a host open files, records, lines, artifacts, and app views without
  embedding host navigation into the protocol.
- Tasks expose durable, delegable work with parent relationships, assigned
  agents, progress, and smart objects. Task groups organize stable task ids
  without replacing tasks as the workflow contract, and their canonical create,
  update, complete, and remove events are replay-safe.
- Participants expose the current roster and lifecycle state for primary,
  delegated, peer, and external agents. Append-only interactions preserve what
  agents did to one another, while agent-scoped activities preserve the work
  performed in the thread, workspace, or an external app, using a shared
  semantic kind taxonomy for status, reasoning, search, reads, writes, commands,
  checks, MCP calls, connections, navigation, delegation, approvals, and tools.
- Namespaced `x-*` message parts let a host add rich domain UI without forking
  the base union, and `data` parts carry opaque structured content for
  host-owned renderers. The host owns validation and rendering for both.
- Approval responses support simple confirmation, single or multiple choices,
  and structured input values without a new transport for each card.
- Thread history, branching, queued messages, and steering are optional
  transport operations, so a small embed stays small without blocking a full
  workbench.
- Multi-agent activity is capability-negotiated. A backend can start with one
  participant and later register parallel agents without changing message or
  task contracts, and each off-surface source remains a portable smart object
  the host can authorize, render, and open.

### Abort and cancellation

Every non-stream `AgentTransport` operation accepts an optional trailing
`AgentRequestContext`. Its `signal` cancels only that request, while its
`correlationId` gives clients, adapters, and backend work one portable tracing
identity. The context is ephemeral local control and is never serialized into
the protocol payload; the argument is optional, so existing transports stay
source-compatible.

`subscribeToRun({ threadId, runId, afterSequence, signal })` accepts an
`AbortSignal`. Aborting it stops that subscriber and requires the transport to
close its iterator and release stream resources. It never changes durable run
state. Call `cancelRun()` only when the caller intends to cancel the remote run.

HTTP and streaming adapters map the signal to their request or stream abort
mechanism. `parseAgentRequestContext()` and `parseSubscribeToRunInput()`
validate signal shape at local transport boundaries. Aborted non-stream work
fails with the typed, non-retryable `request_aborted` error and preserves
correlation identity.

### Durable snapshots and replay

`AgentThreadSnapshot` remains a backward-compatible partial projection.
Restart-safe hosts return `AgentDurableThreadSnapshot`, which requires every
collection even when empty: messages, tools, activities, tasks, task groups,
approvals, widgets, annotations, agents, interactions, artifacts, suggestions,
queued messages, runs, active-run ids, and ordered replay events. Annotation and
widget update and removal events keep these projections complete without
runtime-specific extension fallbacks.

Its `AgentReplayCheckpoint.sequenceByRun` must equal each included run's
`lastSequence` and cover every run, replayed events cannot advance beyond the
checkpoint, and active-run ids must resolve to included, non-terminal runs.
These invariants let clients hydrate each projection once, then subscribe after
the accepted sequence without dropping durable state or duplicating deltas.
Parse persisted or remote values with `parseAgentDurableThreadSnapshot()`.
Before advancing a replay cursor, validate the entire received batch with
`parseAgentEventSequence()`, which rejects the batch when the first event does
not follow `afterSequence` or any later event leaves a sequence gap.

### Approval decisions

Every `AgentApprovalResponse` carries an explicit provider-neutral `decision` of
`"approve"` or `"deny"`. Option ids and structured input remain payload, never
authorization signals: transports must not infer approval from labels, localized
copy, or provider-specific option ids. Resolved approval events and approved or
denied snapshots preserve the same explicit decision.

Choice requests accept a user-authored alternative unless `allowOther` is
explicitly `false`. The alternative is returned as `response.other`, separate
from `optionIds`, so runtimes never mistake arbitrary text for a predefined
choice. Multi-select requests may submit both predefined options and `other`.

### Connection requests

`AgentConnectionRequest` pauses a run when a concrete integration dependency is
missing. Its reason distinguishes a new `connect`, an existing connection that
needs an app `grant`, expired credentials or missing catalog-defined access that
requires `reauthorize`, and setup that is `admin_required`. This is not an
approval request: approval authorizes an operation, while a connection request
establishes the capability required to attempt it.

The lifecycle is explicit and replayable. `connection.requested` moves through
`requested` and `connecting`, then `connection.updated` settles as `connected`,
`declined`, or `failed`. Clients answer with `resolveConnectionRequest`, and
transports resume the exact blocked run only after a connected response. Failed
requests remain visible and retryable.

The request intentionally has no URL, credential, token, or scope fields. The
host resolves `provider` through its authenticated connection catalog and owns
OAuth, credential storage, grants, and scope policy, which keeps contextual
cards demand-driven without letting agent-authored data define a setup endpoint
or permission set. Agent-Native carries this provider-only shape through
authenticated A2A task metadata too, so a delegated agent pauses the caller's
visible run instead of degrading the dependency into an opaque remote failure.

### Errors, correlation, and metadata

`AgentError` is the serializable error base, and capability, operation, and
version failures have typed refinements and constructors.
`AgentKitProtocolError` retains the exact wire-safe value on `protocolError`
when a transport rejects, and both errors and envelopes can carry
`correlationId`.

Every standard metadata field accepts `AgentProtocolMetadata`. Its `actor`,
`workspace`, `access`, `audit`, `trace`, and `context` fields are portable
references that the owning host resolves and enforces access for. Existing
arbitrary metadata stays source-compatible, while new non-standard keys should
use an `x-*` namespace. Runtime parsing validates the standard reference shapes
and rejects non-JSON values, cycles, non-finite numbers, and excessive nesting.

### Queue steering semantics

Steering is a handoff into agent work, not a silent queue deletion. A transport
can return a `StartRunResult` when promotion starts a new run, or emit
`message.created` and `queue.updated` on an existing run. The queued item's id
is preserved so clients render the accepted user message exactly once across
optimistic state, replay, and remote events. If work rejects the command, the
transport must reject the operation and leave the queued item unchanged.
Explicit removal updates only the queue and never creates a conversation
message.

## Transport conformance

`@agent-native/agentkit/conformance` is an executable invariant suite for custom
and remote transports. It checks capability discovery, stable identity, runtime
validation, unique event identity, contiguous sequence, explicit terminal
semantics, declared reconnect replay, and run and thread snapshots without tying
hosts to a test runner. When a stream emits annotation, widget, or task-group
lifecycle events, it also proves replay idempotency and agreement with the
thread snapshot.

Run it against every first-party adapter and in deployment smoke tests for
remote implementations:

```ts
import { assertAgentTransportConformance } from "@agent-native/agentkit/conformance";

const report = await assertAgentTransportConformance({
  transport,
  threadId: "conformance-thread",
});

console.log(report.checks);
```

`assertAgentTransportConformance()` accepts one options object:

- **transport**: an existing `AgentTransport` for the baseline profile. Supply
  this or `createTransport`, never both.
- **createTransport**: a factory returning an isolated transport per
  full-profile scenario. Conformance owns each one, awaits its optional
  `dispose()`, and disposes it even when a check fails.
- **threadId**: an optional stable thread id for the run.
- **messages**: optional seed messages. The default requests a short
  acknowledgement.
- **timeoutMs**: an optional per-operation timeout. The default is 2,000 ms.
- **isUnsupportedError**: an optional predicate for a host's typed unsupported
  error.

The baseline `transport` form is borrowed and the caller retains lifecycle
ownership. Use the `createTransport` form for adapter release gates that must
prove cancellation, abort, reconnect, cross-thread isolation, approval, queue,
and terminal-failure behavior. The report includes the profile, run id, baseline
and scenario event counts, negotiated capabilities, and completed checks.
Optional checks follow declared capabilities, and a transport must not advertise
a capability it cannot prove.

## Ownership and application mapping

| Concern                                        | Owner                               | AgentKit boundary                                                                                                                 |
| ---------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Agent execution, persistence, auth, and access | Agent-Native or the host backend    | Implement `AgentTransport` or use the Core adapter                                                                                |
| Conversation state and commands                | One `AgentKitController`            | Pass one client/source to `AgentChat`, inject a host-owned controller into `AgentKitRoot`, or compose `AgentKitProvider` directly |
| App operations                                 | Agent-Native `defineAction` actions | Route stable widget action ids through `invokeAction`                                                                             |
| Visible app context                            | Agent-Native application state      | Resolve smart objects and client effects in host callbacks                                                                        |
| Agent UI semantics                             | AgentKit                            | Use components, hooks, slots, and renderer registries                                                                             |
| Design system and workspace chrome             | Toolkit plus app-owned adapters     | Compose around AgentKit without moving runtime ownership                                                                          |

Protocol ids and smart objects are references, not authorization grants. The
host authenticates the transport, scopes every thread read, checks every action
invocation, and re-resolves objects before opening them. The generic HTTP
handler must be mounted behind those controls. The Agent-Native adapter keeps
the existing Core request and access boundaries.

## Configure, compose, then eject

Customization follows an ownership ladder: configure `AgentChat` with labels,
`composerProps`, callbacks, semantic tokens, slots, and registries; compose
`AgentKitRoot`, hooks, and the visual regions the product needs, using Toolkit
for semantic controls and workspace UI; then eject only an installed unit listed
by `agent-native eject --list`, such as
`agent-native eject toolkit/composer --app <app> --apply`.

Ejection transfers presentation source to the app. It does not transfer Core
auth, persistence, action execution, application state, chat transport, or agent
execution. AgentKit does not advertise an AgentKit-wide ejection unit, so use
its public props, slots, registries, provider, client, and hooks instead of
copying package internals.

## Compatibility and versioning

Every network envelope carries `AGENTKIT_PROTOCOL_NAME` and a selected version
from `AGENTKIT_SUPPORTED_PROTOCOL_VERSIONS`. Discovery offers supported versions
and selects the highest mutual version with
`negotiateAgentKitProtocolVersion()`. Runtime parsers reject an unsupported
name, version, event, or command at the trust boundary. They do not coerce an
unreadable payload into an empty successful value.

Optional behavior is added through capability negotiation, which distinguishes
`available`, `degraded`, `unavailable`, and `unsupported`; omitted capabilities
remain unknown. The original boolean map is a backward-compatible projection
where `true` means available, `false` means unsupported, and omission means
unknown. Breaking required wire changes add a protocol version instead of
guessing a fallback.

New transports implement `discoverCapabilities(input)` and return an
`AgentCapabilitiesDiscovery` descriptor for every requested capability.
`degraded` and `unavailable` descriptors carry a typed `capability_unavailable`
error with explicit retryability, and `unsupported` descriptors carry a
non-retryable `capability_unsupported` error. Use `getAgentCapabilityStatus()`
to inspect a descriptor, or `requireAgentCapability()` to fail instead of
turning missing functionality into a no-op.

AgentKit is pre-1.0 and publishes as one compatibility-tested package. Generated
apps pin it through Core's dependency rather than resolving a `latest` tag. Read
release notes for minor updates, and run transport conformance after upgrading a
custom adapter.

## Migrate an existing Core chat surface

Keep the Core runtime and replace the presentation boundary in one pass:

1. Create `createAgentNativeAgentKitTransport()` for the default Agent-Native
   runtime. A custom `AgentChatRuntime` can use
   `createAgentKitProtocolAdapter()` from `@agent-native/core/client/chat`.
2. Replace the existing Core transcript component with `AgentChat`, or with
   `AgentKitRoot` plus `AgentKitChat` for a composed surface.
3. Move render overrides to `slots` and kind-specific `registry` entries. Move
   thread commands to `useAgentKitControl()`.
4. Keep actions, application-state keys, thread routing, auth, and access checks
   unchanged.
5. Remove the old surface and stream owner. Never run parallel message, queue,
   approval, or SSE state for the same conversation.
