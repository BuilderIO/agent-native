---
title: "Content Suggested Edits parity shape"
date: 2026-09-02
status: shape-complete
authoritySchemaVersion: 3
ledgerRevision: content-suggested-edits-shape-r1
governingArtifactRevision: content-suggested-edits-shape-r1
---

# Content Suggested Edits parity

## Summary

Add **Suggested Edits** to Agent Native Content with behavioral parity to Notion's observed feature: a commenter, editor, admin, owner, or authorized agent can propose page-body text changes without changing the canonical page; reviewers inspect each proposal in place, discuss it, and accept or reject it durably. The first shipped slice deliberately matches Notion's narrow page-body boundary rather than prematurely implementing Content's broader typed-diff roadmap.

The implementation should extend Core's existing review domain with executable suggestions and let Content register the document-specific operation and renderer adapter. Content owns page semantics, supported blocks, editor mode, and canonical mutation. Core owns proposal identity, thread/disposition lifecycle, permissions integration, notifications, audit/history seams, and shared actions. Suggestions are not comments with overloaded metadata, recovery versions, raw Yjs updates, or draft copies of pages.

## Human problem and stakes

Today, a Content collaborator can either comment without showing the exact desired edit or directly edit the canonical document. Agents face the same binary choice. Reviewers must translate prose feedback into changes or trust a direct rewrite after the fact.

After this feature, a collaborator can make the intended revision directly in the familiar editor while the canonical document stays unchanged. The owner can understand the proposed result in context, discuss it, and make an attributable accept/reject decision. This matters most for agent-assisted editing and comment-level collaborators: both can contribute exact changes without receiving direct-edit authority.

## Exact parity boundary

“Parity” means parity with the firsthand Notion behavior observed on 2026-09-01, not parity with every future capability in Content's `Review changes in place` roadmap.

| Behavior | Content contract |
| --- | --- |
| Enter mode | `•••` page menu exposes **Suggest edits**; active mode is labeled **Suggesting** in the page header. |
| Exit mode | Header control or page menu stops suggesting; pending proposals remain untouched. |
| Permissions | Owner/admin/editor can edit and suggest. Commenter can suggest and comment but cannot directly edit. Viewer remains read-only. Server actions enforce the same matrix as the UI and agent. |
| Add | Inserted text is provisional and stored as an Add operation. |
| Delete | Deleted text remains represented until acceptance and is stored as a Delete operation. |
| Replace | Replacing a selected range is one atomic Replace operation with exact before/after text. |
| Formatting | Supported inline mark changes are typed operations, initially Bold, Italic, Underline, Strikethrough, Code, and Link add/remove/change where the renderer can preserve exact material. |
| New text block | A new supported block is one proposal, even if its internal operation contains a boundary plus content insertion. |
| Review | Each suggestion has author, timestamp, typed summary, Accept, Reject, reactions, replies, and a more menu. Decisions apply immediately and idempotently. |
| History | Pending, accepted, and rejected suggestions remain visible in **All discussions**. Resolution removes decision controls but not the thread. |
| Thread tools | Mark unread, copy deep link, and mute replies are available for suggestion threads. |
| Notifications | Page owner/relevant participants receive the existing durable notification flow for new suggestions, replies, mentions, reactions where policy calls for it, and dispositions. |
| Agent parity | Agents create the same suggestion objects through shared actions; they do not directly mutate canonical content while operating in suggestion mode. |
| Locking | A locked/read-only page disables suggestion creation even if the role would otherwise permit it. Existing proposals remain readable according to access. |
| Scope exclusions | No title, icon, cover, database property, inline database, media/embed, local-file, source-owned, or peek/preview suggestion editing in the first release. Unsupported content remains read-only in suggesting mode. |
| Bulk decisions | No Accept all / Reject all in parity v1. Content's future filtered-review capability remains separate. |

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

### Smallest compatible delta

Extend the existing Core review seam with a generic executable-suggestion lifecycle and a registered resource adapter. Implement only Content document-body text and inline-mark operations first. Reuse the existing Content comments rail presentation through one review controller rather than creating a second discussion system.

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

Acceptance runs one Content-owned transaction: re-resolve access and feature flag; load the current body; verify or safely rebase the exact operation; apply it through the canonical Content serializer; update `documents.content` and `updatedAt`; create the ordinary Content version/history/audit effects; append the accepted decision; and emit normal action/collaboration sync. If any step fails, neither the canonical content nor the disposition commits. Reject appends only the decision/disposition and leaves canonical content unchanged.

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

Add the Core suggestion types/store/registry/actions, Content adapter registration, default-off `content-suggested-edits` flag, role/lock/source enforcement, idempotent accept/reject, action audit targets, and focused database tests. This slice may use fixture operations before editor composition exists.

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
- **Stale acceptance:** current material changes after proposal. Control with base token plus exact before material and contextual anchor; fail as stale unless the adapter proves a unique safe rebase.
- **Commenter escalation:** proposal or acceptance bypasses role limits. Control at action/adaptor boundaries; commenter may create but only editor/admin/owner may accept/reject unless future policy explicitly changes.
- **Dual discussion models:** Content comments and Core review threads drift. Control by adopting the Core controller/store for suggestion threads and incrementally adapting ordinary Content comments rather than creating a third store.
- **History ambiguity:** proposal creation looks like committed content. Control with distinct proposal/decision events; only acceptance emits canonical Content mutation history.
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
6. Concurrent canonical editing produces either a proven safe rebase or an explicit stale/conflict state; it never overwrites newer material or reports a no-op as accepted.
7. Retry of create/accept/reject is idempotent; simulated persistence failure leaves canonical content and suggestion disposition mutually consistent.
8. Two open clients receive proposal, reply, reaction, and disposition updates through shared sync without extra EventSource connections or editor jitter.
9. Keyboard and screen-reader workflows can enter/exit mode, identify operation types and before/after material, traverse suggestions, decide, reply, and restore focus.
10. With the feature flag Off, current editing, comments, sharing, history, agent direct-edit behavior, local files, and source sync remain unchanged.

Automated coverage is required for model/store/action/permission/idempotency/stale/persistence/canonical-isolation behavior. Real-interface evidence is required for the complete editor workflow at desktop and narrow widths. A proportional independent technical review is required for Core review boundary, permission checks, and Yjs/canonical isolation.

## Architecture fingerprint

```yaml
stage: shape
authority-source: "User invoked $shape and requested exact Suggested Edits feature parity for Agent Native Content."
authorized-scope:
  repositories:
    - /home/teenylilmonkey/Developer/agent-native
  product-surfaces:
    - Agent Native Content page editor
    - Agent Native Core review substrate
  outcome: Notion-parity Suggested Edits for supported Content page-body text and inline formatting
allowed-mutations:
  - artifact-write
write-targets:
  artifacts:
    - templates/content/docs/solutions/2026-09-02-content-suggested-edits-parity-shape.md
governing-artifact:
  path: templates/content/docs/solutions/2026-09-02-content-suggested-edits-parity-shape.md
  revision: content-suggested-edits-shape-r1
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
      constituency: Agent Native app developers and review-capable applications
      durable-destination: agent-native repository main and publishable Core package release
      integration-action: merge
  governing-architecture: Core owns the reusable executable-suggestion lifecycle and Content registers page-body operation, authorization, apply, and renderer behavior while SQL remains canonical and Yjs remains live transport only.
  acceptance-story:
    id: content-suggested-edits-parity-v1
    summary: A commenter or agent proposes supported edits in the ordinary Content editor; an authorized editor discusses and decides each proposal; only accepted material reaches canonical Content and every state remains attributable and recoverable.
    required-assertions:
      - proposal creation preserves canonical content
      - selective accept/reject applies exactly the decided operation
      - discussion and resolved history persist with deep links
      - UI, agent, and action permission parity fails closed
      - stale/concurrent edits never overwrite newer content
      - retries and persistence failures remain atomic and idempotent
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
  smallest-compatible-delta: Core executable-suggestion lifecycle plus a Content page-body text/mark adapter and ordinary-editor presentation.
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
  unresolved-owner-questions: []
delegation-ceiling: []
acceptance-state:
  status: pending
  summary: Shape is complete; implementation and current acceptance evidence have not begun.
  blockers: []
  last-land-packet: null
ledger-revision: content-suggested-edits-shape-r1
status: active
```

## Next step

Invoke `/work templates/content/docs/solutions/2026-09-02-content-suggested-edits-parity-shape.md` to implement the frozen first release. Work should begin with Slice 1 and preserve the exact parity boundary; discovering that the operation model cannot maintain canonical isolation or safe stale detection is a return-to-shape condition rather than permission to degrade silently.
