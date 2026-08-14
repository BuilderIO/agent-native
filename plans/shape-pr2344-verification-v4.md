# Builder attach handoff and hydration latency — shape v4

## Lifecycle authority

```yaml
authoritySchemaVersion: 3
stage: work
authority-source: 'Alice invoked "$work" on 2026-08-14, approving shape-pr2344-verification-v4-proposed-r1'
authorized-scope:
  repositories: [BuilderIO/agent-native]
  product-surfaces:
    - Agent Native Content Builder source attachment handoff
    - Agent Native Content Builder body hydration orchestration
    - Agent Native Content Builder phantom-change and Review Diff regression proof
  outcome: >-
    Make a ready Builder preview visible immediately after Attach, end the
    attaching state from the durable attachment acknowledgement, and begin the
    existing hydration pump without waiting for a source-query round trip,
    while preserving zero phantom changes and the semantic Review Diff repair.
allowed-mutations: [artifact-write, ephemeral-test-resource, branch, commit, push, pull-request]
write-targets:
  artifacts:
    - plans/shape-pr2344-verification-v4.md
    - plans/shape-pr2344-verification-v3.md
    - templates/content/actions/_database-source-utils.ts
    - templates/content/actions/_database-source-utils.test.ts
    - templates/content/shared/builder-mdx.ts
    - templates/content/shared/builder-mdx.test.ts
    - templates/content/app/components/editor/database-sources/BuilderSourceReviewDialog.tsx
    - templates/content/app/components/editor/database-sources/BuilderSourceReviewDialog.ui.test.tsx
    - templates/content/app/i18n-data.ts
    - templates/content/app/i18n/zh-TW.ts
    - templates/content/app/hooks/use-content-database.ts
    - templates/content/app/hooks/use-content-database.test.ts
    - templates/content/app/components/editor/database/DatabaseView.tsx
    - templates/content/app/components/editor/database/DatabaseView.error-toasts.test.tsx
test-resources:
  - id: pr2344-v4-local-runtime
    kind: server
    surface: http://127.0.0.1:8080 backed by /tmp/an-pr2344-lane-a-v4/app.db
    ownership-marker: /tmp/an-pr2344-lane-a-v4 and captured server PID/session
    baseline: exact path absent and port 8080 has no listener before creation
    allowed-actions: [create, exercise, delete]
    cleanup-trigger: after assertions or any failure
    cleanup-method: stop captured server, navigate preview away, remove only exact temporary directory
    cleanup-proof: exact path absent and port 8080 has no listener
    shared-impact: none
    isolation: local-runtime
    ownership: task-created
    production-data: false
    customer-data: false
    cost: none
    boundary-evidence: [exact absent path, loopback-only listener]
    max-lifetime-minutes: 120
    declared-at: 2026-08-14T17:57:27Z
    expires-at: 2026-08-14T19:57:27Z
    status: cleaned
    phase: work
  - id: pr2344-v4-local-database
    kind: database
    surface: authenticated localhost Content Actions and browser
    ownership-marker: __an_pr2344_local_verify_20260806_v2__ plus every returned stable ID
    baseline: exact marker absent in the task-created SQLite database
    allowed-actions: [create, update, exercise, delete]
    cleanup-trigger: after assertions or any failure
    cleanup-method: typed database delete and permanent deletion of every captured child
    cleanup-proof: typed not_found, empty active/Trash/search, and zero exact SQL counts
    shared-impact: none
    isolation: isolated-test-surface
    ownership: task-created
    production-data: false
    customer-data: false
    cost: none
    boundary-evidence: [task-created SQLite file, unique marker, safe Builder test model]
    max-lifetime-minutes: 120
    declared-at: 2026-08-14T17:57:27Z
    expires-at: 2026-08-14T19:57:27Z
    status: cleaned
    phase: work
  - id: pr2344-v4-browser-session
    kind: session
    surface: task-created T3 collaborative preview for http://127.0.0.1:8080
    ownership-marker: returned preview tab ID captured before use
    baseline: no preview acquired for v4
    allowed-actions: [create, exercise, delete]
    cleanup-trigger: after assertions or any failure
    cleanup-method: navigate exact tab away before stopping local server
    cleanup-proof: exact tab no longer targets localhost
    shared-impact: none
    isolation: local-runtime
    ownership: task-created
    production-data: false
    customer-data: false
    cost: none
    boundary-evidence: [thread-bound T3 preview, disposable localhost identity]
    max-lifetime-minutes: 120
    declared-at: 2026-08-14T17:57:27Z
    expires-at: 2026-08-14T19:57:27Z
    status: cleaned
    phase: work
governing-artifact:
  path: plans/shape-pr2344-verification-v4.md
  revision: shape-pr2344-verification-v4-work-r2
architecture-fingerprint:
  outcome: >-
    Make the existing preview, attachment acknowledgement, and hydration action
    form one prompt and finite client-visible lifecycle without changing Builder
    source truth or write policy.
  shipping-surfaces:
    - id: content-builder-source-lifecycle
      repository: BuilderIO/agent-native
      product-surface: Agent Native Content Builder source attachment, hydration, and Review Diff
      constituency: authenticated Content editors
      durable-destination: repository main lineage
      integration-action: merge
  governing-architecture: >-
    Existing Actions remain canonical; the Content client coordinates the
    already-fetched attach preview, the typed attachment acknowledgement, and
    the existing hydration mutation as an explicit finite handoff, with no new
    endpoint, persistence contract, provider operation, or background server job.
  acceptance-story:
    id: shape-pr2344-verification-v4
    summary: >-
      From one authenticated Attach gesture, useful preview rows appear within
      two seconds, final attachment metadata appears within ten seconds,
      hydration terminates within sixty seconds, hydration and Load More create
      zero outbound changes, and the frozen two-word edit remains one visible
      body-only Review Diff; cleanup leaves no task residue.
    required-assertions:
      - artifact begins from origin/main current at Work start and later base drift is classified against overlap and mergeability
      - ready preview rows become visibly available within 2.0 seconds of Attach
      - attachment acknowledgement ends the attaching state and exposes the final fetched-row count within 10.0 seconds
      - the acknowledgement source ID starts the existing hydration action without waiting for source-query discovery
      - hydration terminates within 60.0 seconds with every row hydrated or honestly unavailable and none pending
      - two consecutive terminal source reads report zero outbound changes
      - one Load More click has zero UI, Action, and SQL changes at exact 0/2/5/15-second observations
      - the frozen violet canary edit creates exactly one visible body-only review row with no unchanged field changes
      - Review Diff and semantic details meet the existing 10.0-second and 2.0-second bounds
      - no Check, prepare, validate, stage, approve, publish, push, or Builder write action occurs
      - three provider read-backs retain the original entry ID, timestamp, and body hash
      - typed cleanup and independent absence proof leave zero task residue
      - focused tests, typecheck, formatter, i18n guard, repository guards, and diff check pass
      - Lane B remains separate and makes no behavioral claim
    acceptance-policy:
      modality: real-interface
      independence: preferred
      custody: same-context-allowed
      interface: authenticated local Agent Native Content browser surface
      rationale: >-
        This is an ordinary bounded read-only source lifecycle repair. Current
        implementer-run browser evidence may satisfy every assertion; an
        independent tester adds confidence but is not a merge gate.
  risk-strategy:
    kind: system-ready
    production-validation-after-merge: false
architecture-grounding:
  applicability: required
  reason: The repair crosses the existing client/action lifecycle seam.
  status: grounded
  demonstrated-callers:
    - authenticated Content editor attaching the safe read-only Builder test model
  existing-primitives:
    - ready preview query and writeBuilderAttachPreviewToCache
    - ContentDatabaseSourceAttachmentAck with sourceId, importedItemCount, and fetchedAt
    - process-builder-body-hydration action and the existing client hydration pump
    - canonical source metadata and Review Diff payload
  ownership-boundaries:
    - Actions own attachment, source truth, hydration work, comparisons, and hashes
    - the attach hook owns optimistic preview and acknowledgement cache state
    - DatabaseView owns settings-sheet handoff and invocation of existing mutations
    - Builder remains read-only throughout acceptance
  legacy-contracts:
    - hydration and Load More remain outbound no-ops
    - attach failure rolls back optimistic data and presents a recoverable error
    - Review Diff remains selection-independent and body-semantic
    - provider publication and writes remain separate guarded actions
  shared-vocabulary: [attach preview, attachment acknowledgement, hydration pump, Review Diff]
  smallest-compatible-delta: >-
    Close the source sheet once a ready preview is installed, recover the sheet
    and cache on attach failure, retain acknowledgement completion until the
    canonical source response supersedes it, and start the existing hydration
    pump directly from the acknowledgement source ID.
  deferred-capabilities:
    - server-side background hydration jobs
    - new Action or persistence state
    - generic rich-text inline diffing
    - provider writes, publication, and production mutation
  reversibility: >-
    The delta is client orchestration around existing typed contracts and can be
    reverted without migration, backfill, or provider cleanup.
  direct-evidence:
    - v3 Attach gesture reached useful rows in 4.7944 seconds while the attach action took 3.893 seconds
    - v3 attaching state remained after 84 seconds despite a typed acknowledgement contract
    - v3 hydration reached terminal state around 90 seconds after waiting for client source discovery
    - templates/content/app/hooks/use-content-database.ts
    - templates/content/app/components/editor/database/DatabaseView.tsx
    - templates/content/actions/attach-content-database-source.ts
  inferences:
    - eliminating both client handoff waits is sufficient to restore the frozen bounds on the safe 584-row model
  unresolved-owner-questions: []
delegation-ceiling: []
product-boundary-gates:
  agent-native-public-constituency: >-
    Any authenticated Content editor attaching a Builder source receives the
    lifecycle improvement without Alice's vault, machine, or private orchestration.
  bowerbird-product-boundary: not-applicable
acceptance-state:
  status: passed
  summary: >-
    The exact disposable real-interface transaction passed the frozen attach,
    acknowledgement, hydration, phantom-change, semantic Review Diff, provider
    read-back, and cleanup assertions. Lane B remains separate and unrun.
  blockers: []
  last-land-packet: null
ledger-revision: shape-pr2344-verification-v4-work-r2
status: work-complete
```

`WORK RESUMED — replacement v4 approved by Alice's 2026-08-14 $work invocation`

## Material delta from v3

V3 proved that canonical comparison is now correct: terminal hydration created
no changes, and `violet canary` produced one legible body-only Review Diff. The
remaining failure is the client-visible attachment lifecycle. A preview is
already ready before Attach is enabled, but the settings sheet stays in front of
it until the attach action returns. Hydration then waits for invalidation and a
fresh source query before invoking an action whose source ID was already present
in the attachment acknowledgement.

This v4 shape changes the governing architecture from “measure before deciding
whether to optimize” to a demonstrated client orchestration repair. It also
replaces the overly strict requirement that a moving `origin/main` remain an
ancestor throughout Work: Work starts from then-current main, while later drift
is classified by mergeability and acceptance-relevant overlap under repository
policy.

## Options

### 1. Speed up Builder reads or hydration internals

The measured attach action took 3.893 seconds and its first hydration batch took
8.008 seconds. Both are individually inside the relevant bounds. Optimizing
provider reads or hydration concurrency would attack the wrong clock and add
provider/load risk.

### 2. Make the existing client handoff finite and immediate (recommended)

Install the already-ready preview and dismiss the source sheet at dispatch;
recover both on failure. Use the typed acknowledgement to show completion and
start the existing hydration pump immediately. This removes the demonstrated
waits while preserving Action ownership and every read-only boundary.

### 3. Relax the latency acceptance

The interface eventually converges, but an 84-second attaching state and a
roughly 90-second hydration lifecycle are not credible progressive loading.
Relaxing the bounds would rename the bug instead of fixing it.

## Proposed Work boundary

Work should use a new dedicated worktree and branch
`codex/builder-phantom-review-v4` created from the `origin/main` revision read at
Work start. It may cherry-pick the exact semantic repair commits
`4ed14c9e5778ea4b650651ee89c67f98ebc46041` and
`c12f5a3f764111d5abbfc025685ef59af757fc3e`; this explicit branch operation does
not authorize rebasing, force-pushing, or integrating into main.

The implementation boundary is limited to:

- `templates/content/app/hooks/use-content-database.ts` and its focused tests;
- `templates/content/app/components/editor/database/DatabaseView.tsx` and the
  smallest existing UI test surface that can prove handoff recovery and direct
  hydration start;
- existing v3 comparison, Review Diff, and localization files carried by the
  two exact commits;
- the governing v4 artifact.

No changes to Builder read concurrency, hydration conversion, schemas, routes,
credentials, server startup, write policy, or provider operations are in scope.

## Work test-resource contract

Work may declare and use exactly one fresh transaction with these paired
resources:

1. A task-created SQLite database at
   `/tmp/an-pr2344-lane-a-v4/app.db`, served only on `127.0.0.1:8080`. Baseline:
   the exact path is absent and port 8080 has no listener. Cleanup: stop the
   captured server process, remove only `/tmp/an-pr2344-lane-a-v4`, and prove
   both path and listener absent.
2. One database created through the authenticated local Content Action surface,
   with marker `__an_pr2344_local_verify_20260806_v2__`, the disposable
   `test@test.com` identity, and only the safe model
   `agent-native-blog-article-test`. Capture every returned database, root,
   source, item, and document ID before mutation. Cleanup: typed database delete
   plus permanent deletion of every captured child, followed by typed
   `not_found`, empty active/Trash/search results, and zero exact SQL counts.
3. One task-created T3 collaborative preview tab bound to the local server.
   Capture its returned tab ID before use. Cleanup: navigate it away before
   stopping the server and prove it no longer targets localhost.

Credentials remain runtime-only, are never printed or written to repository
artifacts, and expire with the local process. Never use Alice's real database or
production data. The resource lifetime is at most 120 minutes, cleanup triggers
after assertions or any failure, and Work cannot complete with an active or
unproved resource.

## Replacement acceptance procedure

1. Install a browser-side observer before Attach. Anchor all clocks to the
   trusted click timestamp and have the observer persist DOM snapshots at exact
   0/2/5/15-second offsets; tool-call scheduling is not the clock.
2. Prove useful rows by 2.0 seconds and final count plus no attaching state by
   10.0 seconds. Record acknowledgement timing separately from visible timing.
3. Prove hydration terminal by 60.0 seconds, with 0 pending and every row
   hydrated or unavailable. Two consecutive Action reads and SQL must show zero
   changes.
4. Click Load More once. The preinstalled observer, Action reads, and SQL must
   report zero changes at 0/2/5/15 seconds, with stable source identity and 584
   rows.
5. Apply only the first exact replacement `Hey hey, devs!` ->
   `Hey hey, devs! violet canary` on the lexicographically selected hydrated
   non-empty row.
6. Prove Review Diff within 10 seconds and semantic details within 2 seconds:
   exactly one row, no field changes, one body change, visible Current/Proposed
   excerpts, only the two-word insertion, and no Author change.
7. Close Review Diff without Check or any prepare/write path. Read the provider
   three times and retain the original ID, timestamp, and body hash.
8. Run the complete typed cleanup and independent absence proof. Then run the
   focused tests, Content typecheck, formatter, i18n guard, repository guards,
   and diff check against the exact final artifact.
9. Keep Lane B separate. It may later attest deployment ancestry and public
   asset binding, but it cannot establish this behavioral story.

## Shape Refresher

The human problem is no longer uncertainty about phantom changes: that boundary
passed. The remaining experience is that a user clicks Attach while the preview
is ready, yet the interface hides that useful work behind a sheet and delays the
next existing action until another query discovers information the
acknowledgement already returned.

V4 binds a client-only lifecycle repair and retains every safety boundary: no
new API, background server machinery, provider write, production mutation, or
weakened timing bar. It wins over provider optimization because the measured
provider/action work is already inside the individual budgets; the extra waits
are in client orchestration. Approval asks only to resume Work on this exact
replacement fingerprint and its fresh disposable proof transaction.

## Work transition

Alice approved `shape-pr2344-verification-v4-proposed-r1` with `$work`. Work is
authorized for the explicitly named fresh branch/worktree, cherry-picks,
bounded client changes, tests, disposable localhost transaction, cleanup,
commit, and review PR—but not merge, production mutation, or Builder write.

Output: plans/shape-pr2344-verification-v4.md
Lifecycle state: V4 implementation and exact-artifact Lane A real-interface proof are complete; Lane B remains separate and unrun
Authority: work, ledger shape-pr2344-verification-v4-work-r2, governing artifact plans/shape-pr2344-verification-v4.md, frozen outcome/surface/client-handoff architecture/real-interface acceptance/system-ready risk
Allowed: bounded branch, artifact, test-resource, commit, push, and review-PR mutations; no merge or provider write
Invalidated by: outcome, shipping surface, governing architecture, acceptance story, or risk-strategy change
Task attention: land-ready; title unchanged — this host exposes no calling-thread title adapter
Next: publish the review PR without merging

## Work evidence — ledger r2

- Repository lane: `/Users/alicemoore/.codex/worktrees/builder-phantom-review-v4/agent-native`, branch `codex/builder-phantom-review-v4`, refreshed Work-start base `8c9218612d7c837acf22f14eb5ffb1b4d3e3ef9d`.
- Later base drift: `origin/main` advanced to `429ae6c416d99ffa0c1c012cf9bfa5f806647843` through #2866 and the version-packages follow-up. The drift overlaps acceptance-relevant Content files because #2866 contains the carried v3 repair, but `git merge-tree --write-tree HEAD origin/main` completed without conflicts (`4d9c3332e07e10faad8760639fcb398001f58dcc`); no rebase or branch movement was performed.
- Implementation: `7e3880b7ea645da0f822b9bc2a9e12d326285bc6`, carrying the two exact v3 semantic repair commits as `86cbf7dad` and `d4af2996f`.
- Attach click: `2026-08-14T18:25:29.970Z`. The preinstalled page observer first saw 100 useful preview rows at `1058.8ms`; the typed acknowledgement completed the fetched-row badge and `100 of 584` pagination at `6070.6ms`. The settings sheet was absent throughout the observer samples and the server recorded the attachment action at `5413ms`.
- Direct hydration: source `e5659a5c-fb40-4e9a-8c08-c667aff2b8d4` began from the acknowledgement path; the server recorded the hydration action at `8852ms`. Terminal state was `578 hydrated + 6 unavailable + 0 pending + 0 hydrating + 0 error = 584`, inside 60 seconds of Attach.
- Phantom changes: two consecutive typed source reads returned complete rows/change-set projections, terminal hydration, and `changeSets: []`. SQL independently returned 584 source rows, zero queued hydration rows, and zero change sets.
- Load More click: `2026-08-14T18:26:36.538Z`. Page-timer samples at approximately `0/2/5/15s` showed no pending-change badge or Review Diff signal while visible local pagination advanced from 100 to 200 of the stable 584 rows. The following typed source read and SQL again returned zero changes, stable source identity, 584 source rows, and zero hydration queue rows.
- Frozen edit: lexicographically smallest hydrated, non-empty entry `006a35d6a3cd454aba655096b0e282c2`, local document `builder-doc_9CAL_-ihZDDsGa4jInSPtN19`. The only edit was the first `Hey hey, devs!` -> `Hey hey, devs! violet canary`; SQL confirmed exactly one 13-character `violet canary` insertion.
- Review Diff click: `2026-08-14T18:29:29.712Z`. The dialog opened immediately with its loading state; the complete semantic detail was visible at `1320.2ms`. Its scoped dialog contained exactly one Builder entry, no field changes, one body change, the original and proposed excerpts, and no Author change. The Check button was never clicked; no prepare, validate, stage, approve, publish, push, or Builder write action ran.
- Provider read-back: three uncached, live Builder reads independently retained entry `006a35d6a3cd454aba655096b0e282c2`, timestamp `1783976746939`, and body hash `2g5dsm8eoi6`.
- Cleanup receipt: typed delete plus permanent deletion removed 585 documents; typed database read returned `not_found`; active Trash lists and marker/canary searches were empty. Independent SQL returned zero databases, roots, selected document, sources, source rows, marker, and canary across all attempts. T3 preview `tab_5` and the temporary Chrome connection tab were navigated to `https://example.com`; server session `34051` stopped; port 8080 is free; `/tmp/an-pr2344-lane-a-v4`, task `.env.local`, and task-created local build/database residue are absent.
- Acceptance reconciliation: consistent — schema-v3, real-interface, preferred independence, same-context evidence allowed.
- Lane A conclusion: pass on the exact local artifact. Lane B: separate, unrun, and makes no behavioral claim.
