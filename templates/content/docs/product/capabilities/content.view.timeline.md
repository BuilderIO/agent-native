---
record_type: "capability"
spec_version: 2
id: "content.view.timeline"
name: "Timeline View"
user_promise: "Timeline places and directly edits canonical records across typed dates and ranges while obeying the View conformance contract."
primary_user_job: "See work across time, adjust an authorized date or range directly, and understand what the timeline cannot safely infer."
kind: "surface"
state: "in_progress"
publicness: "public"
availability: "universal"
dependencies: ["content.time.types", "content.view.renderer-conformance"]
related_features:
  [
    "content.feature.see-your-information-your-way",
    "content.feature.plan-work-across-time",
  ]
roadmap_boundary: "feature"
acceptance_summary: "Timeline renders canonical, access-scoped records across selected typed date or range Properties and edits them through shared Actions with conformance, recovery, and accessible navigation."
proof_requirements:
  [
    "Typed date/range placement, end-date, undated, overlap, range navigation, and configuration persistence coverage",
    "Shared Action edit, permission, history, optimistic recovery, and agent-context parity coverage",
    "Real-interface keyboard, assistive-technology, responsive, reload, and unavailable-state workflow",
  ]
evidence:
  [
    "../../../app/components/editor/database/TimelineView.tsx",
    "../../../app/components/editor/DocumentDatabase.test.ts",
  ]
superseded_by: null
last_reviewed: "2026-07-29"
---

# Timeline View

## Why this exists

Time is an important projection of work, but a bar is never a schedule engine or a
second record. Timeline makes typed temporal values visible and editable in place.

## Example workflow

An editor selects a date Property and optional end-date Property, moves to the next
range, creates a dated record, and edits a card. The shared Action changes the canonical
record; undated and unavailable records are reported rather than invented into a lane.

## Product contract

- Timeline consumes canonical, access-scoped results and configured typed dates or ranges.
- Cards, overlap lanes, range controls, counts, and previews reflect authorized records only.
- Direct edits and creation use shared Actions, validation, history, and recovery behavior.
- Timeline is the current shallow renderer donor; Gantt is a composed mode/Feature, not proof of scheduling or a separate renderer contract.

## Boundaries and non-goals

Time types own temporal meaning; schedule constraints own dependency evaluation. Timeline
does not infer dates, create a Gantt engine, or claim runtime feature-flag work not proven here.

## Acceptance stories

### Place a dated range

Given authorized records with start and end date Properties, when a viewer opens Timeline,
then overlapping cards appear in the selected range and an undated state is explicit.

### Edit one canonical date

Given an editable timeline card, when an editor changes its date, then the shared Action
updates one canonical record, records history, and refreshes every authorized projection.

## Current evidence

`TimelineView.tsx` and `DocumentDatabase.test.ts` show a current Timeline renderer and
date-window donor behavior. They do not prove the complete typed-time, Action-parity,
conformance, accessibility, or recovery contract; this Capability remains `in_progress`.

## Proof plan

1. Test date-only, instant, ranges, end dates, undated records, overlaps, and range navigation.
2. Verify Action edits, access closure, history, error rollback, and agent context.
3. Run keyboard, assistive technology, responsive, reload, and unavailable-source workflows.

## Open questions

Precise Gantt composition and schedule-constraint visualization belong to their own Feature work.
