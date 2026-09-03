# AgentKit Conformance

Executable invariants for custom and remote AgentKit transports. The suite
checks capability discovery, stable identity, runtime validation, unique event
identity, contiguous sequence, explicit terminal semantics, declared reconnect
replay, and run and thread snapshots without tying hosts to a test runner. When
a stream emits annotation, widget, or task-group lifecycle events, conformance
also proves replay idempotency and agreement with the thread snapshot.

Run `assertAgentTransportConformance()` against every first-party adapter and
in deployment smoke tests for remote implementations:

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
- **createTransport**: a factory that creates an isolated transport for each
  full-profile scenario. Conformance owns every returned transport, awaits its
  optional `dispose()` method, and disposes it even when a check fails.
- **threadId**: an optional stable thread id for the run.
- **messages**: optional seed messages. The default requests a short
  acknowledgement.
- **timeoutMs**: an optional per-operation timeout. The default is 2,000 ms.
- **isUnsupportedError**: an optional predicate for a host's typed unsupported
  error.

The baseline `transport` form is borrowed. Conformance never disposes it; the
caller retains lifecycle ownership.

Use the factory form for adapter release gates that must prove cancellation,
abort, reconnect, cross-thread isolation, approval, queue, and terminal-failure
behavior:

```ts
const report = await assertAgentTransportConformance({
  createTransport: (scenario) => testBackend.createTransport({ scenario }),
  timeoutMs: 5_000,
});
```

The returned report includes the profile, run id, baseline and scenario event
counts, negotiated capabilities, and completed checks. Optional checks follow
the transport's declared capabilities. A transport must not advertise a
capability it cannot prove.
