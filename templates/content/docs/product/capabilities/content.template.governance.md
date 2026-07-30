---
record_type: "capability"
spec_version: 2
id: "content.template.governance"
name: "Template governance"
user_promise: "Find and adopt a reusable working system with clear ownership, approval, version, provenance, and access."
primary_user_job: "Choose a reusable system with visible ownership and approval."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.template.graph", "content.access.page-database"]
related_features:
  [
    "content.feature.share-how-your-organization-works",
    "content.feature.put-your-organizations-know-how-to-work",
    "content.feature.evolve-systems-safely",
  ]
roadmap_boundary: "feature"
acceptance_summary: "Template governance provides private, organization-approved, and published catalogs with stable identity, ownership scope, inspectable content, versioning, approval, discovery, provenance, and access-aware adoption."
proof_requirements:
  [
    "Catalog scope determines discoverability, editing, approval, and audit; it does not bypass object access.",
    "Templates are inspectable snapshots of ordinary primitives, not opaque packages or a second authority system.",
    "Adoption preserves origin and version choice; a later update is handled through review rather than possession.",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Template governance

## Why this exists

A reusable system is only trustworthy when adopters can inspect who made it, what version they are taking, and who approved it. Discovery must not turn a catalog entry into a permission bypass.

## Example workflow

Kai inspects an organization-approved editorial Template, then adopts its version into a workspace with visible owner, approval, and provenance.

## Product contract

- Catalog scope determines discoverability, editing, approval, and audit; it does not bypass object access.
- Templates are inspectable snapshots of ordinary primitives, not opaque packages or a second authority system.
- Adoption preserves origin and version choice; a later update is handled through review rather than possession.

## Boundaries and non-goals

- `content.template.graph` owns snapshot/instantiation; Template updates own adopted-instance diffs and selective application.
- Governance does not grant access to referenced objects, auto-update instances, or turn Templates into opaque packages.

## Acceptance stories

### Scope does not bypass access

Given one referenced object is inaccessible, when a person inspects or adopts the Template, then inspection/adoption does not leak it.

### Make approval history visible

Given a new version is published, when an adopter opens catalog detail, then adopters distinguish draft, approved, and adopted versions without auto-update.

## Current evidence

`docs/product/features/content.feature.share-how-your-organization-works.md` names Template substrate; no unified catalog, approval action, or adoption implementation exists.

## Proof plan

1. Create private/org/published entries with scope, owner, version, provenance.
2. Test discovery, approval, audit, and edit permissions.
3. Adopt under mixed access without leaking hidden references.
4. Hand updates to Template update workflow.

## Open questions

Publisher-role policy remains open.
