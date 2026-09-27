---
record_type: "capability"
spec_version: 2
id: "content.object.blocks-field"
name: "Blocks fields"
user_promise: "Every editable rich-content body uses one Blocks-field grammar and keeps its own stable revision boundary."
primary_user_job: "Write rich content in Pages and collaboration surfaces without each body inventing incompatible editing and history rules."
kind: "primitive"
state: "in_progress"
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
evidence:
  [
    "server/db/schema.ts",
    "actions/_blocks-field-identity.ts",
    "actions/blocks-seeding.db.test.ts",
    "actions/content-database-block-actions.db.test.ts",
  ]
superseded_by: null
last_reviewed: "2026-09-23"
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
- Page-body recovery generations are scoped to one editor lineage and settle only when the confirmed canonical title and body represent that authored snapshot.
- Page-body save attempts retain a matching base, candidate, actor/session, and retry identity through rebase, retention, lifecycle submission, and remount. A remote live observation is distinct from authored intent and from confirmed SQL persistence; recovery retains the latest observed body without promoting it to a new local edit.

## Boundaries and non-goals

- A Blocks field does not become a top-level Page, Collection row, or sharing principal.
- It does not decide Page Version branching, cross-field merge, or generic query history.
- Shared grammar does not imply every renderer is supported in every host.

## Acceptance stories

### Reuse grammar without merging ownership

Given a Page body and a Comment body containing references, when each is edited, then both use compatible Blocks while Comment access and history remain owned by the Comment's Page context.

### Recover exactly one body

Given a Page with two Blocks fields, when an authorized editor restores one field, then the other field, title, Properties, and memberships remain unchanged and a new attributable Revision records the recovery.

## Current evidence

Primary and additional collection Blocks properties retain distinct field identities, ordered Block identities, and independent monotonic revisions around their existing Markdown stores. Shared actions can list and mutate one exact collection Blocks field with field-level compare-and-swap, sibling preservation, stable IDs, durable retry receipts, and verified read-back. The Page body fences delayed recovery upserts after a confirmed editor generation and preserves another tab's lineage. The September 23 hosted beta two-tab run still lost later independent edits from one tab and opened version-choice recovery, so those foundations did not prove Page-body convergence. An early local pass of the current save-session repair preserved all markers through three alternating edits per tab, ten more alternating cycles, and an independent browser/MCP edit with replay receipt; full R01–R08 and repaired beta proof remain pending. Export reports each field and its identity status without changing plain NFM. Comment/Discussion owners, attributable history, arbitrary restore, and the full real-interface matrix remain incomplete, so this is `in_progress`.

## Proof plan

1. Author equivalent typed content in every supported field owner and compare serialization/rendering.
2. Verify per-field identity, history, recovery, deletion, and inaccessible rendering.
3. Test agent, human, and automation edits with causal attribution and concurrent writes.
4. Exercise UI, Actions, export, import, keyboard, and assistive technology paths.

## Open questions

The exact first set of non-Page field owners can grow incrementally; no owner may claim grammar compatibility without its own proof.
