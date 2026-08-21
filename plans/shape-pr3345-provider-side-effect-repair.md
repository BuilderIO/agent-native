# PR #3345 provider-side-effect repair Shape

Status: Work implemented and locally verified; PR refresh and exact-head CI remain pending. Merge and production mutation are not authorized.

## Summary

PR [#3345](https://github.com/BuilderIO/agent-native/pull/3345) is still open at exact head
`94e657039753f20d3a0626386201b9dacd593651`. Its ordinary GitHub, targeted test,
desktop-platform, security, build, and preview checks completed without failure. Builder's
exact-head review opened two blocking threads in the resumable chunk route:

1. a delayed failed provider response may abort or delete a session after the request has
   lost the exact attempt/generation lease; and
2. a provider-accepted chunk may be returned as stale before its accepted offset and metadata
   are durably reconciled, leaving a later retry able to replay the old range.

The smallest coherent repair keeps the shared provider contract unchanged. Clips must treat a
provider call as a side effect whose result must be settled exactly once: destructive cleanup
belongs only to a path that has first retired the session's generation, while an accepted result
must be monotonically reconciled into the exact stored session before ownership loss is returned
to the caller.

## Current evidence

### Direct facts

- Exact PR head: `94e657039753f20d3a0626386201b9dacd593651`.
- Current open Builder threads are only:
  - `PRRT_kwDORlS_j86bNdZl` / comment `3831642188`, failed-response cleanup without a
    current ownership fence; and
  - `PRRT_kwDORlS_j86bNdZo` / comment `3831642190`, accepted provider state stranded after
    heartbeat ownership loss.
- `handleResumableChunk()` currently performs provider relay under a lease heartbeat, then:
  - returns `409` immediately when the heartbeat observed ownership loss;
  - advances `bytesUploaded`, `lastCommittedIndex`, and `updatedMeta` only after another lease
    renewal succeeds; and
  - calls `cleanupFailedFinalSession()` on non-OK final responses without first checking the
    exact attempt/generation lease. The same helper aborts the provider session and deletes its
    local handle.
- The reset route already owns the safer cleanup seam: it first compare-and-set rotates the
  recording to a new generation, claims cleanup of the retired session in application state,
  aborts that old provider session, and only then retires the old local handle.
- The shared `FileUploadProvider.resumable` contract returns `ok`, `status`, and optional
  `updatedMeta`; it has no cross-provider authoritative-offset query. Builder/GCS returns an
  accepted status but no offset metadata, while S3 returns provider metadata required for later
  multipart completion.
- Stored resumable session state is already generation-scoped and contains `sessionId`, `meta`,
  `bytesUploaded`, and `lastCommittedIndex`. Core application state already provides exact
  compare-and-set.
- The older committed-reset cancellation thread `PRRT_kwDORlS_j86bMP7d` is resolved. Current
  native code awaits the reset response, retains the returned generation for subsequent work,
  observes cancellation only after that response, and excludes the cancellation sentinel from
  the generic interrupt path. Builder's latest summary explicitly did not repost it.

### Inferences

- A provider's accepted response is the best available cross-provider proof of the exact call's
  side effect. Querying the provider later is not a portable first-slice solution.
- An application-state compare-and-set from the exact pre-relay session snapshot to its monotonic
  accepted successor can preserve the accepted offset without overwriting a newer session.
- Destructive provider cleanup is safe only after the affected session is no longer a live session
  any writer may use. Merely checking a renewable lease immediately before a potentially slow
  abort leaves another time-of-check/time-of-use window; rotating the generation first closes it.

## Causal model and ownership boundary

There are two authorities, and neither substitutes for the other:

- The recording row's `(uploadAttemptId, uploadGenerationId, lease)` decides which request may
  initiate another provider write or move recording lifecycle state.
- The provider response decides whether the provider side effect from an already-issued request
  was accepted.

Today those authorities are evaluated in the wrong order after relay. If the lease is lost, the
handler returns stale before recording an accepted provider effect. Conversely, if the provider
returns failure, the handler may destroy a session even though that request no longer owns it.

The repaired boundary is:

1. **Before dispatch:** require the exact attempt/generation lease.
2. **During dispatch:** heartbeat the same fence, including close/final provider calls.
3. **After an accepted response:** settle the provider effect monotonically against the exact
   pre-dispatch session snapshot. This settlement is reconciliation, not permission for more work;
   it must occur before returning an observed ownership loss.
4. **After a failed or ambiguous response:** do not destructively abort or delete a still-live
   session from the chunk request. Return a typed failure/restart result and let reset rotate the
   generation and claim cleanup of the retired session.
5. **After settlement:** only a request that still holds the lease may continue to finalization or
   dispatch another provider operation. A stale request stops with a typed `409` after leaving
   durable provider/session truth monotonic.

## Frozen invariants

### Provider session cleanup

- A chunk request never aborts or deletes a provider session that remains attached to a live
  generation.
- Provider abort and local-handle deletion occur only through an explicit cleanup claim for a
  generation already retired by an exact recording compare-and-set.
- Cleanup failure remains loud and recoverable; it cannot be coerced into successful restart or
  absence.
- Cleanup of generation A can neither target nor delete generation B's local handle or provider
  session.

### Accepted offset persistence and reconciliation

- Every accepted data-chunk response advances stored session truth exactly once from the exact
  pre-dispatch snapshot, including provider `updatedMeta`.
- Accepted state is monotonic: `bytesUploaded` and `lastCommittedIndex` never move backward, and
  a stale settlement never overwrites a different session or a successor already beyond it.
- If the exact compare-and-set loses, the handler rereads session state. It may classify the
  effect as already reconciled only when the same session is at or beyond the accepted byte/index
  boundary with compatible metadata. Missing, regressed, or contradictory state fails loudly and
  forces the safe retired-generation restart path; it is never returned as a normal stale retry.
- Ownership loss prevents further work, but does not discard an accepted provider result.

### Takeover and retry

- A different live claim continues to return the typed bounded conflict.
- A stale takeover never reuses an offset from a session with an unsettled or contradictory
  provider effect. It retires that session/generation and restarts from a new safe generation.
- Same-claim response-loss retry resumes only from the reconciled committed offset and index.
- Duplicate chunks at or below the reconciled committed index remain acknowledgements without a
  second provider write.

### Cancellation

- Cancellation stops local replay/upload work and preserves the local backup.
- Cancellation never routes through generic interruption merely because it races a reset response.
- If reset commits before cancellation is observed, the client consumes the authoritative reset
  response first. The preserved local attempt can immediately re-enter that server fence on the
  next retry; no pre-reset fence is used to interrupt it.
- The resolved committed-reset behavior receives regression coverage in the same verification
  packet, but no new native behavior is in the first slice unless that coverage disproves the
  current invariant.

### Finalization

- Accepted provider state is settled before finalization.
- A stale request never finalizes, aborts, or deletes after ownership loss.
- Ambiguous provider completion remains distinguishable from failure, restart-required, stale
  ownership, and ready recording reconciliation.

## Recommended Work slice

Keep the repair inside Clips and avoid a shared provider-contract expansion:

1. Add a generation-scoped resumable-session compare-and-set helper using the existing core
   application-state CAS primitive.
2. Refactor the chunk route's provider-result settlement into one boundary used by data chunks,
   final data chunks, and the zero-byte close sentinel:
   - reconcile accepted offset/index/meta first;
   - then stop with typed stale ownership when the heartbeat or post-response lease was lost; and
   - continue/finalize only while the exact lease remains held.
3. Remove inline destructive cleanup from failed provider-response paths. Route restart-required
   and final-session retirement through the existing reset generation-rotation and cleanup-claim
   path.
4. Reuse the same typed stale/restart vocabulary already consumed by browser and native retry
   clients. Change client code only if an existing response branch cannot express the safe reset.
5. Add focused deterministic server races and a regression assertion for the already-resolved
   native committed-reset cancellation behavior.

This is one coherent Work slice because all changes enforce one rule: provider effects are settled
against an exact session incarnation, while destruction occurs only after that incarnation is
retired.

## Compatibility and rollback

- Keep the existing default-off `uploadRetryResume` feature flag and Alice-only production target.
- Flag-off legacy null-fence uploads remain unfenced and keep their existing full-restart behavior.
- Existing non-null attempt and optional generation fences remain preserved when the flag changes.
- Buffered uploads, non-resumable providers, ordinary first uploads, share URLs, recording schema,
  and provider credentials are unchanged.
- No schema migration and no new shared provider method are required.
- Disabling the flag remains the operational rollback for new retries. It does not erase an
  already-stored fence or accepted resumable-session state.
- A failed cleanup or contradictory settlement fails closed with the local backup retained; it
  does not delete media or pretend the upload restarted.

## Acceptance story

### Automated assertions

Focused deterministic tests must prove:

1. A non-OK final data response that loses its exact lease performs no provider abort and no local
   session deletion, and returns typed stale ownership.
2. A non-OK close-sentinel response under the same race has the same result.
3. A provider failure while ownership remains held returns the existing loud failure/restart
   result but defers destruction to reset.
4. Reset first rotates generation, then claims and cleans only the retired session; a concurrent
   successor generation is untouched.
5. A provider-accepted ordinary chunk plus heartbeat ownership loss CAS-persists its advanced
   bytes, index, and metadata before returning stale.
6. The analogous accepted final-data and close-sentinel paths settle metadata before stale exit
   and never finalize after ownership loss.
7. A lost settlement CAS rereads: already-advanced same-session state is accepted as reconciled;
   a different/newer session is untouched; regressed or contradictory same-session state fails
   loudly and forces safe restart.
8. A same-claim retry resumes at the reconciled byte/index boundary and duplicate replay does not
   call the provider.
9. A stale different-attempt takeover cannot consume unsettled state and uses the retired-session
   cleanup/reset path.
10. Cancellation after a committed native reset waits for the reset response, skips generic
    interruption, preserves the local backup/attempt, and allows immediate same-claim retry.
11. Flag-off legacy null-fence and acknowledged-attempt-with-null-generation cases remain
    unchanged.

### Exact-head verification

After implementation, bind all evidence to the new exact PR head:

- focused resume, chunk, reset, abort, upload-lease, browser recovery, and native retry-plan tests;
- Clips desktop TypeScript;
- Rust 1.88 native tests and `cargo fmt`;
- `oxfmt` for every modified TypeScript/TSX file and `git diff --check`;
- repository targeted-workspace tests, lint/format, typecheck, security/static guards, general
  build, and all three Clips desktop platform builds;
- a fresh Builder review with zero open actionable threads, plus signed replies/resolutions only
  after Work is authorized and fixes exist;
- the required human technical approval on the exact final head.

### Real-interface and canary evidence

The concurrency invariants are principally automated; a manual desktop run cannot reliably force
the provider-response/lease interleavings. Real-interface acceptance is still required for the
successful-user story because the product bug is a production desktop retry after network loss.

- Before merge: a local desktop smoke is preferred, same-context allowed, verifying Retry remains
  cancellable and the local backup remains visible. It is not a substitute for the race tests.
- After merge/deploy: repeat the Alice-only production Wi-Fi-interruption canary under
  `uploadRetryResume`. The prior canary predates this repair and cannot prove the new exact artifact.
  Verify interruption leaves the backup, Retry completes without byte-zero replay or raw conflict,
  Cancel retry remains available during active work, and a subsequent retry still succeeds.
- Do not broaden flag targeting until that post-merge canary is recorded against the deployed
  revision.

Acceptance policy: real-interface, independence preferred, same-context allowed, through the signed
Clips desktop application and Alice-only production flag target. Independent technical review is
required because this is provider-side concurrency and destructive-cleanup logic.

## Explicit non-goals

- No shared `FileUploadProvider` offset-query API or provider-specific status protocol.
- No schema change, background reconciliation service, upload queue, or new distributed lock.
- No changes to recording/share content, local cache format, authentication, storage credentials,
  or production data.
- No broad feature-flag rollout.
- No redesign of the retry banner or cancellation UX.
- No merge, deployment, production mutation, review reply, or thread resolution during Shape.

## Work evidence

- Alice explicitly invoked Work against this artifact on 2026-08-21.
- Clips persists accepted data, final-data, and close-sentinel provider effects with an exact generation-scoped session CAS before returning stale ownership.
- Provider failures no longer abort or delete a live resumable session. Ambiguous transport outcomes return the existing typed restart signal so reset retires the generation before replay.
- The resolved native committed-reset cancellation ordering is covered without changing the user-facing flow.
- Focused Vitest: 112 passed. Full Clips Vitest: 1,399 passed. Rust 1.88: 210 passed, 1 intentionally ignored. TypeScript, `oxfmt`, `cargo fmt`, and `git diff --check` pass.
- Independent Terra review found ambiguous data and close response-loss paths plus missing final-data race coverage. All findings were repaired; the bounded one-follow-up ceiling prevented a third ceremonial review turn after the final close-path repair.

## Architecture grounding and fit

Grounding is required because this repair crosses the recording lease, persisted session, provider,
reset cleanup, and native cancellation seams.

- **Demonstrated caller:** signed Clips desktop retrying one locally saved recording after a failed
  or interrupted resumable upload.
- **Existing primitives:** exact upload lease CAS, generation-scoped resumable session state, core
  application-state CAS, relay heartbeat, reset generation rotation, reset cleanup claim, typed
  retry/restart responses, and native cancellation sentinel.
- **Ownership boundaries:** recording row owns write permission; provider response owns knowledge of
  an issued side effect; generation-scoped application state owns resumable offset/meta; reset owns
  retirement and destructive cleanup; clients own local cancellation and backup custody.
- **Legacy contracts:** flag-off behavior, buffered upload fallback, provider portability, local
  backup retention, same-claim lost-response retry, and ready-recording reconciliation remain
  unchanged.
- **Smallest compatible delta:** use existing Clips/core CAS and reset cleanup primitives to settle
  provider results and retire sessions safely; do not expand the provider interface.
- **Deferred capabilities:** provider offset introspection, generic framework resumable-operation
  journals, and cross-template upload orchestration.
- **Reversibility:** bounded source changes behind the existing flag, no migration, and operational
  rollback by disabling the flag for new retries.
- **Unresolved owner questions:** none. Current code and review evidence establish the local Clips
  boundary without changing a public/shared contract.

## Architecture fingerprint and lifecycle authority

```yaml
authoritySchemaVersion: 3
stage: shape
authority-source: >-
  Alice delegated PR #3345 back to Shape for diagnosis only; no implementation,
  push, review mutation, production mutation, or merge.
authorized-scope:
  repositories: [BuilderIO/agent-native]
  product-surfaces: [Clips resumable retry recovery]
  outcome: >-
    Freeze the smallest repair that settles accepted provider effects and prevents stale
    destructive cleanup while preserving retry, cancellation, and feature-flag compatibility.
allowed-mutations: [artifact-write]
write-targets:
  artifacts: [plans/shape-pr3345-provider-side-effect-repair.md]
governing-artifact:
  path: plans/shape-pr3345-provider-side-effect-repair.md
  revision: shape-pr3345-provider-side-effect-repair-r1
architecture-fingerprint:
  outcome: >-
    A failed or accepted provider response is reconciled against its exact resumable session;
    stale requests cannot destroy live sessions, and retries never replay a provider-accepted range.
  shipping-surfaces:
    - id: clips-resumable-retry-repair
      repository: BuilderIO/agent-native
      product-surface: signed Clips desktop resumable retry and hosted Clips upload routes
      constituency: Clips users with a locally saved recording whose upload failed or was interrupted
      durable-destination: BuilderIO/agent-native main lineage and deployed Clips production
      integration-action: merge
  governing-architecture: >-
    Recording attempt/generation lease gates new work, generation-scoped CAS settles provider
    results monotonically, and reset owns cleanup only after retiring the affected generation;
    the shared provider contract remains unchanged.
  acceptance-story:
    id: clips-pr3345-provider-side-effect-repair
    summary: >-
      After network loss or stale retry ownership, accepted bytes remain resumable, stale requests
      cannot abort a successor session, cancellation preserves the local backup, and the Alice-only
      production retry completes safely.
    required-assertions:
      - both current Builder races are deterministically covered and fixed on the exact PR head
      - accepted bytes, chunk index, and provider metadata reconcile monotonically before stale exit
      - destructive cleanup occurs only after exact generation retirement and cannot touch a successor
      - same-claim retry resumes without replay while different-claim takeover safely restarts
      - committed-reset cancellation preserves the authoritative fence and local backup
      - flag-off legacy and buffered/non-resumable behavior remain unchanged
      - focused and full exact-head CI are green with zero actionable review threads
      - Alice-only post-merge production Wi-Fi canary succeeds before broader rollout
    acceptance-policy:
      modality: real-interface
      independence: preferred
      custody: same-context-allowed
      interface: signed Clips desktop plus Alice-only production uploadRetryResume target
      rationale: >-
        Deterministic tests prove concurrency; the real desktop canary proves the user journey.
        Same-context custody is sufficient, while exact-head independent technical review remains required.
  risk-strategy:
    kind: feature-flagged
    production-validation-after-merge: true
architecture-grounding:
  applicability: required
  reason: Provider side effects cross lease, session, reset-cleanup, and native-client boundaries.
  status: grounded
  demonstrated-callers:
    - signed Clips desktop retrying a locally saved interrupted recording
  existing-primitives:
    - exact attempt/generation upload lease CAS and heartbeat
    - generation-scoped resumable session application state
    - core application-state compare-and-set
    - reset generation rotation and resumable cleanup claim
    - typed browser/native retry, restart, and cancellation flows
  ownership-boundaries:
    - recording lease authorizes new provider work
    - provider response proves the result of already-issued work
    - session CAS owns monotonic accepted offset and metadata
    - reset owns retired-generation destructive cleanup
    - desktop owns local cancellation and backup custody
  legacy-contracts:
    - flag-off legacy uploads and preserved fences
    - buffered and non-resumable uploads
    - same-claim response-loss retry and duplicate acknowledgement
    - local backup retention and ready-recording reconciliation
  shared-vocabulary:
    - provider-effect settlement
    - retired-generation cleanup
    - accepted-offset reconciliation
  smallest-compatible-delta: >-
    Add a Clips resumable-session CAS settlement helper, use it after provider relay, and route
    destructive failure cleanup through existing reset retirement.
  deferred-capabilities:
    - provider offset query API
    - generic framework operation journal
    - background reconciliation worker
  reversibility: Existing default-off flag, no migration, no shared contract expansion.
  direct-evidence:
    - PR head 94e657039753f20d3a0626386201b9dacd593651
    - Builder threads PRRT_kwDORlS_j86bNdZl and PRRT_kwDORlS_j86bNdZo
    - templates/clips/server/routes/api/uploads/[recordingId]/chunk.post.ts
    - templates/clips/server/routes/api/uploads/[recordingId]/reset-chunks.post.ts
    - templates/clips/server/lib/resumable-session.ts
    - packages/core/src/file-upload/types.ts
    - templates/clips/desktop/src-tauri/src/native_screen.rs
  inferences:
    - exact session CAS can portably settle accepted provider results without a provider query method
  unresolved-owner-questions: []
delegation-ceiling: [read-only]
acceptance-state:
  status: pending
  summary: >-
    Work is not authorized. Current PR head has two open blocking Builder threads; exact-head repair,
    technical review, CI, and post-merge Alice-only canary remain required.
  blockers:
    - explicit Alice /work approval for this exact fingerprint
    - implementation and exact-head verification of the frozen assertions
    - fresh technical approval and post-merge production canary
ledger-revision: shape-pr3345-provider-side-effect-repair-r1
status: return-to-shape
```

## Approval boundary

Approval of `/work plans/shape-pr3345-provider-side-effect-repair.md` authorizes only the
bounded Clips repair, focused/full verification, PR push, and review-thread handling described
above. It does not authorize merge, deployment, production mutation, or broader flag rollout.
