---
record_type: "capability"
spec_version: 2
id: "content.object.blocks-field"
name: "Blocks fields"
user_promise: "Every editable rich-content body uses one Blocks-field grammar and keeps its own stable revision boundary."
primary_user_job: "Write rich content in Pages and collaboration surfaces without each body inventing incompatible editing and history rules."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.object.block"]
related_features:
  [
    "content.feature.durable-foundations",
    "content.feature.collaborate-in-context",
  ]
roadmap_boundary: "feature"
acceptance_summary: "Pages, additional rich fields, Comments, and Discussion messages use compatible typed Blocks while retaining distinct owner, field identity, access, and attributable revision history."
proof_requirements:
  [
    "One grammar across each supported editable body",
    "Stable field and Block identity with independent revision/recovery boundaries",
    "Owner-scoped access and typed rendering including unavailable content",
    "Shared Action/UI behavior for concurrency, history, and portable output",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Blocks fields

## Why this exists

An article, a comment, and a Discussion message should support the same useful content rather than forcing people into a plain-text side channel or making every small body a full Page.

## Example workflow

A reviewer writes a Comment containing a Page reference and a code Block, while an author keeps a research-notes field beside the Page body. Each body renders through the same grammar, but only the intended field is revised or recovered.

## Product contract

- A Blocks field is one editable rich-content body with stable identity and a canonical owning object.
- Page bodies, additional rich fields, Comments, and Discussion messages reuse the grammar; their ownership and access do not collapse into one Page.
- Field history distinguishes atomic Events, logical Revisions, recovery snapshots, and named Page Versions.
- Typed Blocks preserve source when a renderer is unavailable and report a degraded state rather than dropping content.
- A multi-field action can share causality while retaining which field changed.

## Boundaries and non-goals

- A Blocks field does not become a top-level Page, Database row, or sharing principal.
- It does not decide Page Version branching, cross-field merge, or generic query history.
- Shared grammar does not imply every renderer is supported in every host.

## Acceptance stories

### Reuse grammar without merging ownership

Given a Page body and a Comment body containing references, when each is edited, then both use compatible Blocks while Comment access and history remain owned by the Comment's Page context.

### Recover exactly one body

Given a Page with two Blocks fields, when an authorized editor restores one field, then the other field, title, Properties, and memberships remain unchanged and a new attributable Revision records the recovery.

## Current evidence

The document editor proves rich Page-body editing and comments provide collaboration substrate. The repository does not yet prove one generalized Blocks-field grammar or independent field history across all owners; this remains `approved_shape`.

## Proof plan

1. Author equivalent typed content in every supported field owner and compare serialization/rendering.
2. Verify per-field identity, history, recovery, deletion, and inaccessible rendering.
3. Test agent, human, and automation edits with causal attribution and concurrent writes.
4. Exercise UI, Actions, export, import, keyboard, and assistive technology paths.

## Open questions

The exact first set of non-Page field owners can grow incrementally; no owner may claim grammar compatibility without its own proof.
