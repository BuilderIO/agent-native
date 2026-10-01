# @agent-native/agentkit

## 0.199.0

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.198.8

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.198.7

### Patch Changes

- Release all public npm packages with a patch version bump.
- 3ba09b7: Copy complete Visual Edit instructions by default and show Builder.io for Builder credit connections.

## 0.198.6

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.198.5

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.198.4

### Patch Changes

- 85a87e6: Split ChatFirst navigation from its pane bundle, preserve queued chat intent through provider preparation, and keep client-only SSR stubs constructible.
- Release all public npm packages with a patch version bump.
- 20d3bb8: Retry automatic queued message promotion when the run slot remains occupied.

## 0.198.3

### Patch Changes

- Release all public npm packages with a patch version bump.
- ce1245c: Preserve queued chat intent through asynchronous preparation and resumed runtime streams.

## 0.198.2

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.198.1

### Patch Changes

- 0b127e9: Clear chat input immediately on submit and show the pending response status in the transcript.
- Release all public npm packages with a patch version bump.

## 0.198.0

### Minor Changes

- afbee14: Move runtime-backed React surfaces and generated source corpus out of Core's default package path, and move AgentKit's React entrypoints to Toolkit in a breaking AgentKit release. Follow the [Core 0.198.0 upgrade guide](https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-core-ui.mdx) when updating an existing app or consuming AgentKit directly.

### Patch Changes

- 8853f61: Keep reasoning inside collapsed work history, align disclosure chevrons with their labels, and tighten progress spacing. Show elapsed time once on the work summary instead of repeating the full run duration on each thought.
- 8853f61: Render model-authored follow-up suggestions only for the latest successfully completed turn, retire stale suggestions across new turns and restores, and submit full suggestion prompts through normal context and permission checks. Keep initial empty-state starters separate from conversational follow-ups.

  Pass the active thread ID to fullscreen callbacks instead of a menu selection event.

- 8853f61: Clear shared chat composers when AgentKit owns the recoverable user message instead of waiting for the agent request to start. Preserve newer drafts, explicit send failures, and queued-message acknowledgement timing without sending local callbacks to transports or persisted submissions.
- 8853f61: Show catalog integration badges throughout live and expanded agent activity, retaining provider identity while tools run and keeping activity from different providers in separate groups.
- Release all public npm packages with a patch version bump.
- 8853f61: Collapse run activity by default, keep the latest active step visible, and group expanded history by purpose.
- 8853f61: Preserve completed runs when history refresh or stream closure fails, honor resolved approvals during hydration, keep connection continuations responsive, and expose tool, approval, and cancellation failures. Reject retained attachments if standalone upload access is withdrawn instead of silently dropping files. Reset chat disclosures across threads, preserve host composer gates, recognize streamed provider arguments, and contain long transcript content. Integrate thread- and account-scoped app composer context with exact revalidation, active-surface checks, and accepted-only cleanup while preserving ambient context, composer mode instructions, and full menu defaults.

## 0.5.1

### Patch Changes

- f2e8ffe: Center empty chat composers correctly and make send buttons circular across shared chat surfaces.
- Release all public npm packages with a patch version bump.
- 57e0a0f: Preserve live assistant messages through stale thread snapshots and reconcile terminal run status without skipping events.
- 82ad87c: Publish the current AgentKit runtime exports required by Core's chat surface.
- Updated dependencies [f2e8ffe]
- Updated dependencies [023ee9b]
- Updated dependencies [47985fe]
- Updated dependencies
- Updated dependencies [fa62fdf]
  - @agent-native/toolkit@0.23.1

## 0.5.0

### Minor Changes

- 108074a: Standardize full-page AgentKit chat homes and restore the Dispatch workspace app launcher.

### Patch Changes

- 7af9d3f: Refine AgentKit activity labels, approval details, and shared action cards.
- Release all public npm packages with a patch version bump.
- 230c5f0: Use the shared dropdown menu for message actions, matching chat menu styling and keyboard behavior.
- Updated dependencies
- Updated dependencies [a20f0b4]
  - @agent-native/toolkit@0.23.0

## 0.4.1

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [880740b]
- Updated dependencies [55c9666]
- Updated dependencies [55c9666]
- Updated dependencies
  - @agent-native/toolkit@0.22.3

## 0.4.0

### Minor Changes

- d462819: Move framework chat surfaces to AgentKit while preserving chat history, recovery, context, attachments, model selection, runs, and message actions. This removes the old assistant-ui transcript and stream owners, the `AssistantChat.createAdapter` prop, the public `AssistantMessageActionBar` export, and the adapter APIs `createAgentChatAdapter`, `createCodeAgentChatAdapter`, `createAgentChatRuntimeAdapter`, `codeAgentTranscriptEventsToContent`, and `codeAgentTranscriptHasPendingApproval`, plus their adapter-only options and event types. Use AgentKit `runtime` or `createTransport` for custom chat implementations.

### Patch Changes

- Release all public npm packages with a patch version bump.
- ed3801e: Remove nonessential source comments.
- Updated dependencies [d462819]
- Updated dependencies [797b3e2]
- Updated dependencies [e76947b]
- Updated dependencies
- Updated dependencies [adc7497]
- Updated dependencies [797b3e2]
- Updated dependencies [ed3801e]
- Updated dependencies [e7b6fcc]
- Updated dependencies [e76947b]
- Updated dependencies [2397f94]
  - @agent-native/toolkit@0.22.2

## 0.3.1

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [7e8a10a]
- Updated dependencies
  - @agent-native/toolkit@0.22.1

## 0.3.0

### Minor Changes

- 39a89d0: Add connected cascading composer context menus with declarative search, list, link, loading, error, retry, and pagination behavior, plus persistent footer actions for existing links or modal workflows. Apps register authorized data loaders or local choices instead of rebuilding picker views. Allow host file-staging adapters through PromptComposer and AgentKitComposer while preserving shared upload controls and attachment chips, with an opt-out from ordinary text-file inlining when the host already extracts those files. Document scope resets and source-version refreshes, with localized defaults in every supported locale.
- 39a89d0: Add opt-in hierarchical composer context menus, attachment status and recovery controls, bounded immutable context snapshots, and a shared quick-start submission handle. AgentKit awaits a beforeSend hook and carries the same context metadata through immediate and queued submissions. Composer drafts, files, and context can be staged before provider setup while submission remains gated; hosts can use `submissionDisabled` without disabling staging.
- 39a89d0: Add declarative context dialogs for URL attachment and paginated multi-selection, with validation, cancellation, batch callbacks, and localized shared controls. Expose the additive picker configuration through AgentKit while preserving existing submenu pickers.

  Add read-only website composer source requests and the server-side readComposerWebsiteSource helper. Website references retain bounded extraction status, warnings, rendering provenance, and explicit truncation, while failed extraction remains an error.

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [dbb10d5]
- Updated dependencies [39a89d0]
- Updated dependencies [39a89d0]
- Updated dependencies [39a89d0]
- Updated dependencies [39a89d0]
- Updated dependencies
- Updated dependencies [39a89d0]
- Updated dependencies [39a89d0]
- Updated dependencies [39a89d0]
  - @agent-native/toolkit@0.22.0

## 0.2.13

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [6ff4d47]
  - @agent-native/toolkit@0.21.3

## 0.2.12

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [2ba6541]
  - @agent-native/toolkit@0.21.2

## 0.2.11

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.21.1

## 0.2.10

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [21fdd86]
- Updated dependencies [4917d34]
- Updated dependencies
- Updated dependencies [ac01083]
- Updated dependencies [21fdd86]
- Updated dependencies [185e25d]
  - @agent-native/toolkit@0.21.0

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
