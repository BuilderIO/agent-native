# AgentKit

Agent-Native is the application framework and execution platform. It owns
actions, SQL data, application state, agent execution, authentication, access
control, and deployment. AgentKit is its agent interaction and experience
layer. It owns the portable conversation protocol, deterministic client,
adapters, React bindings, and composable agent UI. Toolkit supplies the semantic
design-system and workspace building blocks used by AgentKit and the surrounding
product experience.

AgentKit stays provider-neutral. An Agent-Native app uses the first-party Core
adapter. Another backend implements `AgentTransport` directly or exposes the
versioned HTTP contract.

## Install

Generated Chat apps already include the compatible framework packages. The
root package is deliberately headless and installs only the protocol and
client. For an existing Agent-Native React app, add the React implementation
beside the façade and Core:

```bash
pnpm add @agent-native/agentkit @agent-native/agentkit-react @agent-native/core
```

For a provider-neutral headless client, install only
`@agent-native/agentkit`. HTTP hosts add `@agent-native/agentkit-adapters`;
React hosts add `@agent-native/agentkit-react`. The façade subpaths keep the
application imports concise while the focused packages keep optional runtimes
out of headless dependency graphs.

## Minimal React integration

Use `AgentChat` with the first-party Agent-Native transport. The component owns
one AgentKit client, loads the thread, reconnects active work, and disposes the
client when it unmounts.

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
created transport on replacement or unmount. Omit it for application-level
shared transports. This adapter uses the built-in
`/_agent-native/agent-chat` runtime. It restores
durable history, streams runs, continues approved tool calls, and persists the
message queue. The app does not add a second fetch or event-stream layer.

### Contextual connection requests

When an action cannot continue without a workspace integration, the runtime
emits a typed connection request instead of relying on assistant prose. The
request identifies only the provider, reason, and blocked run. AgentKit renders
an inline card and the host performs setup through its trusted connection
catalog:

```tsx
<AgentChat
  transport={transport}
  threadId={threadId}
  onConnectionRequest={async (request) => {
    const connection = await workspaceConnections.connect(request.provider, {
      reason: request.reason,
    });
    return connection
      ? { status: "connected", connectionId: connection.id }
      : { status: "declined" };
  }}
/>
```

Agent-Native Chat replaces the generic card with Core's MCP connection surface,
which resolves the provider through the workspace catalog, preserves the exact
run across OAuth, and resumes it after setup. Agent-authored values never supply
OAuth URLs, credentials, or arbitrary scopes. Connection setup is also distinct
from approval: an existing connection may still require a separate human
approval before an action runs.

The same request survives delegated Agent-Native work. An authenticated A2A
agent can pause its task with provider-only connection metadata; the caller
rehydrates that dependency into its own run so the user connects once in the
surface they are already using.

## Provider-neutral HTTP integration

Use the endpoint form when a backend mounts `createAgentKitHttpHandler()` at a
versioned AgentKit route:

```tsx
import { AgentChat } from "@agent-native/agentkit/react";
import "@agent-native/agentkit/react/styles.css";

export function Conversation({ threadId }: { threadId: string }) {
  return (
    <AgentChat
      endpoint="/_agent-native/agentkit"
      threadId={threadId}
      title="Workspace review"
    />
  );
}
```

`AgentChat` owns one HTTP transport and one controller, loads the thread,
negotiates capabilities, reconnects active streams, and disposes its resources
when unmounted. Optional features render only when the backend advertises them.

The façade accepts exactly one of `endpoint`, `transport`, or `client`.
Endpoint and transport modes create a managed client that is released on
unmount or source/thread change. Client mode is caller-owned and never disposed
by React. All modes open a releasable lease for the active thread, resume live
streams, release the old lease on client/thread changes, deduplicate Strict
Mode effects, and avoid network work during server render.

```tsx
const client = createAgentKitClient({ transport });

<AgentChat client={client} threadId={threadId} />;
```

## Compose an advanced product

Create a controller when the application needs dependency injection, a native
transport, custom upload behavior, or more than one coordinated view:

```tsx
import { createAgentKitClient } from "@agent-native/agentkit";
import { AgentKitRoot } from "@agent-native/agentkit/react/headless";
import { AgentKitChat } from "@agent-native/agentkit/react";

const controller = createAgentKitClient({ transport });

<AgentKitRoot
  controller={controller}
  threadId={threadId}
  registry={{ widgets: { chart: ChartWidget } }}
  onOpenObject={(object) => workspace.open(object)}
  onThreadForked={(thread) => workspace.openThread(thread.id)}
  onRenderError={(failure) => telemetry.capture(failure)}
>
  <AgentKitChat toolbar={<WorkspaceTools />} />
</AgentKitRoot>;
```

The host owns an injected controller and disposes it when the application
lifecycle ends. AgentKit never creates a second stream reader for it.

`AgentKitProvider` and `AgentKitChat` remain the advanced state and presentation
primitives for hosts that already own lifecycle. The headless React entrypoint
excludes the reference conversation and composer from custom-client bundles.
The full React entrypoint remains the default for the one-component path and
for products that reuse individual visual regions.

Import the protocol and headless controller from the root package. HTTP and
React use explicit façade subpaths backed by their separately installed
implementation packages, so headless servers and alternate clients do not
install UI code. Transport authors install
`@agent-native/agentkit-conformance` directly as a development dependency.

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

1. Configure `AgentChat` with labels, `composerProps`, callbacks, semantic
   tokens, slots, and registries.
2. Compose `AgentKitRoot`, hooks, and the visual regions the product needs. Use
   Toolkit for semantic controls, the composer, and workspace UI.
3. Eject only an installed unit listed by `agent-native eject --list`. For
   example, a custom headless composition can take ownership of Toolkit's
   composer with `agent-native eject toolkit/composer --app <app> --apply`.

Ejection transfers presentation source to the app. It does not transfer Core
auth, persistence, action execution, application state, chat transport, or
agent execution. AgentKit does not currently advertise an AgentKit-wide
ejection unit, so use its public props, slots, registries, provider, client, and
hooks instead of copying package internals.

## Compatibility and versioning

- The six AgentKit packages publish as one compatibility-tested release train.
  Generated apps pin that train from Core's protocol dependency instead of
  resolving implementation packages from independent `latest` tags. HTTP,
  React, and conformance remain independently installable so non-UI and browser
  bundles do not inherit unrelated runtimes.
- Network discovery offers `AGENTKIT_SUPPORTED_PROTOCOL_VERSIONS` and selects
  the highest mutual version. Unsupported wire versions fail during runtime
  validation instead of degrading to empty state.
- Optional behavior is capability-negotiated with explicit `available`,
  `degraded`, `unavailable`, and `unsupported` states. Removing a field or
  changing required wire behavior requires another protocol version.
- AgentKit is pre-1.0. Read release notes for minor updates, keep every
  installed AgentKit package on the same version, and run transport conformance
  after adapter upgrades.

## Migrate an existing Core chat surface

Keep the Core runtime and replace the presentation boundary in one pass:

1. Create `createAgentNativeAgentKitTransport()` for the default Agent-Native
   runtime. A custom `AgentChatRuntime` can use
   `createAgentKitProtocolAdapter()` from `@agent-native/core/client/chat`.
2. Replace the existing Core transcript component with `AgentChat`, or with
   `AgentKitRoot` plus `AgentKitChat` for a composed surface.
3. Move render overrides to `slots` and kind-specific `registry` entries. Move
   thread commands to `useAgentKitControl()`.
4. Keep actions, application-state keys, thread routing, auth, and access
   checks unchanged.
5. Remove the old surface and stream owner. Never run parallel message, queue,
   approval, or SSE state for the same conversation.
