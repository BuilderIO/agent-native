---
record_type: "capability"
spec_version: 2
id: "content.reader.documents"
name: "Document Reader"
user_promise: "The earlier separate PDF/EPUB reader proposal remains readable lineage rather than an active second product contract."
primary_user_job: "Understand where native document-reading work belongs without building a separate reader identity or data system."
kind: "surface"
state: "superseded"
publicness: "public"
availability: "universal"
dependencies: ["content.reader.surface"]
related_features: []
roadmap_boundary: "superseded"
acceptance_summary: "This lineage record directs new reading and annotation work to the unified Reader surface, keeps PDF export distinct, and prevents a separate document-reader app or source model from becoming an active requirement."
proof_requirements:
  [
    "Catalog validation that supersession target remains present",
    "Review of new reader work confirming it targets content.reader.surface",
    "Regression review ensuring PDF export is not represented as native annotation support",
  ]
evidence: []
superseded_by: "content.reader.surface"
last_reviewed: "2026-07-29"
---

# Document Reader

## Why this exists

The original narrow reader idea captured a real need but split the product where one Reader surface now carries the contract.

## Example workflow

A contributor looking for PDF annotation requirements follows this record to `content.reader.surface` and `content.research.annotation`, rather than creating a new PDF/EPUB app and data model.

## Product contract

- This record is lineage only. New reading work targets the unified Reader surface over Content objects and source representations.
- PDF export remains a read-oriented output path, not a substitute for reading state, selectors, or annotations.
- Any later separate app shell may reuse the Reader contract without creating separate Content identity or custody.

## Boundaries and non-goals

This record does not specify new implementation, verify a reader, or preserve a separate document-only roadmap.

## Acceptance stories

### Route a new request correctly

Given a proposal for EPUB highlighting, when it is classified, then it is evaluated against Reader surface and Annotation contracts rather than this superseded record.

### Keep export distinct

Given a PDF export improvement, when it is documented, then it does not claim native reading progress or annotation support.

## Current evidence

Repository product records identify `content.reader.surface` as the active unified target. This superseded record has no implementation proof and intentionally makes no delivery claim.

## Proof plan

1. Keep the supersession link valid in the product-doc guard.
2. Review future reader records for unified identity and annotation ownership.
3. Reject any new separate reader contract unless a later Shape explicitly changes this boundary.

## Open questions

- None; implementation questions belong to `content.reader.surface`.
