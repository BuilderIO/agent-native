# @agent-native/agentkit-protocol

Provider-neutral protocol types for AgentKit, the official Agent Experience
Framework for Agent-Native.

This package is intentionally dependency-free. It defines the stable language
between an agent backend and AgentKit clients: messages, streamed events, tool
calls, activities, delegable tasks, approvals, widgets, annotations, artifacts,
capabilities, runs, threads, queues, and transport operations.

Runtime validators and versioned envelopes are exported beside the TypeScript
types. Every network adapter should parse commands and events at its trust
boundary. Compile-time types are not a substitute for protocol validation.

Agent-Native is the reference application and execution platform, but the
protocol does not require a particular model provider, database,
authentication system, or server framework. Backend adapters translate their
native events into `AgentEvent` values, while AgentKit clients consume the
normalized contract.

Core provides two first-party adapters:

- `createAgentNativeAgentKitTransport()` from
  `@agent-native/core/client/agent-chat` binds AgentKit to the production Agent
  Native thread, queue, approval, and streaming runtime.
- `createAgentKitProtocolAdapter()` from `@agent-native/core/client/chat`
  adapts a host-owned Core `AgentChatRuntime` for custom runtime integration.

Both keep this protocol package dependency-free. Provider-neutral backends can
implement `AgentTransport` directly or expose it through the HTTP adapter.

## Design principles

- The core event union covers common agent behavior without hiding richer
  backend capabilities.
- `x-*` extension events and capability keys allow backend-specific features
  without coupling the base protocol to one provider.
- IDs and timestamps are represented as strings so hosts can choose UUIDs,
  database IDs, or another stable format.
- Widgets carry serializable data and action payloads. The host decides how to
  render them and routes stable action identifiers through `invokeAction`.
- Activities and smart-object references preserve compact agent progress while
  letting a host open files, records, lines, artifacts, and app views without
  embedding host navigation into the protocol.
- Tasks expose durable, delegable work with parent relationships, assigned
  agents, progress, and smart objects. Task groups organize stable task ids
  without replacing tasks as the workflow contract. Their canonical
  create/update/complete/remove events are replay-safe.
- Participants expose the current roster and lifecycle state for primary,
  delegated, peer, and external agents. Append-only interactions preserve what
  agents did to one another, while agent-scoped activities preserve the actual
  work performed in the thread, workspace, or an external app.
- Activities use a shared semantic kind taxonomy for status, reasoning, search,
  reads, writes, edits, commands, checks, MCP calls, connections, navigation,
  delegation, approvals, and generic tools. Adapters should publish an explicit
  kind when they know it; `inferAgentActivityKind()` provides a conservative
  fallback for runtimes that only expose stable tool identifiers.
- Namespaced `x-*` message parts let a host add rich domain UI without forking
  the base union. The host owns validation and rendering for those parts.
- `data` message parts carry opaque structured content for host-owned renderers
  without forcing runtime-specific content into the base message union.
- Approval responses support simple confirmation, single or multiple choices,
  and structured input values without requiring a new transport for each card.
- Reasoning parts can publish a concise display label independently of their
  safe expandable summary, avoiding generic completed-state copy.
- Thread history, branching, queued messages, and steering are optional
  transport operations so a small embed can stay small without blocking a
  full workbench.
- Multi-agent activity is capability-negotiated. A backend can start with one
  participant and later register parallel agents without changing message or
  task contracts. Each off-surface source remains a portable smart object the
  host can authorize, render, and open.
- Persistence, authorization, file storage, and transport implementation stay
  outside this package.

## Framework packages

- `@agent-native/agentkit`: installable entry point with explicit HTTP, React,
  and conformance subpaths.
- `@agent-native/agentkit-protocol`: versioned types, validators, and
  provider-neutral lifecycle semantics.
- `@agent-native/agentkit-client`: headless state, optimistic mutations,
  reconnect, replay, approvals, actions, and queue orchestration.
- `@agent-native/agentkit-adapters`: Fetch-compatible HTTP commands and
  resumable server-sent event streams.
- `@agent-native/agentkit-conformance`: executable invariants for custom and
  remote transports.
- `@agent-native/agentkit-react`: provider, hooks, control API, slots,
  registries, shared composer integration, and accessible default primitives.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for ownership and extension rules.

## Compatibility

Every network envelope carries `AGENTKIT_PROTOCOL_NAME` and a selected version
from `AGENTKIT_SUPPORTED_PROTOCOL_VERSIONS`. Discovery offers supported
versions and selects the highest mutual version with
`negotiateAgentKitProtocolVersion()`. Runtime parsers reject an unsupported
name, version, event, or command at the trust boundary. They do not coerce an
unreadable payload into an empty successful value.

Optional behavior is added through capability negotiation. Discovery
distinguishes `available`, `degraded`, `unavailable`, and `unsupported`.
Omitted capabilities remain unknown. The original boolean map is a
backward-compatible projection. Breaking required wire changes add a protocol
version instead of guessing a fallback. This is a pre-1.0 package, so consumers
should keep the AgentKit entry package and its tested implementation
dependencies together and review minor-release notes before upgrading a custom
adapter.

`AgentCapabilities` has fixed compatibility semantics: `true` means available,
`false` means unsupported, and omission means unknown. New transports should
implement `discoverCapabilities(input)` and return an
`AgentCapabilitiesDiscovery` descriptor for every requested capability.
`degraded` and `unavailable` descriptors carry a typed
`capability_unavailable` error with explicit retryability. `unsupported`
descriptors carry a non-retryable `capability_unsupported` error. Use
`getAgentCapabilityStatus()` to inspect a descriptor or
`requireAgentCapability()` to fail instead of turning missing functionality into
a successful no-op.

## Abort and cancellation

Every non-stream `AgentTransport` operation accepts an optional trailing
`AgentRequestContext`. Its `signal` cancels only that request, while its
`correlationId` gives clients, adapters, and backend work one portable tracing
identity. The context is ephemeral local control and is never serialized into
the protocol payload. Existing transports remain source-compatible because the
argument is optional.

`subscribeToRun({ threadId, runId, afterSequence, signal })` accepts an
`AbortSignal`. Aborting it stops that subscriber and requires the transport to
close its iterator and release stream resources. It never changes durable run
state. Call `cancelRun()` only when the caller intends to cancel the remote run.

The signal is local transport control and is not serialized in an envelope.
HTTP and streaming adapters map it to their request or stream abort mechanism.
`parseAgentRequestContext()` and `parseSubscribeToRunInput()` validate signal
shape at local transport boundaries. Aborted non-stream work fails with the
typed, non-retryable `request_aborted` error and preserves correlation identity.

## Durable snapshots and replay

`AgentThreadSnapshot` remains a backward-compatible partial projection.
Restart-safe hosts return `AgentDurableThreadSnapshot`, which requires every
collection even when empty: messages, tools, activities, tasks, task groups,
approvals, widgets, annotations, agents, interactions, artifacts, suggestions,
queued messages, runs, active-run ids, and ordered replay events. Annotation
and widget update/removal events keep these projections complete without
runtime-specific extension fallbacks.

Its `AgentReplayCheckpoint.sequenceByRun` must equal each included run's
`lastSequence` and cover every run. Replayed events cannot advance beyond the
checkpoint. Active-run ids must resolve to included, non-terminal runs. These
invariants let clients hydrate each projection once, then subscribe after the
accepted sequence without dropping durable state or duplicating deltas. Parse
persisted or remote values with `parseAgentDurableThreadSnapshot()`.
Before advancing a replay cursor, validate the entire received batch with
`parseAgentEventSequence()`. It rejects the batch when the first event does not
follow `afterSequence` or any later event leaves a sequence gap.

## Approval decisions

Every `AgentApprovalResponse` carries an explicit provider-neutral `decision`
of `"approve"` or `"deny"`. Option ids and structured input remain payload,
never authorization signals: transports must not infer approval from labels,
localized copy, or provider-specific option ids. Resolved approval events and
approved or denied snapshots preserve the same explicit decision.

Choice requests accept a user-authored alternative unless `allowOther` is
explicitly `false`. The alternative is returned as `response.other`, separate
from `optionIds`, so runtimes never mistake arbitrary text for a predefined
choice. Multi-select requests may submit both predefined options and `other`.

## Connection requests

`AgentConnectionRequest` pauses a run when a concrete integration dependency is
missing. Its reason distinguishes a new `connect`, an existing connection that
needs an app `grant`, expired credentials or missing catalog-defined access that
requires `reauthorize`, and setup that is `admin_required`. This is not an
approval request: approval authorizes an operation, while a connection request
establishes the capability required to attempt it.

The lifecycle is explicit and replayable:
`connection.requested` moves through `requested` and `connecting`, then
`connection.updated` settles as `connected`, `declined`, or `failed`. Clients
answer with `resolveConnectionRequest`; transports resume the exact blocked run
only after a connected response. Failed requests remain visible and retryable.

The request intentionally has no URL, credential, token, or scope fields. The
host resolves `provider` through its authenticated connection catalog and owns
OAuth, credential storage, grants, and scope policy. This keeps contextual
cards demand-driven without allowing agent-authored data to define a setup
endpoint or permission set.

Agent-Native also carries this provider-only shape through authenticated A2A
task metadata. A delegated agent therefore pauses the caller's visible run
instead of degrading the dependency into an opaque remote failure.

## Errors, correlation, and metadata

`AgentError` is the serializable error base. Capability, operation, and version
failures have typed refinements and constructors. `AgentKitProtocolError`
retains the exact wire-safe value on `protocolError` when a transport rejects.
Both errors and envelopes can carry `correlationId`.

Every standard metadata field accepts `AgentProtocolMetadata`. Its `actor`,
`workspace`, `access`, `audit`, `trace`, and `context` fields are portable
references; the owning host resolves them and enforces access. Existing
arbitrary metadata remains source-compatible, while new non-standard keys
should use an `x-*` namespace. Runtime parsing validates the standard reference
shapes and rejects non-JSON values, cycles, non-finite numbers, and excessive
nesting.

## Queue steering semantics

Steering is a handoff into agent work, not a silent queue deletion. A transport
can return a `StartRunResult` when promotion starts a new run, or emit
`message.created` and `queue.updated` on an existing run. The queued item's id is
preserved so clients render the accepted user message exactly once across
optimistic state, replay, and remote events. If work rejects the command, the
transport must reject the operation and leave the queued item unchanged.
Explicit removal updates only the queue and never creates a conversation
message.

## Product direction

AgentKit is the agent interaction and experience layer for Agent-Native
products. Its goal is to provide a complete agent surface without making every
product adopt the same visual skin, agent backend, or workflow model.

The framework is being built around these product goals:

- Deep UI customization through semantic design-system adapters, composable
  primitives, slots, and ejectable source.
- Built-in response streaming with buffering and lifecycle events for natural,
  stable conversational rendering.
- Tool and workflow integration that visualizes actions, progress, approvals,
  artifacts, and safe reasoning summaries. AgentKit does not depend on exposing
  a model's hidden chain-of-thought.
- Rich interactive widgets rendered inline and connected to app actions and
  application state.
- Attachment handling for files and images, with storage represented by
  portable references rather than embedded payloads.
- Thread and message management for branching, queuing, steering, restoring,
  and organizing long-running conversations.
- Source annotations and entity tagging for transparent citations, references,
  and app-aware context.
- Agent-authored next actions that can replace the suggestion row after each
  turn without coupling the UI to a model provider. Suggestions use a concise,
  single-line `label` for the pill and may carry a longer `prompt` to submit.

Agent-Native remains the reference backend. The protocol stays provider-neutral
so other runtimes can implement the same message, run, tool, approval, artifact,
and transport contracts.

## Product boundary

AgentKit is independently embeddable while remaining the standard agent
experience layer for Agent-Native. Agent-Native owns application execution,
actions, SQL, application state, auth, access, and persistence. AgentKit owns
portable conversation semantics, deterministic client state, adapters, and
agent UI.
Toolkit owns the semantic design-system and workspace layer. See
[ARCHITECTURE.md](./ARCHITECTURE.md) for the complete ownership and migration
model.
