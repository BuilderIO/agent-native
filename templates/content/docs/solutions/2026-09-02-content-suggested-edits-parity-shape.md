---
title: "Content Suggested Edits parity shape"
date: 2026-09-02
status: shape-complete
authoritySchemaVersion: 3
ledgerRevision: content-suggested-edits-shape-r2
governingArtifactRevision: content-suggested-edits-shape-r2
---

# Content Suggested Edits parity

## Summary

Add **Suggested Edits** to Agent-Native Content with behavioral parity to Notion's observed feature: a commenter, editor, admin, owner, or authorized agent can propose page-body text changes without changing the canonical page; reviewers inspect each proposal in place, discuss it, and accept or reject it durably. The first shipped slice deliberately matches Notion's narrow page-body boundary rather than prematurely implementing Content's broader typed-diff roadmap.

The implementation should extend Core's existing review domain with executable suggestions and let Content register the document-specific operation and renderer adapter. Content owns page semantics, supported blocks, editor mode, and canonical mutation. Core owns proposal identity, thread/disposition lifecycle, permissions integration, notifications, audit/history seams, and shared actions. Suggestions are not comments with overloaded metadata, recovery versions, raw Yjs updates, or draft copies of pages.

## Human problem and stakes

Today, a Content collaborator can either comment without showing the exact desired edit or directly edit the canonical document. Agents face the same binary choice. Reviewers must translate prose feedback into changes or trust a direct rewrite after the fact.

After this feature, a collaborator can make the intended revision directly in the familiar editor while the canonical document stays unchanged. The owner can understand the proposed result in context, discuss it, and make an attributable accept/reject decision. This matters most for agent-assisted editing and comment-level collaborators: both can contribute exact changes without receiving direct-edit authority.

## Exact parity boundary

“Parity” means parity with the firsthand Notion behavior observed on 2026-09-01, not parity with every future capability in Content's `Review changes in place` roadmap.

| Behavior         | Content contract                                                                                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enter mode       | `•••` page menu exposes **Suggest edits**; active mode is labeled **Suggesting** in the page header.                                                                                                                 |
| Exit mode        | Header control or page menu stops suggesting; pending proposals remain untouched.                                                                                                                                    |
| Permissions      | Owner/admin/editor can edit and suggest. Commenter can suggest and comment but cannot directly edit. Viewer remains read-only. Server actions enforce the same matrix as the UI and agent.                           |
| Add              | Inserted text is provisional and stored as an Add operation.                                                                                                                                                         |
| Delete           | Deleted text remains represented until acceptance and is stored as a Delete operation.                                                                                                                               |
| Replace          | Replacing a selected range is one atomic Replace operation with exact before/after text.                                                                                                                             |
| Formatting       | Supported inline mark changes are typed operations, initially Bold, Italic, Underline, Strikethrough, Code, and Link add/remove/change where the renderer can preserve exact material.                               |
| New text block   | A new supported block is one proposal, even if its internal operation contains a boundary plus content insertion.                                                                                                    |
| Review           | Each suggestion has author, timestamp, typed summary, Accept, Reject, reactions, replies, and a more menu. Decisions apply immediately and idempotently.                                                             |
| History          | Pending, accepted, and rejected suggestions remain visible in **All discussions**. Resolution removes decision controls but not the thread.                                                                          |
| Thread tools     | Mark unread, copy deep link, and mute replies are available for suggestion threads.                                                                                                                                  |
| Notifications    | Page owner/relevant participants receive the existing durable notification flow for new suggestions, replies, mentions, reactions where policy calls for it, and dispositions.                                       |
| Agent parity     | Agents create the same suggestion objects through shared actions; they do not directly mutate canonical content while operating in suggestion mode.                                                                  |
| Locking          | A locked/read-only page disables suggestion creation even if the role would otherwise permit it. Existing proposals remain readable according to access.                                                             |
| Scope exclusions | No title, icon, cover, database property, inline database, media/embed, local-file, source-owned, or peek/preview suggestion editing in the first release. Unsupported content remains read-only in suggesting mode. |
| Bulk decisions   | No Accept all / Reject all in parity v1. Content's future filtered-review capability remains separate.                                                                                                               |

One intentional correction to Notion's observed UI: a block badge reports suggestions and replies separately instead of inflating “suggestions” when someone replies.

## Architecture grounding and fit

### Demonstrated caller

The demonstrated caller is an authenticated Content user or accountable agent opening a canonical Content Page and requesting “Suggest edits,” then proposing a supported body change for later review.

### Existing primitives and seams

- `templates/content/app/components/editor/VisualEditor.tsx` is the TipTap/ProseMirror editing surface and already participates in Yjs collaboration.
- `templates/content/server/plugins/collab.ts` and Core's collaboration substrate already synchronize human and agent changes, cursor state, and editor reconciliation.
- Content already exposes Page access as `canComment` and `canEdit`; Core sharing already has viewer/commenter/editor/admin/owner role ordering.
- Content's comments already provide text anchors, replies, mentions, resolution, and a comments rail.
- `packages/core/src/review` already owns reusable access-scoped review comments, threads, mentions, notifications, and review status actions.
- `packages/core/src/history` and automatic action audit provide reusable version/history and actor attribution donors.
- The approved Content records `content.diff.in-place`, `content.diff.filtered-review`, `content.diff.ai-assist`, `content.version.field-history`, and feature 7 already define the broader destination.

### Ownership boundaries

- **Core review domain:** stable suggestion/change/thread/decision types, stores, access-scoped list/create/reply/react/mute/unread/decide actions, idempotency, durable attribution, and notification hooks.
- **Content domain:** supported page-body operation grammar, document access/lock/source checks, base revision calculation, canonical apply transaction, comment-rail integration, and editor rendering.
- **TipTap editor:** ephemeral composition and provisional visual presentation. It is not the durable source of suggestion truth.
- **Yjs collaboration:** transports live canonical editor state and presence. Pending suggestions must not be written into the canonical Y.Doc as if accepted.
- **SQL:** owns durable suggestions, operations, thread state, dispositions, and canonical Content. Large editor snapshots or Yjs blobs are not copied into suggestion rows.
- **Audit/history:** records actual proposal and decision actions. A pending suggestion is not a committed Content revision; acceptance creates the canonical mutation and its normal history/audit record.

### Return-to-shape decision: canonical mutation coordination

The first implementation pass exposed one material architecture gap: suggestion acceptance can update canonical SQL and version history inside the suggestion transaction, but Core's current Yjs writer independently owns its document lock, persistence CAS, cache mutation, and broadcast. Calling that writer before the suggestion transaction commits can leak a rolled-back edit; calling it afterward leaves a committed SQL change vulnerable to an already-open client flushing stale cached Yjs state. Direct SQL from the adapter also bypasses Content's normal mutation side effects.

The compatible boundary is a **prepare / commit / publish canonical mutation coordinator**, not a suggestion-specific second write path:

1. Core collaboration provides a document-scoped mutation lease. It serializes the operation with in-process Yjs writers, loads and merges the latest durable Y.Doc, and prepares the mutation on an isolated clone. Preparation produces the next canonical text, encoded Yjs state/update, and the `_collab_docs.version` fence; it does not mutate the shared cache or emit.
2. Content provides one canonical document-body mutation helper used by both ordinary full-body saves and accepted suggestions. Given an existing database transaction and the prepared collaboration mutation, it re-resolves resource eligibility, verifies the immutable proposal base plus exact before/context against the current body, performs the document CAS, persists Blocks-field identity and the prepared `_collab_docs` state with its version fence, creates the ordinary document version/history effects, and records a durable resource-scoped sync event.
3. Core suggestion decision remains the transaction owner for acceptance. The adapter's decision coordinator acquires the document lease outside that transaction, then the existing decision transaction invokes the Content helper so suggestion disposition, decision row, canonical body, version/history, durable Yjs state, and sync event commit or roll back together.
4. After a successful commit, the lease publishes the prepared Y.Doc into the process cache and emits the minimal collaboration update. After rollback it discards the clone. If the process dies after commit but before broadcast, the durable Yjs row and sync event cause connected clients or polling/reconnect to converge; network delivery itself is not represented as transactional.
5. Cross-process safety is enforced by both the Content document CAS and `_collab_docs.version` fence. Either conflict becomes an explicit stale/retry outcome; no layer may coerce it into accepted success. A connected client based on an older Yjs version must merge/reload the committed state before its next durable write.

This coordinator is a Core collaboration primitive because locking, cached Y.Doc lifecycle, version fencing, and broadcast are framework concerns. The canonical document mutation helper is Content-owned because Markdown/Blocks reconciliation, source/database exclusions, version policy, access, and mutation history are Content semantics. The generic suggestion registry gains only the lifecycle hook needed to wrap its existing transaction in an adapter-provided decision coordinator; it does not learn Content or Yjs details.

The proposal revision token is immutable and continues to identify the exact `documents.updatedAt` observed at creation. Acceptance does not require the Page to remain globally unchanged: the Content adapter may safely rebase only when the exact before material plus bounded contextual anchor resolves uniquely against the current canonical body. The current body revision and `_collab_docs.version` are separate execution-time fences. Ambiguous, missing, multiply matched, or structurally incompatible material produces `stale`; it never silently broadens to whole-string replacement.

### Smallest compatible delta

Extend the existing Core review seam with a generic executable-suggestion lifecycle and registered resource adapter, plus the narrow decision-coordination hook required to join an adapter-owned mutation lease to Core's decision transaction. Add the Core prepare/commit/publish Yjs lease and a Content canonical body-mutation helper shared by ordinary saves and suggestion acceptance. Implement only Content document-body text and inline-mark operations first. Reuse the existing Content comments rail presentation through one review controller rather than creating a second discussion system.

Do not begin with the generic cross-object typed graph promised by feature 7. The first slice establishes the stable lifecycle and Content adapter that the broader graph can later extend without changing user-visible semantics.

### Legacy contracts that remain unchanged

- Direct editor changes by editor/admin/owner continue to update the canonical document normally.
- Ordinary comments retain their current identities, anchors, reply/resolve behavior, and Notion comment synchronization.
- Existing whole-document versions remain recovery snapshots; they are not reclassified as suggestions.
- SQL remains canonical for Content body; Yjs remains the live collaboration transport and reconciliation layer.
- Local-file and externally source-owned pages retain their current authority and synchronization rules.
- Existing sharing role names stay fixed; only commenter capability copy changes to truthfully include suggesting for Content resources.

### Evidence classification

Direct evidence comes from the verified Notion interaction memo and screenshots, Content schema/actions/editor code, Core review/history/sharing code, and approved Content product records. The proposed Core adapter shape is an architectural inference from those seams. No unresolved domain-owner question changes the public contract; storage details and ProseMirror decoration technique remain implementation choices.

## Durable model

Add a Core-owned suggestion aggregate with append-only decisions:

- `review_suggestions`: id, resource type/id, adapter kind/version, thread id, author/actor/run context, base revision token, status (`pending`, `accepted`, `rejected`, `stale`, `superseded`), summary, timestamps, access scope, and metadata.
- `review_suggestion_operations`: stable operation id, suggestion id, ordinal, operation kind, field/target identity, before/after payload, anchor/context, dependencies, and payload schema version.
- `review_suggestion_decisions`: stable idempotency key, suggestion id, reviewer, decision, observed base, outcome, failure/conflict detail, and timestamp.
- Reuse Core review comments/threads for replies, mentions, reactions, resolution, mute, unread, and deep links; link the thread to the suggestion ID explicitly.

For Content v1, the operation grammar is `insert_text`, `delete_text`, `replace_text`, `add_text_block`, and `set_inline_mark`. Each operation records the affected Blocks field, ProseMirror-compatible range/shape, exact before/after material, surrounding anchor context, and a base digest. The durable payload is typed JSON, not serialized ProseMirror transactions or Yjs client updates.

Suggestion creation validates that all operations are supported, belong to one Page body, and match the observed base. It does not mutate `documents.content` or create a document version.

Acceptance runs under one document mutation lease and one Core-owned decision transaction: re-resolve access, feature flag, source link, database membership, and lock state; load the latest durable Y.Doc and current body; verify or uniquely rebase the exact operation; prepare the isolated Yjs mutation; apply it through Content's canonical body-mutation helper; CAS `documents.content` and `updatedAt`; persist the fenced Yjs state, Blocks-field identity, ordinary Content version/history effects, accepted decision, and durable sync event; then publish the cache/update only after commit. If any transactional step fails, neither canonical content, durable Yjs state, history, sync event, nor disposition commits. Reject appends only the decision/disposition and leaves canonical content unchanged.

## Interaction design

The mode should feel like Content, not like a separate diff application:

1. The ordinary page editor stays in place. Unsupported page controls and blocks become non-editable while suggesting.
2. Provisional additions and formatting render inline; deletions remain visible with subdued strike treatment. Semantic tokens distinguish proposed material without relying on color alone.
3. A compact numbered marker aligns to each affected block. Selecting it opens the existing right utility rail on the exact suggestion thread.
4. The rail shows a typed operation summary first, then Accept/Reject for authorized reviewers, replies/reactions, and thread controls. It distinguishes counts for edits and replies.
5. **All discussions** filters ordinary comments and suggestion threads by Pending, Accepted, Rejected, and Resolved without hiding historical decisions.
6. Deep links reopen the Page, scroll to the current or historical anchor, and focus the thread. If the anchor is stale or deleted, the rail shows the retained before/after material and honest stale state.
7. Keyboard users can enter/exit suggesting, traverse markers, inspect before/after text, decide, reply, and return focus to the editor. Screen readers receive operation kind, before/after material, author, status, and affected block context.

No explanatory banner, duplicate page heading, or permanent review dashboard is added. Suggesting state lives in the header and contextual rail.

## Action surface

Core/shared actions:

- `create-resource-suggestion`
- `list-resource-suggestions`
- `get-resource-suggestion`
- `decide-resource-suggestion`
- `reply-review-comment` / existing thread actions
- `react-to-review-comment`, `set-review-thread-unread`, and `set-review-thread-muted` where missing

Content registers a `document` suggestion adapter that implements `validateProposal`, `preview`, `apply`, `resolveAnchor`, and `describeOperation`. UI calls the same actions through `useActionQuery`/`useActionMutation`; agent tools expose the identical schemas. Direct agent edits remain available when authorized, but an explicit “suggest” request must use suggestion actions and return suggestion IDs/deep links rather than claim the Page changed.

## Delivery plan

### Slice 1 — lifecycle and permissions

Add the Core suggestion types/store/registry/actions and decision-coordination hook; the Core prepare/commit/publish Yjs mutation lease; the shared Content canonical body-mutation helper; Content adapter registration; default-off `content-suggested-edits` flag; transaction-time role/lock/source/database enforcement; idempotent accept/reject; normal Content history/audit/sync effects; and focused database/collaboration tests. This slice may use fixture operations before editor composition exists.

### Slice 2 — editor composition and in-place rendering

Add Suggesting mode to `VisualEditor`, operation capture for supported text/mark changes, provisional decorations, block markers, header/menu entry/exit, pending persistence, reload restoration, and narrow/keyboard/accessibility states. Prevent pending material from entering canonical autosave/Yjs reconciliation.

### Slice 3 — discussion and history parity

Unify suggestion threads with the Content comments rail; add replies, mentions, reactions, unread, mute, deep links, pending/accepted/rejected history filters, notifications, and honest orphan/stale presentation.

### Slice 4 — agent parity and rollout proof

Teach Content's agent instructions/actions to propose rather than directly edit when asked, expose inspection links, group a run's related suggestions without bulk-deciding them, verify live cross-client updates, and dogfood behind the flag before wider rollout.

### Deferred beyond parity v1

- Titles, Properties, database cells/schema, media, embeds, and arbitrary registry blocks.
- Accept/reject all, filtered bulk review, dependency-safe sets, and agent-generated review summaries.
- Named Versions, cross-Version merge, general typed change graphs, code review, and external-provider suggestion synchronization.
- Local-file suggestions and offline portable suggestion representation.

These are plausible extensions of the stable lifecycle, not requirements for Notion parity.

## Risks and controls

- **Canonical leakage:** pending edits accidentally autosave or enter Yjs. Control with a separate suggestion editor transaction filter/state and tests that canonical Markdown/Y.Doc/drafts remain byte-identical until acceptance.
- **Split-brain acceptance:** SQL commits while a cached Y.Doc still contains the old body, allowing a connected client to overwrite the accepted edit. Control with the document mutation lease, isolated preparation, transactionally persisted fenced Yjs state, post-commit cache publication, and a two-client stale-flush test.
- **Commit/broadcast crash window:** the process dies after the database commit but before emitting to connected clients. Control by storing a resource-scoped sync event in the same transaction; reconnect/poll reloads durable canonical and Yjs state. Broadcast is an optimization, not the durable proof of mutation.
- **Stale acceptance:** current material changes after proposal. Control with base token plus exact before material and contextual anchor; fail as stale unless the adapter proves a unique safe rebase.
- **Commenter escalation:** proposal or acceptance bypasses role limits. Control at action/adaptor boundaries; commenter may create but only editor/admin/owner may accept/reject unless future policy explicitly changes.
- **Dual discussion models:** Content comments and Core review threads drift. Control by adopting the Core controller/store for suggestion threads and incrementally adapting ordinary Content comments rather than creating a third store.
- **History ambiguity:** proposal creation looks like committed content or acceptance bypasses normal document history. Control with distinct proposal/decision events and one shared Content canonical mutation helper; only acceptance emits the same body-version, audit attribution, Blocks-field reconciliation, and sync effects as an ordinary accepted body mutation.
- **External-source corruption:** suggestions apply to source-owned or syncing bodies. Control by excluding local-file, Notion-linked/source-owned conflict states, and other non-local authority in v1.
- **Payload drift:** editor schema evolves. Control with versioned operation payloads and adapter-owned migration/degraded rendering.

## Acceptance story

The acceptance interface is the real Content Page editor in a deployed beta surface with two authenticated test users (commenter and editor) plus an accountable agent run. Independence is preferred and custody may remain in the same context because the interaction is consequential but reversible, while technical review and automated invariants cover the persistence and authorization risk.

Required assertions:

1. A commenter enters Suggesting, creates Add/Delete/Replace/new-text-block/format suggestions, exits and reloads, and the canonical document and another viewer's canonical rendering remain unchanged.
2. An editor sees inline markers, exact before/after material, author/time, replies/reactions, and independently accepts one suggestion and rejects another; only the accepted operation changes canonical Content.
3. Accepted and rejected threads remain discoverable in All discussions with durable actor, time, decision, replies, reactions, and working deep links.
4. Viewer creation and commenter acceptance are denied identically through UI and actions; lock/source/unsupported-block constraints fail closed without partial state.
5. An agent asked to suggest creates inspectable pending suggestions through the same actions and does not directly modify canonical content.
6. Concurrent canonical editing produces either a uniquely proven contextual rebase or an explicit stale/conflict state; the immutable proposal base, current document CAS, and current Yjs version fence are independently enforced, and no no-op is reported as accepted.
7. Retry of create/accept/reject is idempotent; failures injected before SQL commit, during Yjs-state persistence, and after commit but before live broadcast leave canonical content, durable Yjs state, ordinary Content history, sync event, and suggestion disposition mutually consistent or durably convergent as specified.
8. With two open clients, acceptance updates the accepting client and the peer without a reload; a peer holding the pre-accept Yjs state cannot flush it over the accepted body. Proposal, reply, reaction, and disposition updates use shared sync without extra EventSource connections or editor jitter.
9. Keyboard and screen-reader workflows can enter/exit mode, identify operation types and before/after material, traverse suggestions, decide, reply, and restore focus.
10. With the feature flag Off, current editing, comments, sharing, history, agent direct-edit behavior, local files, and source sync remain unchanged.

Automated coverage is required for model/store/action/permission/idempotency/stale/persistence/canonical-isolation behavior, including transaction rollback, cross-process CAS, post-commit broadcast failure, and stale connected-client flush. Real-interface evidence is required for the complete editor workflow at desktop and narrow widths with two simultaneous clients. A proportional independent technical review is required for the Core review boundary, transaction ownership, permission checks, and Yjs/canonical isolation.

## Architecture fingerprint

```yaml
stage: shape
authority-source: "User invoked $shape and requested exact Suggested Edits feature parity for Agent-Native Content."
authorized-scope:
  repositories:
    - /home/teenylilmonkey/Developer/agent-native
  product-surfaces:
    - Agent-Native Content page editor
    - Agent-Native Core review substrate
  outcome: Notion-parity Suggested Edits for supported Content page-body text and inline formatting
allowed-mutations:
  - artifact-write
write-targets:
  artifacts:
    - templates/content/docs/solutions/2026-09-02-content-suggested-edits-parity-shape.md
governing-artifact:
  path: templates/content/docs/solutions/2026-09-02-content-suggested-edits-parity-shape.md
  revision: content-suggested-edits-shape-r2
architecture-fingerprint:
  outcome: Commenters, editors, and agents can propose supported page-body edits without changing canonical Content until an authorized reviewer accepts them.
  shipping-surfaces:
    - id: agent-native-content-template
      repository: agent-native
      product-surface: templates/content deployed application
      constituency: authenticated Content page collaborators and accountable agents
      durable-destination: agent-native repository main plus deployed Content beta/production surfaces
      integration-action: merge
    - id: agent-native-core-packages
      repository: agent-native
      product-surface: Core review/action/client packages consumed by templates
      constituency: Agent-Native app developers and review-capable applications
      durable-destination: agent-native repository main and publishable Core package release
      integration-action: merge
  governing-architecture: Core owns the reusable executable-suggestion lifecycle plus a prepare/commit/publish Yjs mutation lease; Content owns one canonical document-body mutation helper shared by ordinary saves and suggestion acceptance; the suggestion decision transaction atomically commits disposition, canonical SQL, history, fenced durable Yjs state, and a sync event before cache publication or broadcast.
  acceptance-story:
    id: content-suggested-edits-parity-v1
    summary: A commenter or agent proposes supported edits in the ordinary Content editor; an authorized editor discusses and decides each proposal; only accepted material reaches canonical Content and every state remains attributable and recoverable.
    required-assertions:
      - proposal creation preserves canonical content
      - selective accept/reject applies exactly the decided operation
      - discussion and resolved history persist with deep links
      - UI, agent, and action permission parity fails closed
      - stale/concurrent edits never overwrite newer content
      - retries, persistence failures, and commit-to-broadcast crashes remain atomic, idempotent, or durably convergent according to the transaction boundary
      - a connected client holding pre-accept Yjs state cannot overwrite accepted content
      - cross-client sync and accessibility work through the real editor
      - flag-off legacy behavior remains unchanged
    acceptance-policy:
      modality: real-interface
      independence: preferred
      custody: same-context-allowed
      interface: deployed Content beta Page editor with commenter/editor users and an accountable agent run
      rationale: The user-visible workflow requires real editor proof; reversible review actions permit same-context custody while authorization and canonical-isolation seams receive independent technical review.
  risk-strategy:
    kind: feature-flagged
    production-validation-after-merge: true
architecture-grounding:
  applicability: required
  reason: The feature crosses shared review, permissions, history, action, collaboration, and Content domain boundaries.
  status: grounded
  demonstrated-callers:
    - Content Page collaborator or accountable agent requesting Suggest edits
  existing-primitives:
    - Core review comments/threads/notifications/status
    - Core sharing roles and action audit
    - Core history/version donor
    - Content TipTap/Yjs editor and comments rail
    - Content document access/actions/version snapshots
  ownership-boundaries:
    - Core owns reusable suggestion lifecycle and shared actions
    - Content owns document operation semantics and canonical application
    - SQL owns durable truth; Yjs owns live collaborative transport
  legacy-contracts:
    - direct editing, comments, versions, sharing, local files, source sync, and agent direct edits remain unchanged when suggestion mode is not requested or flag is off
  shared-vocabulary:
    - Suggested Edit
    - Suggesting
    - suggestion operation
    - suggestion thread
    - pending
    - accepted
    - rejected
    - stale
  smallest-compatible-delta: Core executable-suggestion lifecycle and narrow decision coordinator, a Core prepared Yjs mutation lease, one shared Content canonical body-mutation helper, and the Content page-body text/mark adapter plus ordinary-editor presentation.
  deferred-capabilities:
    - generic typed Property/Database/media proposals
    - filtered bulk review
    - named Versions and selective cross-Version merge
    - local-file and provider suggestion synchronization
  reversibility: A default-off app-owned feature flag keeps dormant code inactive; suggestion tables are additive; pending proposals never alter canonical content.
  direct-evidence:
    - verified Notion Suggested Edits interaction memo dated 2026-09-01
    - packages/core/src/review and packages/core/src/history
    - templates/content editor, actions, schema, comments, collaboration plugin
    - Content feature 7 and diff/history/access capability records
  inferences:
    - extending Core review with an adapter registry is the smallest reusable implementation boundary
    - typed JSON operations are more durable than persisted ProseMirror transactions or Yjs updates
    - database commit is the atomic authority while cache publication and network broadcast are post-commit delivery backed by durable sync replay
    - acquiring the document lease outside the decision transaction is necessary to prevent a live Yjs writer from straddling acceptance
  unresolved-owner-questions: []
delegation-ceiling: []
acceptance-state:
  status: in-progress
  summary: Core and Content implementation is staged; local real-interface proof covers proposal isolation plus accept and reject decisions in the contextual rail.
  evidence:
    - templates/content/docs/solutions/evidence/suggested-edits-accept-reject.png
    - focused Core and Content automated suites
  remaining:
    - commenter/editor role-separated acceptance
    - accountable agent proposal acceptance
    - two-client sync and narrow-width accessibility acceptance
    - independent technical review closure
  blockers: []
  last-land-packet: null
change-record:
  from-revision: content-suggested-edits-shape-r1
  to-revision: content-suggested-edits-shape-r2
  trigger: Independent review proved that direct SQL acceptance could diverge from the cached Y.Doc and bypass normal Content mutation effects.
  preserved:
    - outcome and exact Notion-parity product boundary
    - shipping surfaces and ownership split between Core and Content
    - default-off feature-flag risk strategy
  changed:
    - canonical mutation coordination is now an explicit prepare/commit/publish architecture
    - ordinary Content saves and accepted suggestions must share one Content body-mutation helper
    - durable Yjs state and sync event join the suggestion decision transaction
    - acceptance now proves stale-client overwrite prevention and crash-window convergence
ledger-revision: content-suggested-edits-shape-r2
status: shape-complete
```

## Active Work envelope

```yaml
stage: work
authority-source: "User invoked $work on 2026-09-03 against content-suggested-edits-shape-r2."
ledger-revision: content-suggested-edits-work-r2-2
governing-artifact:
  path: templates/content/docs/solutions/2026-09-02-content-suggested-edits-parity-shape.md
  revision: content-suggested-edits-shape-r2
allowed-mutations:
  - artifact-write
  - ephemeral-test-resource
  - branch
  - commit
write-targets:
  repositories:
    - /home/teenylilmonkey/.codex/worktrees/content-suggested-edits/agent-native
test-resources:
  - id: content-suggested-edits-r2-page
    kind: record
    surface: local Content SQLite document id codex-suggested-edits-r2-20260903
    ownership-marker: title "[task-test] Suggested Edits r2 2026-09-03"
    baseline: exact document id returned zero rows immediately before creation
    allowed-actions: [create, update, exercise, delete]
    cleanup-trigger: before Work completion
    cleanup-method: delete suggestion/review/version/collab/membership rows for the exact document id, then delete that document row in one local SQLite transaction
    cleanup-proof: read every named table for the exact document id and observe zero rows
    shared-impact: none
    isolation: local-runtime
    ownership: task-created
    production-data: false
    customer-data: false
    cost: none
    boundary-evidence:
      - fixed id is absent from the local Content database before creation
      - pending replacement created through the real editor and accepted through the review card
      - a second live client converged from Alpha old Omega to Alpha new Omega
      - rejected replacement resolved without changing the accepted document body
      - viewport screenshots retained under C:/Users/emdis/.codex/visualizations/2026/09/01/01a05dfc-8e21-7780-a44a-4937701320e4
    max-lifetime-minutes: 240
    declared-at: 2026-09-03T16:48:52Z
    expires-at: 2026-09-03T20:48:52Z
    status: cleaned
    cleanup-result: documents=0, suggestions=0, comments=0, versions=0, collab_docs=0 after one local SQLite write batch
    phase: work
acceptance-reconciliation: consistent
task-attention: autonomous
status: verification
```

## Next step

Invoke `/work templates/content/docs/solutions/2026-09-02-content-suggested-edits-parity-shape.md` to revise the staged implementation against r2. Work resumes at Slice 1 by replacing the direct-SQL acceptance path with the frozen mutation coordinator and shared Content helper before proceeding to remaining interface acceptance. Failure to make the document lease span the decision transaction, persist the Yjs fence in that transaction, or prevent stale-client overwrite is a return-to-shape condition rather than permission to degrade silently.
