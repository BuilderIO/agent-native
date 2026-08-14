# Builder source refresh and semantic Review Diff — shape v3

## Lifecycle authority

```yaml
authoritySchemaVersion: 3
stage: work
authority-source: "$work invoked by Alice on 2026-08-14, approving shape-pr2344-verification-v3-proposed"
authorized_scope:
  repositories: [BuilderIO/agent-native]
  product_surfaces:
    - Agent Native Content Builder source hydration and Load More
    - Agent Native Content Builder Review Diff dialog
  outcome: >-
    Preserve the repaired zero-phantom-change boundary, visibly expose the one
    real body edit in Review Diff, and re-prove the user-visible latency bounds
    with clocks attached to the already-running authenticated interface.
allowed-mutations:
  - artifact-write
  - ephemeral-test-resource
  - branch
  - commit
  - push
  - pull-request
write-targets:
  artifacts:
    - plans/shape-pr2344-verification-v3.md
    - templates/content/actions/_database-source-utils.ts
    - templates/content/actions/_database-source-utils.test.ts
    - templates/content/shared/builder-mdx.ts
    - templates/content/shared/builder-mdx.test.ts
    - templates/content/app/components/editor/database-sources/BuilderSourceReviewDialog.tsx
    - templates/content/app/components/editor/database-sources/BuilderSourceReviewDialog.ui.test.tsx
    - templates/content/app/i18n-data.ts
    - templates/content/app/i18n/zh-TW.ts
test-resources: []
governing_artifact:
  path: plans/shape-pr2344-verification-v3.md
  revision: shape-pr2344-verification-v3-work-r1
architecture-fingerprint:
  outcome: >-
    Preserve zero phantom changes for hydration and Load More, visibly expose
    the one real body edit, and prove the user-visible latency bounds.
  shipping-surfaces:
    - id: content-builder-source-review
      repository: BuilderIO/agent-native
      product-surface: Agent Native Content Builder source and Review Diff
      constituency: authenticated Content editors
      durable-destination: repository main lineage
      integration-action: merge
  governing-architecture: >-
    Existing Actions own canonical comparisons and excerpts; the existing
    dialog renders that evidence; the preview-first attach cache remains unless
    correctly measured browser latency identifies a narrower bottleneck.
  acceptance-story:
    id: shape-pr2344-verification-v3
    summary: >-
      Hydration and Load More create zero changes, the exact violet canary edit
      creates one visibly inspectable body-only diff, latency stays within the
      frozen UI bounds, no Builder write occurs, and cleanup proves absence.
    required-assertions:
      - exact eventual artifact is on current main lineage and fingerprinted
      - useful rows visible within 2 seconds and complete metadata within 10 seconds
      - hydration terminates within 60 seconds with zero outbound changes
      - Load More creates zero outbound changes
      - exact two-word edit creates exactly one visible semantic body-only diff
      - semantic details appear within 2 seconds without preparing a write
      - provider read-back is unchanged
      - typed cleanup and independent absence proof leave zero task residue
      - focused tests, typecheck, formatter, and diff checks pass
      - Lane B remains separate and makes no behavioral claim
    acceptance-policy:
      modality: real-interface
      independence: preferred
      custody: same-context-allowed
      interface: authenticated local Agent Native Content browser surface
      rationale: >-
        The change is bounded and non-destructive; same-context evidence is
        allowed, while independent QA is preferred when available.
  risk-strategy:
    kind: system-ready
    production-validation-after-merge: false
architecture-grounding:
  applicability: required
  reason: Content source truth and typed review contracts govern the repair.
  status: grounded
  demonstrated-callers:
    - authenticated editor reviewing one local edit to a read-only Builder source
  existing-primitives:
    - ContentDatabaseSourceBodyChange currentExcerpt and proposedExcerpt
    - BuilderSourceReviewDialog typed field and body review blocks
    - preview-first Builder attach cache handoff
  ownership-boundaries:
    - Actions own comparison and hashes; the dialog owns presentation; Builder remains read-only
  legacy-contracts:
    - hydration and Load More are outbound no-ops
    - publication and provider writes remain separate guarded actions
  shared-vocabulary:
    [Review Diff, body change, current excerpt, proposed excerpt]
  smallest-compatible-delta: Render existing body excerpts and test their accessible presence.
  deferred-capabilities:
    - generic rich-text inline diffing
    - provider writes and publication
    - speculative attach optimization
  reversibility: Presentation-only UI addition plus the already-bounded hash repair.
  direct-evidence:
    - templates/content/shared/api.ts
    - templates/content/actions/_database-source-utils.ts
    - templates/content/app/components/editor/database-sources/BuilderSourceReviewDialog.tsx
    - templates/content/docs/product/capabilities/content.source.sync-policy.md
    - templates/content/docs/product/capabilities/content.diff.in-place.md
  inferences: []
  unresolved-owner-questions: []
delegation-ceiling: []
product-boundary-gates:
  agent-native-public-constituency: >-
    Any authenticated Content editor with a Builder source can inspect the
    typed review evidence without Alice's vault, machine, or private orchestration.
  bowerbird-product-boundary: not-applicable
acceptance-state:
  status: pending
  summary: Implementation and exact-artifact real-interface proof remain pending.
  blockers: []
  last-land-packet: null
ledger-revision: shape-pr2344-verification-v3-work-r1
status: active
```

`WORK PAUSED — RETURNING TO SHAPE`

## Material delta from v2

Lane A established that hydration and Load More produced zero outbound changes,
and that the frozen `violet canary` edit produced one body-only review row. It
also exposed two independent follow-ups:

1. The Review Diff action payload already contains `currentExcerpt` and
   `proposedExcerpt`, but `BuilderSourceReviewDialog` renders only the generic
   `bodyChange.summary` and warnings. The user therefore cannot inspect the
   semantic body change before selecting or preparing it.
2. The recorded 10.63-second attach duration included CLI/process overhead.
   Content deliberately paints cached preview rows before attach completion and
   later marks `attachPreview.complete`. That measurement cannot prove or
   disprove the frozen user-visible metadata bound.

The first is a demonstrated contract failure. The second is an invalid proof,
not yet a demonstrated performance defect. No provider write occurred, and the
disposable resource was completely deleted and independently absent on read-back.

## Options

### 1. Treat both observations as implementation defects

Render body excerpts and optimize the attach path until the CLI invocation is
under ten seconds. This spends code on a timer that includes work outside the
product surface and risks moving an already-progressive load path without a
valid bottleneck.

### 2. Repair semantic Review Diff and remeasure latency correctly (recommended)

Render the existing before/after body evidence in the review row, then repeat
the exact disposable Lane A workflow while measuring attachment from the
already-running browser interaction to visible UI states. Optimize only if
that valid metadata clock exceeds ten seconds.

### 3. Keep the summary-only dialog and weaken acceptance

Accept one body-change summary as semantic proof. This conflicts with the
review contract: a user deciding whether a change is real must be able to see
what changed, not merely receive the software's assurances on the matter.

## Recommended shape fingerprint

- **Outcome:** hydration and continuation remain outbound-no-op operations; one
  frozen local body edit produces one inspectable semantic Review Diff row.
- **Shipping surface:** the public Agent Native Content template in
  `BuilderIO/agent-native`, specifically the Builder source list/attach state
  and `BuilderSourceReviewDialog`, for authenticated Content editors. The
  durable destination is the repository's `main` lineage through an ordinary
  reviewed pull request and merge; Shape itself creates neither.
- **Architecture:** no new Action, payload, persistence, or provider contract.
  `preview-builder-source-review` remains the typed source of before/after body
  excerpts. The dialog renders that existing evidence using its current review
  row and design-system primitives. Source attach keeps its preview-first cache
  handoff unless valid browser timing identifies a narrower bottleneck.
- **Acceptance modality:** real-interface proof in the authenticated local
  Content app plus focused deterministic component/action tests. Independent
  QA is preferred for the final story; same-context evidence is allowed and
  must retain screenshots, exact timestamps, SQL/action read-backs, and cleanup
  receipts. No approval, staging, Check, publish, push, or Builder mutation is
  part of acceptance.
- **Risk:** system-ready, no feature flag, no production-data validation after
  merge. Lane B remains a separate read-only deployment attestation and cannot
  establish Lane A behavior.

## Architecture grounding

- **Demonstrated caller:** an authenticated editor opening a Builder-backed
  Content database, loading its complete read-only source, and reviewing one
  local body edit.
- **Existing primitive:** `ContentDatabaseSourceBodyChange` already carries
  nullable `currentExcerpt` and `proposedExcerpt`; the dialog already renders
  typed field before/after values beside the body summary.
- **Ownership boundary:** Actions own canonical comparison and hashes; the
  dialog owns legible review presentation; the attach hook owns preview-to-full
  cache handoff. Builder remains read-only throughout this proof.
- **Smallest compatible delta:** render body before/after excerpts inside the
  existing body-change block and cover their accessible presence. Do not build
  a second diff engine, add an endpoint, or mutate the payload.
- **Performance boundary:** measure from a user gesture in a warmed,
  authenticated, already-running browser to the visible preview and complete
  metadata states. Exclude process startup, CLI launch, dependency build,
  migrations, and login from both budgets.
- **Product context:** contract repair for
  `content.feature.trust-your-connected-sources`,
  `content.source.sync-policy`, `content.source.adapters`, and
  `content.source.builder-codec`; the visible comparison also uses donor
  machinery toward `content.feature.review-changes-in-place` and
  `content.diff.in-place` without claiming either whole Feature verified.
- **Deferred:** generic rich-text inline diffing, provider writes, publication,
  production mutation, a speculative attach optimization, and product-record
  status changes.

## Replacement acceptance story

Use the exact v2 disposable account, marker
`__an_pr2344_local_verify_20260806_v2__`, Builder resource/table, read-only
source configuration, row-selection rule, two-word edit, evidence cadence, and
typed cleanup contract. Credentials remain supplied out of band and are never
written into repository artifacts.

1. Bind the run to the exact repository head under test and record the repair
   commit's content fingerprint. The eventual shipping head must be on the
   current `main` lineage; historical PR #2344 provenance is recorded
   separately and does not require developing a successor on obsolete history.
2. In an already-running authenticated local browser, start the attach clock at
   the user gesture/action dispatch. Useful rows must be visibly available in
   at most 2.0 seconds. Complete source metadata — including the visible final
   fetched-row count and absence of the attaching state — must be visible in at
   most 10.0 seconds. Record both endpoints independently.
3. Complete hydration under the frozen 60-second bound. At terminal state there
   are no pending rows; every row is classified hydrated or honestly
   unavailable. Two consecutive source reads report zero outbound changes.
4. Trigger Load More once. At the frozen observation points, UI, Action, and SQL
   evidence all report zero outbound changes; corpus size and source identity
   remain stable.
5. Select the lexicographically smallest hydrated non-empty row under the v2
   rule. Replace the first exact `Hey hey, devs!` occurrence with
   `Hey hey, devs! violet canary` and make no other local edit.
6. Review Diff becomes visible within 10.0 seconds and contains exactly one
   review row. It has no field changes and one body change. The visible body
   comparison shows the current and proposed excerpts, with the sole semantic
   difference being insertion of `violet canary`; Author and other unchanged
   values do not appear as changes.
7. The one row's semantic details are visible without preparing or validating
   a write. If disclosure is required, the explicit disclosure interaction
   reveals them within 2.0 seconds and remains keyboard-accessible. The
   selection checkbox remains only selection, not the mechanism that reveals
   meaning.
8. Close Review Diff. Never invoke Check, prepare, validate, stage, approve,
   publish, push, or any Builder write action. Provider-side read-back before
   cleanup matches the original id, timestamp, and body hash.
9. Perform the complete v2 typed cleanup: permanently delete the disposable
