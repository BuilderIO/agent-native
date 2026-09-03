# AgentKit React

Composable React bindings for AgentKit, the agent interaction and experience
layer for the Agent-Native framework. Toolkit supplies the semantic composer
and workspace design layer. AgentKit React owns conversation presentation and
binds it to one AgentKit controller.

The reference experience includes a
persistent composer, recessed message queue, agent-authored suggestions,
buffered streaming, progressive task and activity disclosure, human approval
and choice cards, interactive widgets, attachments, annotations, feedback,
forking, and multi-agent collaboration activity.

## Common path

```tsx
import { AgentChat } from "@agent-native/agentkit-react";
import "@agent-native/agentkit-react/styles.css";

<AgentChat
  endpoint="/_agent-native/agentkit"
  threadId={threadId}
  title="Workspace review"
  toolbar={<ChatToolbar />}
/>;
```

The common path needs no client construction or lifecycle effects. It performs
capability discovery before the first command and renders unsupported features
as absent rather than broken controls.

The optional `http` prop forwards the complete HTTP transport contract:
`fetch`, static or async `headers`, `createCorrelationId`, and the lifecycle
`signal`. Aborting that signal releases in-flight commands and run
subscriptions owned by the mounted endpoint surface. Correlation ids continue
through command headers, protocol envelopes, and event streams.

`AgentChat` accepts exactly one ownership mode:

- `endpoint`: AgentChat owns the HTTP transport and client.
- `transport`: the host owns the transport by default; AgentChat owns the
  client. Set `clientOptions={{ transportOwnership: "owned" }}` when the
  transport was created exclusively for this surface.
- `client`: the host owns the `AgentKitClient`, including final disposal.

Managed clients are disposed when their endpoint, transport, or mounted surface
changes. Caller-owned clients are never disposed. Changing `threadId` keeps the
managed client but exchanges its active thread lease, so one shell can preserve
cross-thread execution state without rebuilding its controller. Active runs are
resubscribed when a thread opens, and obsolete loads cannot report errors after
their lease releases. Set `load="manual"` only when an advanced host coordinates
loading and leases itself.

Chat shells that let users navigate away from active work can keep accepted run
subscriptions alive after the last visible lease releases:

```tsx
<AgentChat
  transport={transport}
  clientOptions={{
    transportOwnership: "owned",
    retainActiveRunsOnThreadRelease: true,
  }}
  threadId={threadId}
/>
```

The retained consumer ends on the run's terminal event or when the managed
client is disposed. Hosts can pair this with
`useAgentChatRunningThreads()` from `@agent-native/core/client/agent-chat` to
render per-thread progress in rails or tabs while the conversation is hidden.
`workingThreadIds` ends at the first visible assistant response, while
`runningThreadIds` remains active until the transport reaches a terminal event;
this keeps presentation honest without weakening queue and cancellation safety.

All three modes are safe to server-render: network work starts in effects, not
during render. React Strict Mode replays share the same managed lease, so the
development-only effect cycle does not duplicate thread loads or dispose the
replacement mount.

In an Agent-Native app, pass the first-party transport instead of an HTTP
endpoint:

```tsx
import { AgentChat } from "@agent-native/agentkit-react";
import { createAgentNativeAgentKitTransport } from "@agent-native/core/client/agent-chat";
import { useMemo } from "react";

function Conversation({ threadId }: { threadId: string }) {
  const transport = useMemo(
    () => createAgentNativeAgentKitTransport({ surface: "app" }),
    [],
  );
  return (
    <AgentChat
      transport={transport}
      clientOptions={{
        transportOwnership: "owned",
        retainActiveRunsOnThreadRelease: true,
      }}
      threadId={threadId}
    />
  );
}
```

This Agent-Native example transfers its shell-scoped transport to the managed
client, which disposes it exactly once when replaced or unmounted. The transport
receives the current thread on every command; keeping it stable is what lets a
background subscription survive route changes. Omit the ownership option for
shared transports. Use `client` when the host owns an `AgentKitClient`. Use
`controller` only on `AgentKitRoot` or `AgentKitProvider` for an advanced
controller implementation.

## Contextual connection requests

Backends advertise `connectionRequests` and emit a structured request when a
run needs an integration. The reference transcript renders that request inline.
Pass `onConnectionRequest` to connect a host-owned setup workflow without
teaching AgentKit about provider URLs, credentials, or scopes:

```tsx
<AgentChat
  endpoint="/_agent-native/agentkit"
  threadId={threadId}
  onConnectionRequest={async (request) => {
    const result = await connections.open(request.provider, request.reason);
    return result.connected
      ? { status: "connected", connectionId: result.id }
      : { status: "declined" };
  }}
/>
```

Use `slots.connectionRequest` when the product has a richer catalog-native
card. The slot receives the typed request and its run id; resolve it through
`useAgentKitControl().resolveConnectionRequest(...)`. Status is replay-safe and
moves through `requested`, `connecting`, then `connected`, `declined`, or
`failed`. A failed setup remains retryable. `connect`, `grant`, `reauthorize`,
and `admin_required` describe why setup is blocked; action approval remains the
separate approval contract.

Choice approvals render an **Other** option by default. Selecting it reveals a
focused text field and submits the value as `response.other`, independently of
predefined `optionIds`. Set `allowOther: false` only when the workflow must be
restricted to enumerated answers. Hosts can localize the default affordance
through `approvalOther` and `approvalOtherPlaceholder` labels, or replace the
entire approval surface with `slots.approval`.

Active execution segments use a quiet `Working for {{duration}}` timer, then
settle to `Worked for {{duration}}` from the run's canonical timestamps.
Consecutive equivalent default activities are clustered into one counted row;
expanding it preserves every underlying trace record. Custom activity and tool
renderers remain ungrouped. Hosts can localize the timer with `working`,
`workingFor`, `worked`, and `workedFor`; the duration-bearing labels receive
the formatted value through `{{duration}}`. Duration units use
`durationHourShort`, `durationMinuteShort`, and `durationSecondShort`.

Default activity rows use semantic icons for reasoning, search, reading,
editing, commands, checks, MCP calls, connections, navigation, delegation, and
approval. Adapters should emit an explicit `activity.kind` whenever they know
the operation; otherwise AgentKit conservatively infers the kind from the stable
tool identifier. The run-level `Working for…` spine remains visually distinct
from every individual action.

## Composition contract

`AgentKitRoot` owns controller selection and lifecycle. `AgentKitChat` is the
reference conversation surface, not a required application shell. Broad slots
replace regions. Registries select renderers for domain-specific values.

```tsx
import { createAgentKitClient } from "@agent-native/agentkit-client";
import { AgentKitRoot } from "@agent-native/agentkit-react/headless";

const controller = createAgentKitClient({ transport });

<AgentKitRoot
  controller={controller}
  threadId={threadId}
  labels={localizedLabels}
  slots={{
    emptyState: NewConversation,
    messageSupplement: ProductMessageContext,
    messageActions: ProductMessageActions,
    approval: ProductApproval,
    runFailure: ProductRunFailure,
    file: WorkspaceFile,
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

The `headless` entrypoint excludes the reference transcript and rich composer.
Use it for custom clients and load only the UI regions the product renders.

`AgentKitProvider` and `AgentKitChat` remain the advanced primitives for hosts
that already own a controller and lifecycle. `AgentKitRoot` composes those
primitives for a custom surface; `AgentChat` is the batteries-included façade.

`AgentKitRoot` accepts `threadId`, children, and exactly one client source:

- **endpoint** creates a managed HTTP transport and controller. Pass optional
  HTTP configuration through `http`.
- **transport** creates a managed controller around a host-owned transport.
  Pass deterministic client configuration through `clientOptions`.
- **controller** uses the host's existing `AgentKitController`. `AgentKitRoot`
  opens and releases the active thread lease; the host eventually disposes the
  controller. With `load="manual"`, the host owns both steps.

`AgentKitProvider` is the lower-level context boundary exported by the headless
entrypoint. It accepts a controller, thread id, slots, registry, labels, and host
callbacks. It does not load a thread or dispose a controller. Prefer
`AgentKitRoot` unless the host already owns those lifecycle steps.

The common `AgentChat` path passes labels, registries, object handlers, renderer
slots, and `composerProps` through unchanged. Region slots cover the header,
toolbar, transcript, and footer. `messageSupplement` adds trusted host-owned
contextual UI after a message without replacing its content or action behavior.
Behavioral queue and suggestion slots receive the same client-backed handlers
as the defaults, so presentation can change without forking behavior. AgentKit
does not inject default commands or skills.
Upload controls only appear when the backend advertises uploads, and uploads
always flow through `AgentKitClient.uploadFiles`. Host-owned commands must be
passed explicitly.

Widgets call stable framework actions. Smart objects ask the host to navigate.
Neither primitive reaches into product routes directly.

Thread forking renders only when both the backend advertises the capability and
the host provides `onThreadForked` to activate the returned thread. Feedback
controls follow the same capability contract. AgentKit never renders an inert
control merely because a transport method exists in a type. Message copy uses
the shared host-aware clipboard path and confirms success in place. Feedback
selection is optimistic and rolls back on transport failure; a fork remains
pending until the durable thread exists and only then reaches
`onThreadForked`.

### Renderer isolation

Messages, activity, approvals, headers, connection errors, and composers are
isolated by `AgentKitErrorBoundary`. A broken host slot or agent-authored widget
cannot unmount the rest of the conversation. Users see the localized
`renderError` label. `onRenderError` receives the original error, surface,
thread id, and React component stack for observability. The public boundary is
also available for product-owned regions.

### One controller, one stream owner

An application must have exactly one behavioral owner for a conversation:

- Use `endpoint` or `transport` on `AgentChat` when AgentKit should create and
  dispose the client.
- Use `client` on `AgentChat` when a host already owns an `AgentKitClient`.
- Use `controller` on `AgentKitRoot` or `AgentKitProvider` for an advanced
  controller projection.
- Share that controller across custom views. Never create another client for
  the same live thread.
- When adopting AgentKit inside an existing chat runtime, project that runtime
  through `AgentKitController`. Do not open a second SSE connection or maintain
  a parallel queue, approval store, or optimistic message list.

## Failure and mutation behavior

Terminal `run.failed` events render beside the run that failed. Connection
failures render separately. Approvals, widget actions, queue controls, uploads,
and sends expose pending and typed error states. The composer preserves its
draft when submission fails.

AgentKit intentionally does not provide a generic retry button. Replaying agent
work can duplicate side effects. A product that owns an idempotent recovery
action can render it explicitly:

```tsx
function ProductRunFailure({ error, runId }: AgentRunFailureRenderProps) {
  const recover = useAgentKitMutation(async () =>
    recovery.retryRun({
      runId,
      idempotencyKey: error.metadata?.idempotencyKey,
    }),
  );

  return (
    <ProductNotice
      message={error.message}
      action={
        error.retryable
          ? {
              label: "Try again",
              onSelect: () => void recover.execute(),
            }
          : undefined
      }
      pending={recover.pending}
      error={recover.error}
    />
  );
}
```

`control.resubscribe(runId)` only reattaches to an existing stream after a
connection loss. It never reruns a prompt.

## Hooks

- `useAgentThread(threadId?)` returns the normalized projection for the context
  thread or an explicitly requested thread.
- `useAgentRun(runId)` returns one run lifecycle.
- `useAgentCapabilities()` exposes negotiated backend behavior.
- `useAgentConnection()` exposes connection and typed error state.
- `useAgentRoster()` and `useAgentParticipant(id)` select agent identity.
- `useAgentInteractions(filter)` selects append-only collaboration evidence.
- `useAgentKitSnapshot()` and `useAgentKitSelector()` power custom surfaces.
- `useAgentKitControl(threadId?)` binds conversation commands to the context
  thread or an explicitly requested thread.
- `useAgentKitMutation(fn)` provides race-safe pending and error state for host
  actions.

`useAgentKitMutation()` returns `execute()`, `reset()`, `status`, `pending`,
and `error`. `execute()` accepts the same arguments as the supplied async
function. Only the latest invocation owns the visible status.

The simplest custom surface reads the current projection and binds commands to
the provider's thread:

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

Use `useAgentKitSelector(selector, isEqual?)` for a focused derived value. Use
`useAgentKitSnapshot()` only when a custom surface genuinely needs the complete
client snapshot. `useAgentRun(runId?)` and `useAgentParticipant(agentId?)`
return `undefined` when no matching value exists.

The shared composer exposes a named multiline textbox through
`labels.composerLabel`. `composerPlaceholder` remains visual guidance and does
not substitute for the accessible name.

## Streaming and formatting

`AgentStreamingText` smooths uneven network chunks per message and preserves
grapheme clusters. Its reset key prevents a later response from inheriting a
previous message's buffer. Plain text is the default. A backend must set
`format: "markdown"`, and a host must intentionally supply a rich-text slot,
before authored emphasis is interpreted.

Reasoning defaults to a compact expandable row. Hidden reasoning is never
rendered. Agents may provide a concise `label` such as “Reviewed release
boundaries” for completed reasoning. The localized `reasoning` label remains
the active/default fallback. Activities describe safe execution evidence
instead of exposing private chain-of-thought.

## Slash discovery

AgentKit exposes slash discovery without inventing product semantics:

```tsx
<AgentKitComposer
  slashCommands={productCommands}
  slashSkills={workspaceSkills}
  includeDefaultSlashCommands={false}
  includeDefaultSlashSkills={false}
  onSlashCommand={(command) => commands.execute(command)}
/>
```

Omit unavailable commands and skills. Empty integration or skill states are not
injected into the conversation.

## Semantic styling

The standalone stylesheet uses semantic host tokens and exposes focused
overrides:

- `--agentkit-chat-background`
- `--agentkit-composer-background`

Components inherit host foreground, muted, border, primary, destructive,
success, focus, and radius tokens. Composer, overlay, and control depth use the registered
`--agent-kit-*-elevation` semantic tokens and fall back to no shadow. No product
palette is embedded in the package.

## Configure, compose, and source ownership

Start with labels, callbacks, `composerProps`, semantic tokens, slots, and
registries. Compose a custom view with `AgentKitRoot` and the headless hooks when
region replacement is not enough. If that composition needs app-owned Toolkit
source, inspect `agent-native eject --list` and eject the smallest listed unit,
such as `toolkit/composer`.

AgentKit React does not publish an AgentKit-wide ejection unit. Do not copy its
private source or create a second controller to customize presentation. An
ejected Toolkit region is app-owned, while AgentKit state and Agent-Native
runtime, action, context, and security contracts remain package-owned.
