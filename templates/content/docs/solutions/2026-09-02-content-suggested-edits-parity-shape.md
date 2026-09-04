---
title: "Content Suggested Edits parity shape"
date: 2026-09-02
status: shape-complete
authoritySchemaVersion: 3
ledgerRevision: content-suggested-edits-shape-r4
governingArtifactRevision: content-suggested-edits-shape-r4
---

# Content Suggested Edits parity

## Summary

Add **Suggested Edits** to Agent-Native Content with behavioral parity to Notion's observed feature: a commenter, editor, admin, owner, or authorized agent can propose page-body text changes without changing the canonical page; reviewers inspect each proposal in place, discuss it, and accept or reject it durably. The first shipped slice deliberately matches Notion's narrow page-body boundary rather than prematurely implementing Content's broader typed-diff roadmap.

The implementation should extend Core's existing review domain with executable suggestions and let Content register the document-specific operation and renderer adapter. Content owns page semantics, supported blocks, editor mode, and canonical mutation. Core owns proposal identity, thread/disposition lifecycle, permissions integration, notifications, audit/history seams, and shared actions. Suggestions are not comments with overloaded metadata, recovery versions, raw Yjs updates, or draft copies of pages.

## 2026-09-03 return-to-shape: in-place review repair

Human QA of PR #4274 at `c820218ee5e811c0328d68e16085a0b1bcce2fc1` proved that the staged interface does not satisfy this artifact's already-frozen parity contract. While Suggesting is active, edits render as ordinary canonical-looking content and the Comments rail reports no proposal. Stopping Suggesting replaces the draft with canonical content, then creates one detached whole-session markdown diff. Pending changes have no marker in the Page after submission or reload, raw markdown leaks into the review card, and the tablet/mobile review modal obscures the Page. Accept, reject, and persistence work, but only after the reviewer discovers and reconstructs the detached proposal.

The firsthand Notion reference keeps every pending change visibly anchored in the ordinary document. Insertions, replacements, formatting, and new blocks have inline treatment and per-location counts; activating an anchor opens the exact suggestion thread with author, time, discussion, and Accept/Reject beside the affected material. The repair therefore restores the existing contract rather than adding optional polish.

## 2026-09-04 return-to-shape: calm Notion-parity interaction repair

Human QA of PR #4274 after the r3 repair, recorded at
`https://clips.agent-native.com/r/HQTpXgtD7rxX`, proves that the implementation
still fails the parity contract. The author can now see some provisional edits,
but deletions can jump to the start of the Page, the page-actions trigger keeps a
stuck focus treatment, ending Suggesting opens Comments, and activating an inline
change does not reliably expose a usable discussion and decision surface. The
rail renders suggestions as a separate custom card family and offers no way to
hide them when the user wants ordinary comments only.

The desired interaction is the observed Notion behavior: Suggesting is a quiet,
explicit toolbar mode with an adjacent close action; additions are blue;
deletions recede in gray with strikethrough until hover; exiting the mode does not
move the viewport or open a panel; and each selected suggestion behaves like a
normal anchored comment thread with replies and Accept/Reject. The Comments view
can include suggestions, exclude them, or show them alone without introducing a
second discussion system.

### Root causes in the current implementation

- `suggestionAnchorRange` reconstructs empty-range deletion positions from
  independently searched prefix/suffix strings and falls back to ProseMirror
  position `1`. That fallback converts an unresolved location into a plausible
  top-of-document location.
- Draft operations are recomputed from whole-document Markdown after every
  change. The derived deletion has no stable ProseMirror bookmark, so the
  renderer tries to rediscover a position after the deleted text is already gone.
- `handleSuggestionModeChange(false)` persists the session and then explicitly
  selects the first suggestion and opens Comments. Mode exit and review
  navigation are incorrectly coupled.
- Suggestion activation updates selection and scroll state, but the desktop
  suggestion cards are not integrated into the existing anchored comment layout.
  A click can therefore select an ID without presenting the expected adjacent
  thread.
- `CommentsSidebar` duplicates suggestion-card markup in inline and history
  modes and nests a headerless `ReviewThreadPanel` inside it. That parallel
  presentation bypasses the established comment card hierarchy, replies, and
  filtering vocabulary.
- The active style uses an outline and destructive red treatment. That conflicts
  with the requested calm gray-deletion/blue-addition visual language and makes
  transient selection look like a persistent focus defect.

### Implementation plan

#### 1. Make suggestion locations structural and fail closed

- Replace the UI's Markdown diff loop with a ProseMirror suggestion-capture
  plugin backed by the existing `suggestions/model.ts` and `controller.ts`.
  Capture insert, delete, replace, supported mark, and supported text-block
  operations from transactions before the document loses the original range.
- Give every local operation a stable local ID and mapped ProseMirror bookmark.
  Coalesce only adjacent keystrokes of the same operation kind; never merge
  unrelated ranges merely because they happened in one Suggesting session.
- Persist the operation's typed before/after material and contextual anchor at
  the edit boundary. Swap the local ID for the returned durable suggestion ID
  without replacing the decoration or losing focus.
- For reloaded suggestions, resolve exact text plus bounded prefix and suffix as
  one ordered context match. Zero or multiple matches produce an explicit
  orphaned/stale presentation in the rail; delete the `{ from: 1, to: 1 }`
  fallback. An unresolved proposal must never appear at a believable wrong
  location.
- Keep `contentRevision` and `onBaseAwareReconcile` from current `main` active on
  the canonical editor. Suggesting remains isolated from canonical autosave and
  Yjs, while external canonical movement invalidates or explicitly rebases local
  operations instead of silently shifting them.

#### 2. Make Suggesting a calm editor mode

- Replace the single secondary button with the compact observed control: pencil
  icon plus **Suggesting**, followed by a separately focusable X with tooltip and
  accessible name. The X changes authoring mode only.
- Entering from the page-actions menu must close the menu and return focus to the
  editor. Remove persistent trigger highlighting that represents neither an open
  menu nor keyboard focus; retain standards-compliant `focus-visible` treatment.
- Exiting Suggesting must not open Comments, select the first proposal, scroll,
  or alter the current utility panel. Pending and failed writes remain visible in
  place; failures expose retry without pretending the proposal exists durably.
- Render additions with the existing blue semantic accent. Render deletions as
  muted gray strikethrough at rest, removing the strike and increasing contrast
  on hover/focus so the text can be read. Use shape/line treatment in addition to
  color and remove the persistent black/blue outline from active suggestions.

#### 3. Use one anchored thread presentation for comments and suggestions

- Extract the existing comment card's header, body, reply sequence, composer,
  reactions, overflow menu, focus behavior, and anchored layout into a shared
  thread shell. Ordinary comments keep their current behavior and identity.
- Add a suggestion-thread content adapter to that shell. It supplies typed
  before/after material and pending Accept/Reject actions, then uses the same
  chronological replies, mentions, reactions, unread/mute/deep-link controls,
  spacing, and focus semantics as a normal comment.
- Remove both duplicated custom suggestion-card render loops and the nested
  headerless `ReviewThreadPanel`. A selected inline suggestion should open or
  focus its exact adjacent thread; selecting the thread should focus and center
  the exact inline anchor. Orphaned suggestions remain reviewable in a clearly
  labeled unanchored section without fabricating a document location.
- Keep decisions operation-specific and idempotent. During a pending decision,
  disable only that suggestion's controls. On success, update the canonical
  editor and thread status optimistically, reconcile from the action result, and
  restore focus to the affected material. On stale/conflict failure, preserve
  the thread and show the typed failure.

#### 4. Add a real Comments content filter

- Add a compact content-type filter with **All**, **Comments**, and
  **Suggestions** to the existing Comments filter menu. Compose it with the
  existing status and author filters rather than creating a second sidebar mode.
- Apply the filter consistently to anchored desktop cards, narrow sequential
  cards, empty states, and All discussions history. Filtering suggestions out
  must not remove their editor decorations or mutate their state.
- Persist the filter only if the ordinary Comments surface already persists
  comparable view preferences; otherwise keep it local to avoid creating a new
  settings contract for this repair.

#### 5. Lock the behavior with focused proof

- Unit-test transaction capture, keystroke coalescing, stable ID handoff,
  deletion bookmarks, ordered-context reload resolution, and explicit
  unresolved/ambiguous outcomes. Add a regression proving no path returns
  position `1` after failed resolution.
- Component-test menu focus restoration, independent X behavior, mode exit with
  every utility-panel state, visual class/state contracts, inline-to-thread and
  thread-to-inline focus, per-thread pending decisions, and content-type filters.
- Preserve and extend action/database tests for permissions, canonical
  isolation, idempotent decisions, stale bases, SQL/Yjs fencing, history, and
  cross-client convergence.
- Run formatter, Content/Core focused suites, typecheck, i18n guards, repository
  guards, and `pnpm test:content-product-impact`.
- Human-QA the exact head in the real Content editor at desktop and narrow
  widths, using a fresh uniquely marked disposable Page. Compare against the
  referenced Notion interactions for enter/edit/hover/exit/review/filter flows.
  A second authenticated client verifies that pending edits do not change
  canonical content and that accepted edits converge without reload. Record
  visible latency in coarse honest bands and clean the fixture with independent
  absence proof.

### Sequencing and ownership

1. **Editor semantics:** transaction capture, structural anchors, persistence
   handoff, and canonical/base-aware isolation.
2. **Interaction shell:** toolbar mode, exit behavior, focus restoration, and
   calm addition/deletion styling.
3. **Unified discussion:** shared thread shell, bidirectional anchoring,
   operation-scoped decisions, and orphan/stale fallback.
4. **Filtering and accessibility:** content-type filter, narrow layout,
   keyboard, screen-reader, and focus-return behavior.
5. **Proof and PR reconciliation:** automated suites, exact-head human QA,
   cleanup, product-impact declaration, and PR description/evidence refresh.

The first four steps are one coherent repair: shipping only the anchor fix would
leave the unusable parallel review model intact, while shipping only the thread
restyle would preserve data that can point at the wrong text.

### Explicit exclusions retained

- No title, Property, database, media, embed, local-file, or provider-owned
  suggestions.
- No Accept all/Reject all, dependency-aware bulk review, AI summary, or general
  typed-change graph.
- No new discussion store, REST route, permanent review dashboard, or canonical
  mutation path.
- No claim that all of Content Feature 7 is available. This remains the
  supported Page-body slice.

### Bound repair

1. **Capture semantic operations, not one markdown session diff.** The suggesting editor must translate supported ProseMirror transactions into typed Add/Delete/Replace/Add block/Set mark operations with stable operation and thread identity. Keystrokes that form one continuous edit may coalesce, but distinct ranges and operation kinds remain independently reviewable. `markdownSuggestionOperation(base, finalDraft)` may remain a compatibility/test helper; it cannot be the UI's primary capture boundary.
2. **Render one pending overlay in the ordinary editor.** Canonical Markdown/Yjs remains unchanged, while the editor projects canonical content plus local and durable pending operations. Insertions and marks receive visible non-color-only treatment; deletions remain readable with deletion treatment. Block markers/counts and keyboard-focusable anchors open the existing review rail at the matching thread.
3. **Persist without a disappearing-submit transition.** A completed semantic operation becomes a pending suggestion at a clear edit boundary and remains inline through mode exit, reload, and another authorized viewer. Exiting Suggesting changes authoring mode only; it does not submit an invisible batch or make proposed material vanish. Pending-save and failed-save states are explicit, and a failed proposal write cannot masquerade as a durable suggestion.
4. **Review the affected material, not serialized markdown.** The rail renders typed before/after content through the Content renderer, preserves formatting, identifies operation kind/author/time/status, and supports independent Accept/Reject where operations are compatible. Selecting a rail item focuses its Page anchor; selecting an anchor opens its rail item. Historical or stale operations retain an honest contextual fallback.
5. **Preserve context at narrow widths.** The narrow review surface may use a sheet, but it must provide the affected before/after material and a reliable return-to-anchor path. On widths that can support split review, the Page and decision surface remain simultaneously readable.

### Smallest implementation sequence

- Wire the existing typed suggestion model/controller into `VisualEditor` through a ProseMirror plugin that captures supported transactions and supplies decorations/markers. Delete the parallel plain-markdown draft as the source of suggestion semantics.
- Extend the existing Core suggestion aggregate only as needed for multiple stable operations and per-operation thread/decision identity; do not create a second Content-only persistence system.
- Hydrate durable pending operations through `useResourceSuggestions`, resolve their anchors against the canonical document, and render the same overlay used for local operations. Local operations transition to their returned durable IDs without visual replacement or focus loss.
- Replace the Comments rail's `operations[0]`/plain-text rendering with typed operation rows connected bidirectionally to editor anchors. Reuse existing review replies, reactions, unread, mute, deep links, and dispositions.
- Keep the already-shaped prepare/commit/publish acceptance path for canonical application. This repair changes proposal composition and presentation, not transaction ownership, access enforcement, or the SQL/Yjs authority boundary.

### Explicit exclusions for this repair

- No Property, database cell/schema, title, icon, cover, media, embed, local-file, or source-owned suggestions.
- No Accept all/Reject all, filtered-set review, AI summaries, or general change-graph work.
- No separate diff page, permanent review dashboard, duplicate discussion store, or canonical Yjs mutation while a suggestion is pending.
- No claim of complete Feature 7 availability; this remains the page-body parity slice of `content.revision.suggestions` and `content.diff.in-place`.

### QA evidence

The current exact-head report and screenshots are retained outside the product repository at `/Users/alicemoore/.codex/visualizations/2026/09/03/01a06892-a5f4-77d0-a834-27af7c39c530/suggested-edits-qa/HUMAN-QA.md`. They are task evidence, not intended shipping documentation.

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
authority-source: "User invoked $shape on 2026-09-04 after the second human QA pass of PR #4274 and requested an implementation plan against latest main."
authorized-scope:
  repositories:
    - /Users/alicemoore/.codex/worktrees/5438/agent-native
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
  revision: content-suggested-edits-shape-r4
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
      - Suggesting uses a compact labeled mode control with an independent accessible exit action
      - entering from page actions restores focus without leaving the trigger visually stuck
      - each supported semantic edit is visibly distinguished and independently anchored while authoring and after persistence or reload
      - unresolved or ambiguous anchors are explicit and never rendered at a plausible fallback location
      - additions use blue provisional treatment and deletions use readable gray strikethrough that clarifies on hover and focus
      - exiting Suggesting changes authoring mode without removing pending material, opening Comments, scrolling, or changing the utility panel
      - typed review renders exact before and after material without exposing serialized markdown syntax
      - suggestions use the ordinary anchored comment-thread interaction with chronological replies and per-thread decisions
      - Comments can show all discussion, ordinary comments only, or suggestions only without mutating editor state
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
    rationale: The repair crosses shared review persistence and collaborative SQL/Yjs mutation seams, so the existing default-off flag remains necessary for beta dogfooding and post-merge cross-client validation before ordinary-user enablement.
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
  smallest-compatible-delta: Preserve the existing Core executable-suggestion lifecycle, canonical mutation coordinator, and main's base-aware editor reconciliation; replace whole-session Markdown rediscovery and parallel suggestion cards with typed transaction capture, structural/fail-closed anchors, calm Notion-like mode and decorations, one ordinary anchored thread shell, and composable discussion filtering for the Content page-body slice.
  deferred-capabilities:
    - generic typed Property/Database/media proposals
    - filtered bulk review
    - named Versions and selective cross-Version merge
    - local-file and provider suggestion synchronization
  reversibility: A default-off app-owned feature flag keeps dormant code inactive; suggestion tables are additive; pending proposals never alter canonical content.
  direct-evidence:
    - verified Notion Suggested Edits interaction memo dated 2026-09-01
    - human QA recording HQTpXgtD7rxX dated 2026-09-04
    - origin/main e4364cd716 integrated locally at merge commit 713e8a7c29
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
  status: blocked
  summary: WORK PAUSED — RETURNING TO SHAPE. PR #4274 remains acceptance-blocked: the second human QA pass shows wrong-location deletions, stuck menu focus, coupled mode-exit navigation, unusable inline activation, a parallel suggestion-card UI, and no comments-only filter.
  evidence:
    - templates/content/docs/solutions/evidence/suggested-edits-accept-reject.png
    - focused Core and Content automated suites
  remaining:
    - typed ProseMirror operation capture with stable structural/fail-closed anchors
    - calm Suggesting control, focus restoration, independent exit, and Notion-like addition/deletion presentation
    - one ordinary anchored thread shell for comments and suggestions with reliable bidirectional focus
    - All, Comments, and Suggestions content filtering across desktop, narrow, and history views
    - commenter/editor role-separated acceptance
    - accountable agent proposal acceptance
    - two-client sync and narrow-width accessibility acceptance
    - independent technical review closure
  blockers:
    - exact-head real-interface QA in HQTpXgtD7rxX failed the anchoring, mode-control, visual treatment, thread interaction, and filtering assertions
  last-land-packet: null
change-record:
  from-revision: content-suggested-edits-shape-r3
  to-revision: content-suggested-edits-shape-r4
  trigger: The second human QA recording proved that r3's partial overlay repair still violates the Notion-parity interaction contract and that latest main adds reconciliation/comment seams the repair must preserve.
  preserved:
    - outcome, shipping surfaces, and supported Page-body parity boundary
    - shipping surfaces and ownership split between Core and Content
    - default-off feature-flag risk strategy
    - prepare/commit/publish canonical mutation coordination
  changed:
    - structural and fail-closed anchor behavior is now explicit, including prohibition of top-of-document fallback
    - mode exit is separated from persistence selection, scrolling, and Comments navigation
    - the visual contract freezes blue additions, gray struck deletions, hover/focus legibility, and no persistent active outline
    - suggestions must use the ordinary anchored comment-thread shell rather than custom nested review cards
    - Comments gains a composable All, Comments, and Suggestions content filter
    - current main's base-aware reconciliation is a preserved implementation seam
ledger-revision: content-suggested-edits-shape-r4
status: shape-complete
```

## Superseded Work envelope

```yaml
stage: shape
authority-source: "The 2026-09-04 QA evidence materially changed the acceptance story and invalidated the prior r3 Work envelope."
ledger-revision: content-suggested-edits-work-r3-1
governing-artifact:
  path: templates/content/docs/solutions/2026-09-02-content-suggested-edits-parity-shape.md
  revision: content-suggested-edits-shape-r3
allowed-mutations:
  - artifact-write
  - ephemeral-test-resource
  - commit
  - push
  - pull-request
write-targets:
  repositories:
    - /Users/alicemoore/.codex/worktrees/5438/agent-native
  artifacts:
    - templates/content/docs/solutions/2026-09-02-content-suggested-edits-parity-shape.md
test-resources:
  - id: content-suggested-edits-r3-page
    kind: record
    surface: local Content SQLite page BI4G0ihYdTeK at http://127.0.0.1:8080
    ownership-marker: title "QA Suggested Edits 2026-09-03 A"
    baseline: task-created disposable page with Alpha, Beta, and Gamma baseline sentences before its first suggestion
    allowed-actions: [update, exercise, delete]
    cleanup-trigger: before Work completion
    cleanup-method: delete the exact page and its suggestion/review/version/collaboration rows through the local Content action or exact database transaction
    cleanup-proof: independently query every affected table for exact page id BI4G0ihYdTeK and observe zero rows
    shared-impact: none
    isolation: local-runtime
    ownership: task-created
    production-data: false
    customer-data: false
    cost: none
    boundary-evidence:
      - unique task marker and exact returned page id
      - local demo-only runtime at 127.0.0.1:8080
    max-lifetime-minutes: 720
    declared-at: 2026-09-03T15:30:00-04:00
    expires-at: 2026-09-04T03:30:00-04:00
    status: active
    phase: work
acceptance-reconciliation: consistent — schema-v3 real-interface, preferred independence, same-context-allowed custody
task-attention: autonomous
status: return-to-shape
invalidation-banner: WORK PAUSED — RETURNING TO SHAPE
```

## Next step

Invoke `/work templates/content/docs/solutions/2026-09-02-content-suggested-edits-parity-shape.md` to revise PR #4274 against r4. Work begins with typed ProseMirror capture and structural anchor resolution, then replaces the parallel suggestion cards with the ordinary anchored thread shell before visual polish or filtering. The PR remains acceptance-blocked until the complete exact-head real-interface story passes; a correct persistence action is insufficient when the edit appears in the wrong place or the discussion cannot be operated naturally.
