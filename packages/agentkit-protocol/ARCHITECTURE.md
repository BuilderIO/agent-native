# AgentKit architecture

Agent-Native is the application framework and execution platform. AgentKit is
its agent interaction and experience layer. Toolkit is the semantic
design-system and workspace layer. These layers are designed to work together
without collapsing their ownership boundaries.

| Layer        | Owns                                                                                       | Does not own                                    |
| ------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Agent-Native | Actions, SQL, application state, agent execution, auth, access, persistence, deployment    | Portable conversation UI contracts              |
| AgentKit     | Protocol, event validation, client state, transports, React bindings, agent UI composition | App data, authorization policy, agent execution |
| Toolkit      | Semantic controls, composer building blocks, design-system adapters, workspace UI          | Conversation state or backend behavior          |

AgentKit also runs with another backend. That backend must own the same
execution and security responsibilities that Agent-Native normally provides.
Each layer has one source of truth and a narrow dependency direction.

```text
Agent-Native Core or another agent runtime
              ↓ runtime adapter
versioned AgentKit protocol + validation
              ↓ transport
headless AgentKit client + event reducer
              ↓ subscription
React provider + AgentKit UI using Toolkit semantics
              ↓ composition
app slots, registries, callbacks, and workspace chrome
```

## Ownership model

The backend owns durable truth. The AgentKit client owns the live normalized
projection and optimistic command state. React owns presentation. The app owns
its product composition.

An application chooses exactly one client source per conversation:

- `endpoint` lets `AgentKitRoot` create and dispose an HTTP transport and
  controller.
- `transport` lets `AgentKitRoot` create and dispose a controller around a
  host-owned transport.
- `controller` keeps lifecycle in the host. AgentKit does not load or dispose
  another controller behind it.

Inject the same controller into every coordinated view. A second controller,
stream reader, queue, approval store, or optimistic message list creates two
behavioral owners and violates the contract.

## Invariants

1. Events are append-only, ordered, replayable, and explicitly terminal.
2. A reconnect begins after the last accepted sequence. Duplicate events are
   harmless.
3. Binary data never enters messages or event logs. Uploads negotiate a target
   and complete into portable file references.
4. Widgets invoke stable action identifiers. They do not call app routes or
   mutate app state directly.
5. Hidden chain-of-thought is not a UI contract. Agents publish safe reasoning
   summaries and named activities instead.
6. Rich formatting is opt-in per text part. Plain text remains the secure,
   visually quiet default.
7. Suggestions are agent-authored post-response actions, never unexplained
   template defaults.
8. Smart objects contain portable identity. Hosts own authorization,
   navigation, and rendering.
9. The headless client is the behavioral source of truth for default and
   custom views.
10. Optional capabilities are negotiated. Unsupported behavior fails clearly
    instead of being silently coerced into success.
11. Tasks model delegable workflow state. Activities model execution evidence.
12. Approval authorization is explicit. Option ids and user-facing labels never
    determine whether a response approves or denies work.
    A host may expose either capability without pretending one is the other.
13. The agent roster is a current-state projection. Agent interactions are an
    append-only audit of collaboration. Lifecycle state never replaces the
    activity that explains what an agent actually did.
14. Work outside the thread declares `scope` and a portable `source` smart
    object. The protocol never assumes that an app, workspace object, or remote
    agent shares the chat host's navigation or authorization model.
15. One controller owns a conversation's state and command lifecycle. A host
    may project an existing runtime through that contract, but it must not open
    a parallel stream or maintain duplicate message, queue, or approval state.
16. `resubscribeRun` reconnects to existing work. Retrying work is a separate,
    host-defined, idempotency-aware action and is never inferred from a network
    failure.
17. Host and agent-authored renderers fail within their own surface boundary.
    Users receive safe copy. Host observability receives the original failure
    with thread and surface identity.
18. Aborting non-stream request context cancels only that operation. Aborting a
    run subscription releases only that subscriber's resources. Neither action
    implicitly cancels or otherwise mutates the remote run.
19. A durable snapshot is self-contained. Empty projections are present as
    empty arrays, its checkpoint covers every included run, and active-run ids
    resolve only to included non-terminal runs.
20. Capability omission means unknown. Unsupported and temporarily unavailable
    states are explicit, typed, and never coerced into a successful no-op.
21. Actor, workspace, access, audit, trace, and context metadata are portable
    references, not authorization grants. The receiving host re-resolves them
    at its trust boundary.
22. Events are contiguous within a run. A consumer rejects a sequence gap
    before advancing its replay cursor so reconnect cannot make a missing event
    permanent.
23. Approval continuation binds an explicit approve-or-deny decision to the
    exact pending request id. Option labels and localized identifiers never
    imply authorization.
24. AgentKit packages publish as one compatibility-tested release train even
    though focused packages remain independently installable.

## Protocol boundaries

Version discovery occurs before versioned envelope exchange.
`negotiateAgentKitProtocolVersion()` selects the highest mutual version or
returns a typed, non-retryable incompatibility. Once selected, every received
envelope, command, event, result, and persisted snapshot passes through its
matching runtime parser. Unknown envelope fields and unsupported versions fail
loudly; opaque payload and metadata values must still be JSON-safe.

`AgentThreadSnapshot` supports existing partial transports.
`AgentDurableThreadSnapshot` is the canonical persistence and restart contract.
It carries both normalized current projections and ordered events through an
`AgentReplayCheckpoint`. The projection prevents an application from having to
re-derive messages, tools, activities, tasks, approvals, widgets, agents,
interactions, artifacts, or suggestions after restart. The checkpoint prevents
the client from replaying accepted deltas or skipping active work.

Errors cross process boundaries as `AgentError` values. Capability,
unsupported-operation, and version failures use their typed refinements with
explicit retryability and correlation identity. A local transport may throw
`AgentKitProtocolError`, which preserves the serializable error unchanged for
an adapter or caller.

Non-stream transport operations accept an optional provider-neutral
`AgentRequestContext`. Its abort signal and correlation identity are ephemeral
request controls rather than wire payload. Adapters propagate them to backend
work and return a typed `request_aborted` error when cancellation wins. Stream
subscription signals remain consumer-local and never imply `cancelRun()`.

## Extension model

Use a standard protocol field when behavior affects every host. Use an `x-*`
event or capability only for backend-specific data. React presentation extends
through slots for broad replacement and kind registries for widgets, tools, and
activities. App operations extend through `invokeAction`. App navigation
extends through smart-object and client-effect callbacks.

Multi-agent renderers compose at three levels: `agent` replaces identity,
`agentInteraction` replaces lifecycle rows, and activity registries replace
domain-specific work. Hosts can therefore preserve one behavioral contract
while presenting a lightweight chat feed, an operations timeline, or a full
agent observability workspace.

## Adapter model

Agent-Native provides the first-party production adapter:

```ts
import { createAgentNativeAgentKitTransport } from "@agent-native/core/client/agent-chat";

const transport = createAgentNativeAgentKitTransport({
  threadId,
  surface: "app",
});
```

It binds the built-in Agent-Native chat endpoint to AgentKit thread snapshots,
run streams, approval continuation, feedback, durable queue operations, and
thread forking. It preserves Core's runtime and request boundaries.

Runtime implementers that already expose Core's `AgentChatRuntime` can use
`createAgentKitProtocolAdapter()` from `@agent-native/core/client/chat`.
Provider-neutral backends implement `AgentTransport` directly. They may expose
that transport with `createAgentKitHttpHandler()` and consume it with
`createAgentKitHttpTransport()`.

The protocol and HTTP packages do not provide authentication, authorization,
persistence, tenancy, or agent execution. Those remain backend responsibilities.

## Agent-Native contract mapping

### Actions

AgentKit widgets carry stable action identifiers and serializable payloads.
They call `AgentTransport.invokeAction`. In an Agent-Native app, map that
operation to the same named `defineAction` surface used by the UI and agent.
The production adapter advertises the `actions` capability only when the host
supplies `operations.invokeAction`.

Validate the payload at the action boundary and preserve normal request context
and access checks. Do not route widget actions to product URLs or mutate SQL
from a renderer.

### Context and navigation

`AgentObjectReference` provides portable identity for a file, record, artifact,
or view. `onOpenObject` resolves it into host navigation. `client.effect` and
`client.deeplink` events reach `onClientEffect`. If opening an object changes
Agent-Native application state, use the app's existing named helper or action.
The protocol never writes `application_state` directly.

### Security

Thread ids, run ids, action ids, widget payloads, and smart objects are not
authorization grants. The host must authenticate transport requests, scope
thread reads and writes, assert action access, validate uploads, and re-resolve
objects before navigation. Mount the generic HTTP handler only after those
controls. Keep Agent-Native apps on Core's existing auth, request-context, and
ownable-data boundaries.

## Configure, compose, and eject

Customization follows an ownership ladder:

1. Configure labels, semantic tokens, composer props, callbacks, slots, and
   renderer registries.
2. Compose a product with `AgentKitRoot`, the headless hooks, selected AgentKit
   regions, and Toolkit workspace components.
3. Eject the smallest installed unit listed by `agent-native eject --list`.
   A headless composition can take ownership of Toolkit's composer with
   `agent-native eject toolkit/composer --app <app> --apply`.

The current AgentKit packages do not advertise an AgentKit-wide ejection unit.
Do not copy their private source. Ejecting a Toolkit region transfers only that
presentation source. Core auth, persistence, action execution, application
state, chat transport, and agent execution stay on public package contracts.

## Migration from Core chat UI

An existing Agent-Native app can migrate presentation without replacing its
runtime:

1. Keep the app shell, thread routing, actions, application-state keys, auth,
   access checks, and agent runtime.
2. Create `createAgentNativeAgentKitTransport()` for the default runtime. For a
   custom Core runtime, wrap its `AgentChatRuntime` with
   `createAgentKitProtocolAdapter()`.
3. Replace the old transcript surface with `AgentChat`, or compose
   `AgentKitRoot` and `AgentKitChat`.
4. Move visual overrides into slots and kind registries. Move commands into
   `useAgentKitControl()` or the injected controller.
5. Remove the old controller and stream owner in the same migration. Keep one
   source of message, run, queue, and approval state.

## Public distribution

Applications install `@agent-native/agentkit`. The root import exposes only
the dependency-free protocol and headless client. HTTP, React, and conformance
live behind explicit subpaths so a server, native client, or alternate renderer
does not inherit unrelated runtime code. The smaller implementation packages
remain public for hosts that need exact dependency control.

## Stability path

New transports run `assertAgentTransportConformance()` before release. New event
shapes require validators, reducer coverage, replay tests, and documentation.
Breaking wire changes increment the protocol version and must fail loudly at
the envelope boundary.

Package APIs follow each package's version. The `@agent-native/agentkit` entry
package installs a tested implementation set. Network discovery offers
`AGENTKIT_SUPPORTED_PROTOCOL_VERSIONS` and selects the highest mutual version.
Compatibility does not assume that all package versions match. Capability
discovery distinguishes available, degraded, unavailable, unsupported, and
omitted unknown state. During the pre-1.0 period, consumers should review
minor-release notes before upgrading a custom adapter.

Conformance follows negotiated capabilities. A transport that declares
`resumableRuns` must prove cursor replay. A transport that declares
`durableThreadSnapshots` must return a value accepted by
`parseAgentDurableThreadSnapshot()`. A transport that cannot survive a process
restart must declare both capabilities false even if it can replay an in-memory
stream during that process.
