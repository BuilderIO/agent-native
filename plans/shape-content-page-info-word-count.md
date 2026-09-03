# Content Page Info Blocks-field word counts

## Summary

Show the Page's content-bearing Blocks fields in the existing Page Info rail, with each field's word count as secondary information, and expose the same field-scoped calculation through a read-only `get-blocks-field-word-count` Action.

This replaces the earlier design, which displayed one Page-level **Word count** row and exposed `get-document-word-count`. The roadmap makes the stronger boundary explicit: a Page owns one or more Blocks fields, and each Blocks field owns one editable rich-content body. Word count therefore describes a Blocks field, not the Page as a scalar property.

Implementation must happen in a new dedicated Git worktree created from current `origin/main`. Shape may update only this governing artifact; product code, branches, and worktrees remain untouched until `/work` is invoked for this revision.

## Context

The Page Info control opens `DocumentInfoPanel`, which currently shows the description and, for database-member Pages, scalar Properties. `DocumentProperties` intentionally excludes Blocks properties because those fields render as editable body content rather than scalar rows.

The Content roadmap defines the relevant boundary:

- A Page owns stable identity, title, access, top-level Properties, and one or more Blocks fields.
- A Blocks field owns one editable rich-content body, stable field identity, and its own revision and recovery boundary.
- The primary `Content` field uses `documents.content`; additional Blocks fields use `document_block_field_contents`, keyed by Page and Property identity.

Content already uses the shared `countWords()` helper for Blocks-field values. Its current lightweight, Markdown-aware semantics are the calculation contract for this slice.

## Problem or opportunity

A Page-level **Word count** row looks like another scalar Property and implies one canonical body. That becomes misleading when a Page contains multiple Blocks columns such as `Content`, `Research notes`, or `Draft introduction`.

The Info rail can instead explain the Page's content structure: name each Blocks field and attach its count. Agents need the same field boundary so they can request one exact measurement without fetching rich content or guessing which body “the document” means.

## Desired outcome

- Page Info contains a compact **Content** section listing every Blocks field the current viewer may see.
- Each row uses the field's display name as the primary label and a localized word count as secondary information.
- A Page with only its primary field shows one compact `Content` row; Pages with additional Blocks columns show one row per field in schema order.
- Counts follow each field's current value. The actively edited field reflects local unsaved/debounced text without an extra request.
- `get-blocks-field-word-count` returns the count for one authorized field addressed by `documentId` plus optional `propertyId` (omitted for the primary field).
- Empty content returns numeric `0` from the Action and localized zero-word copy in the UI.
- Description, scalar Properties, Blocks-field editing, access behavior, source behavior, and existing Actions remain unchanged.

## Options considered

1. **One Page-level Word count and `get-document-word-count`.** Rejected because it resembles another Property and conflicts with the one-or-more-Blocks-fields model.
2. **One total across all Blocks fields.** Rejected because it hides which body contributes what and becomes ambiguous when field access differs.
3. **A Content section with per-field counts and a field-scoped Action.** Chosen because UI and agent vocabulary align with the roadmap.
4. **A plural `get-page-blocks-word-counts` Action.** Deferred as a possible convenience projection; the atomic contract should first address one exact field.

## Recommended direction

### UI

Add a compact **Content** section to `DocumentInfoPanel`, before scalar Properties:

```text
Content

Content                 1,284 words
Research notes            326 words
Draft introduction         91 words
```

`Content` is user-facing section vocabulary; `Blocks field` remains technical and Action vocabulary. Do not label the measurement as a standalone Property, add a total, introduce cards or a summary strip, or duplicate editable content.

Use the same ordered Blocks definitions and values as the Page editor. The primary field's active count comes from current editor content. Any actively editable additional field must likewise use its editor-owned value rather than a stale snapshot. The UI must not call the Action merely to render Info.

Respect field visibility and Page/database access before rendering a name or count. Local-file Pages retain their implicit primary Content field and do not gain database Properties.

### Action

Create a read-only `get-blocks-field-word-count` Action:

```ts
{ documentId: string; propertyId?: string }
```

Omit `propertyId` for the primary Content field. Return unformatted data:

```ts
{
  documentId: string;
  propertyId: string | null;
  name: string;
  primary: boolean;
  wordCount: number;
}
```

Resolve the exact field through existing Page/database membership and Blocks-property helpers. Enforce Page and field access before reading. For the primary field, use the live-editor flush handshake. For an additional field, use its field-scoped storage/freshness boundary and fail loudly if an exact fresh value cannot be established; never coerce unreadable or unavailable to zero.

Reuse `countWords()` and return no formatted English string. Document how primary and additional fields are addressed in Content's agent instructions.

### Feature checklist

- UI: Page Info **Content** section with ordered per-field counts.
- Action: `get-blocks-field-word-count` over one exact authorized field.
- Instructions: document Action addressing in `templates/content/AGENTS.md`.
- Application state: no new key; existing current-Page and Info state identify the surface.
- Localization: add section/count copy across every configured Content locale.
- Changelog: record the visible Content improvement.

## Constraints

- Work in a new dedicated worktree; do not switch or modify the shared checkout beyond this shaping artifact.
- Keep Blocks fields separate from scalar Properties even when defined by database columns.
- Preserve `countWords()` semantics; improved tokenization is separate work.
- Exclude title, description, scalar Properties, comments, Discussion, inaccessible embedded text, and sibling fields from a field's count.
- Preserve access-before-computation; denied, missing, unavailable, and unreadable remain distinct from zero.
- Do not add a custom API route, schema change, dependency, feature flag, aggregate total, or application-state key.
- Update all configured locale catalogs and run changed-copy guards.

## Risks and assumptions

- Primary-field live-collaboration and additional-field freshness may use different seams. Work must trace and test both.
- Concurrent schema or membership changes must produce an honest conflict/not-found outcome, not a count for the wrong field.
- The shared counter is intentionally lightweight. Consistency matters more here than a new linguistic tokenizer.
- A future Page aggregate needs explicit access and aggregation semantics and is not implied by this feature.

## Open questions

None for the first slice. The user-facing heading is **Content**; the domain and Action term is **Blocks field**.

## Architecture grounding and fit

- **Demonstrated callers:** a Content reader opens Info to understand a Page's content fields; an authorized agent requests one exact field's word count.
- **Existing primitives:** `DocumentInfoPanel`; deliberate Blocks exclusion in `DocumentProperties`; current editor content; ordered Blocks definitions/values; additional-field storage; Blocks identity helpers; `countWords()`; `defineAction`; access resolution; primary live-editor flush.
- **Ownership boundaries:** the Page owns the field collection; each Blocks field owns one counted body; the active editor owns the freshest local projection; the shared helper owns count semantics; Actions own authorized external reads.
- **Legacy contracts:** Info description and scalar Properties, editing placement, Blocks storage/identity, local-file behavior, document and field Actions, permissions, and source behavior.
- **Shared vocabulary:** **Content** section, **Blocks field** domain object, `wordCount` result, `get-blocks-field-word-count` Action.
- **Smallest compatible delta:** one compact Info projection and one field-scoped read Action.
- **Deferred:** Page totals, plural batch Action, reading time, character/selection counts, generic statistics, new counting semantics, Comments, and Discussion.
- **Reversibility:** additive UI, Action, tests, instructions, and localized copy; no migration or persisted state.
- **Direct evidence:** roadmap Page/Blocks-field records, `DocumentInfoPanel.tsx`, `DocumentProperties.tsx`, `_property-utils.ts`, `_blocks-field-identity.ts`, `pull-document.ts`, `properties.ts`, and Blocks action tests.
- **Inference:** Work must confirm the exact editor seam for unsaved additional-field values.
- **Unresolved owner questions:** none.

This is a local refinement of `content.author.document-editor` and `content.object.blocks-field`; it makes the roadmap contract visible rather than changing it.

## Replacement acceptance story

Successful-user story: while viewing or editing a Page, a person opens Info and sees each accessible content-bearing Blocks field by name with its immediately current word count; an authorized agent requests one exact field and receives the same field-only measurement without retrieving rich content.

Required assertions:

1. Shared tests cover empty, singular, plural, Markdown punctuation, fenced code, and exclusion of title and sibling fields.
2. Info renders localized **Content** rows in schema order for standalone, single-field database, and multiple-field database Pages without treating Blocks fields as scalar Properties.
3. Each count is field-only; primary and additional fields do not contribute to one another.
4. Editing the active primary or additional field updates its count without calling the Action, while sibling counts remain correct.
5. Hidden or inaccessible fields reveal neither name nor count; missing/unreadable fields are not rendered or returned as zero.
6. The Action addresses primary by `documentId` and additional by `documentId` plus `propertyId`, returns structured numeric data, rejects non-Blocks/inaccessible/deleted/mismatched fields, and uses the correct freshness boundary.
7. Registration/types, agent instructions, changelog, locales, focused tests, formatting, typecheck, i18n guards, and product-impact checks pass.
8. In the real editor at desktop and narrow width, one and several rows remain compact, long names do not crowd counts, and live edits change the expected row.

Acceptance policy:

- Modality: `real-interface`
- Independence: `preferred`
- Custody: `same-context-allowed`
- Interface: local Content editor at desktop and narrow viewport with one-field and multiple-field Pages
- Rationale: automated proof covers domain behavior; same-context interface proof proportionately verifies hierarchy, density, truncation, and live updates.

## Material change record

`WORK PAUSED — RETURNING TO SHAPE` was triggered because the outcome, governing architecture, Action vocabulary, and acceptance story changed.

### Old fingerprint (`shape-v1`)

- Outcome: one Page-body count shown as metadata.
- Architecture: the Page's canonical body is the counted unit.
- Action: `get-document-word-count --id <documentId>`.
- Acceptance: one body-only count; additional Blocks fields deferred.

### Approved replacement (`shape-v2`)

- Outcome: Page Info lists every accessible Blocks field with its own count.
- Architecture: each Blocks field is counted; the Page is the container and Info projection.
- Action: `get-blocks-field-word-count`, addressed by Page plus optional Blocks-property identity.
- Acceptance: prove multi-field UI, field isolation, access, primary/additional freshness, and exact field-scoped Action behavior.

Alice approved this direction with: “yeah, that makes sense. shape the revision.” This authorizes the artifact revision only; `/work` remains the implementation handoff.

## Architecture fingerprint

```yaml
authoritySchemaVersion: 3
stage: shape
authority-source: "Alice approved the per-Blocks-field direction and requested: shape the revision."
authorized-scope:
  repositories: [/home/teenylilmonkey/Developer/agent-native]
  product-surfaces: [Content editor Page Info rail, Content Action surface]
  outcome: Each accessible Blocks field is visible by name with its own count in Page Info and measurable through one field-scoped authorized Action.
allowed-mutations: [artifact-write]
write-targets:
  artifacts: [plans/shape-content-page-info-word-count.md]
governing-artifact:
  path: plans/shape-content-page-info-word-count.md
  revision: shape-v2
architecture-fingerprint:
  outcome: Each accessible Blocks field is visible by name with its own count in Page Info and measurable through one field-scoped authorized Action.
  shipping-surfaces:
    - id: content-template
      repository: /home/teenylilmonkey/Developer/agent-native
      product-surface: Content editor Page Info rail and Content Action registry
      constituency: Authorized Content readers, writers, and agents
      durable-destination: Agent Native Content template on the dedicated task branch
      integration-action: push
  governing-architecture: Page Info projects ordered accessible Blocks fields while each field remains the independently counted and authorized body; UI uses editor-owned current values and the Action uses the appropriate field storage and freshness boundary.
  acceptance-story:
    id: content-page-info-blocks-field-word-count-v2
    summary: A person sees one current count per accessible Blocks field in Info, and an authorized agent receives the same field-only count for one exact field.
    required-assertions:
      - Field-only count semantics are tested.
      - Info handles standalone, single-field, and multiple-field Pages without treating Blocks fields as scalar Properties.
      - UI counts update from current primary/additional editor values with sibling isolation.
      - Field names and counts obey access and unavailable-state boundaries.
      - The Action resolves one exact field, uses its correct freshness boundary, and returns numeric output.
      - Instructions, registration, changelog, locales, checks, and desktop/narrow real-interface acceptance pass.
    acceptance-policy:
      modality: real-interface
      independence: preferred
      custody: same-context-allowed
      interface: Local Content editor at desktop and narrow width with one-field and multiple-field Pages
      rationale: Automated proof covers domain behavior; same-context interface proof verifies hierarchy, density, truncation, and live updates.
  risk-strategy:
    kind: system-ready
    production-validation-after-merge: false
architecture-grounding:
  applicability: required
  reason: A public Action must honor Page, Blocks-field, access, storage, and collaboration boundaries.
  status: grounded
  demonstrated-callers:
    - Content reader opening Page Info
    - Authorized agent requesting one exact Blocks field count
  existing-primitives:
    - DocumentInfoPanel and DocumentProperties
    - editor-owned field values
    - Blocks definitions, storage, and identity helpers
    - shared countWords()
    - defineAction, access resolution, and primary live-editor flush
  ownership-boundaries:
    - Page owns the field collection and Info projection
    - Each Blocks field owns its counted body and revision boundary
    - Active editor owns freshest local value
    - Action boundary owns authorized external reads
  legacy-contracts:
    - Existing Info description and scalar Properties
    - Existing Blocks editing, storage, identity, and visibility
    - Existing document/Blocks Actions, local-file, and source behavior
  shared-vocabulary: [Content section, Blocks field, get-blocks-field-word-count, wordCount]
  smallest-compatible-delta: One per-field Info projection and one exact field-scoped Action over the existing counter.
  deferred-capabilities: [Page aggregate, plural batch Action, generic text statistics, new count semantics, non-Page field owners]
  reversibility: Additive code and copy only; no schema or persisted-state change.
  direct-evidence:
    - templates/content/docs/product/architecture.md
    - templates/content/docs/product/capabilities/content.object.page.md
    - templates/content/docs/product/capabilities/content.object.blocks-field.md
    - templates/content/app/components/editor/DocumentInfoPanel.tsx
    - templates/content/app/components/editor/DocumentProperties.tsx
    - templates/content/actions/_property-utils.ts
    - templates/content/actions/_blocks-field-identity.ts
    - templates/content/actions/pull-document.ts
    - templates/content/shared/properties.ts
  inferences: [Work must confirm the editor seam for unsaved additional-field values.]
  unresolved-owner-questions: []
delegation-ceiling: []
acceptance-state:
  status: pending
  summary: Revised Shape is complete; Work must implement and produce frozen automated and real-interface evidence in a new worktree.
  blockers: [Work has not been invoked for shape-v2.]
  last-land-packet: null
ledger-revision: content-page-info-blocks-field-word-count-shape-v2
status: active
task-attention: shape-complete
execution-placement:
  kind: local
  worktree-required: true
```

## Next steps

Invoke `/work plans/shape-content-page-info-word-count.md`. Work should first create the dedicated worktree from current `origin/main`, then implement and verify this exact `shape-v2` fingerprint without modifying or switching the shared checkout.
