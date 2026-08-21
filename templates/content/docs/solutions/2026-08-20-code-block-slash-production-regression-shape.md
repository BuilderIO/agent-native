# Ordinary Code Block slash insertion production regression

## Decision

Treat the remaining report as a production-only contract regression until a
reporter-equivalent disposable fixture demonstrates the first divergent
boundary. Do not repeat the July 24 atomic `setCodeBlock()` repair without that
evidence: the current repository implementation and the current production
bundle already contain it, and the exact current repository snapshot passes
both Enter-key and pointer-selection insertion plus reload persistence in a
real local Content interface.

The Work lane is therefore narrow and fail-closed: reproduce the production
failure on an approved disposable fixture, capture the editor transaction and
save receipt, and repair only the first boundary that differs from the passing
current-head control. If the failure does not reproduce, Work stops with
changed evidence instead of manufacturing another Code Block implementation.

## Durable identity and coordinates

- Bowerbird task: `Repair Content slash-command image and code block insertion`
- Bowerbird ID: `b39ed5ea-738a-47d7-9300-62c07f49efc0`
- Supplied current Bowerbird revision:
  `c56ab46ffd312c412f971ab7db183951eb342ca2e9685a86127fd41856f77580`
- Historical Codex owner: `019ff1d3-9943-7603-9a35-29fa3a94c4e0`
- Repository: `BuilderIO/agent-native`
- Refreshed repository HEAD:
  `6203d5dba9095978b7d5681720b81953ce04638c`
- Production host: `https://content.agent-native.com`
- Observed production editor asset:
  `assets/VisualEditor-dwyChdnP.js`
- Shape ledger revision: `content-code-block-production-shape-v1`

No Bowerbird row, production/customer document, shipping source, commit, PR,
deployment, or task title was changed during Shape.

## Scope

### Owned outcome

A signed-in Content writer types `/code block` in an ordinary Page and can
insert one native Code Block with either Enter or pointer selection; the slash
query disappears atomically, the editor remains responsive, entered code saves,
and the same block and source return after reload.

### Explicit exclusions

- image insertion or upload completion;
- the adjacent Code Block UX task, including language controls, tabs, execution,
  rendered output, or styling;
- Mermaid insertion, rendering, fallback, or execution;
- registry-derived slash-command catalog behavior;
- broader slash-command discovery, grouping, or keyboard redesign;
- production/customer-data mutation during diagnosis or acceptance.

## Evidence

### Direct evidence

1. Current source routes both activation modes through the same
   `executeCommand` callback in
   `templates/content/app/components/editor/SlashCommandMenu.tsx`.
2. The ordinary Code Block command preserves the slash range and calls
   `setCodeBlockFromSlashCommand`, which chains `focus()`, optional
   `deleteRange(slashRange)`, and `setCodeBlock()` into one ProseMirror command.
3. After a document-changing command, `executeCommand` calls
   `onDraftCommitted`; `VisualEditor` binds that callback to
   `persistEditorContent(editor, { userInitiated: true })`.
4. `persistEditorContent` serializes the current editor document through NFM,
   registers the emitted collaborative value, and hands it to
   `DocumentEditor`'s queued 500 ms save boundary. Navigation/teardown has a
   separate flush path.
5. `CodeBlockNode.tsx` uses Tiptap's native Lowlight Code Block renderer. The
   historical React node view that could lock a collaborative editor is not the
   current renderer.
6. The July 24 commit
   `caedc1e6280a012561021eaf016d190da4d763cd` introduced the atomic conversion
   helper and its focused transaction test.
7. The focused current-head suite passed 31 of 31 tests. Its Code Block test
   proves the helper transaction, while its pointer test proves button-event
   deduplication; neither currently proves the full pointer/Enter -> command ->
   persistence -> reload story.
8. A disposable local Content runtime built from repository HEAD
   `6203d5dba9095978b7d5681720b81953ce04638c` exercised the real rendered
   editor:
   - Enter on exact `/code block` created one native `<pre><code>` block;
   - pointer selection of the ordinary `Code Block` item created a second native
     block;
   - `enter-path-marker` and the pointer marker both survived a full reload;
   - the final interface contained two native Code Blocks.
9. Production was inspected read-only. The deployed editor bundle contains
   `setCodeBlock`, `preserveSlashRange`, and `onDraftCommitted`, so production is
   not simply missing the known July 24 command and persistence seams.
10. Production interaction was not attempted because every available Page was
    persisted production/customer state and this Shape explicitly forbids
    mutating it.
11. The task-owned sandbox `/tmp/content-codeblock-shape-20260820`, its SQLite
    data, dependencies, and local Page were moved to
    `/Users/alicemoore/.Trash/content-codeblock-shape-20260820`. Port 4187 and
    the original sandbox path were independently absent afterward.

### Historical evidence

The prior owner reproduced current-head Code Block insertion and navigation
round-trip on August 12 and recommended hosted confirmation before closure.
That same run separated native Code Blocks from image media nodes and
registry-backed Mermaid blocks. The later image repair merged independently.

### Inferences

- Because both activation modes pass through one command and persistence path,
  a reporter-equivalent failure in both modes is more likely to occur at shared
  document state, collaboration, serialization/save, or artifact/environment
  boundaries than in the pointer or Enter event adapters individually.
- The production bundle's presence of current symbol seams is evidence of
  included logic, not proof that production runs the same complete source
  revision or that a specific persisted Page/Y.Doc state accepts the
  transaction.
- A local pass does not overturn the supplied current truth that production is
  broken; it rules out prescribing the already-landed atomic helper as the next
  repair without a production-equivalent failure trace.

### Unresolved

- No safe disposable production Page was available under Shape authority, so
  the exact production transaction, console, network, collaboration, and
  canonical read-back remain unobserved.
- Production did not expose a repository commit SHA in the inspected page or
  asset names. The exact deployment-to-commit coordinate remains unresolved.
- The supplied Bowerbird revision could not be independently read back without
  sending a new app request, which Shape forbids. It remains the governing
  durable coordinate supplied by Alice.

## Architecture grounding

Grounding is not required beyond the bounded local repair boundary. The
demonstrated caller is one signed-in Content writer inserting an ordinary native
Code Block into a Page. Existing ownership is already clear:

- `SlashCommandMenu` owns discovery and Enter/pointer command dispatch;
- ProseMirror/Tiptap owns the atomic document transaction and selection;
- `CodeBlockNode` owns native Code Block schema/rendering behavior;
- `VisualEditor` owns collaborative serialization and the explicit
  post-command persistence request;
- `DocumentEditor` owns queued canonical save, teardown flush, and durable
  document mutation.

The smallest compatible delta is the first one of those existing owners proven
to diverge on the reporter-equivalent fixture. No parallel command, renderer,
save channel, or Code Block type is permitted. Legacy contracts that must remain
unchanged are all unrelated slash commands, images, registry blocks, Mermaid,
ordinary typing and history, NFM round-trip, collaboration, and canonical Page
persistence.

## Smallest repair boundary

Work must not begin with a guessed code change. It must capture these four
checkpoints for both Enter and pointer paths on the same disposable artifact:

1. **Dispatch:** the ordinary `Code Block` item is selected once with the live
   slash range.
2. **Transaction:** the post-command ProseMirror document contains one native
   `codeBlock`, no slash query, a valid selection, and a responsive editor.
3. **Persistence request:** `onDraftCommitted` serializes the post-command
   document and produces a distinguishable success or failure result.
4. **Durable read-back:** canonical Page content contains the fenced Code Block,
   and reload reconstructs it.

Repair only the first failed checkpoint:

- dispatch failure -> repair the shared `executeCommand` activation boundary;
- transaction failure -> repair the one atomic conversion helper or valid
  selection mapping, without changing Code Block UX;
- persistence-request failure -> repair the existing explicit post-command
  persistence call or its truthful failure propagation;
- durable-read-back failure -> repair the existing save/reconcile boundary and
  preserve current transaction behavior.

If all four checkpoints pass in the reporter-equivalent fixture, no shipping
repair is justified; classify the production report as stale or
document-specific and return to Shape with that evidence.

## Frozen successful-user-story acceptance

**Persona:** A signed-in Content writer editing an ordinary Page.

**Starting state:** A task-owned disposable Page on an isolated local runtime,
branch preview, or other approved non-production surface built from the exact
review artifact. The Page begins with two empty paragraphs and no Code Blocks.
No production/customer document is used.

**Disposable data:** One Page with a task marker, exact stable ID, initial
canonical-content read-back, and a declared create/exercise/delete manifest.

H1. Focus the first empty paragraph and type the exact text `/code block`.
Press Enter once.
Functional expectation: the slash query is removed and exactly one native
Code Block appears; the editor remains responsive and focused in the block.
Visual expectation: one ordinary Code Block is visible with no Mermaid,
registry-block, image, or execution controls.
Evidence: interaction trace, post-command editor JSON/DOM, and console.

H2. Type `enter-path-marker`, press Tab, and continue typing.
Functional expectation: the marker and tab are accepted without lockup or
duplicate block creation.
Visual expectation: source remains legible in the ordinary Code Block.
Evidence: visible block text and editor transaction state.

H3. Focus the second empty paragraph, type `/code`, and click the ordinary
`Code Block` item once with the pointer.
Functional expectation: the slash query is removed and exactly one second
native Code Block appears; click/mousedown deduplication creates no third
block.
Visual expectation: the selected item and resulting block are the ordinary
Code Block, not `Code`, `Code tabs`, `Diagram`, or another catalog item.
Evidence: pointer event/command trace and post-command editor JSON/DOM.

H4. Type `pointer-path-marker` in the second block.
Functional expectation: typing remains responsive and the two blocks retain
distinct source.
Visual expectation: both ordinary Code Blocks remain visible and usable.
Evidence: visible source and console.

H5. Observe the explicit post-command persistence result for each insertion,
wait for the canonical save, then navigate away and back or reload.
Functional expectation: neither persistence request is silently skipped or
reported successful on failure; canonical read-back contains exactly two
fenced Code Blocks with their respective markers, and reload reconstructs
both.
Visual expectation: both blocks return without slash text, loading lock,
error fallback, Mermaid rendering, or duplicate blocks.
Evidence: save request/result, canonical action or database read-back, fresh
reload screenshot/DOM, and console/network record.

**Regression checks:** Existing atomic conversion, pointer deduplication,
slash-command menu, NFM round-trip, collaborative editor, and focused Content
tests pass. Image, Mermaid, registry catalog, and Code Block UX assertions are
limited to proving they did not change.

**Cleanup:** Delete only the declared Page and isolated data/runtime, verify its
stable ID and sandbox path are absent, stop the exact task-owned process, and
verify its port is unbound. A successful delete response alone is not cleanup
proof.

**Acceptance policy:**

- modality: `real-interface`
- independence: `preferred`
- custody: `same-context-allowed`
- interface: fresh browser session against a task-owned isolated Content runtime
  or branch preview built from the exact review artifact, with canonical
  read-back
- rationale: this is a bounded editor interaction and durability repair;
  same-context real-interface evidence plus exact-artifact automated coverage is
  proportionate, while independent technical review remains useful for any
  collaboration or persistence change

## Exact Work handoff

Invoke:

`/work templates/content/docs/solutions/2026-08-20-code-block-slash-production-regression-shape.md`

Work must:

1. refresh the Bowerbird task at exact ID and revision and stop on an unexpected
   revision or broadened outcome;
2. bind the exact repository head, production asset identity, and review
   artifact before mutation;
3. declare an isolated fixture manifest with exact account/database/Page/port,
   baseline, stable IDs, expiry, and cleanup proof;
4. reproduce H1-H5 on the pre-fix exact artifact; if the production-equivalent
   defect does not reproduce, stop with changed evidence and return to Shape;
5. capture all four dispatch/transaction/persistence/read-back checkpoints and
   repair only the first failed owner;
6. add focused coverage that drives the full Enter and pointer command paths
   through `onDraftCommitted`, plus the smallest persistence/reload regression
   required by the observed failure;
7. run the frozen H1-H5 story against the exact review artifact and complete
   cleanup before reporting Work complete;
8. keep image insertion, Code Block UX, Mermaid, and slash-command catalog work
   out of the diff and PR prose.

## Lifecycle authority envelope

```yaml
authoritySchemaVersion: 3
stage: shape
authority-source: Alice's delegated $shape request on 2026-08-20
authorized-scope:
  repositories:
    - BuilderIO/agent-native
  product-surfaces:
    - Content ordinary native Code Block slash insertion and canonical Page persistence
  outcome: Restore production ordinary Code Block insertion through both Enter and pointer activation without absorbing adjacent editor work.
allowed-mutations:
  - artifact-write
  - prototype-sandbox-write
write-targets:
  artifacts:
    - templates/content/docs/solutions/2026-08-20-code-block-slash-production-regression-shape.md
  prototype-sandboxes:
    - /tmp/content-codeblock-shape-20260820
governing-artifact:
  path: templates/content/docs/solutions/2026-08-20-code-block-slash-production-regression-shape.md
  revision: content-code-block-production-shape-v1
architecture-fingerprint:
  outcome: Restore production ordinary Code Block insertion through Enter and pointer activation with truthful canonical persistence.
  shipping-surfaces:
    - id: content-ordinary-code-block-slash
      repository: BuilderIO/agent-native
      product-surface: Content visual Page editor ordinary native Code Block insertion and persistence
      constituency: signed-in Content writers
      durable-destination: public Content template behavior in BuilderIO/agent-native
      integration-action: merge
  governing-architecture: SlashCommandMenu dispatches one atomic native Code Block transaction, VisualEditor explicitly requests persistence, and DocumentEditor remains the sole canonical save owner.
  acceptance-story:
    id: content-code-block-slash-production-v1
    summary: A signed-in writer inserts two ordinary native Code Blocks by Enter and pointer, types in both, and reloads with both blocks and source preserved.
    required-assertions:
      - pre-fix production-equivalent defect reproduces or Work stops with changed evidence
      - Enter removes the slash query and creates exactly one native Code Block
      - pointer selection removes the slash query and creates exactly one second native Code Block
      - editor typing and Tab remain responsive with no lockup or duplicate block
      - each explicit persistence request reports success or failure truthfully
      - canonical read-back and reload preserve exactly two fenced Code Blocks and their distinct markers
      - focused automated and exact-review-artifact real-interface evidence pass
      - image Code Block UX Mermaid and catalog behavior remain unchanged and out of scope
    acceptance-policy:
      modality: real-interface
      independence: preferred
      custody: same-context-allowed
      interface: Fresh browser session on a task-owned isolated Content runtime or branch preview built from the exact review artifact, with canonical read-back.
      rationale: Bounded editor interaction and persistence repair; same-context real-interface proof is proportionate, with independent technical review for collaboration or persistence changes.
  risk-strategy:
    kind: system-ready
    production-validation-after-merge: false
architecture-grounding:
  applicability: not-required
  reason: Bounded local repair within established slash transaction and canonical save owners; no shared contract, schema, identity, or public vocabulary changes are permitted.
  status: grounded
  demonstrated-callers:
    - Signed-in Content writer typing /code block and activating ordinary Code Block by Enter or pointer.
  existing-primitives:
    - SlashCommandMenu executeCommand
    - setCodeBlockFromSlashCommand
    - native CodeBlockLowlight extension
    - VisualEditor persistEditorContent and onDraftCommitted
    - DocumentEditor queued save and teardown flush
  ownership-boundaries:
    - SlashCommandMenu owns dispatch
    - ProseMirror owns atomic transaction and selection
    - VisualEditor owns serialization and persistence request
    - DocumentEditor owns canonical save and read-back
  legacy-contracts:
    - unrelated slash commands and catalog
    - image and media insertion
    - Mermaid and registry blocks
    - Code Block UX and execution
    - NFM collaboration history and canonical Page persistence
  shared-vocabulary:
    - ordinary Code Block means the native Tiptap codeBlock node, not a registry Code or Mermaid block
  smallest-compatible-delta: Repair only the first demonstrated divergent dispatch, transaction, persistence-request, or durable-read-back boundary; add no parallel command, renderer, save channel, or block type.
  deferred-capabilities:
    - image insertion
    - Code Block UX
    - Mermaid rendering
    - slash-command catalog expansion
  reversibility: One bounded existing-owner repair plus focused tests; no schema, migration, provider data, or new persisted representation.
  direct-evidence:
    - repository HEAD 6203d5dba9095978b7d5681720b81953ce04638c
    - production asset VisualEditor-dwyChdnP.js
    - current-head isolated real-interface Enter pointer and reload pass
    - focused SlashCommandMenu suite 31 of 31 pass
    - historical owner 019ff1d3-9943-7603-9a35-29fa3a94c4e0
  inferences:
    - reporter-equivalent dual-path failure likely lies in a shared document, collaboration, persistence, or environment boundary
  unresolved-owner-questions: []
delegation-ceiling:
  - artifact-write
product-boundary-gates:
  agent-native-public-constituency: Signed-in Content writers use this public template editor behavior; no Alice-private credential, orchestration, or vault-only dependency is required.
  bowerbird-product-boundary: Bowerbird supplies durable task identity only; no Bowerbird product behavior changes.
acceptance-state:
  status: pending
  summary: Shape is complete; current source and production bundle contain the known repair, current-head real-interface control passes, and Work must reproduce the production-equivalent failure before any shipping change.
  blockers:
    - Reporter-equivalent production transaction and durable read-back are unavailable without an approved disposable non-production fixture under Work authority.
  last-land-packet: null
ledger-revision: content-code-block-production-shape-v1
status: active
```

## Prototype disposition

Question: Do Enter and pointer activation fail at one shared transaction or
persistence boundary on current repository head?

Observer and decision: The owning Work thread uses the result to decide whether
the next repair belongs to dispatch, transaction, persistence request, or
durable read-back.

Artifact: Disposable local runtime and SQLite state formerly at
`/tmp/content-codeblock-shape-20260820`, built from repository HEAD
`6203d5dba9095978b7d5681720b81953ce04638c` and driven at
`http://127.0.0.1:4187/page/CmzxL4fTUtnZ`.

Observations: Both activation modes created native Code Blocks and both markers
survived reload. The local control did not reproduce the supplied production
failure.

Verdict: Current source does not justify another atomic helper repair. Work must
obtain the reporter-equivalent failure trace and patch only the first divergent
existing owner.

Unresolved: Exact production transaction and canonical read-back.

Disposition: preserve this document as evidence; sandbox moved to Trash and
prohibited from promotion.

Authority: Shape, ledger `content-code-block-production-shape-v1`, sandbox
`/tmp/content-codeblock-shape-20260820`, local prototype state only, disposed
after observation.

Next: `/work templates/content/docs/solutions/2026-08-20-code-block-slash-production-regression-shape.md`

## Work execution record

Work lane: `codex/repair-content-code-block-slash` at repository revision
`07e0de38223d646cd847dd59c8ba376a43c3f83d`, refreshed from `origin/main` on
2026-08-20. No commits between the
Shape revision and this Work base touched `SlashCommandMenu.tsx`,
`VisualEditor.tsx`, `CodeBlockNode.tsx`, or `DocumentEditor.tsx`.

Acceptance reconciliation: consistent with schema v3. The frozen modality is a
real interface, independence is preferred, and same-context custody is allowed.

Test-resource manifest:

- resource id: `content-codeblock-work-20260820`
- owner: this Work execution only
- runtime: task-owned local Content dev server on `127.0.0.1:4188`
- canonical store: `/tmp/content-codeblock-work-20260820/content.db`
- scope: task-owned disposable Pages created only to isolate and exercise the frozen H1-H5 story
- allowed mutations: create, edit, save, reload, read back, and delete this fixture
- prohibited mutations: production, customer, shared staging, or unrelated local data
- expiry: 240 minutes after creation
- cleanup trigger: immediately after H1-H5 evidence capture or on early stop
- cleanup proof: server stopped, port unbound, and sandbox moved to Trash

Pre-fix direct evidence: on the clean task-owned Page `SBWGbSkWZHlj`, typing
`/code` displayed the native `Code Block` item as selected, but Enter inserted
a `registryBlock` with `blockType: code` and a `Loading code block…`
placeholder. Pointer selection of the displayed native item inserted the
expected `pre.notion-code-block`. The first divergence was therefore the Enter
adapter, before the shared native transaction and persistence boundary.

Root cause: the document-level Enter handler ran exact-title lookup before the
open-menu selection. The query `code` exactly matched the adjacent registry
command titled `Code`, overriding the visibly selected ordinary `Code Block`.

Smallest repair: run exact-title fallback only when the slash menu is closed.
When it is open, Enter executes `filteredCommands[selectedIndex]`, the same
native item presented to the writer. Pointer behavior, registry behavior,
catalog composition, image insertion, Mermaid, and Code Block UX are unchanged.

Post-fix acceptance on Page `55gJt3h1I5WF`:

- Enter on `/code` created one native Code Block and removed the query.
- Pointer selection of `Code Block` created one second native Code Block.
- Typing and Tab remained responsive in both blocks.
- After reload, the interface contained `ENTER_MARKER_20260820TAB_OK` and
  `POINTER_MARKER_20260820TAB_OK` in two code nodes.
- Canonical SQLite read-back contained exactly two fenced Code Blocks with the
  same distinct markers and one intentional empty-block separator.
- The focused suite passed 32 of 32 tests, including the new visible-menu Enter
  regression story; Content typecheck exited 0. Its production-config audit
  reported the expected absent local production secrets and database URL.
- Changelog creation was attempted as required, but the Content app explicitly
  reports that changelog support is disabled; no entry was created.

Resource cleanup: the browser tab and dev server were closed, port 4188 was
confirmed unbound, and `/tmp/content-codeblock-work-20260820` was moved to
`/Users/alicemoore/.Trash/content-codeblock-work-20260820`. No production,
customer, shared staging, Bowerbird row, or unrelated local data was mutated.

Independent technical review: not required. The final shipping delta is one
low-risk dispatch condition plus one focused regression test; it does not alter
persistence, collaboration, schema, authorization, or network behavior.

Work evidence: complete. Ledger revision:
`content-code-block-production-work-v1`. Task attention: `land-ready`.
