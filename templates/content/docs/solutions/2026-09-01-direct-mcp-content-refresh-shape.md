# Direct MCP Content edits should refresh an open page

## Answer

Yes, a successful mutating MCP call should cause an already-open Content page
to refresh without another gesture. The missing operation is not a browser
cache flush and should not be implemented as one. Direct MCP dispatch should
publish the same durable `action` change notification already published after
successful browser Action calls, CLI Action calls, and in-app agent tool calls.
The existing client synchronization layer should then invalidate its active
Action queries and let the collaborative editor reconcile the newer document.

The observed “it updates when I click the page” behavior is consistent with a
missing change notification: focusing the embedded page forces `useDbSync()` to
poll immediately, and that fallback can discover the committed SQL change. The
click is therefore a wake-up signal, not the intended consistency mechanism.
This causal account is strongly supported by current source, but the exact live
ChatGPT in-app-browser request has not been traced in this Shape and remains a
Work-stage reproduction requirement.

## Human problem

A person can watch a Page while an external agent edits that same Page through
Content's MCP server. The MCP tool reports success, but the visible Page keeps
showing the old text until the person clicks into the browser. That makes a
committed agent change look lost or delayed and violates the promise that
people and agents work on the same live object through one Action surface.

## Product context

- Feature: `content.feature.review-changes-in-place`.
- Capabilities: `content.agent.action-parity` and
  `content.author.document-editor`.
- Workflow: keep a Content Page open in ChatGPT's in-app browser, have an
  authorized external agent edit its body through the direct Content MCP tool,
  and see the committed text appear without click, focus, or reload.
- Classification: contract repair. This preserves the existing one-Action and
  live-sync contracts; it does not create a new product promise.

## Architecture grounding

### Demonstrated caller and request

The demonstrated caller is an external agent invoking a mutating Content
Action such as `edit-document` through the hosted MCP `tools/call` handler while
the same document is open in ChatGPT's embedded browser. `edit-document`
declares `mcpTool: true`, is not read-only, and tags this route as caller
`"mcp"`.

### Direct evidence

1. `packages/core/src/mcp/build-server.ts` executes direct MCP tools by calling
   `entry.run(..., { caller: "mcp", actionName: name })`. After a successful
   result, that dispatch path does not call `notifyActionChange` or
   `notifyActionChangeInBackground`.
2. `packages/core/src/server/action-routes.ts` publishes
   `notifyActionChange(...)` after every successful non-read-only Action route.
3. `packages/core/src/agent/production-agent.ts` publishes
   `notifyActionChangeInBackground(...)` after every successful non-read-only
   agent tool call.
4. `packages/core/src/scripts/runner.ts` also publishes an Action change after
   successful mutating CLI execution.
5. `packages/core/src/client/use-db-sync.ts` immediately polls when the browser
   window receives focus. It also consumes Action-change events and invalidates
   relevant React Query caches.
6. `templates/content/app/hooks/use-db-sync.ts` mounts that shared transport and
   includes `action` among Content's invalidation keys.
7. `templates/content/app/components/editor/DocumentEditor.tsx` treats the SQL
   document's `updatedAt` as a freshness watermark and uses the shared
   collaborative-document transport for the body.
8. `.agents/skills/real-time-sync/SKILL.md` states the intended contract:
   mutating Actions auto-emit `source: "action"`; UIs should not require an
   agent to call `refresh-screen` after normal mutations.

### Inferences to verify

- The missing MCP-side Action notification is the first broken boundary in the
  reported path.
- The user's click focuses the embedded browser and invokes `handleFocus ->
pollNow`, after which the fallback database scan or durable event replay
  detects the document change.
- Once the MCP dispatch publishes the normal event, Content's active
  `get-document` query and collaborative editor will adopt the newer body
  without a second Content-specific invalidation.

These are high-confidence inferences, not a current live trace. Work must record
the MCP request, returned success, emitted sync event, client receipt/refetch,
and visible editor reconciliation to identify the first failing step.

### Ownership boundaries

- The Content Action owns the authorized document mutation and committed SQL /
  collaboration state.
- The MCP dispatcher owns lifecycle behavior common to direct MCP execution,
  including emitting the same post-success mutation signal as other Action
  callers.
- Core Action-change and `useDbSync` infrastructure own cross-process delivery,
  polling fallback, and query invalidation.
- Content's document query and collaborative editor own adoption of the newer
  authoritative value.
- The ChatGPT host owns embedding and focus; it must not be required to repair
  application consistency with a synthetic click.

### Legacy contracts to preserve

- Read-only MCP tools emit no mutation event.
- Failed or approval-pending MCP calls emit no success-shaped refresh event.
- MCP authorization, caller identity, organization scope, approval, audit, and
  result rendering remain unchanged.
- Browser, CLI, in-app agent, A2A, and WebMCP Action paths keep their existing
  behavior and do not receive duplicate notifications.
- Refresh signaling remains best effort and cannot turn a committed mutation
  into a reported failure if marker persistence fails.
- Collaborative edits still use their current `updatedAt` / Yjs reconciliation
  rules; no full page reload or editor remount is introduced.

### Smallest compatible delta

At the direct MCP dispatch boundary, after an Action has completed successfully
and only when `actionCallIsReadOnly(...)` says it is mutating, publish the
existing Action-change notification with the verified MCP caller's owner and
organization context. Use the established background/durable notification
semantics so refresh publication cannot change the mutation result.

If the live trace shows that this notification is already arriving, stop and
repair the next demonstrated boundary instead: durable marker replay, client
event delivery, Action-query invalidation, document refetch, or collaborative
editor reconciliation. The evidence does not authorize stacking a second
special case on top of an unverified cause.

### Explicit exclusions

- No MCP-specific cache, event type, refresh tool, browser message, or click
  simulation.
- No blanket React Query invalidation, full page reload, shortened global poll
  interval, or extra `EventSource`.
- No notification inside `edit-document` or `update-document`; that would
  duplicate lifecycle behavior across callers and omit sibling MCP Actions.
- No schema, migration, Action contract, authorization, or collaboration model
  change.
- No claim that a source-level repair is deployed or accepted in ChatGPT's
  in-app browser.

## Successful-user-story acceptance

Story `content-direct-mcp-open-page-refresh-v1`:

> Given Alice has an editable Content Page open in ChatGPT's in-app browser and
> an authorized external agent can access that exact Page through Content MCP,
> when the agent successfully changes a unique body string with the direct
> `edit-document` tool, then the open Page shows the committed replacement
> without click, focus, navigation, or reload; a read-back returns the same
> value; no duplicate save overwrites it; and a failed or read-only MCP call
> causes no false mutation refresh.

Required proof:

1. An automated MCP dispatcher test proves one successful mutating direct MCP
   call publishes one correctly scoped Action change, while read-only, failed,
   unknown, forbidden, and approval-pending calls publish none.
2. Existing Action-route, CLI, in-app tool-call, poll replay, and Content sync
   tests remain green, proving the change does not duplicate or weaken sibling
   paths.
3. A real-interface test uses one uniquely marked disposable Page in the
   intended hosted Content environment and the actual ChatGPT in-app browser.
   Capture the visible old text, invoke direct MCP without interacting with the
   Page, and capture the visible replacement plus exact MCP read-back.
4. Instrumentation for that run establishes the causal chain: mutation commit,
   Action-change publication, browser receipt, query/collab reconciliation.
   The test must fail if a click or focus event is required.
5. Restore or delete the disposable Page and independently verify cleanup.

Acceptance policy:

- Modality: `real-interface`.
- Independence: `preferred`.
- Custody: `same-context-allowed`.
- Interface: the hosted Content MCP server and Content Page embedded in
  ChatGPT's in-app browser.
- Rationale: the bug is specifically an interaction between a remote mutation,
  cross-process event delivery, and an embedded browser's focus lifecycle;
  unit tests alone cannot prove the reported experience.

## Frozen direction

- Outcome: an open Content Page reflects a successful direct MCP edit without
  user interaction.
- Shipping surface: `BuilderIO/agent-native`, shared MCP Action dispatch and
  Content live editor, for people supervising external-agent edits; durable
  destination is the Agent-Native framework and Content template integrated by
  merge.
- Governing architecture: all Action callers converge on the shared
  post-success Action-change signal; Content consumes that signal through its
  existing sync/query/collaboration boundaries.
- Acceptance: story `content-direct-mcp-open-page-refresh-v1` above.
- Risk strategy: `system-ready`; production validation after merge is required
  because the acceptance interface is hosted ChatGPT plus hosted Content MCP.

## Shape boundary

This artifact authorizes no implementation, branch operation, commit, push,
pull request, deployment, publication, or merge. The natural next stage is
`/work` against this exact frozen direction.
