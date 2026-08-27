# Expose Content comment actions through MCP — Shape

## Answer

An authenticated external agent could read and edit the Content document in
task `01a04455-42b8-7be0-b401-f272ae688661`, but it could not discover or call
the actions needed to read, reply to, or resolve the document's comments. The
agent therefore fell back to `ask_app`, which failed separately with `Missing
Authentication header` and left Alice's request unfinished.

The smallest compatible repair is to add the existing `list-comments`,
`add-comment`, and `update-comment` actions to Content's curated MCP catalog.
Those actions already own comment reads, replies, resolution, SQL persistence,
and document access checks. Work must not add parallel comment routes, wrapper
tools, or an MCP-only comment model.

## Evidence

- The referenced Codex task successfully called Content MCP document actions,
  then found no direct comment action through `tool-search` and used `ask_app`.
- `ask_app` returned `Missing Authentication header`. Because direct MCP reads
  had already succeeded, this is evidence of a downstream delegated-agent
  authentication failure, not failure of the caller's Content MCP connection.
- Content already defines `list-comments`, `add-comment`, and `update-comment`
  with `defineAction()` under `templates/content/actions/`.
- `list-comments` requires viewer access to the document; `add-comment`
  requires commenter access; resolving or reopening through `update-comment`
  requires editor access.
- Merged commit `abf0a5f178d72cb77a0003a0e3520d0b04a83936` moved Content's
  compact MCP membership beside each action with `mcpTool: true`, enabled
  allowlisted direct writes, and added a focused catalog contract test. Its
  curated set includes document actions but not the three comment actions.
- The approved `content.comment.page-owned` capability says replies and
  resolution use shared Actions and retain Page authority. Content's
  architecture likewise requires people, agents, APIs, and the UI to share one
  Action surface and access model.

## Inferences

- The direct failure is a catalog-membership omission, not a missing comment
  subsystem. Projecting the existing actions should make the workflow callable
  without invoking a model or durable agent-to-agent run.
- The current action names are sufficient. Creating separate
  `list-comment-threads`, `reply-to-comment-thread`, and
  `resolve-comment-thread` actions would duplicate the existing orthogonal
  action surface unless real-interface acceptance exposes a contract gap that
  cannot be fixed compatibly.
- The action descriptions may need small clarification so an external caller
  can select exact document, comment, and thread identifiers safely. That is an
  implementation detail inside this shape, not a new product contract.

## Uncertainties

- Current source proves action and catalog structure, not that the deployed
  beta MCP will expose and execute the repaired catalog after integration.
- `update-comment` resolves a thread by one comment ID and accepts an optional
  document ID. Work must exercise stale or mismatched IDs and preserve the
  current fail-closed document check; if the real workflow reveals ambiguity,
  it may tighten validation without inventing a parallel action.
- The delegated `ask_app` credential defect still needs its own diagnosis and
  acceptance story. It is not required for direct comment management.

## Recommendation

Treat this as a contract repair for
`content.feature.collaborate-in-context` / `content.comment.page-owned`:

1. Declare `mcpTool: true` on `list-comments`, `add-comment`, and
   `update-comment`.
2. Extend the existing Content MCP action contract test to keep all three in
   the curated catalog and to distinguish the read from the two writes.
3. Preserve the existing `defineAction()` implementations, access checks,
   dispatcher, audit behavior, error sanitization, and UI refresh path.
4. Add only focused action tests needed to prove safe external selection,
   mismatched document/comment refusal, reply behavior, idempotent resolution,
   and unchanged sibling threads.
5. Exercise the successful-user story through a real MCP client against an
   exact-artifact local Content runtime, verify the same state in the Content
   UI, then monitor the automatic beta deployment and repeat the bounded
   discovery/read/write verification there.

Explicitly exclude new REST routes, a separate MCP comment schema, comment
storage or anchor redesign, Discussion, Notion comment synchronization, public
anonymous comment tools, and repair of delegated `ask_app` authentication.

## Successful-user story

As an authenticated Content MCP user with access to a document, I can discover
and directly call the shared comment actions to inspect unresolved feedback,
edit the document, reply to the exact thread, resolve it, and verify that the
Content UI shows the same result—without browser automation or an `ask_app`
hop.

Required assertions:

1. MCP discovery returns `list-comments`, `add-comment`, and `update-comment`
   with usable schemas and read/write classification.
2. `list-comments` returns all comments and thread identifiers for an
   accessible task-owned document, including anchor, author, reply, resolution,
   and timestamp fields already stored by Content.
3. The client can use `get-document` and `edit-document`, add a reply to one
   exact thread, resolve that thread, and re-list comments to observe the new
   reply and resolved state.
4. An unrelated thread and unrelated document content remain unchanged, and
   the Content UI presents the same comment state after reload.
5. Repeating the resolve call is idempotent; a mismatched document/comment pair
   and an unauthorized caller fail closed without mutating comment state.
6. The direct path invokes registered actions through the authenticated MCP
   dispatcher and does not invoke `ask_app`, an app-agent callback, or another
   model runtime.
7. Focused tests pass on the exact artifact, and the automatic beta deployment
   is monitored before the task is called delivered on beta.

Acceptance policy:

- Modality: `real-interface`
- Independence: `preferred`
- Custody: `same-context-allowed`
- Interface: a real external MCP client plus the Content UI, first against an
  exact-artifact isolated local Content runtime and then as a bounded beta
  deployment verification.
- Rationale: unit tests can prove catalog policy and dispatch, but only the real
  client and UI together prove that discovery, authenticated writes, persisted
  thread state, and user-visible parity work as requested. The operations are
  routine document collaboration mutations on a task-owned fixture, so
  same-context custody is proportionate.

## Architecture constraints

- Demonstrated caller: Codex task `01a04455-42b8-7be0-b401-f272ae688661`
  requesting `Resolve the comments` for Content document `7RMCKJJN0u5q`.
- Existing primitives: Content `defineAction()` registry; per-action
  `mcpTool`; compact connector catalog; `externalAgents.writes: allowlisted`;
  authenticated MCP dispatcher; `assertAccess`; `document_comments`; UI action
  hooks and refresh signaling.
- Ownership boundaries: Content owns comment semantics and document access;
  core owns MCP catalog policy, authentication, approval, dispatch, audit, and
  sanitized error transport; the app agent owns only open-ended delegated
  reasoning through `ask_app`.
- Legacy contracts: the in-app agent and UI retain their current action names
  and behavior; viewer/commenter/editor boundaries remain unchanged; personal
  and organization document scoping remain enforced; non-comment MCP actions
  and `ask_app` behavior remain unchanged.
- Smallest compatible delta: curate the three existing Content comment actions
  for direct authenticated MCP calls and extend focused catalog/action proof.
- Deferred capabilities: richer pagination and status filters; new thread APIs;
  multi-Block anchor redesign; Discussion; delegated-agent credential repair.
- Reversibility: catalog flags, descriptions, and focused tests are removable
  without schema, data, route, or persisted-format migration.
- Unresolved owner questions: none. Current architecture and the approved
  capability already settle the shared Action boundary.

## Lifecycle envelope

```yaml
authoritySchemaVersion: 3
stage: shape
authority-source: "Alice: $shape a fix for the problems that this thread is running into: codex://threads/01a04455-42b8-7be0-b401-f272ae688661"
authorized-scope:
  repositories:
    - BuilderIO/agent-native
  product-surfaces:
    - Content authenticated MCP comment workflow
  outcome: Let authenticated external agents manage Content comments through the existing shared actions without ask_app or browser fallback.
allowed-mutations:
  - artifact-write
write-targets:
  artifacts:
    - templates/content/docs/solutions/2026-08-27-content-comment-actions-mcp-shape.md
  prototype-sandboxes: []
test-resources: []
governing-artifact:
  path: templates/content/docs/solutions/2026-08-27-content-comment-actions-mcp-shape.md
  revision: content-comment-actions-mcp-shape-v1
architecture-fingerprint:
  outcome: Let authenticated external agents manage Content comments through the existing shared actions without ask_app or browser fallback.
  shipping-surfaces:
    - id: content-comment-actions-mcp
      repository: BuilderIO/agent-native
      product-surface: Content authenticated MCP action catalog and dispatcher
      constituency: authenticated external agents acting for Content users with document access
      durable-destination: public Content template behavior in BuilderIO/agent-native
      integration-action: merge
  governing-architecture: Content's existing defineAction comment operations remain the single source of truth and are projected through core's authenticated curated MCP catalog and dispatcher.
  acceptance-story:
    id: content-comment-actions-mcp-v1
    summary: An authenticated external agent directly reads, replies to, resolves, and verifies a task-owned Content comment thread while the UI shows the same state and no ask_app hop occurs.
    required-assertions:
      - MCP discovery exposes list-comments add-comment and update-comment with usable schemas and correct read-write classification
      - a permitted caller can list comment and thread state then reply and resolve one exact thread through direct actions
      - re-list and UI reload show the same persisted reply and resolution while unrelated state remains unchanged
      - repeat resolution is idempotent and mismatched or unauthorized access fails closed
      - direct execution retains authenticated dispatcher access audit error and refresh behavior and never invokes ask_app or a model runtime
      - focused exact-artifact tests and real-interface local MCP plus UI acceptance pass
      - automatic beta deployment is monitored and bounded discovery read and write verification passes before beta delivery is claimed
    acceptance-policy:
      modality: real-interface
      independence: preferred
      custody: same-context-allowed
      interface: Real external MCP client and Content UI against an isolated exact-artifact local runtime, followed by bounded beta deployment verification.
      rationale: The failure is cross-surface discovery and authenticated persistence; focused tests plus a real client and UI are proportionate, while independent custody is useful but not part of the user story.
  risk-strategy:
    kind: system-ready
    production-validation-after-merge: false
architecture-grounding:
  applicability: required
  reason: The repair crosses Content-owned Actions and core-owned external-agent catalog and dispatch policy.
  status: grounded
  demonstrated-callers:
    - Codex task 01a04455-42b8-7be0-b401-f272ae688661 resolving comments on Content document 7RMCKJJN0u5q.
  existing-primitives:
    - Content list-comments add-comment and update-comment defineAction operations
    - action-owned mcpTool catalog membership
    - core compact connector catalog and authenticated dispatcher
    - Content externalAgents writes allowlisted policy
    - assertAccess and document_comments persistence
  ownership-boundaries:
    - Content owns comment contracts persistence and document permissions
    - core owns MCP discovery authentication policy dispatch audit approvals and error transport
    - ask_app owns open-ended delegated reasoning and is not required for bounded comment state
  legacy-contracts:
    - existing UI and in-app agent action behavior and names
    - viewer commenter and editor access thresholds
    - personal and organization workspace document scoping
    - existing non-comment MCP and ask_app behavior
  shared-vocabulary:
    - direct comment actions means list-comments add-comment and update-comment through authenticated MCP dispatch
    - reply means add-comment with an existing thread identifier
    - resolve means update-comment on a comment whose thread receives the resolution state
  smallest-compatible-delta: Mark the three existing comment actions as curated MCP tools, clarify their external schemas if needed, and extend focused catalog and behavior tests.
  deferred-capabilities:
    - new comment-thread-specific action family
    - pagination and status-filter product expansion
    - comment anchor or storage redesign
    - Discussion and Notion synchronization
    - ask_app delegated credential repair
  reversibility: No schema or persisted-format change; the delta is limited to action metadata descriptions and focused tests.
  direct-evidence:
    - referenced Codex task transcript
    - repository HEAD b8e7d97c67ba5df596d74f3c1846cad46f041c4d
    - merged direct MCP action repair abf0a5f178d72cb77a0003a0e3520d0b04a83936
    - templates/content/actions/list-comments.ts
    - templates/content/actions/add-comment.ts
    - templates/content/actions/update-comment.ts
    - templates/content/actions/mcp-action-contract.spec.ts
    - templates/content/docs/product/capabilities/content.comment.page-owned.md
  inferences:
    - catalog omission is the direct cause of the missing semantic path
  unresolved-owner-questions: []
delegation-ceiling:
  - artifact-write
product-boundary-gates:
  agent-native-public-constituency: Any authenticated Content user can delegate comment review through MCP using ordinary document permissions; no Alice-private data credentials or orchestration are required.
  bowerbird-product-boundary: not-applicable
acceptance-state:
  status: pending
  summary: Shape is complete; implementation and exact-artifact real-interface proof have not begun.
  blockers: []
  last-land-packet: null
ledger-revision: content-comment-actions-mcp-shape-v1
status: active
```

## Work handoff

Execution placement: local. The expected implementation is a small Content
action-metadata and focused-test change. Work should create an isolated local
Content document/comment fixture and clean it after acceptance; it must not use
or mutate Alice's document `7RMCKJJN0u5q` as the test fixture. Beta verification
may use a newly created task-owned fixture with a declared cleanup manifest.

Natural next stage:

`/work templates/content/docs/solutions/2026-08-27-content-comment-actions-mcp-shape.md`

## Work execution record

Acceptance reconciliation: consistent — schema v3 freezes real-interface
acceptance, preferred independence, same-context custody, and a real external
MCP client plus Content UI.

Work lane:

- worktree: `/Users/alicemoore/.codex/worktrees/content-comment-actions-mcp`
- branch: `codex/content-comment-actions-mcp`
- refreshed base: `origin/main` at
  `2ee0e37506d6b7da75d97d007926724c794de753`
- allowed mutations: artifact-write, ephemeral-test-resource, branch, commit,
  push, and pull-request; merge, deploy, credential publication, and production
  data mutation remain prohibited

Declared verification resource:

```yaml
- id: content-comment-actions-mcp-local-20260827
  kind: database server profile session file
  surface: Isolated Content runtime at http://127.0.0.1:43127 backed by /tmp/content-comment-actions-mcp-20260827
  ownership-marker: Content Comment MCP Acceptance 2026-08-27
  baseline: /tmp/content-comment-actions-mcp-20260827 absent and TCP port 43127 unbound at 2026-08-27T18:51:38Z
  allowed-actions:
    - create
    - update
    - exercise
    - delete
  cleanup-trigger: After local MCP and UI acceptance evidence is captured, or immediately on abandonment.
  cleanup-method: Close the task browser tab and MCP client session, stop the exact server process, confirm TCP port 43127 is unbound, and move /tmp/content-comment-actions-mcp-20260827 to Trash.
  cleanup-proof: Independent port-unbound and original-path-absence checks plus database read-back before removal.
  shared-impact: none
  isolation: local-runtime
  ownership: task-created
  production-data: false
  customer-data: false
  cost: none
  boundary-evidence:
    - exact sandbox path absent before creation
    - exact TCP port unbound before server start
    - fixture title is unique to this task and date
  max-lifetime-minutes: 180
  declared-at: 2026-08-27T18:51:38Z
  expires-at: 2026-08-27T21:51:38Z
  status: active
  phase: work
```

Resource transition: sandbox directory created and Content server acquired on
TCP port 43127 at 2026-08-27T18:52:14Z; database, fixture, MCP session, and
browser evidence remain pending.

Implementation result:

- `list-comments`, `add-comment`, and `update-comment` now opt into the curated
  MCP catalog through their existing `defineAction` contracts.
- The comment action descriptions make the externally important identifier and
  document-pairing constraints explicit without creating a second action path.
- Focused contract coverage now checks discovery membership, required schemas,
  read/write hints, validated reply linkage, exact-thread mutation,
  unrelated-thread preservation, idempotency, and mismatched document/comment
  failure.

Local external-client evidence (task-owned fixture only):

- MCP initialization and `tools/list` exposed all three comment actions with
  usable schemas; `list-comments` was read-only and both mutations were writes.
- A signed task-scoped A2A caller created document `2OfFY7xnrELc`, added threads
  `rl75rqy8jjf` and `shxrdq4n66`, edited only the first paragraph, replied on the
  first thread with comment `7yu5q2b2ecp`, and resolved that thread.
- Repeating the resolution returned the same successful resolved state.
- Re-listing showed the first root and reply resolved while unrelated thread
  `shxrdq4n66` remained unresolved; the second paragraph remained byte-for-byte
  unchanged.
- A mismatched document/comment pair returned `Comment not found`; a separately
  signed caller without document access returned `No access to document`.
- The Content UI authenticated successfully and its action read returned the
  exact document with HTTP 200, but the local in-app editor remained at
  `Connecting live editor. Showing a read-only snapshot.` Chrome disconnected
  before the alternate visible-state read could begin. UI parity therefore
  remains an explicit acceptance gap rather than a claimed pass.

Verification commands:

- `pnpm --filter content exec vitest --run actions/mcp-action-contract.spec.ts actions/add-comment.test.ts actions/update-comment.test.ts`
  — 3 files and 16 tests passed after review repairs.
- `pnpm --filter content typecheck` — exited 0; the harness also reported the
  expected missing production-only database and auth settings for this isolated
  local runtime.
- `git diff --check` — passed.

Acceptance state: code and direct external MCP behavior pass locally. Visible UI
parity and post-merge beta monitoring remain open delivery gates; neither is
claimed by this Work record.

Resource cleanup: the task browser tab and MCP/runtime session were closed, the
exact server was stopped, TCP port 43127 was independently confirmed unbound,
and `/tmp/content-comment-actions-mcp-20260827` was confirmed absent after being
moved to `/Users/alicemoore/.Trash/content-comment-actions-mcp-20260827-20260827T1900Z`.
The declared resource status is `cleaned`; the Trash copy is recoverable and is
not an active runtime resource.

Independent technical review:

- reviewer: bounded Terra reviewer `Pasteur`; two turns, the maximum allowed by
  the bounded-review contract
- risk trigger: existing comment writes became discoverable across the
  authenticated MCP network boundary
- initial findings: reply selectors were not validated against their
  access-scoped document/thread, and runtime-required inputs were advertised as
  optional in MCP schemas
- disposition: repaired at the action boundary with paired nonempty reply
  selectors, document-scoped parent validation, required schemas, explicit MCP
  descriptions, and focused tests; the reviewer confirmed both original
  findings resolved and identified one final wording gap, which was corrected
  and covered by the final green contract test
- remaining review findings: none known; the final wording-only repair could
  not receive a third reviewer turn under the frozen review budget

Work handoff:

- implementation commit: `8abc2cd910`
- draft pull request: https://github.com/BuilderIO/agent-native/pull/3772
- integration state: not merged; merge and deploy remain prohibited in Work
- remaining acceptance gates: visible Content UI parity for the persisted
  comment state, then post-merge beta deployment monitoring and bounded beta
  discovery/read/write verification
- natural next stage after the visible UI gate is closed: `/land`
