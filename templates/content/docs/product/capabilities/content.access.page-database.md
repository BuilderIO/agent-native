---
record_type: "capability"
spec_version: 2
id: "content.access.page-database"
name: "Page and Database access"
user_promise: "Page and Database roles separate reading, commenting, entry editing, and structure authority."
primary_user_job: "Share work at the appropriate level without accidentally granting collection-wide power."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: []
related_features: []
roadmap_boundary: "supporting"
acceptance_summary: "Fixed Page and Database roles are enforced by the shared Action surface before every read or mutation, including deletion and structured-value policy."
proof_requirements:
  [
    "Page role decisions for view, comment, edit, and full access",
    "Database role decisions for entry versus schema authority",
    "Identical UI, agent, API, and automation enforcement",
    "Deletion, select-option, source-policy, and stale-capability failure coverage",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Page and Database access

## Why this exists

Collaboration needs more than editor or viewer. A teammate may comment on a Page, edit a Database entry, or manage the Database structure—those are deliberately different powers.

## Example workflow

A manager gives a collaborator **Can edit entries** in a planning Database. The collaborator changes authorized rows but cannot alter Properties or delete the Database; a Page commenter can discuss a brief but cannot edit its body.

## Product contract

- Page roles are **Can view**, **Can comment**, **Can edit**, and **Full access**.
- Database roles are **Can view**, **Can comment**, **Can edit entries**, **Can edit database**, and **Full access**.
- Roles are fixed product roles backed by internal capabilities, not custom checkbox combinations.
- Every UI, agent, automation, and API operation calls the same Action authorization and operation-specific validation.
- Source truth, Property locks, and policy can narrow authority; they never widen a role.
- Deletion and option/schema mutation require the stronger authority their impact demands.

## Boundaries and non-goals

- This record defines role semantics, not row-specific overrides, public publication, or derived-result closure.
- A personal Favorite or Only-me View is a private capability, not shared edit authority.
- Seeing an object or relationship never grants authority to mutate it.

## Acceptance stories

### Edit entries but not structure

Given a collaborator with **Can edit entries**, when they update an allowed row, then it succeeds through UI and Action. When they rename a Property or change a select option, then it is denied without a partial mutation.

### Comment without editing body

Given a Page commenter, when they add a comment, then it is permitted. When they submit a body edit or ask an agent to do it, then both surfaces return the same denial.

## Current evidence

Current Content actions and Database permission work provide role and ownership substrate, but the complete fixed-role matrix, shared effective operation capabilities, and all destructive/structured-value paths are not yet proven together. This remains `approved_shape`.

## Proof plan

1. Build a role-by-operation matrix for Page and Database actions and UI controls.
2. Test direct, bulk, agent, automation, source-backed, and stale client capability paths.
3. Verify denial is typed and leaves content, schema, and audit state unchanged.
4. Test role changes during a pending mutation, reload, keyboard, and assistive technology.

## Open questions

Internal capability representation is an implementation detail. The fixed product role vocabulary and no-widening rule are settled.
