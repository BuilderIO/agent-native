---
record_type: "capability"
spec_version: 2
id: "content.portability.pdf-export"
name: "PDF export"
user_promise: "Create a readable PDF of an authorized Content representation without confusing it with the editable or lossless export."
primary_user_job: "Hand someone a stable, readable document that faithfully represents what I am authorized to share."
kind: "workflow"
state: "in_progress"
publicness: "public"
availability: "universal"
dependencies: ["content.renderer.typed", "content.access.visibility-closure"]
related_features:
  [
    "content.feature.publish-with-confidence",
    "content.feature.take-the-whole-vault-with-you",
  ]
roadmap_boundary: "feature"
acceptance_summary: "PDF export resolves the acting user's authorized representation through shared rendering, gives supported blocks a faithful layout or explicit fallback, and returns a durable file with clear scope and failure reporting."
proof_requirements:
  [
    "Renderer fidelity tests for supported blocks, media, math, code, and explicit fallbacks",
    "Access-closure, asset, pagination, metadata, and error reporting tests",
    "Interface export workflow validated against the selected representation and downloaded PDF",
  ]
evidence:
  [
    "../../../shared/document-export.ts",
    "../../../shared/document-export.spec.ts",
  ]
superseded_by: null
last_reviewed: "2026-07-29"
---

# PDF export

## Why this exists

PDF is a dependable reading artifact, not a promise that a flat page can carry every living behavior.

## Example workflow

An editor exports the approved article revision. Content renders the same authorized blocks, reports an unavailable protected asset, and produces a PDF whose scope identifies the selected representation.

## Product contract

- Export materializes the acting user's authorized closure at export time; it never borrows a collaborator's access.
- It uses shared semantic rendering where possible and provides deliberate, readable fallbacks for unsupported interactive behavior.
- The artifact records enough representation and generation context to explain what it contains. Asset failures are reported, not silently omitted.
- A PDF is read-oriented output, separate from editable source and lossless archive formats.

## Boundaries and non-goals

Publication owns stable public URLs; vault export owns complete package closure. PDF export does not promise round-trip editing or live embeds.

## Acceptance stories

### Export only the viewer's closure

Given a Page references an inaccessible private asset, when a permitted editor exports it, then the PDF does not expose the asset and reports the unavailable representation.

### Render a deliberate fallback

Given a supported Page contains an interactive Block without a print equivalent, when it exports, then the PDF includes a labeled safe fallback rather than pretending the interaction survived.

## Current evidence

Implementation evidence: `shared/document-export.ts` and `shared/document-export.spec.ts` cover current document export machinery. Donor evidence does not yet prove all block fidelity, access closure, or interface-level PDF behavior, so this record remains `in_progress`.

## Proof plan

1. Expand fixture coverage across supported blocks and intentional fallbacks.
2. Test access changes, media resolution, metadata, pagination, and failures.
3. Compare a real export against the selected authorized representation.

## Open questions

- Print styling and accessibility metadata policy need final acceptance criteria.
