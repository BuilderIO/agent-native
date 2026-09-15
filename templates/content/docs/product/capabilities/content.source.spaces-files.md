---
record_type: "capability"
spec_version: 2
id: "content.source.spaces-files"
name: "Content spaces and Files"
user_promise: "Personal and organization-backed Content spaces and Files views keep work navigable without becoming a second permission system."
primary_user_job: "Find, enter, and organize authorized work in the right space while knowing that sidebar arrangement does not rewrite shared ownership."
kind: "primitive"
state: "verified"
publicness: "public"
availability: "configured"
dependencies: []
related_features: ["content.feature.find-your-place-again"]
roadmap_boundary: "feature"
acceptance_summary: "Content provides database-backed personal and organization spaces, Files and Workspace/sidebar projections, explicit scope-aware selection, and source-as-adapter handling while access remains enforced by the shared resource model."
proof_requirements:
  [
    "Schema and action tests for scope-aware spaces, Files membership, and source handling",
    "Sidebar selection, ordering, drag/drop, and access-boundary regression tests",
    "Interface workflow entering a space, organizing Files, reopening a source-backed item, and handling unavailable scope",
  ]
evidence:
  [
    "../../../server/db/schema.ts",
    "../../../app/components/sidebar/DocumentSidebar.tsx",
    "../../../app/components/sidebar/DocumentSidebar.layout.test.ts",
  ]
superseded_by: null
last_reviewed: "2026-07-29"
---

# Content spaces and Files

## Why this exists

People need a place to arrive and a way to arrange it, without mistaking a sidebar for the constitution.

## Example workflow

A teammate enters an organization space, opens its Files view, reorders a personal sidebar preference, and opens a source-backed item without changing the source's ownership or another person's arrangement.

## Product contract

- Personal and organization-backed spaces organize Content navigation and memberships; shared access remains the resource/access model's responsibility.
- Files, Workspaces, and sidebar sections are projections over Content objects and source-backed items, not a rival Source architecture.
- Scope selection and saved personal navigation state are explicit. Personal ordering does not silently mutate shared Database membership or reparent a Page.
- Source-backed entries retain source-adapter boundaries and unavailable states rather than pretending all files are native Content.

## Boundaries and non-goals

Global Home and session restore own cross-space arrival; source adapters own provider behavior. Spaces do not grant access merely because an item appears in a sidebar.

## Acceptance stories

### Keep a personal reorder personal

Given two people share a Files view, when one reorders their custom sidebar arrangement, then their preference persists without changing the other person's order or shared membership positions.

### Respect space access

Given a stale link to an organization-backed item, when a person without current access opens it, then the interface gives an honest access state and does not expose the item's title or source data.

## Current evidence

Implementation evidence: `server/db/schema.ts`, `app/components/sidebar/DocumentSidebar.tsx`, and `app/components/sidebar/DocumentSidebar.layout.test.ts` cover database-backed sidebar/Files behavior and source handling. The cited tests support the present atomic contract; Feature-level arrival proof remains separate.

## Proof plan

1. Maintain schema/action coverage for personal and organization scope boundaries.
2. Run sidebar ordering and source-backed-item regression suites.
3. Periodically verify the real interface workflow across scope changes and denied links.

## Open questions

- Broader Home and cross-space resumption improvements belong to their dedicated capabilities.
