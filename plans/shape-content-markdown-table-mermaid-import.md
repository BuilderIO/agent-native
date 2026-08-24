# Shape: preserve Markdown tables and Mermaid flowcharts in Content

## Human problem

A Content user imported a Markdown document containing a table and a flowchart. The structures were not preserved as usable rich content, and asking Content chat to repair the import removed unrelated document material. The repair must protect the user's whole document, not merely make the two structures look right.

This shape uses only a sanitized fixture. The reporter's original file and all pre-existing user documents are excluded.

## Current evidence

### Source report

- Bowerbird task `b5fb24ed-7111-44f8-abb2-382d4dcd25b7`, revision `341b832dd51ffe86252737744678b4ec7d39e130dc20eb6ae69a7b02d9cd1509`, records the 2026-08-19 report: Markdown tables and flowcharts were not preserved, and chat repair removed chunks of the document.
- The report does not contain the original file, exact import route, exact flowchart syntax, tool trace, or resulting document bytes. Those details remain unavailable and must not be invented.

### Sanitized representative fixture

The disposable fixture contains:

````md
# Release path

Keep this paragraph before the structures.

| Stage | Owner |
| --- | --- |
| Draft | Writer |
| Review | Editor |

```mermaid
flowchart LR
  Draft --> Review
```

Keep this paragraph after the structures.
````

The executable evidence is preserved at `/Users/alicemoore/.codex/visualizations/2026/08/24/01a034b6-19e2-7821-b224-35fcbb475bbd/markdown-import-shape/evidence.json`. The harness copied the current production `nfm.ts` parser into a disposable module with only its two unrelated imports stubbed; no parser logic was changed.

Observed current parser round trip:

- The pipe table becomes four ordinary paragraph nodes. Its pipes are escaped on serialization, so it no longer round-trips as a Markdown table.
- The fenced Mermaid source becomes a `codeBlock` with `language = mermaid`; its `flowchart LR` source survives.
- Both unrelated sentinel paragraphs survive this parser-only round trip.

This directly reproduces table import-fidelity loss. It does **not** reproduce Mermaid rendering loss: current parsing preserves the Mermaid fence and source. A real-interface check is therefore required before Work may classify the flowchart symptom as import loss rather than a renderer or presentation defect.

### Import and editing boundaries

- `parseContentSourceFile` strips frontmatter but otherwise hands the document body through.
- `import-content-source` persists that parsed body. The structural loss occurs when the body crosses the NFM-to-editor boundary, where only canonical HTML-style NFM tables are recognized as table nodes.
- `edit-document` performs bounded find/replace and leaves unmatched content alone. A failed match returns `NOT FOUND` without a write.
- `update-document --content` replaces the whole body. Its optional compare-and-swap protects against concurrent writes, but it cannot detect that an AI-generated replacement omitted unrelated content. Current instructions already tell agents to prefer `edit-document` for small changes, so repeating that prose is not an adequate repair mechanism.

The historical destructive chat edit is direct report evidence; the whole-body overwrite capability is direct code evidence; the exact historical tool call is unresolved. Shape does not replay a destructive write against a live or pre-existing document.

## Product classification

This is a `contract_repair` for:

- Feature: `content.feature.move-without-starting-over`
- Capabilities: `content.portability.roundtrip`, `content.author.mermaid`, and `content.object.blocks-field`

No product record change is proposed. The accepted contracts already require known structure to survive import, imported Mermaid to remain Code with `language = mermaid`, and a supported edit to preserve unrelated siblings.

## Smallest repair boundary

Work should make the existing Markdown import boundary recognize supported pipe tables and canonicalize them into Content's existing native/NFM table representation before the editor parses them. It should preserve fenced Mermaid as ordinary Code with `language = mermaid` and use the existing Mermaid renderer; it should not introduce a second diagram datastore or convert Mermaid into a registry/custom block.

For AI-assisted repair, Work should expose or route this conversion as a deterministic, exact-region operation over the malformed structure. Failure must be typed and leave the document byte-for-byte unchanged. A localized structure repair must not send a regenerated whole document through `update-document --content`. This is a mechanism boundary, not another instruction reminding the model to be careful.

The first slice includes:

- CommonMark/GFM pipe tables with a delimiter row, header cells, body rows, escaped pipes, alignment markers, and surrounding text.
- Fenced Mermaid blocks whose source is retained as `language = mermaid` Code and rendered through the existing Mermaid path when supported.
- Exact-region repair with fail-closed no-match/ambiguous-match behavior and preservation of all text outside the selected structure.
- Import, editor-open/save, export/re-import, and chat-repair proof using the same sanitized fixture.

Explicitly excluded:

- The reporter's original document or any production/user document.
- Arbitrary malformed-table inference, broad Markdown/MDX fidelity, Mermaid syntax repair, new Mermaid styling, a new diagram block type, general-purpose AI rewrite safety, or changes to unrelated `update-document` full-rewrite use cases.
- Implementation, commits, pushes, pull requests, deployments, publication, or merge during Shape.

## Architecture grounding

- **Demonstrated caller:** local Markdown/MDX import via `import-content-source`, followed by opening the imported Page in `VisualEditor`; a user may then ask Content chat to repair the malformed structure.
- **Existing primitives:** `parseContentSourceFile`; `import-content-source`; `nfmToDoc`/`docToNfm`; native TipTap table nodes serialized as canonical NFM `<table>`; Code blocks with a language attribute; existing Mermaid renderer; `edit-document` bounded replacement; Blocks-field identity persistence.
- **Ownership boundaries:** the import codec owns source-to-canonical conversion; NFM owns the canonical Page-body grammar; the editor owns typed node rendering/editing; Mermaid owns rendering of `language = mermaid` Code; document actions own guarded mutation and live collaboration delivery.
- **Legacy contracts that remain unchanged:** canonical NFM `<table>` input; Notion table round trips; ordinary fenced code; full-document rewrites when explicitly requested; source IDs/frontmatter; unknown MDX preservation; existing Mermaid registry-block compatibility.
- **Smallest compatible delta:** add pipe-table normalization at the Markdown import/repair codec boundary, reuse existing table and Code/Mermaid primitives, and make localized repair fail closed without whole-body regeneration.
- **Deferred capabilities:** generic GFM normalization, arbitrary malformed Markdown recovery, new diagram types, and general full-rewrite policy.
- **Reversibility:** conversion is limited to positively recognized table syntax and a selected exact region; unsupported or ambiguous input remains source with an explicit unresolved result.
- **Direct evidence:** `templates/content/shared/content-source.ts`; `templates/content/actions/import-content-source.ts`; `templates/content/shared/nfm.ts`; `templates/content/actions/edit-document.ts`; `templates/content/actions/update-document.ts`; current product capability records; disposable parser evidence.
- **Inference:** the reporter's “flowchart” was Mermaid fenced code; the reported missing flowchart may be a rendering/presentation defect rather than parser loss.
- **Unresolved owner questions:** none that change a public/shared contract. The real-interface reproduction resolves defect location without changing the governing architecture.

## Frozen acceptance story

**Story ID:** `content-markdown-structure-import-v1`

An authorized Content user imports the sanitized Markdown fixture. The pipe table appears and remains an editable native table, the Mermaid fence remains ordinary Code with `language = mermaid` and has a faithful rendered or explicit source/error presentation, and the before/after sentinel paragraphs remain unchanged through open, save, export, and re-import. When chat is asked to repair an intentionally unsupported or ambiguous structure, the repair returns a typed unresolved/no-change result and the entire Page body is unchanged; when repair is possible, only the exact structure changes and both sentinels plus all unrelated bytes remain unchanged.

Required assertions:

1. Import persistence retains the complete fixture body before editor canonicalization.
2. The editor parses the pipe table into a native table, not paragraph lookalikes, and export/re-import retains equivalent rows, cells, header meaning, escaped pipes, alignment metadata where supported, and surrounding order.
3. The Mermaid fence parses as Code with `language = mermaid`; source survives open/save/export/re-import, and the real interface shows a faithful render or an explicit source/error fallback rather than silently dropping it.
4. Before and after sentinels, plus a third unrelated middle paragraph, remain byte-equivalent outside normalized structure regions after import, open/save, and successful repair.
5. A no-match, ambiguous, malformed, or renderer-failure repair is typed as unresolved/no-change and independently reads back the exact pre-repair body.
6. The chat-driven successful repair uses the deterministic localized mutation path, not whole-body `update-document --content`, and read-back proves no unrelated deletion.
7. Existing canonical NFM tables, Notion table fixtures, ordinary code fences, Mermaid registry compatibility, unknown MDX fallback, and explicit full-document rewrite workflows remain unchanged.

Acceptance policy:

- **Modality:** `real-interface`
- **Independence:** `preferred`
- **Custody:** `same-context-allowed`
- **Interface:** a branch preview or isolated local Content runtime with a task-created disposable Page and captured action/tool trace
- **Rationale:** the defect crosses import, editor parsing/rendering, agent tool selection, persistence, and export. Unit fixtures are necessary but cannot prove the user-visible flow or that chat avoided a whole-body rewrite. Independent review is proportional; independent human QA is not part of the user story.

## Lifecycle authority envelope

```yaml
authoritySchemaVersion: 3
stage: shape
authority-source: "Delegation from task 01a03440-cc23-7802-966d-e709fead3a3f: use Shape for Bowerbird task b5fb24ed-7111-44f8-abb2-382d4dcd25b7; stay within Shape; do not implement or merge"
authorized-scope:
  repositories:
    - /Users/alicemoore/.codex/worktrees/d016/agent-native
  product-surfaces:
    - Content Markdown/MDX import
    - Content Page editor table and Mermaid presentation
    - Content chat localized document repair
  outcome: Freeze the smallest safe repair for Markdown table/Mermaid import fidelity and non-destructive chat repair.
allowed-mutations:
  - artifact-write
  - prototype-sandbox-write
write-targets:
  artifacts:
    - plans/shape-content-markdown-table-mermaid-import.md
  prototype-sandboxes:
    - /Users/alicemoore/.codex/visualizations/2026/08/24/01a034b6-19e2-7821-b224-35fcbb475bbd/markdown-import-shape
governing-artifact:
  path: plans/shape-content-markdown-table-mermaid-import.md
  revision: shape-content-markdown-structure-v1
architecture-fingerprint:
  outcome: Supported pipe tables and fenced Mermaid survive Content import while localized AI repair cannot remove unrelated Page content.
  shipping-surfaces:
    - id: content-template
      repository: BuilderIO/agent-native
      product-surface: Content template import, editor, and agent action surface
      constituency: Content authors importing Markdown or asking chat to repair an import
      durable-destination: agent-native main and the normal Content deployment path
      integration-action: merge
  governing-architecture: Normalize supported Markdown at the import/repair codec boundary into existing native NFM table and Code/Mermaid primitives; localized repair is exact-region and fail-closed.
  acceptance-story:
    id: content-markdown-structure-import-v1
    summary: A sanitized pipe table, Mermaid fence, and unrelated sentinels survive import, editing, export/re-import, and successful or failed chat repair without unrelated loss.
    required-assertions:
      - Import body retained before editor canonicalization
      - Pipe table becomes native table and round-trips
      - Mermaid remains language=mermaid Code with render or explicit fallback
      - Unrelated sentinels remain unchanged
      - Failed repair is typed no-change with exact read-back
      - Successful chat repair uses localized mutation, not whole-body rewrite
      - Legacy NFM, Notion, code, MDX, and explicit rewrite contracts remain unchanged
    acceptance-policy:
      modality: real-interface
      independence: preferred
      custody: same-context-allowed
      interface: isolated local runtime or branch preview with task-created disposable Page and captured action trace
      rationale: The failure crosses parser, renderer, agent tool selection, persistence, and export.
  risk-strategy:
    kind: system-ready
    production-validation-after-merge: false
architecture-grounding:
  applicability: required
  reason: The repair crosses Content's shared import codec, canonical Blocks grammar, editor, renderer, and agent mutation boundary.
  status: grounded
  demonstrated-callers:
    - import-content-source -> VisualEditor -> optional chat repair
  existing-primitives:
    - parseContentSourceFile/import-content-source
    - nfmToDoc/docToNfm and native table nodes
    - Code language attribute and Mermaid renderer
    - edit-document exact replacement
    - Blocks-field identity persistence
  ownership-boundaries:
    - import codec owns source normalization
    - NFM owns canonical Blocks grammar
    - Mermaid owns rendering of language=mermaid Code
    - document actions own mutation and live delivery
  legacy-contracts:
    - canonical NFM and Notion tables
    - ordinary fenced code and Mermaid registry compatibility
    - unknown MDX fallback and explicit whole-document rewrite
  shared-vocabulary:
    - pipe table
    - canonical NFM table
    - Mermaid Code
    - localized repair
    - unresolved no-change
  smallest-compatible-delta: Positively recognize pipe tables at import/repair, map them to existing native tables, preserve Mermaid Code, and fail closed for localized repair.
  deferred-capabilities:
    - generic Markdown normalization
    - arbitrary malformed-Markdown inference
    - new diagram types or Mermaid styling
    - general whole-document rewrite policy
  reversibility: Unsupported or ambiguous source remains unchanged and explicit; conversion is limited to a recognized exact region.
  direct-evidence:
    - current parser harness evidence
    - current import, NFM, edit-document, and update-document code
    - current Content product records
  inferences:
    - reporter flowchart was Mermaid and its symptom may be renderer-side
  unresolved-owner-questions: []
delegation-ceiling:
  - artifact-write
  - prototype-sandbox-write
product-boundary-gates:
  agent-native-public-constituency: Existing public Content contracts already cover faithful import, Mermaid Code, and sibling preservation.
  bowerbird-product-boundary: Bowerbird is task authority only; no Bowerbird mutation is authorized in Shape.
acceptance-state:
  status: pending
  summary: Shape is complete; Work must implement and obtain isolated real-interface evidence for every frozen assertion.
  blockers:
    - No implementation or real-interface acceptance exists yet.
  last-land-packet: null
ledger-revision: shape-content-markdown-structure-v1
status: active
```

## Prototype disposition

Question: Does the current production parser itself distinguish a pipe table from a fenced Mermaid block while preserving unrelated text?

Observer and decision: Alice; decide whether Work repairs one broad “Markdown import” problem or separate table-conversion, Mermaid-presentation, and chat-mutation boundaries.

Artifact: `/Users/alicemoore/.codex/visualizations/2026/08/24/01a034b6-19e2-7821-b224-35fcbb475bbd/markdown-import-shape/reproduce.mjs` and `evidence.json`.

Observations: the pipe table flattened to escaped paragraphs; Mermaid remained language-tagged Code with source intact; unrelated sentinels survived the parser-only round trip.

Verdict: freeze a table conversion repair, retain Mermaid as Code and verify its real-interface renderer separately, and require a deterministic localized chat repair with typed no-change failure.

Unresolved: exact historical chat tool call and the reporter's exact flowchart syntax are unavailable; neither is required to bind the safe first slice.

Disposition: preserve as evidence; never promote the harness.
