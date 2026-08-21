# Cross-app feature flag error transport

## Answer

The best repair is a narrow shared Core transport correction, not an Analytics-only parser or a new error policy.

`AgentActionStopError` already means “stop the agent rather than retry this action,” which is required when a mutation may have persisted. Core should additionally preserve its stable `errorCode` and a new, explicitly safe `details` object across the browser action transport. The agent-only `toolResult` must remain private to the agent runtime. The action route should keep its existing HTTP status behavior, and browser query/mutation retry behavior should not change.

This is additive and composes the two existing contracts without pretending an uncertain mutation is an ordinary caller-correctable `ActionContractError`.

## Evidence

### Demonstrated caller

- Analytics calls Content's `set-feature-flag`, then independently calls `list-feature-flags` to prove persistence for Alice.
- A live rollback persisted `Off`, but the action returned HTTP 500 after roughly four seconds. A fresh read proved the mutation succeeded, so automatically retrying the mutation would be unsafe.
- The current Work implementation uses `WorkspaceFeatureFlagFailure extends AgentActionStopError`, runs the mutation once, and retries only the verification read once for timeout/network failure.

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
- **Legacy contracts:** ordinary internal 500s stay generic; existing stopped-action messages/statuses and agent stop behavior stay unchanged; mutation remains exactly once; only the verification read may retry once; feature-gate-off behavior remains v2.
- **Smallest compatible delta:** add optional safe `details` to `AgentActionStopError`; serialize its `errorCode`/`details` but never `toolResult`; preserve `errorCode`/`details` when `actionFetch` reconstructs an error; pass `{ phase }` from Analytics.
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
2. Verification retries at most once and only for timeout/network failure, with a fresh delegated read token.
3. Safe `phase` and `errorCode` survive server serialization and browser reconstruction; `toolResult` and arbitrary internal error details do not.
4. Existing `ActionContractError` metadata survives the browser transport.
5. Existing stopped-action message, status, agent-stop behavior, and Core retry behavior remain unchanged.
6. With the Alice-only gate enabled, live Alice-targeted enablement freshly reads `Enabled for you`; rollback freshly reads `Off`.
7. Automated failure cases remain distinguishable. Slack and delegated Content canaries remain out of scope until this prerequisite passes.

Acceptance uses automated Core/Analytics contract tests plus the real beta Analytics interface for enable/read-back/rollback. Independent review is preferred; same-context custody is allowed because the production mutation is Alice-scoped, reversible, and feature-gated.

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
