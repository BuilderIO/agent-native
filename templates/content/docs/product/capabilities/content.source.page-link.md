---
record_type: "capability"
spec_version: 2
id: "content.source.page-link"
name: "Page-linked Sources"
user_promise: "A Page can bind to one external item while keeping Content identity and the provider's ownership clear."
primary_user_job: "Open a connected item as a Page and know which values come from its Source, which Content owns, and where an edit will go."
kind: "primitive"
state: "exploring"
publicness: "public"
availability: "configured"
dependencies: ["content.source.adapters", "content.object.page"]
related_features: ["content.feature.connect-your-sources"]
roadmap_boundary: "feature"
acceptance_summary: "A Page may carry one explicit external-item binding with stable source and provider identity, representation and baseline metadata, ownership-aware fields and actions, provenance, and source-policy routing without creating a parallel page-source architecture."
proof_requirements:
  [
    "Binding identity, uniqueness, provenance, access, and Page lifecycle tests",
    "Field ownership, write routing, baseline/conflict, detach, and source-unavailable tests",
    "Page workflow opening a connected item, inspecting provenance, editing a mapped value, and resolving a conflict",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Page-linked Sources

## Why this exists

A connected item deserves a familiar Page without asking it to surrender where it came from.

## Example workflow

A person opens a provider article as a Page, sees source provenance and mapped fields, edits one writable field, and receives a source receipt or a conflict rather than an ambiguous local save.

## Product contract

- A Page has one explicit external item binding when this capability applies; the binding carries Source, provider identity, representation, baseline, and provenance.
- Content identity, comments, memberships, views, and Content-owned fields remain Content-owned. Source-owned values route only through declared adapter policy.
- The page shows freshness, availability, ownership, conflict, and write outcome honestly. Detach is explicit and preserves provenance/history.
- The binding is a normalized use of the Source adapter model, not a separate data architecture.

## Boundaries and non-goals

Multi-source composition belongs to Queries; folder hierarchy belongs to folder Sources. This does not assert that all Pages have or need an external binding.

## Acceptance stories

### Route a mapped edit

Given a Page linked to one writable external item, when an editor changes a source-owned mapped field, then the adapter receives that one authorized change and the receipt names the provider outcome.

### Keep Content work after source loss

Given the linked Source becomes unavailable, when a reader opens the Page, then Content shows the last authorized representation and source status while preserving Content-owned comments and memberships.

## Current evidence

Donor evidence: `actions/_document-source.ts`, `shared/content-source.ts`, and source-backed database actions model parts of binding/provenance. No normalized Page binding, ownership UI, or full conflict proof exists; this record remains `exploring`.

## Proof plan

1. Define binding cardinality, provenance, ownership, detach, and state model.
2. Test access, route selection, base revisions, conflicts, unavailable source, and detachment.
3. Verify linked Page workflow through the editor and source receipts.

## Open questions

- Whether a Page may bind multiple representations of one provider item needs a later Shape.
