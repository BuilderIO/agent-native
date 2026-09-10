---
"@agent-native/agentkit": minor
"@agent-native/core": patch
---

Ship AgentKit as one package with subpath exports for the protocol, headless
client, HTTP transport, conformance harness, and React runtime. The root and
`/http` entries stay React-free, and an import-graph test fails with the
offending file and specifier if that regresses.

Gate capability-dependent UI on descriptors instead of the boolean projection.
A capability the backend never reported is now `unknown` rather than
indistinguishable from one it denied, `degraded` renders and surfaces its
reason, and `unavailable` renders disabled, so a control is never offered that
the client will reject or hidden when it would have worked.

Report the four stream integrity failures a host cannot otherwise see —
sequence gaps, duplicate events, runs that end without a terminal event, and
queued follow-ups that are never promoted — through `onIntegrityReport`, which
Agent-Native surfaces wire with `createAgentKitIntegrityReporter(surface)`.

Remove the aliases that shipped a second way to do the same thing: `resumeRun`,
`AgentThreadState.activeRunId`, `AgentTransport.getCapabilities`, the `error`
render slot, and the thread scope's `resume`. Use `resubscribeRun`,
`activeRunIds`, `discoverCapabilities`, `connectionError`, and `resubscribe`.

Report `resumableRuns` as unsupported rather than degraded on the Agent-Native
adapter. Replay is process-local and bounded by `x-run-replay-retention`;
restart-safe resumption needs a durable event transport the adapter does not
own.
