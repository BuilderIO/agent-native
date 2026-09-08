---
record_type: "capability"
spec_version: 2
id: "content.renderer.artifact-block"
name: "Artifact Blocks"
user_promise: "Make a one-off interactive or visual artifact on one page, then promote it only if reuse becomes real."
primary_user_job: "Build a safe page-local artifact before deliberate promotion."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.renderer.custom-block"]
related_features: ["content.feature.build-new-surfaces"]
roadmap_boundary: "feature"
acceptance_summary: "An Artifact Block is page-owned HTML/CSS/JS in the shared Custom Block sandbox format, with optional typed props, stable asset handles, export fallback, and explicit Save as Custom Block promotion."
proof_requirements:
  [
    "Artifact Blocks have no catalog identity until a user explicitly saves one as a Custom Block.",
    "The sandbox receives only bound typed props and has no ambient Content data, actions, cookies, filesystem, parent DOM, secrets, or network.",
    "Export uses a declared static fallback; promotion preserves provenance rather than silently changing reuse scope.",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Artifact Blocks

## Why this exists

Many useful artifacts begin as one-page experiments, before anyone can justify governing them for reuse. That early experiment still needs a sandbox strong enough that a decorative widget cannot acquire host authority.

## Example workflow

Tess builds a scoring widget on a planning Page, verifies static export, then chooses Save as Custom Block; the original remains local.

## Product contract

- Artifact Blocks have no catalog identity until a user explicitly saves one as a Custom Block.
- The sandbox receives only bound typed props and has no ambient Content data, actions, cookies, filesystem, parent DOM, secrets, or network.
- Export uses a declared static fallback; promotion preserves provenance rather than silently changing reuse scope.

## Boundaries and non-goals

- `content.renderer.custom-block` owns reusable catalog definitions; Artifact Blocks own a page/block-local instance and explicit promotion.
- Artifacts are not Extensions, do not receive ambient host grants, and do not enter a catalog merely because they ran.

## Acceptance stories

### Keep it page-owned

Given the artifact is copied, when the original changes, then the copy is not silently shared.

### Deny ambient authority

Given artifact code requests cookies, Content actions, parent DOM, or network, then the sandbox rejects it.

## Current evidence

`app/blocks/contentBlockRegistry.tsx` and Extension sandbox code donate substrate; no Artifact Block lifecycle is implemented.

## Proof plan

1. Create empty and typed-prop artifacts with no catalog record.
2. Deny SQL/actions/cookies/secrets/DOM/filesystem/network.
3. Verify copy and static export never execute for readers.
4. Promote and inspect distinct catalog provenance.

## Open questions

No question remains: network is out of the first contract.
