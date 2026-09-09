---
record_type: "capability"
spec_version: 2
id: "content.object.page"
name: "Pages"
user_promise: "A durable Page keeps its identity, body, properties, access, discussion, and portable representation wherever it appears."
primary_user_job: "Create work that can be found, shared, revised, and reused without losing what the work is."
kind: "primitive"
state: "verified"
publicness: "public"
availability: "universal"
dependencies: []
related_features: ["content.feature.durable-foundations"]
roadmap_boundary: "feature"
acceptance_summary: "A Page has one stable identity and owner-governed content/access context across editing, Database membership, URLs, comments, source operations, trash, and export."
proof_requirements:
  [
    "Stable Page identity through move, rename, membership, trash, restore, and export",
    "Authorized UI and Action reads/writes with identical access decisions",
    "Portable Markdown/MDX body behavior without making serialization the live identity",
    "Reload and recovery preserve Page content, context, and access boundaries",
  ]
evidence:
  ["../../../server/db/schema.ts", "../../../actions/update-document.ts"]
superseded_by: null
last_reviewed: "2026-07-29"
---

# Pages

## Why this exists

A person needs a durable home for a piece of work, not a row that changes identity with its location or a file that cannot carry access and collaboration context.

## Example workflow

An editor creates a brief, adds body content and Properties, places it in two Databases, shares it with a colleague, then moves it in the sidebar. The same Page URL, comments, history, and source/export identity continue to refer to the brief.

## Product contract

- A Page owns stable identity, title, access, top-level Properties, and one or more Blocks fields.
- A Database row is a Page; membership supplies collection context but never replaces Page identity or creates a primary membership.
- UI, agents, automations, and APIs use shared Actions and the same authorization boundary.
- References, comments, Discussion, history, Versions, sources, and exports target the Page identity, not a transient renderer or location.
- Trash suspends ordinary use without silently reusing the identity; restore returns the Page with its durable context.
- Explicit Page Trash includes its true child hierarchy and applies everywhere the Page appears. Removing a membership, a Reference occurrence, a View, or a personal pin affects only that relationship or presentation.
- Bulk Trash reports each requested Page as trashed, already trashed, covered by a selected ancestor, or failed. A failed scope makes no changes; other independently authorized selections may succeed. Undo restores only roots actually trashed by that operation.

## Boundaries and non-goals

- A Page is not a Blocks field, Database membership, Query result, or named Version.
- Page identity does not grant access to a source, another membership, or a referenced object.
- The Page foundation does not itself define stable Block anchors, source synchronization, or Version branching.

## Acceptance stories

### Move without becoming another document

Given a Page in two Databases, when an editor moves it in navigation or removes one membership, then its URL, body, comments, and remaining membership still resolve to the same Page.

### Deny before revealing context

Given a person who knows a Page link but lacks access, when they open it through UI or an Action, then they receive an honest denial and no title, body, membership, or comment data leaks.

## Current evidence

`server/db/schema.ts` defines durable document rows with IDs, content, ownership, source context, and trash fields. `update-document` persists Page changes through Actions and snapshots prior content; this proves the current Page foundation, not the future Block or Version contracts.

## Proof plan

1. Create, rename, move, multi-home, trash, restore, and export Pages through UI and Actions.
2. Verify identical access decisions for direct links, search, memberships, comments, and agent reads.
3. Reload during edits and recovery, confirming stable identity and no duplicate Page.
4. Check keyboard and assistive-technology navigation and portable Markdown/MDX output.

## Open questions

No open product question changes the verified Page foundation. Richer Page property and source behavior belongs to its adjacent records.
