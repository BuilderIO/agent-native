# Shared Personal Content blank-body repair

Status: Shape complete; ready for `/work`
Task: `bc4a2441-2f92-4eaf-93b4-b29c3cc564fa` — Make shared Personal Content readable and editable
Shape ledger: `shape-bc4a2441-r1`
Frozen against: `BuilderIO/agent-native@84ab540e20387bd4a2bc160ebd73cb7db0215dfd` (`main`, 2026-08-26)

## Outcome

An explicitly authorized recipient can open and edit a page shared from another person's Personal Content space without receiving access to that person's private Files database container. A failed page, property, or collaborative-state initialization is a visible, retryable failure and can never be interpreted as a successfully synchronized empty body or persisted back over known content.

This is a contract repair for `content.access.page-database` and `content.workspace.multi-scope`. It does not broaden sharing, make Personal spaces discoverable, grant access to their Files containers, or redesign Content roles.

## Human problem and stakes

Julia opened a page Taylor had shared from Personal Content. The title was visible, but the body stayed blank. That presentation falsely looks like a legitimately empty page, prevents the recipient from using the shared work, and—because the collaborative client currently converts initialization failures into a synchronized empty state—can turn a read failure into a write hazard.

The repair must preserve both sides of the promise: sharing one page makes that page usable, while everything else in the owner's Personal space remains private.

## Evidence model

### Direct evidence

1. The complete live feedback thread has the original title-visible/body-blank report, Tim's Personal-space correlation, and no verified-fix report. Steve's latest reply says a fix is not verified and speculates about SQLite contention. [Slack thread](https://builder-internal.slack.com/archives/C0ATH3CCZT4/p1787690711095719)
2. The attached screenshot is present as Slack file `F0BSP3678Q2`, but the current Slack connection lacks permission to read the binary. Its visual details are therefore unresolved; the parent's written report is the usable first-party observation.
3. A private follow-up from the Builder bot claims a reproduced property-authorization mismatch and a latent collaborative-initialization failure. Alice authorized that bot branch to implement, but the bot's claims remain evidence rather than authority or proof. [Slack investigation handoff](https://builder-internal.slack.com/archives/D0AD54E67FB/p1787693239343699)
4. The named `square-margin-zcgtoalk` branch is absent from both configured remotes, GitHub's branch API, and all PRs as of this shape. It is not a current artifact and no fix from it is assumed.
5. Direct user shares are valid page authority. Core `resolveAccess` loads the page, matches a case-normalized user share, and does not require the recipient's active org to equal the page's Personal scope. The Content document registration deliberately lets owners reach their pages across active-org selection. See `packages/core/src/sharing/access.ts` and `templates/content/server/db/index.ts`.
6. `get-document` first authorizes the requested page and returns its canonical SQL `content`. See `templates/content/actions/get-document.ts`.
7. A database-row page then renders its body only after `list-document-properties` succeeds. That request receives the row's `databaseId`; `resolvePropertyDatabaseForDocument` calls `assertAccess` on the database's backing document. For an ordinary Personal page, that database is the private Files database, not the shared page. See `templates/content/actions/list-document-properties.ts`, `templates/content/actions/_property-utils.ts`, `templates/content/app/components/editor/DocumentEditor.tsx`, and `templates/content/app/components/editor/DocumentBlockFields.tsx`.
8. When that property query fails, `DocumentBlockFields` has no error branch. Failed data remains indistinguishable from not-yet-loaded data and the component renders an animated loading placeholder forever. It never mounts the canonical body editor.
9. The Content collab routes correctly authorize reads against the shared page and writes at editor role. The access policy is `resourceType: document`; it does not authorize against the Files container. See `templates/content/server/plugins/collab.ts` and `packages/core/src/server/collab-plugin.ts`.
10. The collab browser client is independently fail-open. A 403 or 404 calls `markDocMissing`, which sets `isSynced: true`. A 500 response is parsed without first checking `res.ok` and also becomes synced; a network rejection likewise sets synced true. In each case the Y.Doc may be empty. See `packages/core/src/collab/client.ts` (`fetchInitialState` and `markDocMissing`).
11. Content binds editors to that Y.Doc and enables editing when `collabSynced` becomes true. Viewers render canonical SQL rather than Yjs, so missing Yjs state alone does not explain a viewer's blank body on current `main`; the property gate does. See `templates/content/app/components/editor/DocumentEditor.tsx`.
12. Server-side empty-save protection rejects several stale-empty cases and the browser sends a compare-and-swap timestamp for normal body saves. Those are useful last-line defenses, but neither makes a failed initialization a valid empty snapshot, and unload saves do not currently carry the `loadedContentWasEmpty` attestation. See `templates/content/actions/update-document.ts` and its tests.

### Inferences

- The reported Personal-only symptom follows deterministically from the current authorization graph when the shared page is a member of the owner's private Files database: page read succeeds; explicit database-context property read fails; UI stays in its loading branch.
- Organization-space sharing appears to work because a recipient who is a member can satisfy the backing database document's organization visibility. That incidental success masks the wrong authorization subject.
- SQLite contention could cause an independent 500 or network-like initialization failure, but no live status, trace, or log establishes contention in Julia's case. The shaped failure handling makes the client safe regardless of the 500's storage-level cause.
- The title Julia saw may have come from the successful page response or another metadata surface. The inaccessible screenshot prevents a stronger visual-path claim.

### Unresolved questions that do not block Work

- Julia's exact property-request and collab-request status codes were not captured.
- The inaccessible screenshot may distinguish a title inside the editor from title metadata elsewhere.
- No inspectable artifact remains from the bot branch.

None changes the public contract or the smallest compatible repair. Work should capture fresh request evidence in its isolated repro, but it must not condition safety on reproducing SQLite contention.

## Competing hypotheses

| Hypothesis | Result | Basis |
|---|---|---|
| Personal-page sharing is disallowed by policy | Rejected | Direct user shares are admitted by the page resource's shared access primitive. |
| Page body fetch is denied | Rejected for the demonstrated code path; verify in real repro | `get-document` authorizes and returns the page row including content before the separate property query. |
| Files-container authorization blocks rendering | Supported; governing cause for this shape | The explicit property request asserts access to the backing database document, and the UI converts its failure into perpetual loading. |
| SQLite contention causes the reported blank body | Unconfirmed and unnecessary | No request/log evidence; it could only be one source of a separate 500 path. |
| Failed collab initialization becomes synchronized empty content | Confirmed latent hazard, not required for the viewer symptom | All initial-state failures currently end in `isSynced: true`; editors can then bind an empty Y.Doc. |
| A generic list cache seeds an empty authoritative body | Not supported on current `main` | List/database snapshots are explicitly prevented from owning the editable body cache; the dedicated `get-document` request is authoritative. |

## Architecture grounding

### Demonstrated caller and exact request

- Caller: an authenticated recipient with an explicit `editor` grant on one page owned in another person's Personal space.
- Request chain: `/page/:id` → `get-document(id)` → render database-row Blocks fields → `list-document-properties(documentId, filesDatabaseId)` → optional collab state read → `update-document` / collab update for edits.

### Existing primitives and boundaries

- Page access: framework `resolveAccess` / `assertAccess` over `documents` and `document_shares`.
- Database membership: `content_database_items` relates the page to the Files database without making the container the page's access authority.
- Property read: `list-document-properties` and `_property-utils`; it must validate that the requested database context actually owns or contains the page, while applying the shared page's read authority to page-owned values.
- Schema mutation: configure/reorder/delete property actions remain governed by the database backing document and must not borrow a row-page share.
- Canonical body: `documents.content` is the durable SQL snapshot; Yjs is the live editing projection, not authority to manufacture an empty body after a failed load.
- UI state: loading, loaded-empty, and failed are distinct states. A failure cannot be coerced into either of the first two.

### Legacy contracts to preserve

- Owners and authorized organization members keep existing Personal/org navigation and property behavior.
- Sharing a page does not expose, list, search, or allow traversal of the owner's Personal Files database or sibling pages.
- Database schema changes still require database-level authority.
- Viewers remain read-only and render canonical SQL; editors use collaboration only after a successful state initialization.
- Intentionally empty pages remain editable and savable after a successful authoritative empty load.
- Existing stale-write compare-and-swap behavior remains intact.

### Smallest compatible delta

1. **Authorize page-owned property reads against the page.** In the `list-document-properties` read path, first resolve the shared page, then validate the supplied database membership without requiring independent viewer access to the database backing document. Return only definitions and values necessary to render that page. Keep database-level authorization on schema-mutating actions and any query that enumerates or aggregates database contents. Express this distinction explicitly in `_property-utils` rather than adding another caller-specific catch.
2. **Render property-load failure honestly.** Give `DocumentBlockFields` an explicit query-error state with a visible retry action. Do not render a body editor, an empty-field state, or an indefinite skeleton after failure. Reuse the existing query-error component and localized strings where they accurately describe the failure; if copy changes, update every configured locale and run the changed-copy guards.
3. **Make collaborative initialization fail closed.** Replace the boolean-only startup outcome with an explicit loading/ready/error result that retains status category (`forbidden-or-not-found`, `server`, `network`, `invalid-payload`) without exposing sensitive server detail. Check `res.ok`, require a valid state payload, and never set `isSynced` after failure. Detach/disable outbound update traffic while errored. Expose retry through the hook.
4. **Keep canonical content visible but non-editable on collab failure.** An editor whose page and property reads succeeded should see the canonical SQL body with a visible collaboration error and retry affordance. Do not bind the empty/uninitialized Y.Doc, enable saves, or seed/synchronize it until initialization succeeds. A viewer's canonical body remains unaffected by collab readiness.
5. **Strengthen the write backstop.** Every browser path that can persist a body, including unload/keepalive, must carry the authoritative base revision and loaded-empty attestation (or an equivalent typed initialization token). The server must reject an effectively empty write over nonempty current content when the client never proved a successful authoritative empty initialization. This is defense in depth; it does not replace correct read/error states.

### Deferred capabilities

- Sharing an entire Personal space or Files database.
- Cross-workspace discovery, search, traversal, or container inheritance.
- A new role system or custom page/database capabilities.
- General SQLite tuning or retry policy without an observed contention trace.
- Replacing Yjs, the action surface, or SQL source of truth.

### Reversibility

The repair changes authorization subject only for one page-scoped read, adds explicit client error states, and tightens initialization/write preconditions. It adds no schema, migration, credential, or new sharing grant. Each portion can be reverted independently, though the fail-closed safety behavior should be retained even if the property model later changes.

## Work handoff

### Expected implementation surface

- `templates/content/actions/list-document-properties.ts`
- `templates/content/actions/_property-utils.ts`
- focused Content database tests for a shared Personal Files-member page
- `templates/content/app/hooks/use-document-properties.ts`
- `templates/content/app/components/editor/DocumentBlockFields.tsx` and focused component tests
- `templates/content/app/components/editor/DocumentEditor.tsx` and focused state/render tests
- `packages/core/src/collab/client.ts`, exported collab client types, and focused client tests
- `templates/content/actions/update-document.ts` plus browser/unload contract tests if the existing payload is insufficient
- configured locale catalogs only if existing error/retry copy cannot be reused
- one Content changelog entry (`fixed`)
- a Core changeset because publishable Core client behavior changes

This is a prospective inventory, not permission to touch unrelated files. Work should re-read the shared checkout and narrow it if current code moves.

### Required automated proof

1. Database integration fixture with two identities: owner has a Personal space and private Files database; owner creates a nonempty page in Files and grants recipient `editor` on only that page.
2. As recipient, `get-document` returns the exact nonempty body and editor role.
3. As recipient, `list-document-properties(documentId, filesDatabaseId)` returns only the shared page's renderable definitions/values even though direct access to the Files database backing document remains denied.
4. Recipient cannot list/search/describe the private Files database, open a sibling page, mutate schema, or acquire any container share.
5. Recipient can save a body edit through the ordinary action and collaboration path; owner reads the exact edit.
6. Property read 403, 404, 500, and network rejection each render a stable visible error with retry and never mount an empty/primary editor.
7. Collab initial state 403, 404, 500, malformed-success payload, and network rejection each remain unsynced, disable outbound updates, keep canonical content visible read-only, and recover only after an explicit successful retry.
8. A failed initialization followed by rerender, navigation, timer expiry, page hide, or unload emits no empty update and leaves SQL and Yjs durable state unchanged.
9. A legitimately empty page loaded successfully can still be edited and intentionally cleared; stale/conflicting saves remain rejected.
10. Existing org-space, owner, viewer, commenter, editor, local-file, and database-schema authorization tests remain green.
11. Run focused Content tests, Core collab tests, `pnpm test:content-product-impact`, `pnpm guard:i18n-catalogs`, `pnpm guard:i18n-changed-copy`, relevant guards, formatting, and typecheck in proportion to the touched packages.

### Real-interface acceptance

Use an isolated non-production Content surface and two task-owned QA identities. The sender creates a marker-named Personal page with a clearly nonempty body and shares that page as editor with the recipient. Capture visible desktop evidence before network/DOM diagnosis.

Required assertions:

1. Recipient follows the shared link and sees the exact title and complete body without indefinite loading.
2. Recipient edits a unique sentence, sees the save settle, reloads, and still sees the edit; sender independently reloads and sees the same edit.
3. Recipient cannot open, enumerate, search, or mutate the sender's private Files database or a marker-named sibling page. Inspecting the share record confirms only the page grant exists.
4. With each initialization failure class injected at the property and collab boundaries (403, 404, 500, network), the body area shows a visible retryable failure or retained canonical read-only body as specified; it never presents a writable empty document.
5. During each failure, after waiting beyond autosave debounce and exercising reload/page-hide, sender's original SQL body and persisted collab state remain byte-equivalent to baseline.
6. Removing the injected failure and retrying restores the exact canonical body and editing without creating a second grant or widening authority.

Acceptance modality is `real-interface`; independence is `preferred`; custody is `same-context-allowed`. Rationale: the risk is cross-user authorization and content loss, so the complete two-identity interaction must be exercised through the real browser surface. Independent review is valuable, but an isolated fixture, access read-backs, unchanged-state proofs, and repository review provide the required safety controls without requiring tester-owned custody.

### Cleanup contract for Work

The Work envelope must declare the two QA identities and all created pages/shares as bounded, task-owned, non-production test resources before mutation. Cleanup removes the page share and fixture pages, then independently proves their absence and proves no Files-container grant was ever created. Shape creates none of these resources.

## Frozen five

```yaml
authoritySchemaVersion: 3
outcome: >-
  An authorized recipient can read and edit one page shared from Personal
  Content, while initialization failures are visible and cannot synchronize an
  empty body or widen access to the owner's private Files container.
shipping-surfaces:
  - id: agent-native-content-shared-personal-page
    repository: BuilderIO/agent-native
    product-surface: Content page/property/editor flow plus the shared Core collaborative client
    constituency: authenticated Content senders and explicitly authorized recipients
    durable-destination: repository main, released Content template, and published Core package through the normal release train
    integration-action: merge
governing-architecture: >-
  Page shares authorize page-owned reads and edits; database-container authority
  remains required for schema/container operations; SQL content stays canonical,
  and Yjs becomes writable only after explicit successful initialization.
acceptance-story:
  id: content.shared-personal-page.read-edit-safe-failure
  summary: >-
    A recipient with an editor grant on one Personal page can load and edit that
    page, cannot access its private Files container or siblings, and every read
    or collaboration initialization failure is visible and non-mutating.
  required-assertions:
    - Exact nonempty body loads for the recipient through the shared link.
    - Recipient edit survives both recipient and sender reloads.
    - Access remains page-scoped; Files container and siblings stay inaccessible.
    - 403, 404, 500, malformed response, and network failures remain visible and unsynced.
    - No failure path emits or persists an empty body; deliberate empty content still works after successful load.
  acceptance-policy:
    modality: real-interface
    independence: preferred
    custody: same-context-allowed
    interface: isolated Content browser surface with two task-owned authenticated QA identities
    rationale: >-
      Cross-user authorization and content-loss risk require the real two-person
      workflow plus durable-state and access read-backs; independent review is
      preferred but tester-owned custody is not part of the user story.
risk-strategy:
  kind: system-ready
  production-validation-after-merge: false
```

System-ready is available because Work can prove the complete access, browser, and failure-injection story before merge on an isolated surface. If the actual environment cannot exercise the two-identity real interface until after merge, Work must pause and return to Shape to replace this with a feature-flagged strategy; it may not silently downgrade acceptance.

## Lifecycle authority envelope

```yaml
stage: shape
authority-source: >-
  Alice's parent-task request to create a pinned task and "go ahead and shape a full fix",
  delegated into Codex task 01a03eeb-b752-7ba0-b479-2963a757bcf9
authorized-scope:
  repositories:
    - BuilderIO/agent-native
  product-surfaces:
    - Content shared Personal page read/edit and initialization failure behavior
  outcome: shared Personal pages are usable without container access or empty-body corruption
allowed-mutations:
  - artifact-write
write-targets:
  artifacts:
    - plans/shared-personal-content-blank-body-fix.md
governing-artifact:
  path: plans/shared-personal-content-blank-body-fix.md
  revision: shape-bc4a2441-r1
architecture-grounding:
  applicability: required
  reason: authentication, page/database authority, and shared Core collaboration are platform seams
  status: grounded
delegation-ceiling: []
acceptance-state:
  status: pending
  summary: Work must produce the frozen automated and two-identity real-interface evidence before Land.
  blockers: []
ledger-revision: shape-bc4a2441-r1
status: active
```

## Product handoff

Product context: `content.access.page-database`, `content.workspace.multi-scope`, and `content.feature.find-your-place-again`
Workflow: share one Personal page by explicit role; recipient reads and edits only that page
Proof: current code-level causal reproduction and frozen automated/real-interface proof plan; no fix or acceptance evidence yet
Remaining gaps: Work must implement, exercise the isolated two-identity fixture, and obtain repository review
Product decisions: none; contract repair, not a new sharing promise
Record updates: none required unless implementation discovers a contract change

## `/work` entry instruction

Invoke `/work plans/shared-personal-content-blank-body-fix.md`. Work must reload current `main`, treat every proposed file above as provisional, declare its isolated test resources before creating them, and stop for return-to-Shape if the repair requires broader container visibility, a schema change, a second shipping surface, or post-merge-only acceptance.
