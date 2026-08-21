# Cross-app feature flag error transport

## Answer

The best repair is a narrow shared Core transport correction, not an Analytics-only parser or a new error policy.

`AgentActionStopError` already means “stop the agent rather than retry this action,” which is required when a mutation may have persisted. Core should additionally preserve its stable `errorCode` and a new, explicitly safe `details` object across the browser action transport. The agent-only `toolResult` must remain private to the agent runtime. The action route should keep its existing HTTP status behavior, and browser query/mutation retry behavior should not change.

This is additive and composes the two existing contracts without pretending an uncertain mutation is an ordinary caller-correctable `ActionContractError`.

## Response-body retry amendment

The latest review finding does not change the shared Core architecture. It exposes one narrower Analytics bug: `callTarget()` converts every `response.json()` rejection into `{ body: null }`. That is correct for a syntactically invalid or empty legacy response, but wrong when an otherwise successful response body is interrupted or times out. In the verification path, that coercion bypasses the one permitted read retry and collapses a transport failure into generic `verification`.

The smallest causal repair is to preserve response-body transport failures at the existing `callTarget()` boundary:

- For a successful HTTP response, an abort or timeout while reading the body remains `timeout`; another non-syntax body-read failure remains `network`.
- A `SyntaxError` from invalid, empty, or non-JSON content continues to produce a null body so existing unsupported/legacy payload classification remains unchanged.
- For a non-success response, the HTTP status remains authoritative even if its optional body cannot be parsed; authorization, unsupported-target, and target-action classification must not be replaced by a body-read transport label.
- `readBackTarget()` may retry that preserved verification transport failure once, issuing a fresh `flags:read` delegated token. It never calls `set-feature-flag`.
- A body-read transport failure on the mutation response is mutation-uncertain: the write is not retried, verification does not begin, and the existing stopped `timeout` or `network` failure is returned.

This repair belongs only in Analytics' target-call parsing and focused tests. It does not require a new Core error type, retry framework, action status, A2A contract, or Content change.

## Evidence

### Demonstrated caller

- Analytics calls Content's `set-feature-flag`, then independently calls `list-feature-flags` to prove persistence for Alice.
- A live rollback persisted `Off`, but the action returned HTTP 500 after roughly four seconds. A fresh read proved the mutation succeeded, so automatically retrying the mutation would be unsafe.
- The current Work implementation uses `WorkspaceFeatureFlagFailure extends AgentActionStopError`, runs the mutation once, and retries only the verification read once for timeout/network failure.
- Direct review evidence on head `465f5430cee0f59dc32da1007e7c8125b9c3c616` shows that fetch rejection reaches that retry loop, but a rejection from `response.json()` is swallowed and returned as a successful status with a null body.
- The Analytics rollout flag was explicitly enabled for `alice@builder.io` and last proved `true`. A later read-only attempt did not establish a newer value, so the current rollout must be treated as enabled or unknown until an explicit Off mutation and independent read-back prove otherwise.

### Existing primitives and intent

- `AgentActionStopError` carries `errorCode` and `toolResult` and tells the agent runtime to stop the current turn instead of retrying (`packages/core/src/action.ts`). The production agent preserves both fields (`packages/core/src/agent/production-agent.ts`).
- The HTTP action route already treats `AgentActionStopError.message` as safe for the caller, but currently returns only `{ error }` (`packages/core/src/server/action-routes.ts`).
- `ActionContractError` separately declares `errorCode` and `details` safe on every action transport. The server returns those fields, but `actionFetch` currently reconstructs a browser `Error` with only `status`, dropping both fields (`packages/core/src/client/use-action.ts`). This is a pre-existing Core server/client contract gap.
- Repository consumers of `AgentActionStopError` are limited to Core Extensions and Analytics BigQuery, save-analysis, and this workspace flag repair. Their current stable codes are categorical identifiers rather than secrets. Their `toolResult` values can contain richer provider or edit context and must not cross the HTTP boundary.

### Compatibility and security

- New server + old client: additive JSON fields are ignored; messages and statuses remain unchanged.
- Old server + new client: fields are absent; the client retains current behavior.
- New server + new client: callers can inspect `error.errorCode` and `error.details`; existing message rendering remains unchanged.
- HTTP status remains 500 for stopped actions. Mutation hooks do not gain automatic retries. Query retry behavior is unchanged.
- Only stable codes and explicitly sanitized details cross the boundary. Ordinary 500s remain generic, and `toolResult` remains agent-only.

## Inferences

- Additive response fields are unlikely to break external consumers that parse JSON normally.
- Preserving existing `ActionContractError` fields in the browser is an intended completion of its documented contract, not a new product behavior.
- A shared fix prevents every app from inventing message-prefix parsing or caller-specific rethrows for the same transport gap.

## Uncertainties

- Repository search cannot prove that no off-repo consumer asserts exact equality on stopped-action HTTP bodies. This is the residual compatibility risk; additive fields are the conventional compatible evolution.
- No existing type guarantees that arbitrary future `AgentActionStopError.errorCode` values are HTTP-safe. The implementation and JSDoc must establish that stable codes and `details` are caller-safe, while `toolResult` is not.

## Architecture Constraints

- **Service owner:** Core owns action error classification, HTTP serialization, and browser reconstruction. Analytics owns workspace flag phases and their sanitized meanings. Content continues to own flag mutation and persistence.
- **Vocabulary:** `errorCode` is a stable machine-readable category; `details` is explicitly sanitized caller context; `toolResult` is agent-only context.
- **Legacy contracts:** ordinary internal 500s stay generic; existing stopped-action messages/statuses and agent stop behavior stay unchanged; mutation remains exactly once; only the verification read may retry once; malformed or empty JSON remains an unsupported/unverified payload rather than a network failure; non-success HTTP status remains authoritative; feature-gate-off behavior remains v2.
- **Smallest compatible delta:** retain the existing Core transport work; in Analytics, stop swallowing successful-response body transport failures, preserve them as the existing timeout/network classifications, and add focused response-body regression tests. No new public type or action contract is needed.
- **Deferred:** a general typed error hierarchy, automatic retry policy based on error codes, transport of `toolResult`, changes to A2A error vocabulary, or migration of existing app errors.
- **Reversibility:** all fields are additive and optional; removing the new serialization returns clients to message-only behavior without data migration.

## Options

1. **Shared narrow Core transport repair — recommended.** Corrects the owning seam, preserves stop semantics, and fixes the existing `ActionContractError` browser gap.
2. **Analytics message-prefix parsing.** Avoids Core source changes but creates an app-local transport protocol and leaves the generic Core gap intact.
3. **Hybrid `AgentActionStopError` + `ActionContractError` marker in Analytics.** Makes the current route serialize fields, but misstates an uncertain post-mutation failure as deterministic/caller-correctable and still requires a Core client fix.
4. **Use only `ActionContractError`.** Rejected because the agent may retry a mutation that already persisted.

## Recommendation

Approve option 1 with these shipping surfaces:

- `@agent-native/core` action error type, server action route, browser action client, focused regression tests, and patch changeset; durable destination is the published Core package, integrated by PR merge.
- Analytics workspace feature-flag transaction and focused tests; durable destination is the Analytics template/deployment, integrated by the same PR merge and deployment.

Acceptance assertions:

1. The target mutation is issued exactly once.
2. Verification retries at most once and only for timeout/network failure—including an abort, timeout, or interruption while reading an otherwise successful response body—with a fresh delegated read token.
3. Safe `phase` and `errorCode` survive server serialization and browser reconstruction; `toolResult` and arbitrary internal error details do not.
4. Existing `ActionContractError` metadata survives the browser transport.
5. Existing stopped-action message, status, agent-stop behavior, and Core retry behavior remain unchanged.
6. A focused regression proves: mutation response succeeds; the first verification response is HTTP 200 but its body read rejects; a second verification read with fresh authority succeeds; exactly one write and two reads occur.
7. Exhausted verification body-read failures preserve `verification-timeout` or `verification-network`; a mutation-response body-read failure stops without a second write; malformed JSON and non-success statuses retain their prior semantics.
8. Before merge, the app-local `analytics.verified-fleet-flag-mutations` rollout is explicitly set to Off, then `get-feature-flags` freshly proves the evaluated value is `false` and `list-feature-flags` proves the stored rule is Off for Alice's environment.
9. Current CI and independent technical review pass on the exact repair head, and Steve approves that exact head after the repair is pushed.
10. After deployment, the full live acceptance remains: enable Content's `content.a2a-receiver-ownership` for Alice, freshly read `Enabled for you`, then roll it back and freshly read `Off`. Failure phases remain distinguishable. Slack and delegated Content canaries remain out of scope until this prerequisite passes.

Acceptance uses automated Core/Analytics contract tests plus the real beta Analytics interface for rollout rollback and the later enable/read-back/rollback story. Independent review is preferred; same-context custody is allowed because the production mutation is Alice-scoped, reversible, and feature-gated.

The subsequent Land may permit a **code-ready-only** merge only when assertions 1–9 are current on the exact head and the risky Analytics rollout is proved Off. Such a merge does not permit re-enablement, a `shipped` claim, or task closure. System-ready status and manual archival still require assertion 10 against the deployed result.

## Lifecycle state

**Work active on the approved response-body retry fingerprint.**

- `authoritySchemaVersion`: 3
- Previous acceptance fingerprint: verification retries one fetch-level timeout/network failure; live enable/read-back/rollback remains required.
- Proposed acceptance fingerprint: verification retry includes successful-response body transport failure; mutation-response body failure remains write-uncertain and never retries; exact regression, Analytics rollout Off proof, exact-head review/approval, and later deployed acceptance are explicit.
- Approval source: Alice's `$work the shape` instruction in the active task.
- Work authority: Analytics code/tests, focused and repository verification, commit, task-branch push, PR prose refresh, explicit rollback of `analytics.verified-fleet-flag-mutations` for Alice with read-back, and exact-head review/approval wait. Merge, deployment, re-enablement, and task closure remain Land-gated.

## Sources

- `packages/core/src/action.ts`
- `packages/core/src/server/action-routes.ts`
- `packages/core/src/client/use-action.ts`
- `packages/core/src/agent/production-agent.ts`
- `packages/core/src/action.spec.ts`
- `packages/core/src/server/action-routes.spec.ts`
- `packages/core/src/client/use-action.spec.ts`
- `templates/analytics/server/lib/workspace-feature-flags.ts`
- Independent bounded review in the current task
