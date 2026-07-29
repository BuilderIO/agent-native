---
record_type: "capability"
spec_version: 2
id: "content.object.reference"
name: "References"
user_promise: "A compact reference points to a stable Page, Database, or Block without pretending to be computation."
primary_user_job: "Mention and reuse a known object so people can navigate, render, and index the same identity everywhere."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.object.page", "content.object.block"]
related_features: ["content.feature.living-references"]
roadmap_boundary: "feature"
acceptance_summary: "References store stable target identity plus presentation configuration, resolve under access control, remain portable, and stay distinct from expressions and semantic Relationships."
proof_requirements:
  [
    "ID-based Page, Database, and Block resolution",
    "Access-safe rendering, search, and backlinks",
    "Portable encoding and explicit broken/deleted target states",
    "Renderer inheritance and UI/Action parity",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# References

## Why this exists

People need an effortless `@`-style mention that is indexable and portable. Turning a simple reference into a program makes it harder to inspect, secure, and preserve.

## Example workflow

An author mentions a project Page in a brief and chooses a compact pill presentation. The target is later renamed and appears in another Database; the mention still resolves the stable Page and Connections can find it.

## Product contract

- A Reference stores the stable ID of a Page, Database, or Block with presentation configuration.
- `@Page` is a Reference; accessing a Property, comparing, or traversing it is expression work.
- Renderers may change presentation without changing target identity.
- Resolution, backlinks, search, export, and agents apply target access before showing data.
- Deleted, unavailable, and inaccessible targets are distinguishable only as far as authorization permits and degrade honestly.

## Boundaries and non-goals

- A Reference does not add Database membership, grant access, or create a semantic Relationship.
- It is not a live embed or synced editable content; transclusion owns that behavior.
- Expressions can consume references but do not replace the simple stored primitive.

## Acceptance stories

### Keep identity through a rename

Given a Page reference rendered as a pill, when the target is renamed and moved, then the same reference resolves the renamed target without rewriting it as an expression or a new reference.

### Do not leak a private target

Given a reference to a Page a reader cannot access, when the reader opens, searches, exports, or asks an agent about the host Page, then the target's private content and metadata do not appear.

## Current evidence

Current Content can link Pages and has reference-like editor substrate. It does not yet prove a generic stable Reference value across Page, Database, and Block targets, portable degradation, or universal access-safe indexing; this remains `approved_shape`.

## Proof plan

1. Create and resolve each target kind through editor, Actions, search, backlinks, and agents.
2. Rename, move, trash, restore, delete, and export targets; inspect encoded identity and degradation.
3. Test access loss and restoration across every projection.
4. Verify renderer variants, keyboard navigation, and assistive labels.

## Open questions

Presentation variants and source codecs may differ, but they cannot alter Reference identity or bypass access.
