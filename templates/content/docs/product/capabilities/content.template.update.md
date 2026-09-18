---
record_type: "capability"
spec_version: 2
id: "content.template.update"
name: "Template updates"
user_promise: "Review what changed in a template and selectively bring compatible improvements into my owned instance."
primary_user_job: "Selectively apply template improvements without losing local work."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.template.graph", "content.diff.in-place"]
related_features: ["content.feature.evolve-systems-safely"]
roadmap_boundary: "feature"
acceptance_summary: "Template instances never auto-update; they show a structural, typed, provenance-aware diff and permit dependency-safe selective apply or reset while preserving local additions."
proof_requirements:
  [
    "An update compares the pinned/adopted source version with the proposed version and identifies affected objects, formulas, Rules, Views, and dependencies.",
    "The owner chooses follow, pin, selectively apply, or reset; local additions remain unless the owner deliberately removes them.",
    "Partial apply is dependency-safe, receipt-backed, previewed for impact, and never a silent remote overwrite.",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Template updates

## Why this exists

A template improvement is useful only if an instance owner can see its consequences before accepting it. Remote changes must not overwrite the local adaptations that made the template fit real work.

## Example workflow

Kai reviews a template update, applies a formula but not a view, and keeps a locally added property untouched.

## Product contract

- An update compares the pinned/adopted source version with the proposed version and identifies affected objects, formulas, Rules, Views, and dependencies.
- The owner chooses follow, pin, selectively apply, or reset; local additions remain unless the owner deliberately removes them.
- Partial apply is dependency-safe, receipt-backed, previewed for impact, and never a silent remote overwrite.

## Boundaries and non-goals

- `content.template.graph` owns source/instance graph identity and `content.diff.in-place` owns review presentation; this record owns update notice, impact, and selective apply/reset.
- Updates never auto-apply, overwrite local additions silently, or use a remote version as a new permission authority.

## Acceptance stories

### Never auto-update

Given a new approved version, when an owner opens the instance, then instance remains pinned until owner acts.

### Require dependencies

Given selected change needs a property, when the owner applies it, then Content applies it or explains why partial apply cannot commit.

## Current evidence

`docs/product/features/content.feature.evolve-systems-safely.md` records donors; typed graph diff/impact/apply/recovery are absent.

## Proof plan

1. Diff graph versions including formulas, Rules, views, dependencies.
2. Preview consumers and local additions.
3. Selectively apply/reset with receipts/recovery.
4. Test conflicts, denial, and retry without overwrite.

## Open questions

Conflict presentation and reset granularity remain open.
