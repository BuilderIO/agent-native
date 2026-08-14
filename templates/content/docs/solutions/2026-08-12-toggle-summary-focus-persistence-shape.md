# Preserve Toggle summary, focus, and structure after Enter

## Summary

Content has a confirmed Toggle editing defect that is separate from the
unreproduced report that Content froze while someone was "entering toggle."
On the unchanged artifact tested on 2026-08-08, editing a Toggle summary to
`toggle` and pressing Enter returned promptly, but created a second empty
Toggle, left neither summary focused, and lost the edited summary after reload.
The console also reported `TextSelection endpoint not pointing into a node with
inline content (notionToggle)`.

## 2026-08-13 return-to-Shape diagnosis

Alice's one-tab local acceptance run exposed a branch-only regression after the
Notion interaction implementation: deleting characters from a Toggle summary
caused earlier characters to reappear. The same local runtime preserved ordinary
bullet edits and paragraphs inside the Toggle, and Alice confirmed production did
not show the summary behavior. This is a regression in the current branch's
summary-edit path. It is not the unreproduced original freeze, the earlier
summary-Enter persistence defect, or the separately triaged two-tab synchronization
issue.

The first incorrect boundary is now identified from the complete local call chain:

1. A Toggle summary is a controlled HTML `<input>` outside ProseMirror's editable
   DOM. Consequently, focusing the summary leaves `editor.isFocused === false`.
2. The branch correctly changed a summary keystroke into a local node-attribute
   transaction with `uiEvent: "input"`, allowing `VisualEditor` to serialize and
   emit the edit even though ProseMirror itself is blurred.
3. `DocumentEditor` saves the latest emitted document after a 500 ms debounce. A
   save or poll can therefore return an earlier partial summary while a later
   local summary edit is already visible.
4. The shared `useCollabReconcile` hook records every recent local emission and has
   an explicit guard against reapplying such partial save echoes. That guard is
   conditioned on `editor.isFocused && recentLocalTransaction`.
5. Because the focused summary input never makes `editor.isFocused` true, the
   guard does not apply. A partial SQL echo with a newer timestamp is treated as
   authoritative and surgically reapplied to the Toggle node. React then renders
   the restored node attribute into the controlled input.

This mechanism predicts the observed scope exactly: Toggle summary characters can
return, while Toggle body paragraphs and ordinary bullets are protected because
their keystrokes occur inside ProseMirror and make `editor.isFocused` true. It also
explains why the old summary implementation lost edits: before this branch added
explicit user-input transaction metadata, an external summary input did not
reliably enter the collaborative persistence path at all.

The native runtime prerequisite was separately repaired without tracked changes.
The shell had rebuilt `better-sqlite3` under Node 24 / ABI 137, while
`agent-native dev` launches its environment worker under Node 26 / ABI 147. A
direct Node 26 `node-gyp rebuild --release` produced a module that loads under ABI
147 and allowed the Content server to boot. Restarting invalidated the ephemeral
local-development login before a new instrumented trace could be captured. Shape
does not exercise or recreate test resources, so the reporter Clip plus the
deterministic source trace are the current pre-fix evidence; the exact instrumented
before/after capture remains a Work assertion.

### Repair decision

Do not weaken reconciliation globally by treating every recent emission as active
typing: a legitimate external restore can intentionally match a recently emitted
value. Instead, add a narrow shared-reconciler input that answers whether focus is
inside any editor-owned editing surface. Content supplies `true` when either
ProseMirror or its Toggle summary input owns focus. The reconciler then uses that
semantic focus signal for its existing recent-local-edit deferral and stale-echo
guard. No parallel Toggle state, special save route, longer debounce, or blanket
poll suppression is added.

This is a material architecture and shipping-surface change from the approved
Work fingerprint because the smallest honest repair now touches the shared editor
toolkit contract, not only Content's local Toggle implementation.

`WORK PAUSED — RETURNING TO SHAPE`

Old fingerprint:

- shipping surface: Content template visual editor only;
- governing architecture: repair entirely among Content's Toggle React node view,
  ProseMirror transaction/selection model, and existing collaborative persistence;
- acceptance story: the Notion-style Toggle matrix persists through reload with
  no focus loss, selection warning, or repeated persistence/render loop.

Proposed replacement fingerprint:

- shipping surfaces: Content's Toggle summary interaction and the shared editor
  toolkit's collaboration-reconciliation focus contract, both integrated through
  the public Agent Native repository by merge;
- governing architecture: Content reports semantic editor-owned focus to the
  existing shared reconciliation hook; that hook remains the sole owner of
  stale-echo and external-snapshot arbitration;
- acceptance story: retain every existing Notion Toggle assertion, and add a
  joined regression where rapid summary deletion survives intermediate save/poll
  echoes, multiple reconciliation cycles, and reload while a genuinely newer
  external edit still reconciles after local editing settles;
- risk strategy: unchanged `system-ready`; no merge-then-test or feature flag.

This brief shapes only that confirmed focus/persistence loss. It does not claim
that the defect caused the original freeze or the later reporter Clip's
transient disappearance, and it does not reopen the freeze investigation.

## Context and evidence boundary

- Codex thread `019fd8a9-d1f7-7172-b795-cc547dfce66f` tested six distinct
  Toggle-entry paths on product artifact
  `6ad763410612c69873a37ba76d82c0fd3b325dde`. Every path remained responsive.
- In the sixth path, filling the summary took 16 ms, Enter returned in 20 ms,
  and a zero-delay event-loop probe returned immediately. The reported freeze
  was not reproduced.
- That same path separately failed its durable-edit assertion: Enter created a
  sibling empty Toggle, focus was lost, reload retained only one empty Toggle,
  and the edited summary disappeared.
- Reporter attachment `F0BNKG13W7L` remains unreadable.
- Reporter Clip `7kkuRxVJbzAi` shows an existing Toggle, body typing, transient
  disappearance and return, then collapse, expansion, and deletion. It does not
  show summary Enter, reload persistence, or an event-loop freeze. It is not
  causal evidence for this repair.
- No implementation, commit, pull request, deployment, or production-data
  mutation exists for either issue.
- The relevant Toggle insertion, summary, Enter, focus, and persistence source
  files are unchanged between the tested artifact and the current shaping
  checkout at `573ca53f5170989cf1aa43a4aeac53207ea52f71`.
- The current deployed Content site is healthy, but its public surface does not
  expose the deployed build SHA. Current production reproduction is therefore
  not claimed.

## Problem

A writer can edit a Toggle summary and press Enter without freezing Content,
yet the editor may strand focus and fail to preserve the visible edit and
resulting structure. An interaction that appears to succeed but silently loses
the summary after reload violates the document editor's canonical-content
promise. The absence of a hang is cold comfort when the sentence quietly walks
into the sea.

## Interaction decision

The first Shape revision assumed that the current Enter behavior—creating a
sibling Toggle—was settled product intent. Alice challenged that assumption
before Work. A disposable prototype compared three possible behaviors, but it
was not clear enough to decide the product contract and has been discarded.

Alice then supplied reporter Clip `4uPD6JgAviTC`, “Notion Toggle Creation and
Enter-Key Behavior,” and directed Content to copy the demonstrated Notion
behavior exactly. Frame evidence and Alice's explicit clarification settle the
interaction contract:

- `> ` creates an expanded Toggle whose summary placeholder is `Toggle`;
- a structurally empty expanded Toggle shows `Empty toggle. Click or drop blocks
inside.` without storing a paragraph;
- clicking that empty-body affordance materializes and focuses a real empty
  paragraph inside the Toggle;
- the disclosure caret is muted only while the Toggle has zero child blocks; it
  becomes active when at least one child paragraph exists, even when empty;
- Enter on a completely empty new Toggle removes it and leaves an ordinary empty
  paragraph at the same position;
- Enter after a nonempty summary in an expanded Toggle creates and focuses the
  first inner paragraph;
- Enter in a body paragraph creates another paragraph inside the Toggle;
- Shift-Tab in an inner paragraph outdents that paragraph, moving it immediately
  after the Toggle and keeping focus in the moved paragraph;
- when Shift-Tab removes the last child, the Toggle returns to its structural
  empty affordance and muted disclosure caret;
- Enter from the summary of a collapsed Toggle creates one collapsed sibling
  Toggle below and focuses its summary;
- all visible summaries, child paragraphs, order, expansion state, and focus
  destination persist through the ordinary save/reload path.

Where narration and frames differ, the frame sequence governs. The Clip is
reference evidence for this separate interaction repair; it does not establish
the cause of the original freeze.

Prototype evidence manifest:

- Question: what should Enter do from an edited Toggle summary?
- Observer and decision: Alice rejected the prototype as unclear, then replaced
  it with the supplied Notion Clip and an explicit copy-exactly instruction.
- Sandbox: `/tmp/content-toggle-enter-prototype`.
- Allowed state: one self-contained `index.html` and a localhost static server
  on port 4178 for collaborative inspection.
- Inspection path: interactive browser switcher, summary editing, Enter,
  immediate typing, and simulated save/reload.
- Verified transitions: A focused Toggle 2 summary with two Toggles; B focused
  Toggle 1 body with one Toggle; C focused a paragraph below with one Toggle.
- Known omission: the collaborative preview's keyboard-press tool encoded
  Enter incorrectly during automated driving, so verification dispatched the
  same bubbling cancelable `keydown` event directly. Human browser interaction
  was not production acceptance evidence.
- Disposition: discarded after Alice replaced it with the Notion Clip as the
  governing interaction reference; rebuild production behavior fresh under
  Work.

## Desired outcome

When a signed-in Content writer creates and edits a Toggle, its creation,
structural-empty state, disclosure caret, Enter behavior, Shift-Tab outdent,
focus handoffs, and durable structure match the Notion reference contract above.
The ordinary collaborative save and reload path preserves the result, and no
TextSelection warning is introduced.

## Options considered

1. Continue treating this as evidence for the original freeze. Rejected: the
   exact freeze build and gesture remain unknown, and all six bounded paths were
   responsive.
2. Preserve the current sibling-Toggle Enter behavior everywhere. Rejected:
   Alice's Notion reference establishes context-sensitive Enter behavior.
3. Implement the bounded Notion interaction contract at the existing Toggle
   node-view, transaction, selection, and persistence boundary. Recommended: it
   resolves the product ambiguity while keeping the original freeze causally
   separate.

## Product classification

- Lane: contract repair
- Feature: `content.feature.durable-foundations`
- Capability: `content.author.document-editor`
- Existing promise: the visual editor preserves canonical Blocks content
  through edits and reloads and reports collaboration failures honestly.
- Record change: none expected unless implementation discovers that the
  accepted contract itself is incomplete or must change.

## Recommended direction

Reproduce the exact summary-edit/Enter/reload sequence on an approved disposable
local Content page, then correct the smallest boundary responsible for the
failed joined behavior. The fix should preserve the current model:

- `notionToggle` remains the canonical block type;
- the React node view owns summary input and the Enter gesture;
- TipTap/ProseMirror owns document transactions and selection;
- `VisualEditor` and the existing collaboration stack own persistence;
- no parallel local state, save route, API, schema, or provider path is added.

Implementation must establish how the current node schema and node view should
represent zero children versus an empty child, why the summary transaction can
be dropped, how context-sensitive Enter and Shift-Tab should target valid
ProseMirror positions, and whether collaborative save serializes an intermediate
document. That is diagnostic work inside the frozen boundary, not a menu of
patches to apply speculatively.

## Constraints and exclusions

- Do not claim this repair explains the original freeze or Clip
  `7kkuRxVJbzAi`.
- Do not use Apoorva's, Sabena's, or any other person's production page,
  account, or data.
- Create no fixture outside the exact disposable manifest declared for Work.
- Do not redesign Toggle, slash commands, blockquote shortcuts, collaboration,
  or editor persistence generally.
- Do not change provider integrations, schemas, auth, access, or source truth.
- Preserve other slash commands, pointer activation, Toggle delete and
  Backspace behavior, serialization, and collaborative editing except for the
  explicitly changed Toggle creation, Enter, child, caret, and outdent contract.
- Shape authorizes only this brief. It does not authorize implementation,
  commits, pushes, a pull request, merge, deployment, Slack messages, or vault
  mutation.

## Architecture grounding and fit

Architecture grounding is **not required** beyond this bounded record because
the repair stays inside an existing local editor contract and changes no shared
platform seam or public vocabulary.

- Demonstrated caller and request: a signed-in Content writer creates or edits a
  Toggle, moves among its summary and child paragraphs with Enter and Shift-Tab,
  and reloads without losing canonical content or structure.
- Existing primitives:
  - `ToggleView` in `NotionExtensions.tsx` controls the summary input, calls
    `updateAttributes`, inserts the sibling `notionToggle`, and hands off focus;
  - `focusMostRecentEmptyToggleSummary` provides existing summary-focus
    behavior for Toggle creation;
  - `VisualEditor.tsx` owns the existing collaborative update, reconciliation,
    and save guards;
  - current markdown and NFM tests prove isolated Toggle serialization but not
    this joined interaction.
- Ownership boundaries: React owns the DOM input; ProseMirror owns document
  transactions and valid selections; the existing collaboration path owns
  durable save/reload behavior.
- Legacy contracts: unrelated slash commands, pointer activation, deletion,
  Backspace, serialization, collaboration, and honest error reporting remain
  unchanged. Existing Toggle Enter behavior is superseded only where the frozen
  Notion interaction contract says otherwise.
- Smallest compatible delta: one correction at the first proven dropped
  transaction, stale-node, invalid-selection, focus, or save-order boundary,
  with a joined regression test.
- Deferred capabilities: Toggle UX redesign, general editor performance,
  reporter-exact freeze diagnosis, Clip disappearance diagnosis, provider sync,
  and broad feedback reconciliation.
- Reversibility: localized TypeScript and test changes with no schema, data,
  provider, or migration work.
- Direct evidence: the 2026-08-08 six-path result; current
  `NotionExtensions.tsx`, `SlashCommandMenu.tsx`, and `VisualEditor.tsx`;
  `content.author.document-editor`; current Toggle serialization tests.
- Inference: the defect likely crosses the summary attribute, Enter
  transaction, focus, and persistence ordering boundary. The exact faulty
  operation remains for Work to prove.
- Unresolved owner questions: none. A public or shared contract decision is not
  needed for this bounded repair.

## Successful-user story

Story `content-toggle-notion-interaction-durable-v1`:

> A signed-in Content writer creates a Toggle with `> `, edits its summary and
> child paragraphs using Enter and Shift-Tab, collapses or expands it, reloads,
> and finds the same summaries, children, order, expansion state, and expected
> focus destinations, with structural-empty affordances and disclosure-caret
> state matching Notion and no silent loss or selection warning.

Required assertions:

1. On the pre-fix artifact, the approved disposable page reproduces the
   distinct defect: summary `toggle` plus Enter loses focus and/or the
   summary/structure after reload. If it no longer reproduces, Work stops with
   the changed evidence instead of inventing a repair.
2. `> ` creates one expanded Toggle focused in its `Toggle` summary; with zero
   children it shows the exact empty-body affordance without serializing a
   paragraph, and its disclosure caret is muted.
3. Clicking the empty-body affordance creates and focuses one real empty child
   paragraph; the disclosure caret becomes active despite the child having no
   text.
4. Enter on a completely empty new Toggle replaces it with an ordinary empty
   paragraph, while Enter after a nonempty expanded summary creates and focuses
   the first child paragraph and Enter in a child creates the next child.
5. Shift-Tab in a child paragraph moves that paragraph immediately after the
   Toggle and retains focus; removing the last child restores the structural
   empty affordance and muted disclosure caret.
6. Enter from a collapsed Toggle summary creates exactly one collapsed sibling
   Toggle below, focuses its summary, and preserves the first Toggle.
7. After the existing save settles and the page reloads, summaries, child
   paragraphs, order, expansion state, and bodies match the last visible editor
   state.
8. The interaction emits no `TextSelection endpoint not pointing into a node
with inline content` warning, unhandled rejection, transaction loop, render
   loop, or repeated persistence request.
9. Unrelated slash commands, pointer activation, collapse/expand/delete, and
   empty-summary Backspace retain their current behaviors.
10. Focused automated tests cover Toggle creation, structural-empty state,
    context-sensitive Enter, Shift-Tab outdent, focus handoff where testable,
    serialization, and reload persistence; the
    relevant existing Content editor tests and changed-file checks pass.
11. A current real-interface run against the exact review artifact exercises
    the full numbered interaction matrix above, save, and reload on the declared
    disposable page. Independent evidence is preferred when an independently
    acquirable browser is available, but same-context evidence is allowed and
    its custody must be stated plainly.
12. The Work handoff continues to report the original freeze as unreproduced and
    makes no causal claim about the reporter Clip.

Acceptance policy:

- Modality: `real-interface`, supported by focused automated regression.
- Independence: `preferred`.
- Custody: `same-context-allowed`.
- Interface: a fresh browser session against a task-owned local Content runtime
  and disposable page built from the exact review artifact.
- Rationale: this is an ordinary bounded interactive editor repair with no
  authentication, authorization, privacy, destructive, payment, or migration
  consequence. Independent evidence would add confidence, but its absence
  should not recreate the previous impossible acceptance gate.

## Risk strategy

`system-ready`, without a feature flag. This is a narrow existing-contract
repair proven before merge on an isolated local runtime. Production validation
after merge is not the acceptance plan.

## Proposed Work boundary

If Alice invokes Work for this exact brief, Work may:

- update the smallest Content editor source seam and matching focused tests;
- add one user-facing Content changelog entry if the behavior changes visibly;
- use one exact, time-bounded local runtime/database/account/page manifest with
  no production or customer data and verified cleanup;
- format and run focused checks, relevant guards, and exact-artifact
  real-interface acceptance;
- create a review-ready pull request from the current branch after technical
  acceptance.

Work stops before merge or deployment. Any change to the Enter behavior,
shipping surface, collaboration architecture, acceptance story, or feature-flag
strategy returns to Shape.

## Architecture fingerprint and Shape authority envelope

```yaml
authoritySchemaVersion: 3
stage: work
authority-source: Alice invoked $work on 2026-08-14 for revision shape-v4-summary-reconcile-return-to-shape.
authorized-scope:
  repositories:
    - BuilderIO/agent-native
  product-surfaces:
    - Content visual document editor Toggle summary Enter path
  outcome: Freeze a distinct repair that makes Toggle creation Enter Shift-Tab structural-empty caret focus and persistence behavior match the supplied Notion reference.
allowed-mutations:
  - artifact-write
  - ephemeral-test-resource
  - commit
  - push
  - pull-request
write-targets:
  artifacts:
    - templates/content/docs/solutions/2026-08-12-toggle-summary-focus-persistence-shape.md
    - packages/toolkit/src/editor/useCollabReconcile.ts
    - packages/toolkit/src/editor/useCollabReconcile.concurrent.spec.ts
    - templates/content/app/components/editor/extensions/NotionExtensions.tsx
    - templates/content/app/components/editor/VisualEditor.tsx
    - templates/content/app/components/editor/SlashCommandMenu.tsx
    - templates/content/app/components/editor/NotionToggle.interactions.test.ts
    - templates/content/app/components/editor/VisualEditor.markdown.test.ts
    - templates/content/app/global.css
    - templates/content/changelog/2026-08-12-toggle-blocks-now-follow-notion-style-enter-and-shift-tab-be.md
test-resources:
  - id: content-toggle-work-runtime-v1
    kind: server
    surface: localhost Content development runtime on port 4179
    ownership-marker: content-toggle-work-20260812
    baseline: port 4179 is unbound before startup
    allowed-actions: [create, exercise, delete]
    cleanup-trigger: before Work completion
    cleanup-method: terminate the exact task-owned process and verify the port is unbound
    cleanup-proof: 2026-08-13 read-back found no listener or task-owned process on port 4179
    shared-impact: none
    isolation: local-runtime
    ownership: task-created
    production-data: false
    customer-data: false
    cost: none
    boundary-evidence:
      - exact dedicated worktree and task marker are supplied to the local process
    max-lifetime-minutes: 1440
    declared-at: 2026-08-12T18:10:03Z
    expires-at: 2026-08-13T18:10:03Z
    status: cleaned
    phase: work
  - id: content-toggle-work-data-v1
    kind: database
    surface: task-local Content SQLite database under /tmp/content-toggle-work-20260812
    ownership-marker: content-toggle-work-20260812
    baseline: task-local directory does not exist before provisioning
    allowed-actions: [create, update, exercise, delete]
    cleanup-trigger: before Work completion
    cleanup-method: move the exact task-local directory to Trash after runtime shutdown
    cleanup-proof: 2026-08-13 read-back found the exact /tmp path absent after recoverable move to Trash
    shared-impact: none
    isolation: isolated-test-surface
    ownership: task-created
    production-data: false
    customer-data: false
    cost: none
    boundary-evidence:
      - database path is outside all configured production and customer stores
    max-lifetime-minutes: 1440
    declared-at: 2026-08-12T18:10:03Z
    expires-at: 2026-08-13T18:10:03Z
    status: cleaned
    phase: work
  - id: content-toggle-work-runtime-v2
    kind: server
    surface: localhost Content development runtime on port 4179
    ownership-marker: content-toggle-work-20260814
    baseline: port 4179 is unbound before startup
    allowed-actions: [create, exercise, delete]
    cleanup-trigger: before Work completion
    cleanup-method: terminate the exact task-owned process and verify port 4179 is unbound
    cleanup-proof: process absence plus failed localhost connection on port 4179
    shared-impact: none
    isolation: local-runtime
    ownership: task-created
    production-data: false
    customer-data: false
    cost: none
    boundary-evidence:
      - exact dedicated worktree and content-toggle-work-20260814 marker are supplied to the local process
    max-lifetime-minutes: 1440
    declared-at: 2026-08-14T16:42:28Z
    expires-at: 2026-08-15T16:42:28Z
    status: cleaned
    phase: work
  - id: content-toggle-work-data-v2
    kind: database
    surface: task-local Content SQLite database under /tmp/content-toggle-work-20260814
    ownership-marker: content-toggle-work-20260814
    baseline: exact task-local directory is absent before provisioning
    allowed-actions: [create, update, exercise, delete]
    cleanup-trigger: before Work completion
    cleanup-method: move the exact task-local directory to Trash after runtime shutdown
    cleanup-proof: filesystem absence at the exact declared path
    shared-impact: none
    isolation: isolated-test-surface
    ownership: task-created
    production-data: false
    customer-data: false
    cost: none
    boundary-evidence:
      - database path is outside every configured production and customer store
    max-lifetime-minutes: 1440
    declared-at: 2026-08-14T16:42:28Z
    expires-at: 2026-08-15T16:42:28Z
    status: cleaned
    phase: work
  - id: content-toggle-work-account-v2
    kind: account
    surface: dev@local.test inside content-toggle-work-data-v2 only
    ownership-marker: content-toggle-work-20260814
    baseline: account is absent before task-local database provisioning
    allowed-actions: [create, exercise, delete]
    cleanup-trigger: with content-toggle-work-data-v2 before Work completion
    cleanup-method: remove by deleting the containing task-local database directory
    cleanup-proof: containing database path is absent
    shared-impact: none
    isolation: isolated-test-surface
    ownership: task-created
    production-data: false
    customer-data: false
    cost: none
    boundary-evidence:
      - reserved local-only identity exists solely in the declared SQLite database
    max-lifetime-minutes: 1440
    declared-at: 2026-08-14T16:42:28Z
    expires-at: 2026-08-15T16:42:28Z
    status: cleaned
    phase: work
  - id: content-toggle-work-page-v2
    kind: record
    surface: Content document content_toggle_work_20260814_v1 inside content-toggle-work-data-v2
    ownership-marker: content-toggle-work-20260814
    baseline: document is absent before task-local database provisioning
    allowed-actions: [create, update, exercise, delete]
    cleanup-trigger: with content-toggle-work-data-v2 before Work completion
    cleanup-method: remove by deleting the containing task-local database directory
    cleanup-proof: containing database path is absent
    shared-impact: none
    isolation: isolated-test-surface
    ownership: task-created
    production-data: false
    customer-data: false
    cost: none
    boundary-evidence:
      - stable page ID and task marker are confined to the declared SQLite database
    max-lifetime-minutes: 1440
    declared-at: 2026-08-14T16:42:28Z
    expires-at: 2026-08-15T16:42:28Z
    status: cleaned
    phase: work
governing-artifact:
  path: templates/content/docs/solutions/2026-08-12-toggle-summary-focus-persistence-shape.md
  revision: shape-v4-summary-reconcile-return-to-shape
architecture-fingerprint:
  outcome: Implement the approved Notion Toggle interaction contract and repair focus and persistence loss without claiming or repairing the unreproduced freeze.
  shipping-surfaces:
    - id: content-toggle-summary-enter
      repository: BuilderIO/agent-native
      product-surface: Content visual document editor
      constituency: signed-in Content writers
      durable-destination: public Content template editor behavior
      integration-action: merge
    - id: shared-editor-reconcile-semantic-focus
      repository: BuilderIO/agent-native
      product-surface: shared editor toolkit collaboration reconciliation
      constituency: source-blind Agent Native app developers using editor-owned controls outside ProseMirror
      durable-destination: public Agent Native editor toolkit
      integration-action: merge
  governing-architecture: Content reports semantic editor-owned focus to the existing shared reconciliation hook, which remains the sole owner of stale-echo and external-snapshot arbitration; no parallel state or save mechanism is added.
  acceptance-story:
    id: content-toggle-notion-interaction-durable-v1
    summary: A writer creates and edits a Toggle using context-sensitive Enter and Shift-Tab then reloads and retains exact visible structure state and focus behavior without a selection warning.
    required-assertions:
      - pre-fix defect reproduces on the approved disposable page or Work stops with changed evidence
      - greater-than-space creates one expanded Toggle focused in its summary with a structural-empty affordance and muted caret
      - creating one real empty child activates the caret even before text exists
      - Enter on an empty Toggle exits to a paragraph while Enter after a nonempty expanded summary enters its body
      - Enter within a child creates another child and Shift-Tab outdents the current child while retaining focus
      - removing the last child restores the structural-empty affordance and muted caret
      - Enter from a collapsed summary creates and focuses exactly one collapsed sibling Toggle
      - summaries children order expansion state and bodies survive save and reload
      - no TextSelection warning or render transaction focus or persistence loop occurs
      - rapid Toggle summary deletion is not overwritten by an intermediate local save or poll echo while the summary input owns focus
      - a genuinely newer external edit still reconciles after the local summary interaction settles
      - unrelated Toggle and slash-command behavior remains unchanged
      - focused automated and exact-artifact real-interface evidence passes
      - the original freeze remains explicitly unreproduced and causally separate
    acceptance-policy:
      modality: real-interface
      independence: preferred
      custody: same-context-allowed
      interface: Fresh browser session on a task-owned local Content runtime and disposable page built from the exact review artifact.
      rationale: Ordinary bounded editor repair; independent evidence adds confidence but is not a gate when the same-context run and focused regression cover the exact interaction.
  risk-strategy:
    kind: system-ready
    production-validation-after-merge: false
architecture-grounding:
  applicability: required
  reason: The replacement repair adds a semantic-focus input to the shared editor toolkit reconciliation seam used by multiple apps.
  status: grounded
  demonstrated-callers:
    - Signed-in Content writer creates and edits a Toggle using Enter and Shift-Tab then reloads.
    - Content VisualEditor asks the shared reconciler to distinguish active editing in its external Toggle summary input from a settled editor eligible for external snapshots.
  existing-primitives:
    - ToggleView controlled summary and Enter handler
    - focusMostRecentEmptyToggleSummary
    - TipTap and ProseMirror document transaction and selection model
    - VisualEditor collaborative reconciliation and persistence
    - useCollabReconcile recent-emission ring and newer-snapshot arbitration
  ownership-boundaries:
    - React node view owns summary DOM interaction
    - ProseMirror owns canonical editor transactions and valid selections
    - VisualEditor collaboration owns durable save and reload
    - shared editor toolkit owns stale-echo and external-snapshot arbitration
  legacy-contracts:
    - unrelated slash-command behavior
    - pointer activation delete and Backspace behavior
    - Toggle serialization and collaborative persistence
    - existing shared-editor callers continue using ProseMirror focus unless they explicitly supply an editor-owned focus signal
  shared-vocabulary:
    - Toggle means the existing notionToggle block
    - Enter and Shift-Tab are context-sensitive structural editing gestures defined by the approved Notion reference
  smallest-compatible-delta: Add one optional semantic editor-owned focus input to useCollabReconcile and have Content include its Toggle summary input; preserve the default ProseMirror-focus behavior for every existing caller.
  deferred-capabilities:
    - original freeze diagnosis
    - reporter Clip disappearance diagnosis
    - Toggle UX redesign
    - general editor or persistence redesign
  reversibility: One optional toolkit input plus one Content integration and focused tests; no schema provider data or migration work.
  direct-evidence:
    - thread 019fd8a9-d1f7-7172-b795-cc547dfce66f latest completed result
    - artifact 6ad763410612c69873a37ba76d82c0fd3b325dde six-path run
    - current NotionExtensions SlashCommandMenu and VisualEditor source
    - packages/toolkit/src/editor/useCollabReconcile.ts recent-emission and focus gates
    - DocumentEditor 500 ms debounced canonical save path
    - Alice Clip bRM8cRvDr30R and confirmation that only the local Toggle summary reproduces
    - content.author.document-editor product record
  inferences: []
  unresolved-owner-questions: []
delegation-ceiling:
  - artifact-write
product-boundary-gates:
  agent-native-public-constituency: Any signed-in Content writer can encounter this public template behavior, and any source-blind app developer using an editor-owned control outside ProseMirror needs the shared reconciler to accept semantic focus without Alice's vault machines credentials or private orchestration.
  bowerbird-product-boundary: This repair has no Bowerbird product surface and remains separate from the private feedback task.
acceptance-state:
  status: passed
  summary: The approved Toggle interaction and semantic-focus reconciliation repair passed focused automated, type, guard, same-context browser, persistence, and independent technical review evidence; the original freeze remains unreproduced and out of scope.
  blockers: []
  last-land-packet: null
ledger-revision: content-toggle-summary-reconcile-work-v2
status: active
```

## 2026-08-14 Work evidence

- The pre-fix disposable browser trace reproduced the branch-only summary
  oscillation: rapid deletion changed `abcdef` to the intended shorter value,
  briefly restored an earlier partial value from a save or poll response, then
  returned to the intended value after the next save.
- The repair adds one optional `isEditorFocused` predicate to
  `useCollabReconcile`. Existing callers retain TipTap's `editor.isFocused`
  default. Content additionally treats focus in a contained
  `.notion-toggle__summary` input as editor-owned focus.
- The exact post-fix browser trace moved monotonically from `abcdef` through
  `abcde`, `abcd`, and `abc` to `ab`, retained summary focus, persisted `ab`
  through reload, and subsequently accepted a genuinely newer external value
  after focus left the summary.
- The same browser surface verified that Enter on a nonempty collapsed summary
  creates exactly one collapsed empty sibling and focuses its summary. The
  remaining structural Enter and Shift-Tab cases are covered by focused
  interaction tests using the real ProseMirror document model.
- Focused Content tests passed 68 of 68. Shared reconciliation tests passed 19
  of 19. Toolkit and Content typechecks passed after rebuilding the workspace
  toolkit declarations. All 51 repository guards passed, as did
  `git diff --check`.
- Independent bounded technical review found no material defect. It confirmed
  that shared reconciliation remains the sole snapshot arbitrator, that the
  selection targets are structurally valid, and that direct-child outdent
  preserves the intended Toggle boundary. Its only residual note is that DOM
  focus handoff is covered by the same-context browser evidence rather than the
  synthetic interaction helper test.
- The declared runtime, account, page, and SQLite database were removed by
  stopping port 4179 and moving `/tmp/content-toggle-work-20260814` to Trash.
  An accidental env-less action invocation created a fresh default local
  SQLite database but failed before document access; its exact three database
  files were immediately moved to a separate Trash folder and verified absent
  from the checkout.
- This evidence does not reproduce or explain the original freeze, does not use
  production data, and does not merge the separate two-tab synchronization or
  read-only loading-state defects into this repair.

## 2026-08-14 Land repair evidence

- The accepted browser run exposed a `TextSelection endpoint not pointing into
a node with inline content (notionToggle)` warning while hydrating the exact
  disposable Toggle page. Land stopped rather than treating the earlier green
  interaction evidence as sufficient.
- The warning originated in y-prosemirror's initial whole-document render: it
  recreated the placeholder paragraph selection at the same absolute position
  after replacement, which can be inside a zero-child Toggle. The shared
  collaboration extension now lets ProseMirror map the existing selection
  through that one initial replacement and restores upstream behavior
  immediately afterward.
- A regression mounts and remounts the same collaborative Y.Doc beginning with
  a zero-child Toggle, asserts that the summary hydrates, and rejects the exact
  invalid-TextSelection warning. The focused editor file passes 62 of 62 tests;
  a fresh browser load of the exact disposable page emitted no matching warning.
- The same independent reviewer performed the one bounded follow-up allowed
  after a finding changes the artifact and reported no material finding or Land
  blocker. The residual risk is that the focused regression does not separately
  assert a later remote cursor update, while the immediate `finally` restoration
  of upstream behavior makes a later-selection change unlikely.
- Toolkit tests passed 764 of 764, Toolkit and Content typechecks passed, the
  full formatter check passed, all 51 guards passed, and `git diff --check` was
  clean. Port 4179 was stopped and the disposable database directory was moved
  from `/tmp` back to Trash, then verified absent from `/tmp`.
- This initial-selection repair does not change the accepted Toggle gestures or
  broaden the claim about the original freeze, which remains unreproduced.
- GitHub's review agent then identified a distinct nested-Toggle focus edge:
  collapsed-summary Enter selected the next summary in DOM order, which could
  be a nested child rather than the newly inserted sibling. The repair now
  resolves the sibling node view by its exact post-transaction document
  position and focuses only that node's summary. A focused regression proves
  the position target in the presence of an earlier nested summary; the two
  editor test files pass 70 of 70.

## Natural next stage

Work is complete for this exact brief. Merge and deployment remain separate
Land authority.
