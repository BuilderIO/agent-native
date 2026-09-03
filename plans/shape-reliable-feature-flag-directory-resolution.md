# Reliable feature-flag target resolution

## Answer

The code fix should preserve Dispatch as the authority for app origins while making directory failure observable and retryable for Analytics control-plane mutations.

Today `fetchOrgApps()` intentionally collapses every directory failure into `[]`. That is correct for best-effort cross-app discovery, whose legacy contract is silent local-only degradation, but it is the wrong primitive for a verified write. `setWorkspaceFeatureFlag()` calls that best-effort primitive in a new serverless invocation and treats an empty result as “target not found.” A transient directory error and a genuine absent target are therefore indistinguishable. The beta trace demonstrated exactly this boundary: a list request resolved Content and read its flag, while two later mutation requests failed in the `directory` phase before sending anything to Content.

The smallest compatible delta is:

1. Add a failure-aware Core directory lookup beside `fetchOrgApps()` (or an explicit strict result mode on the same underlying implementation). It should return a typed result that distinguishes `available` from `unavailable`, and retain the existing `fetchOrgApps(): OrgApp[]` wrapper unchanged for legacy best-effort callers.
2. For the failure-aware path, classify no configuration/auth, timeout/network, authorization, invalid response, and a successful empty directory separately enough that callers never mistake infrastructure failure for “no app.” Do not cache failed/empty infrastructure results for verified mutations.
3. In Analytics, use the failure-aware lookup in `resolveTargetApp()` and retry only retryable transport/unavailable outcomes with a small fixed budget (recommended: one retry with short jitter, inside the existing request timeout budget). A successful directory response that lacks `appId` remains a non-retryable directory/target-not-found failure.
4. Continue deriving the target origin exclusively from the server-authenticated directory response. Do not accept an origin or reusable target URL from the browser request.
5. Keep the already-landed mutation transaction unchanged after resolution: scoped A2A token, target write, structured persistence validation, independent read-back, and exact rollback verification.

## Evidence

- `packages/core/src/mcp/org-directory.ts` documents and implements `fetchOrgApps()` as returning `[]` on every error, including no token, non-2xx, timeout, parse failure, and unreachable directory. It also caches empty/failed results for ten seconds.
- `templates/analytics/server/lib/workspace-feature-flags.ts` uses `fetchOrgApps()` in `resolveTargetApp()` and maps both an empty failure result and a real missing app to the same `directory` phase.
- The same Analytics module separately uses `fetchOrgApps()` for fleet listing, so a successful list does not bind the next serverless mutation invocation to the same in-memory cache or runtime instance.
- Live beta evidence on 2026-08-24: Content and `content.a2a-receiver-ownership` were successfully listed as Off; two exact `set-workspace-feature-flag` POSTs later returned HTTP 503 with phase `directory`; neither request reached Content. This proves both intermittent directory resolution and the safe exact-error transport from PR #3313.

## Architecture constraints

- Demonstrated caller: authenticated Analytics operator clicks **Enable for me**, which invokes `set-workspace-feature-flag` for Content.
- Existing primitives: Core org-directory client, service-org A2A authentication, Dispatch `/_agent-native/org/apps`, Analytics action surface, and target-local `set-feature-flag` / `list-feature-flags` actions.
- Ownership boundaries: Dispatch owns the trusted organization app registry and app origins; Core owns directory transport/auth semantics; Analytics owns orchestration and operator-facing failure classification; Content owns flag persistence and evaluation.
- Legacy contract: ordinary `list_apps` / `ask_app` discovery must continue to degrade to `[]` without throwing when the directory is absent or unavailable.
- Security contract: the browser supplies only `appId`, flag key, and operation. It must not be able to select an arbitrary target origin.
- Smallest compatible delta: expose typed strict directory resolution from the same Core implementation and consume it only in verified Analytics management paths with a bounded retry.
- Deferred: durable distributed directory caches, browser-issued signed target handles, changing the Dispatch registry, or redesigning A2A authentication.
- Reversibility: the strict path is additive; the legacy wrapper and target mutation protocol remain intact.
- Unresolved owner questions: none. Current code and the live request trace establish the service boundary and compatibility requirement.

## Frozen destination

```yaml
authoritySchemaVersion: 3
stage: shape
authority-source: "Alice: Okay, so what code fix in agent-native would be needed? $shape"
authorized-scope:
  repositories: [BuilderIO/agent-native]
  product-surfaces: [Analytics beta feature-flag management, Core org-directory client]
  outcome: Verified feature-flag mutations tolerate a transient directory lookup failure without weakening trusted target resolution.
allowed-mutations: [artifact-write]
write-targets:
  artifacts: [plans/shape-reliable-feature-flag-directory-resolution.md]
architecture-fingerprint:
  outcome: Make trusted feature-flag target resolution failure-aware and retry transient directory failure once.
  shipping-surfaces:
    - id: agent-native-feature-flag-directory
      repository: BuilderIO/agent-native
      product-surface: Analytics feature-flag management and Core directory client
      constituency: authenticated organization feature-flag operators
      durable-destination: agent-native main and automatic beta deploy
      integration-action: merge
  governing-architecture: Dispatch remains the target-origin authority; Core exposes typed best-effort and strict directory semantics; Analytics retries only typed transient resolution failures before its existing verified target transaction.
  acceptance-story:
    id: reliable-feature-flag-directory-v1
    summary: An authenticated operator can enable the Content flag, see verified enabled read-back, turn it Off, and see verified Off read-back even when the first directory attempt transiently fails.
    required-assertions:
      - Existing best-effort fetchOrgApps callers still receive [] for unavailable or unconfigured directory state.
      - Strict directory lookup distinguishes unavailable infrastructure from a successful response with no matching app.
      - A mutation retries one typed transient directory failure and then sends exactly one target write.
      - A successful directory response missing the requested app does not retry or call a target.
      - Persistent directory failure sends no target write and preserves the directory failure phase.
      - Browser input cannot provide or override the target origin.
      - The target mutation remains scoped, permission-checked, persistence-validated, independently read back, and auditable.
      - On deployed beta, enable-for-current-user reads back Enabled for you, then rollback reads back Off.
    acceptance-policy:
      modality: real-interface
      independence: preferred
      custody: same-context-allowed
      interface: Authenticated in-app browser on beta Analytics Feature flags targeting Content.
      rationale: Unit tests can prove retry and trust-boundary semantics; the deployed cross-app transaction must also be exercised through the real operator UI. Same-context evidence is allowed because the change is reversible, flag-scoped, and rollback is part of acceptance.
  risk-strategy:
    kind: system-ready
    production-validation-after-merge: false
architecture-grounding:
  applicability: required
  status: grounded
  demonstrated-callers: [Analytics set-workspace-feature-flag -> Content]
  existing-primitives: [Core fetchOrgApps, Dispatch org apps endpoint, service-org A2A auth, Analytics verified flag transaction]
  ownership-boundaries: [Dispatch registry authority, Core transport semantics, Analytics orchestration, Content persistence]
  legacy-contracts: [Best-effort cross-app discovery silently degrades to an empty list]
  shared-vocabulary: [best-effort directory lookup, strict directory lookup, unavailable, target-not-found]
  smallest-compatible-delta: Add typed strict resolution beside the legacy wrapper and use one bounded retry in Analytics mutations.
  deferred-capabilities: [distributed cache, signed browser target handles, directory redesign]
  reversibility: Additive Core API and narrow Analytics consumer change.
  direct-evidence: [packages/core/src/mcp/org-directory.ts, templates/analytics/server/lib/workspace-feature-flags.ts, 2026-08-24 beta network trace]
  inferences: [The intermittent beta result is most likely a transient directory/auth/runtime failure; response status detail is currently erased by fetchOrgApps.]
  unresolved-owner-questions: []
acceptance-state:
  status: pending
  summary: Shape is complete; implementation and deployed beta enable/read-back/rollback evidence remain pending.
  blockers: []
ledger-revision: shape-reliable-feature-flag-directory-v1
status: active
task-attention: shape-complete
```

## Recommendation

Proceed to Work with the additive strict Core API plus the narrow Analytics retry. Do not solve this by trusting the list response's browser-visible origin, lengthening the empty-result cache, or retrying the target write itself.

## Sources

- `packages/core/src/mcp/org-directory.ts`
- `packages/core/src/mcp/org-directory.spec.ts`
- `templates/analytics/server/lib/workspace-feature-flags.ts`
- `templates/analytics/server/lib/workspace-feature-flags.spec.ts`
- Authenticated beta Analytics network trace, 2026-08-24

## Return to Shape — beta deployment boundary

WORK PAUSED — RETURNING TO SHAPE

Work produced exact commit `57ab7e53a54b1ab09bdf8b30e35f95e2dd5b8507`, with focused tests, typechecks, all guards, and independent technical review passing. It then established that `.github/workflows/deploy-beta-sites-prebuilt.yml` deploys only the mirrored `main` revision; `workflow_dispatch` also resolves `main`. No PR-head beta or deploy-preview surface exists. The frozen story requires the exact revision on beta before merge while `production-validation-after-merge` is false, so its ordering is impossible without changing the risk strategy or acceptance interface.

### Options

1. **Recommended — feature-flagged post-merge beta validation.** Add a new Analytics-owned default-off flag around strict directory retry. Before merge, prove it Off on beta. After merge and automatic beta deployment, enable it only for the designated operator through Analytics' local `set-feature-flag` action, execute enable/read-back/rollback against Content, then turn the rollout flag Off again. This preserves the real-interface story and makes post-merge validation reversible.
2. Replace beta acceptance with a local real-interface integration environment. This can prove the browser/action flow before merge but is weaker evidence for the deployed Dispatch/Analytics/Content boundary that actually failed.
3. Add a PR-head beta deployment mechanism. This expands repository deployment architecture and is disproportionate to this bounded fix.

### Old fingerprint

- Governing architecture: strict Core lookup plus bounded Analytics retry, with no rollout gate around the retry.
- Acceptance: exact revision must pass authenticated beta enable/read-back/rollback before merge.
- Risk: `system-ready`, `production-validation-after-merge: false`.

### Proposed replacement fingerprint

- Outcome and shipping surface: unchanged.
- Governing architecture: Dispatch remains authoritative; Core exposes typed strict results; Analytics retries only timeout, network, rate-limit, and server failures, gated by a new Analytics-owned default-off rollout flag.
- Acceptance: focused contracts, typechecks, guards, independent review, and proof that the new retry flag is Off on beta permit code-ready merge; after automatic beta deployment, target the designated operator, run Content enable/read-back/rollback, then return both the Content flag and retry rollout flag to Off.
- Risk: `feature-flagged`, `production-validation-after-merge: true`.

Replacement acceptance story:

1. Legacy `fetchOrgApps()` preserves empty-list degradation.
2. Strict lookup distinguishes unavailable infrastructure from successful empty results.
3. Only timeout, network, HTTP 429, and HTTP 5xx receive one pre-write retry.
4. Missing target and every non-transient failure make zero target calls.
5. Browser input cannot override the directory-derived origin.
6. The target transaction remains scoped, persistence-validated, independently read back, and auditable.
7. The new Analytics retry rollout flag is proven Off on beta before merge.
8. After automatic beta deployment, enable the retry rollout only for the designated operator.
9. Through authenticated beta Analytics, enable `content.a2a-receiver-ownership` and read back **Enabled for you**.
10. Roll back `content.a2a-receiver-ownership` and read back **Off**.
11. Return the Analytics retry rollout flag to Off and verify it is Off.

Lifecycle state: WORK PAUSED — RETURNING TO SHAPE
Authority: Shape, proposed ledger `shape-reliable-feature-flag-directory-v2`; implementation mutations invalidated pending Alice's approval of the replacement fingerprint and acceptance story.
Task attention: alice-decision; title preserved
Next: approve the recommended feature-flagged replacement, then `/work plans/shape-reliable-feature-flag-directory-resolution.md`

### Approval

Alice approved the recommended feature-flagged replacement in the calling task on 2026-08-24. Work authority resumes against `shape-reliable-feature-flag-directory-v2`; the replacement fingerprint and assertions above are authoritative.

## Return to Shape — reliable directory service

WORK PAUSED — RETURNING TO SHAPE

The v2 implementation made directory failures visible and gave Analytics one safe pre-write retry. Live beta investigation then established that this is only a caller-side mitigation: the authenticated Dispatch directory request itself performs variable-cost, uncached discovery behind Core's hard four-second deadline. The same deployed Analytics session alternated between a complete directory and `directoryStatus: unavailable` without a deployment or credential change. Dispatch health and unauthenticated route checks remained fast, isolating the unstable work to the authenticated org resolution and discovery path.

The broader fix should keep PR #3513's typed Core result, success-only caching, transient classification, Analytics rollout flag, and one pre-write retry. It should also make the Dispatch directory a bounded service rather than relying on the generic best-effort discovery path.

### Material delta

- **Old outcome:** verified feature-flag mutations survive one transient directory failure.
- **Proposed outcome:** authenticated organization directory reads are bounded and observable, while verified feature-flag mutations still survive one genuinely transient failure.
- **Old architecture:** generic `discoverAgents()` remains unchanged; Core and Analytics classify and retry its failures.
- **Proposed architecture:** Core owns a strict, purpose-built directory discovery primitive; Dispatch uses it for `/_agent-native/org/apps`; the existing best-effort `discoverAgents()` and `fetchOrgApps()` contracts remain unchanged for legacy callers; PR #3513 remains the strict client and orchestration layer.
- **Old acceptance:** prove retry classification plus one deployed beta mutation transaction.
- **Replacement acceptance:** additionally prove bounded query/latency behavior, exact directory membership semantics, honest server failure, authenticated endpoint behavior, and repeated real beta reads before the mutation transaction.
- **Risk strategy:** remains feature-flagged for Analytics retry behavior with post-merge beta validation. The Dispatch data-access correction is an always-on compatibility fix and must pass exact contract and performance assertions before merge.

### Options

1. **Recommended — strict batched directory discovery plus single-flight success caching.** Add a Core directory-specific read that obtains remote-agent manifests through one projected, portable store query, resolves independent workspace metadata concurrently, and returns a typed failure rather than silently dropping a failed layer. Dispatch coalesces concurrent refreshes and caches only complete successful results per organization for the existing 60-second freshness window. This removes the four sequential list calls and per-resource read waterfall while preserving one source of truth.
2. Parallelize the existing `resourceList()` and `resourceGet()` loops inside `discoverAgents()`. This is smaller, but query count still grows with the number of manifests, changes a broad best-effort primitive for every consumer, and still cannot distinguish a complete directory from a partial fallback.
3. Increase the four-second timeout and rely on PR #3513's retry. This reduces observed failures without bounding the work or revealing why the endpoint failed. It leaves the outage mechanism intact and is not a root fix.
4. Persist a separate durable directory snapshot. This can provide strong stale-while-error behavior, but introduces synchronization, invalidation, and removal semantics that are disproportionate to the demonstrated caller. Defer it unless the batched strict read cannot meet the measured service budget.

### Recommended service contract

1. Core adds a directory-specific strict discovery result beside the generic best-effort agent discovery API.
2. Its successful result is complete: built-in templates, eligible remote-agent resource overrides, and sibling workspace apps retain the same precedence, URL normalization, hidden-template filtering, self-filtering, and organization scope as today's Dispatch response.
3. Remote manifests are read in a bounded number of database round trips through a projected resource-store helper. Query count must not grow per manifest.
4. Independent static/workspace inputs are resolved concurrently where safe. No unbounded `Promise.all` over individual database reads replaces the current serial waterfall.
5. Failure to read an authoritative dynamic layer is a typed failure, not a successful partial directory. Dispatch returns a non-2xx response and records a structured, secret-free failure category and stage duration.
6. Dispatch coalesces simultaneous refreshes and caches only complete successful results per organization for at most 60 seconds. It does not cache failures or serve an older directory after a failed refresh; a withdrawn app must not be silently resurrected.
7. Core's strict HTTP client preserves the typed result and success-only cache from PR #3513. The existing `fetchOrgApps(): OrgApp[]` wrapper continues silent empty-list degradation for legacy cross-app discovery.
8. Analytics retains the default-off `analytics.resilient-fleet-flag-directory` gate and makes at most one retry for typed timeout, network, rate-limit, or server failures before any target write. Missing target, authorization, configuration, and invalid-response failures do not retry.
9. The four-second client deadline remains initially. Work may change it only from measured local/preview evidence and must record the resulting directory service-level objective in tests and code; merely lengthening it is not acceptance.
10. The beta deployment workflow gains an authenticated directory acceptance check or an equivalent trusted fixture-backed probe. Existing `/` and `/_agent-native/health` smoke checks remain but are not directory evidence.

### Architecture grounding and fit

- **Demonstrated caller:** authenticated Analytics `list-workspace-feature-flags` and `set-workspace-feature-flag` call Dispatch `GET /_agent-native/org/apps` for the operator's organization.
- **Existing primitives:** static `getBuiltinAgents()`, generic `discoverAgents()`, resource store, workspace-app manifest and metadata, Dispatch A2A verification and same-org resolution, Core `fetchOrgApps()`, PR #3513's strict result, and Analytics' verified target transaction.
- **Ownership boundaries:** Dispatch owns authenticated organization membership and trusted app origins; Core agent discovery owns registry composition and resource-store access; Core org-directory transport owns timeout/cache/error semantics; Analytics owns fleet orchestration and operator-facing retry; target apps own flag authorization and persistence.
- **Legacy contracts:** generic discovery remains best-effort; hidden templates stay hidden; resource and workspace overrides preserve precedence; directory callers cannot choose target origins; A2A and same-org checks remain unchanged; target writes remain exactly-once, scoped, audited, persistence-validated, and independently read back.
- **Smallest compatible delta:** introduce a strict batched sibling beside generic discovery, use it only in Dispatch's authenticated directory, and retain PR #3513 above it.
- **Deferred capabilities:** durable distributed snapshots, stale-while-error serving, registry schema changes, browser-issued target handles, generalized service discovery, and deployment-system migration repair.
- **Reversibility:** the new path is isolated to one authenticated endpoint; the old discovery and client wrappers remain available; the Analytics behavior stays behind its default-off rollout flag.
- **Direct evidence:** `packages/core/src/server/agent-discovery.ts` performs four sequential list reads and one `resourceGet()` per manifest; `templates/dispatch/server/plugins/org-apps-directory.ts` runs it inside the authenticated request; `packages/core/src/mcp/org-directory.ts` enforces a four-second deadline and historically collapsed all failures to `[]`; authenticated beta alternated between unavailable and complete without configuration drift; Dispatch health and unauthenticated auth rejection remained sub-second; beta deploy smoke does not exercise the authenticated directory route.
- **Inference:** the variable authenticated discovery work is the strongest supported outage mechanism. Existing telemetry cannot identify the exact slow database operation because the current client erases status and timing.
- **Unresolved owner questions:** none. The proposed boundary retains current service and datastore ownership without changing a public protocol.

### Replacement acceptance story

An authenticated organization operator can repeatedly load the complete feature-flag fleet and perform a verified, reversible Content flag mutation even when one directory transport attempt fails, without Analytics trusting browser-provided origins or Dispatch returning partial membership as success.

Required assertions:

1. Generic `discoverAgents()` and `fetchOrgApps()` preserve their best-effort fallback behavior for existing callers.
2. Strict directory discovery returns the same built-in, remote override, workspace app, hidden-template, precedence, URL, org-scope, and self-filter results as the existing successful endpoint.
3. Strict discovery uses a constant bounded number of database round trips as remote-manifest count grows and does not perform an N+1 resource-content waterfall.
4. Under a representative cold fixture and injected database latency, authenticated directory work completes inside the documented service budget and the Core four-second deadline.
5. An authoritative layer failure produces a typed non-2xx directory failure with secret-free stage/duration telemetry; it never returns a successful partial or empty directory.
6. Concurrent same-org requests share one in-flight refresh; only complete success is cached; failure is not cached; organization cache keys do not cross tenants.
7. A withdrawn app does not reappear after the success-cache freshness window, including when the next refresh fails.
8. PR #3513's strict client distinguishes configuration, authentication, timeout/network, rate-limit, server, invalid-response, successful-empty, and target-not-found outcomes while its legacy wrapper still returns `[]`.
9. Analytics retries exactly once only for the frozen transient classes and performs exactly one target write after recovery; persistent or non-transient failure performs zero target writes.
10. Browser input cannot provide or override a target origin, and all A2A audience, organization, scope, permission, audit, persistence-validation, read-back, and rollback contracts remain intact.
11. Repository tests, typechecks, guards, performance-contract tests, and independent technical review pass on the exact PR head.
12. Before merge, the Analytics retry rollout flag is proven Off on beta.
13. After automatic beta deployment, an authenticated operator performs ten consecutive fleet reloads without a directory outage, then enables `content.a2a-receiver-ownership`, reads back **Enabled for you**, rolls it back, and reads back **Off**.
14. After acceptance, `analytics.resilient-fleet-flag-directory` is returned to Off and verified Off.

Acceptance policy:

- **Modality:** real-interface, backed by automated contract and performance evidence.
- **Independence:** preferred.
- **Custody:** same-context-allowed.
- **Interface:** authenticated beta Analytics Feature flags, targeting the beta Dispatch directory and beta Content flag actions; automated tests use deterministic strict-directory fixtures with injected latency and failures.
- **Rationale:** query shape, classification, and exactly-once semantics are deterministic and belong in automated tests. The deployed cross-service behavior still requires the real operator UI. Same-context custody is proportionate because both flags are reversible and rollback is mandatory; an independent technical reviewer should inspect the shared Core/Dispatch boundary.

### Proposed frozen destination

```yaml
authoritySchemaVersion: 3
stage: shape
authority-source: "Alice: $shape a fix for the broader issue. Keep this existing fix as part of it, too, as needed."
authorized-scope:
  repositories: [BuilderIO/agent-native]
  product-surfaces: [Dispatch authenticated organization app directory, Core directory discovery and transport, Analytics feature-flag fleet management]
  outcome: Make authenticated organization directory reads bounded and observable while retaining safe transient recovery for verified feature-flag operations.
allowed-mutations: [artifact-write]
write-targets:
  artifacts: [plans/shape-reliable-feature-flag-directory-resolution.md]
architecture-fingerprint:
  outcome: Make the Dispatch organization directory a bounded, failure-honest service and retain PR 3513's typed strict lookup and one pre-write Analytics retry.
  shipping-surfaces:
    - id: agent-native-org-directory-reliability
      repository: BuilderIO/agent-native
      product-surface: Core and Dispatch organization directory plus Analytics feature-flag fleet management
      constituency: source-blind Agent Native developers and authenticated organization feature-flag operators
      durable-destination: BuilderIO/agent-native main, automatic beta deployment, and PR 3513
      integration-action: merge
  governing-architecture: Core composes the authoritative directory through a strict bounded batched read while preserving generic best-effort discovery; Dispatch authenticates, scopes, coalesces, and exposes that result; Core transport classifies it; Analytics alone decides bounded pre-write retry.
  acceptance-story:
    id: reliable-org-directory-v3
    summary: Repeated authenticated fleet reads return complete directory membership, and a verified reversible Content flag mutation survives one transient pre-write directory failure without weakening origin trust or returning partial membership as success.
    required-assertions: [legacy compatibility, exact membership parity, bounded query count, latency budget, failure honesty and telemetry, tenant-safe single-flight success cache, withdrawal freshness, typed client classification, bounded pre-write retry, security and verified transaction parity, exact-head checks and review, beta rollout flag Off before merge, ten beta reloads plus enable/read-back/rollback after deploy, rollout flag Off after acceptance]
    acceptance-policy:
      modality: real-interface
      independence: preferred
      custody: same-context-allowed
      interface: Authenticated beta Analytics Feature flags plus deterministic strict-directory latency/failure fixtures.
      rationale: Automated evidence proves bounded data access and failure semantics; the deployed cross-service story must also pass through the real operator surface. Independent technical review is preferred for the shared Core/Dispatch seam.
  risk-strategy:
    kind: feature-flagged
    production-validation-after-merge: true
architecture-grounding:
  applicability: required
  reason: This changes a shared cross-service registry and authenticated platform endpoint.
  status: grounded
  demonstrated-callers: [Analytics list-workspace-feature-flags, Analytics set-workspace-feature-flag]
  existing-primitives: [getBuiltinAgents, discoverAgents, resource store, workspace app manifest and metadata, Dispatch org apps endpoint, A2A auth, strict org-directory result from PR 3513]
  ownership-boundaries: [Core composes registry data, Dispatch owns authenticated org authority, Core transport owns failure semantics, Analytics owns retry orchestration, target apps own flag state]
  legacy-contracts: [best-effort generic discovery, exact membership precedence, hidden-template filtering, directory-derived origins, same-org A2A authorization, verified target transaction]
  shared-vocabulary: [best-effort agent discovery, strict organization directory discovery, complete success, authoritative layer failure, transient pre-write retry]
  smallest-compatible-delta: Add a strict batched directory sibling in Core, consume it only in Dispatch, and retain PR 3513's strict transport and Analytics retry.
  deferred-capabilities: [durable distributed directory snapshot, stale-while-error, registry schema, generalized service discovery, deployment migration repair]
  reversibility: One endpoint opts into the new strict path; legacy paths remain; Analytics retry remains default-off.
  direct-evidence: [agent-discovery.ts query waterfall, org-apps-directory.ts request path, org-directory.ts four-second deadline and failure collapse, authenticated beta alternation, sub-second health/auth checks, beta smoke coverage gap]
  inferences: [authenticated dynamic discovery is the dominant timeout source; exact slow query awaits new telemetry]
  unresolved-owner-questions: []
acceptance-state:
  status: pending
  summary: WORK PAUSED — RETURNING TO SHAPE; the broader fingerprint and replacement acceptance story await Alice's approval.
  blockers: [Alice approval of reliable-org-directory-v3]
ledger-revision: shape-reliable-org-directory-v3-proposed
status: return-to-shape
task-attention: return-to-shape
```

### Recommendation

Approve v3 and resume Work on PR #3513. Keep the existing exact-head changes, add the strict batched Dispatch directory path and its performance/failure evidence, update the PR description to explain the root issue, and keep the PR in draft until the replacement acceptance packet is complete.

### V3 approval

Alice approved `reliable-org-directory-v3` and invoked Work in the calling task on 2026-08-24. Work authority resumes on existing draft PR #3513 against ledger `work-reliable-org-directory-v3-r1`. The schema-v3 acceptance policy is reconciled as written: real-interface modality, preferred independence, and same-context-allowed custody.
