# @agent-native/agentkit

## 0.2.9

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.20.9

## 0.2.8

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.20.8

## 0.2.7

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [2427195]
- Updated dependencies [d43305d]
- Updated dependencies
  - @agent-native/toolkit@0.20.7

## 0.2.6

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [e973e00]
  - @agent-native/toolkit@0.20.6

## 0.2.5

### Patch Changes

- 93d3a58: Restore bullet and ordered-list markers in rendered AgentKit Markdown content.
- 93d3a58: Add an inline message action transition for copying the server request ID from AgentKit responses.
- 93d3a58: Keep AgentKit chat streams causally ordered across refreshes and settle streamed work when runs complete, fail, or cancel.
- Release all public npm packages with a patch version bump.
- 15ec2fb: Keep chat lifecycle state and queue rows clear of stale UI overlap, and reserve space for the share dialog close control.
- 93d3a58: Settle AgentKit assistant messages at terminal boundaries and preserve queue mutation intent across overlapping requests.
- Updated dependencies [58b0779]
- Updated dependencies [3ecc476]
- Updated dependencies
- Updated dependencies [15ec2fb]
  - @agent-native/toolkit@0.20.5

## 0.2.4

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [5ede9f7]
- Updated dependencies
- Updated dependencies [ffafd84]
- Updated dependencies [424d0cd]
  - @agent-native/toolkit@0.20.4

## 0.2.3

### Patch Changes

- 901376b: Keep composer controls balanced, keep popovers within the viewport, and prevent first-run prompts from racing model authentication.
- Release all public npm packages with a patch version bump.
- Updated dependencies [901376b]
- Updated dependencies [b35949b]
- Updated dependencies [116c315]
- Updated dependencies
  - @agent-native/toolkit@0.20.3

## 0.2.2

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [c9cb7de]
  - @agent-native/toolkit@0.20.2

## 0.2.1

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [9f08f5d]
- Updated dependencies [cd40555]
- Updated dependencies [1f43d89]
- Updated dependencies [25dc407]
- Updated dependencies [e32e1d5]
- Updated dependencies
- Updated dependencies [657bba1]
- Updated dependencies [25dc407]
- Updated dependencies [6ba23d3]
  - @agent-native/toolkit@0.20.1

## 0.2.0

### Minor Changes

- 210c7d0: **Breaking (pre-1.0):** AgentKit protocol v2 intentionally rejects v1-only
  peers because the AG-UI envelope is not wire-compatible with the original
  Builder envelope. Upgrade the AgentKit client and server together, then rerun
  transport conformance before deploying a custom adapter. The deprecated
  `resolveApproval` API remains only as a source-compatibility bridge after both
  peers are on v2.

  Carry AgentKit runs over the AG-UI wire format instead of a Builder-only
  envelope. Overlapping events map onto native AG-UI event types, and the
  Builder-specific events travel as a versioned typed extension profile over
  `CUSTOM`, so a stock AG-UI client can read the stream while AgentKit consumers
  still receive fully typed domain events. Sequencing, replay cursors, and profile
  version negotiation are defined as explicit extensions because AG-UI specifies
  none of them. Approvals now use AG-UI's interrupt model: the Core transport
  exposes `resumeRun` with `resume` entries in place of `resolveApproval`. An
  approval interrupt terminally closes its protocol run, and `resumeRun` returns
  the distinct replacement run that carries the resolution and continued work.

- 210c7d0: Introduce AgentKit as one public package with subpath exports for the protocol,
  headless client, HTTP transport, transport conformance, and React runtime
  (`@agent-native/agentkit`, `/protocol`, `/http`, `/conformance`, `/react`, and
  `/react/*`), where the root and `/http` entries stay React-free; a
  versioned, provider-neutral protocol; validated messages, runs, capabilities,
  approvals, activities, smart objects, uploads, actions, participants, tasks,
  custom content, and durable thread snapshots; and typed compatibility,
  cancellation, and error semantics. Add the headless client, resumable HTTP and
  SSE adapters, executable transport conformance, and composable React provider,
  hooks, slots, registries, semantic UI, safe streamed Markdown, run recovery,
  host-aware copy confirmation, capability-gated feedback and forking with
  visible mutation state, and durable queued-message promotion.
  Add typed, replay-safe contextual connection requests with host-controlled
  setup, retry, decline, and resumable-run handling.
  Choice prompts now offer a focused custom response by default, preserve that
  answer separately from predefined option ids across transports, and let hosts
  disable the affordance for deliberately constrained workflows.
  Completed activity groups now collapse to a duration-aware “Worked for…” row
  while preserving their expandable action history.
  Execution segments now settle at the first visible assistant output rather than
  the terminal run event, so response streaming time is not counted as working
  time and hidden reasoning does not prematurely end the work phase.
  Active execution segments now expose a duration-aware “Working for…” spine and
  cluster consecutive equivalent default tool activity without discarding trace
  detail or overriding host renderers.
  The entire chat frame now owns transcript scrolling while the inner transcript
  retains its constrained reading measure, so wheel input works from either gutter.
  Activity traces now share a protocol-level semantic taxonomy, render distinct
  icons for searches, reads, edits, commands, checks, MCP calls, connections,
  navigation, delegation, and approvals, and give the run-level work spine its own
  identity instead of presenting every operation as a generic tool.
  Run startup now becomes active before the first streamed event arrives, keeping
  rapid follow-ups in the durable queue instead of launching overlapping runs.
  Transcript following ignores queue-only state churn, follows queue-driven
  viewport resizing, distinguishes programmatic scrolls from deliberate history
  navigation, and avoids redundant scroll writes during sustained streamed
  output.
  Chat shells can now preserve accepted AgentKit runs across thread navigation,
  observe typed per-thread lifecycle state in surrounding chrome, show background
  activity in rails, and surface a newly submitted conversation before durable
  history catches up.
  Host chrome now distinguishes active execution from the pre-response working
  phase, so progress indicators settle when visible assistant output begins while
  queueing and cancellation remain active through the terminal event.
  Core and AgentKit now share one animation-frame-paced streaming primitive with
  adaptive backlog draining, incremental grapheme segmentation, reduced-motion
  support, background-tab catch-up, and stable memoized Markdown blocks, avoiding
  chunk dumps and whole-response reparsing during long answers.
- 210c7d0: Ship AgentKit as one package with subpath exports for the protocol, headless
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

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [210c7d0]
- Updated dependencies [743039f]
- Updated dependencies [bd3e96e]
- Updated dependencies [b83d472]
- Updated dependencies [875f793]
- Updated dependencies [97564cd]
- Updated dependencies [64e6346]
- Updated dependencies [64e6346]
- Updated dependencies [a30a54d]
- Updated dependencies [587297c]
- Updated dependencies
- Updated dependencies [210c7d0]
- Updated dependencies [7a9238c]
- Updated dependencies [ccad889]
  - @agent-native/toolkit@0.20.0
