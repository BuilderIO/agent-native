---
record_type: "capability"
spec_version: 2
id: "content.object.multi-membership"
name: "Multiple Database memberships"
user_promise: "One Page can belong to several Databases without copies or a hidden primary home."
primary_user_job: "Organize the same work for several legitimate collections without choosing which copy is true."
kind: "primitive"
state: "in_progress"
publicness: "public"
availability: "universal"
dependencies: ["content.object.page", "content.object.database"]
related_features: ["content.feature.make-the-workspace-yours"]
roadmap_boundary: "feature"
acceptance_summary: "A Page retains one identity while each Database independently owns membership, membership-local values, access-scoped presentation, addition, and removal."
proof_requirements:
  [
    "Plural membership reads and writes through UI and Actions",
    "No primary-membership inference in identity, URL, access, or export",
    "Remove one membership without deleting Page-owned content or other memberships",
    "Grouped Info and recovery behavior under access and concurrent changes",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Multiple Database memberships

## Why this exists

A project can belong to a roadmap, a client portfolio, and a quarterly review. Copies make those lists disagree; a false primary home makes one view accidentally sovereign.

## Example workflow

An initiative Page appears in Projects and Launches. Each Database shows its own membership-specific fields. Removing it from Launches leaves the Page and Projects entry intact; Info groups the two memberships without naming one primary.

## Product contract

- A Page may have zero, one, or many Database memberships while keeping one Page identity.
- Each Database owns its membership and membership-local values; Page-owned body, title, access, comments, and references remain common.
- Adding or removing membership uses the Database's authorized Action, validation, source policy, and Events.
- No URL, parent, export, agent context, or access decision infers a primary Database from membership order.
- Info presents authorized memberships as a group; inaccessible memberships do not leak.

## Boundaries and non-goals

- Membership is not hierarchy, sidebar placement, a reference, or a share grant.
- It does not merge conflicting Database schemas or values into Page properties.
- Personal View order is separate from shared membership order.

## Acceptance stories

### Keep one Page across two collections

Given a Page in two Databases, when it is edited from either, then both show the same Page-owned content while retaining their own membership-local values.

### Remove only the selected membership

Given a Page in two Databases, when an authorized editor removes it from one, then only that membership disappears and the Page, other membership, comments, and history remain recoverable.

## Current evidence

The Database data model and actions provide Page-backed collection substrate, and current product behavior supports several membership contexts. Complete plural APIs, grouped Info, and proof that no path infers a primary membership remain incomplete; this is `in_progress`.

## Proof plan

1. Add, display, edit, and remove memberships through all supported Views and Actions.
2. Verify identity, URLs, access, export, search, and agent context with several memberships.
3. Test source-managed membership, mixed permissions, trash/restore, and concurrent add/remove.
4. Inspect Info grouping, keyboard, and assistive-technology behavior.

## Open questions

Membership-local property conflict presentation is owned by Database and typed-property work; it must not create a primary Page home.
