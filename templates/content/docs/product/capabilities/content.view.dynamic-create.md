---
record_type: "capability"
spec_version: 2
id: "content.view.dynamic-create"
name: "View-derived creation defaults"
user_promise: "Creating through a View starts new records with safe contextual values without turning that View's filters into hidden validation."
primary_user_job: "Capture a new record where I am working and have it start in the right context without losing the ability to make a valid exception."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.view.query", "content.property.constraints"]
related_features: ["content.feature.data-that-keeps-itself-right"]
roadmap_boundary: "feature"
acceptance_summary: "Creation through an effective View seeds only deterministic positive equality, membership, contextual, and renderer-placement values; Database validation remains the sole hard gate, and valid edits may move records into or out of results with truthful feedback."
proof_requirements:
  [
    "Typed effective-View analysis for positive seeds and refusal of ambiguous inference",
    "Shared UI and Action creation with Database permissions, validation, defaults, Events, revisions, and Undo",
    "Real-interface workflows for conflicting seeds, post-create exclusion, and valid edits that leave or re-enter results",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# View-derived creation defaults

## Why this exists

People often create work from a focused list, Board lane, or Calendar date.
That surface should provide a useful starting context, but a filter only says
which records are included in a result. Treating it as a hidden mutation rule
would make a View unexpectedly own data validity and block legitimate work.

## Example workflow

An editor opens an `Active` Board filtered to `Active = true` and chooses a
lane for `Status = Planned`. New work begins with both values. The editor then
turns `Active` off because that is the correct valid state. Content commits the
change through the Database, removes the record from the active View, and shows
**Moved out of this View · Undo**; it does not reject the change or delete the
record.

## Product contract

### Seed only what is deterministic

- Creation uses the effective View: its saved definition, applicable personal
  arrangement, and renderer placement. Human and agent creation receive the
  same analysis and shared Action behavior.
- Exact positive equality, positive membership, contextual equality, and an
  explicit renderer placement may seed stored values when they have an
  unambiguous writable route. Examples include `Active = true`, `Tags contains
Urgent`, `Assignee = current actor`, a Board lane, or a Calendar date.
- `OR`, negation, ranges, full-text search, aggregate conditions, arbitrary
  formulas, and other non-deterministic expressions never manufacture a stored
  value merely because a record might satisfy them.
- Seeds are starting values, not locked fields. Explicit user intent may change
  them before or after creation whenever the owning Database permits the
  resulting mutation.

### Inclusion is not validation

- Query and View filters control result inclusion. The owning Database owns
  membership, Properties, defaults, constraints, permissions, Rules, and the
  canonical create/write path; only those rules decide whether a value is
  valid.
- A View over a Query cannot seed or validate outside the Query's declared
  creation routes. A composed Query with no applicable route is truthfully
  read-only, and a View cannot invent a target.
- If valid creation or a later valid edit no longer matches the effective
  result, Content preserves the record, refreshes the result, and gives light
  feedback such as **Created, but not shown in this View** or **Moved out of
  this View**, with an appropriate Open or Undo route.
- Conflicting automatic seeds never cause a guess. Quick capture expands to the
  normal creation editor, explains the conflict, and lets Database validation
  and explicit intent resolve it.

## Boundaries and non-goals

- Database and Query Views own presentation, downstream filters, and the
  effective View; Database constraints and Rules own validity.
- Reusable Queries own intrinsic filters and creation routes. This Capability
  applies those routes in a View; it does not define cross-source write routing.
- This is not a bulk-update, schema-default, task-template, permission, or
  second Action system.

## Acceptance stories

### Seed a Board capture without locking it

Given an authorized Board View filtered to `Active = true` with a `Planned`
lane, when a person creates a record in that lane, then the record starts with
`Active = true` and `Status = Planned`. When they validly set `Active = false`,
then the Database commits it and the record leaves the View with Undo feedback.

### Refuse to infer an ambiguous filter

Given a View filtered by `Priority = High OR Priority = Urgent` and a date
range, when a person starts quick capture, then Content does not choose a
priority or fabricate a date from those expressions; it opens the normal editor
with only independently deterministic defaults.

### Resolve conflicting seeds visibly

Given a View's positive filter and renderer placement propose incompatible
writable values, when an authorized person creates a record, then no arbitrary
value is committed and the normal editor identifies the mismatch. If the person
chooses a valid value outside the View, the record is created and truthfully
reported as not shown.

## Current evidence

Existing filters, saved Views, Board/Calendar rendering, and creation paths are
useful donor substrate. They do not yet prove typed seed analysis, identical
human/agent behavior, conflict expansion, result-transition feedback, or the
complete Database-validation boundary. This Capability remains `approved_shape`.

## Proof plan

1. Test equality, membership, contextual, Board, and Calendar seeds through UI
   and Actions, including permissions, defaults, constraints, Rules, Events,
   revisions, reload, and Undo.
2. Assert that OR, negation, ranges, search, aggregates, formulas, unavailable
   fields, ambiguous routes, and inaccessible values produce no invented seed.
3. Exercise post-create exclusion, editing records out of and back into Database
   and Query Views, conflicting seeds, and composed Query zero/one/many routes.
4. Verify accessible feedback and keyboard capture without turning View
   inclusion into a hidden mutation failure.

## Open questions

- The exact precedence and presentation for multiple compatible defaults,
  Database defaults, and renderer placement need implementation design.
- The compact creation editor for conflicting seeds and the exact Undo scope
  need interaction design, while preserving the settled ownership boundary.
