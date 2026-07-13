# Fix Builder blog preview persistence and guarded CMS writes

## Answer

Builder-backed Content databases should support real Builder CMS writes, including the production blog source, through the guarded pipeline that already exists. The production source should not be intrinsically read-only. It should start read-only and become writable only after an authorized user explicitly selects a write tier for that exact source.

Two independent problems currently prevent that product behavior:

1. A hydration race can silently discard a local preview edit before it becomes an outbound Builder change.
2. The write pipeline is still hard-gated to one test model, and a later settings refactor collapsed the tiered Builder controls back to a test-only boolean toggle.

Fix these in two sequential PRs so persistence is trustworthy before production writes are enabled.

## Evidence

### Local edits can be silently discarded

The preview save callback returns a special skipped result when body hydration is pending. The controller handles that result by resetting `pending` to `lastSaved` without reporting an error or a successful save. The corresponding test explicitly expects the pending content to be dropped. This explains the observed sequence: edit, no table diff, close, reopen, missing content.

Sources:

- [`DatabaseView.tsx`](https://github.com/BuilderIO/agent-native/blob/1b43be76f320fa37ed09a9a26a27368d1f883db1/templates/content/app/components/editor/database/DatabaseView.tsx#L2829-L2849)
- [`previewDocumentSaveController.ts`](https://github.com/BuilderIO/agent-native/blob/1b43be76f320fa37ed09a9a26a27368d1f883db1/templates/content/app/components/editor/previewDocumentSaveController.ts#L154-L187)
- [`previewDocumentSaveController.test.ts`](https://github.com/BuilderIO/agent-native/blob/1b43be76f320fa37ed09a9a26a27368d1f883db1/templates/content/app/components/editor/previewDocumentSaveController.test.ts#L256-L299)

### The intended guarded write pipeline already exists

PR #1173 introduced local staging, review, explicit push-mode opt-in, prepared execution gates, and reconciliation. PR #1485 added source-scoped write tiers: read-only, stage-only autosave, and publish updates, plus explicit publish/unpublish controls. PR #1758 made ordinary Builder-backed field edits local-first and retained the guarded review/execution flow.

Sources:

- [PR #1173: source-aware databases and guarded live writes](https://github.com/BuilderIO/agent-native/pull/1173)
- [PR #1485: Builder live writes and write-mode tiers](https://github.com/BuilderIO/agent-native/pull/1485)
- [PR #1758: normal local-first editing of Builder-backed fields](https://github.com/BuilderIO/agent-native/pull/1758)
- [`execute-builder-source-execution.ts`](https://github.com/BuilderIO/agent-native/blob/1b43be76f320fa37ed09a9a26a27368d1f883db1/templates/content/actions/execute-builder-source-execution.ts#L638-L770)

The surviving execution gates are valuable and should remain: editor access, outbound-only change sets, explicit approval state, prepared gate, dry-run validation, stale-plan detection, idempotency, enabled source capability, explicit push mode, conflict checks, and reconciliation after the provider response.

### The remaining read-only behavior is a temporary model gate, not an architectural limit

The current server rejects any live-write source whose table is not `BUILDER_CMS_SAFE_WRITE_MODEL`, and that constant names only the test collection. The action description and review dialog repeat the same restriction.

Sources:

- [`shared/api.ts`](https://github.com/BuilderIO/agent-native/blob/1b43be76f320fa37ed09a9a26a27368d1f883db1/templates/content/shared/api.ts#L399-L410)
- [`_builder-cms-write-settings.ts`](https://github.com/BuilderIO/agent-native/blob/1b43be76f320fa37ed09a9a26a27368d1f883db1/templates/content/actions/_builder-cms-write-settings.ts#L163-L214)
- [`execute-builder-source-execution.ts`](https://github.com/BuilderIO/agent-native/blob/1b43be76f320fa37ed09a9a26a27368d1f883db1/templates/content/actions/execute-builder-source-execution.ts#L750-L770)

PR #1485 had a three-tier settings control, but the current settings surface exposes only an enable/disable toggle for the test model. The backend still understands all three tiers. This is a UI and policy regression, not missing write infrastructure.

Sources:

- [PR #1485 merged implementation](https://github.com/BuilderIO/agent-native/pull/1485)
- [`_builder-cms-write-settings.ts`](https://github.com/BuilderIO/agent-native/blob/1b43be76f320fa37ed09a9a26a27368d1f883db1/templates/content/actions/_builder-cms-write-settings.ts#L113-L160)
- [`database/settings.tsx`](https://github.com/BuilderIO/agent-native/blob/1b43be76f320fa37ed09a9a26a27368d1f883db1/templates/content/app/components/editor/database/settings.tsx#L486-L505)

## Plan

### PR 1 — Never lose a preview edit during Builder hydration

#### 1. Make editability depend on authoritative document state

- Do not mount an interactive body editor for a source-backed row until `useDocument` has returned and the document-level hydration state is known.
- Keep the existing syncing notice/skeleton visible while the body is pending.
- If hydration starts after editing has begun, freeze the editor in a recoverable state instead of pretending the save succeeded.

#### 2. Replace the destructive `skipped` result with explicit outcomes

Use distinct save outcomes rather than one catch-all skip:

- `persisted`: advance `lastSaved` and emit `onSaved`.
- `deferred`: keep the user payload dirty and visible; do not advance or reset the baseline.
- `superseded`: discard only a proven editor-normalization payload, such as a synthetic empty block that contains no user-authored content and has been replaced by a freshly hydrated body.
- `failed`: keep the payload dirty and show a save error.

A non-empty user edit must never enter the superseded path.

#### 3. Handle the rare edit-versus-hydration conflict explicitly

If a user began editing from an empty or stale source body and fresh Builder content arrives before persistence:

- preserve the typed draft;
- show that the Builder body finished syncing after editing began;
- require an explicit choice to keep the local draft or reload the Builder body;
- never silently merge or overwrite either side.

The retained draft must survive closing and reopening the row for the duration of the conflict. If the existing in-memory controller registry cannot guarantee that, persist the bounded draft in local app storage/SQL as a draft record rather than putting it in `application_state`.

#### 4. Prove the complete local outcome

Add focused tests for:

- source-backed empty row remains non-editable until authoritative hydration state arrives;
- hydration flips pending between keystroke and debounce, and the typed payload remains dirty and visible;
- close/reopen preserves a deferred draft;
- only synthetic empty normalization may be superseded;
- a normal title/body/property edit persists locally and appears as an outbound Builder change set;
- hydration cannot create a phantom outbound change.

Add a user-facing Content changelog entry because this fixes visible data-loss behavior.

### PR 2 — Enable guarded writes for explicitly authorized Builder sources

#### 1. Replace the singular test-model gate with per-source authorization

- Remove `BUILDER_CMS_SAFE_WRITE_MODEL` as the final authorization decision.
- Keep every newly attached Builder source in `read_only` mode.
- Allow an authorized document admin to choose a write tier for one exact attached source.
- Require `admin` access, rather than ordinary `editor` access, to change a source from read-only to a writable tier.
- Keep ordinary editing, diff review, and source refresh scoped to their existing permissions.

This makes the safety boundary the source-specific capability and guarded execution record, not a hard-coded internal model name. It also keeps the generic Content template usable with Builder models outside one workspace.

#### 2. Restore the tiered settings UI from PR #1485

Expose the existing server modes in the source settings panel:

- **Read-only** — local edits and reviewable diffs are allowed; no Builder API write.
- **Stage only** — guarded Builder autosave/draft writes are allowed; never publish.
- **Publish updates** — guarded updates may reach Builder while preserving publication state; explicit per-item publish/unpublish transitions remain separately controlled.

The UI must derive eligibility and allowed tiers from the server response. It must not compare the source model name in client code.

Existing sources remain read-only after deployment. Enabling the production Blog source is an explicit post-deploy action, not a migration side effect.

#### 3. Preserve and harden the final execution gates

At execution time, continue to require:

- exact source and row identity;
- outbound approved change set;
- current source revision/conflict check;
- prepared and validated dry-run plan;
- matching idempotency key;
- explicit push-mode confirmation;
- explicit confirmation for unpublish;
- source write tier that permits the requested effect;
- scoped Builder credentials;
- remote read-back and local reconciliation before reporting success.

Add framework human approval to agent-triggered production writes (`needsApproval` on single and batch execution). Direct UI execution remains tied to the user's explicit Push/Publish gesture. Enabling a writable tier through the agent should also require approval and admin access.

#### 4. Use the bounded batch action from the UI

The current preview workflow loops through executable rows and invokes one mutation per row even though `execute-builder-source-batch` already exists. Route the UI through one bounded batch action so it returns concrete `succeeded`, `blocked`, and `failed` counts and does not depend on a long client-side mutation loop.

Batch execution remains resumable and idempotent per change set. Partial provider failures must be shown as partial results, never rounded up to success.

#### 5. Verify against a controlled production blog entry

After deployment:

1. Keep the Blog source read-only and verify local edit → visible table diff → review dry run, with no Builder write.
2. As an authorized admin, select **Stage only** for that exact source.
3. Make one reversible marker edit on a controlled production blog entry.
4. Review the exact before/after diff and push it as autosave only.
5. Read the entry back from Builder, confirm the expected remote revision, and confirm Content reconciled the same value locally.
6. Revert the marker through the same guarded pipeline and verify the remote and local values again.
7. Separately verify that publish/unpublish cannot occur in Stage only mode.
8. Only after that proof, test **Publish updates** on a designated entry with explicit publication intent and confirmation.

Record entry IDs and counts in private QA notes or the PR verification section without copying private content or credentials into the repository.

Add a user-facing Content changelog entry for guarded production Builder writes.

## Acceptance criteria

### Persistence

- Editing a hydrated Builder row, closing it immediately, and reopening it shows the edit.
- If hydration changes during editing, the user sees a recoverable draft/conflict state; content never disappears.
- A successful local edit creates the expected outbound change set and table diff.
- No hydration-only operation creates a phantom diff.

### Authorization and safety

- New and existing Builder sources default to read-only after deploy.
- Only an admin can enable a writable tier for a source.
- An agent cannot enable or execute production writes without human approval.
- Stage only can autosave but cannot publish or unpublish.
- Publish updates preserves publication state unless an explicit per-item transition is selected.
- Unpublish still requires separate confirmation.
- A stale source revision, changed plan, wrong idempotency key, unsupported effect, or mismatched source identity fails closed before the provider write.

### Proof of done

- The UI makes one bounded batch request for a reviewed set and reports exact per-item outcomes.
- A production QA write is verified by reading Builder back, then by checking local reconciliation.
- The reversible QA edit is reverted and that revert is also verified remotely and locally.

## Inferences

- The production Blog source is currently read-only because the temporary test-model guard and simplified settings UI survived after the broader write pipeline shipped.
- The recent reproduction is upstream of Builder execution: the local edit is discarded before a change set exists, so widening write authorization alone would not fix it.
- Restoring production writes before fixing preview persistence would create a misleading surface where Push is available but the user's body edit may never reach the review queue.

## Uncertainties

- The exact controlled production entry for reversible QA should be chosen at execution time from current Builder state; it should not be named in this repository plan.
- The hosted deployment must be checked after each PR so merged code is not mistaken for live behavior.
- If framework `needsApproval` does not apply to direct frontend action calls, the UI click remains the human approval for UI writes while the approval gate protects agent-initiated calls. That distinction should be covered in action tests.

## Recommendation

Implement and deploy PR 1 first. Verify the original Chronicle reproduction no longer loses content and that the edit becomes a reviewable outbound diff. Then implement PR 2, enable the production Blog source initially in Stage only mode, run the reversible remote proof, and only then opt into Publish updates if the production workflow requires it.

## Sources

- [PR #1173](https://github.com/BuilderIO/agent-native/pull/1173)
- [PR #1485](https://github.com/BuilderIO/agent-native/pull/1485)
- [PR #1758](https://github.com/BuilderIO/agent-native/pull/1758)
- [PR #1759](https://github.com/BuilderIO/agent-native/pull/1759)
- [PR #2000](https://github.com/BuilderIO/agent-native/pull/2000)
- Current source at commit [`1b43be76f`](https://github.com/BuilderIO/agent-native/commit/1b43be76f320fa37ed09a9a26a27368d1f883db1)
