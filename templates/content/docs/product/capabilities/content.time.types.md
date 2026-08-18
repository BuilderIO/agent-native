---
record_type: "capability"
spec_version: 2
id: "content.time.types"
name: "Dates, times, and durations"
user_promise: "Date, Instant, ranges, Duration, and explicit timezone conversion"
primary_user_job: "Represent time accurately for the meaning I intend and see its conversion, filtering, rendering, and export without silent timezone drift."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.property.typed"]
related_features:
  [
    "content.feature.data-that-keeps-itself-right",
    "content.feature.plan-work-across-time",
  ]
roadmap_boundary: "feature"
acceptance_summary: "Typed Date, Instant, ranges, Duration, and explicit timezone conversion preserve distinct semantics through storage, filters, rendering, Actions, and export."
proof_requirements:
  [
    "Date-only, instant, range, duration, timezone, validation, storage, and round-trip coverage",
    "Filter, sort, expression, renderer, Action, export, import, and agent-context semantic coverage",
    "DST, locale, invalid value, missing zone, reload, and recovery workflows",
  ]
evidence:
  [
    "../../../app/components/editor/database/calendar-timeline.ts",
    "../../../app/components/editor/DocumentDatabase.test.ts",
  ]
superseded_by: null
last_reviewed: "2026-07-29"
---

# Dates, times, and durations

## Why this exists

“Tuesday” and “Tuesday at 09:00 in a zone” are different promises. Content must retain
that difference from storage to a person reading an export months later.

## Example workflow

An editor records a date-only deadline and a zoned meeting instant, filters both in a
Timeline, travels to another timezone, and exports them with their distinct meaning intact.

## Product contract

- Date, Instant, range, Duration, and timezone are typed values with non-interchangeable semantics.
- Date-only values do not acquire a hidden timezone; Instants retain an explicit conversion context.
- Filters, sorts, expressions, renderers, Actions, import/export, and agents preserve the declared type.
- Invalid, ambiguous, missing-zone, stale, and unavailable values are explicit rather than coerced into success.

## Boundaries and non-goals

Typed Properties own general value storage. This is not a calendar provider, scheduling
policy, or permission model.

## Acceptance stories

### Preserve a date-only value

Given a date-only deadline, when a viewer changes timezone and filters or exports it,
then Content retains the same calendar date rather than shifting it as an Instant.

### Convert an Instant explicitly

Given a zoned meeting Instant, when a viewer changes display timezone, then its displayed
local time changes by explicit conversion while its stored instant and history remain stable.

## Current evidence

`calendar-timeline.ts` and Database tests provide date-window donor behavior. They do
not prove the complete typed storage, timezone, expression, import/export, and recovery
contract; this Capability remains `approved_shape`.

## Proof plan

1. Test every type through validation, storage, round trip, filters, sorts, and expressions.
2. Verify rendering, Actions, import/export, agents, and type-preserving history.
3. Exercise DST, locale, invalid/missing zone, reload, unavailable input, and recovery workflows.

## Open questions

The serialized interchange representation and display-zone preference policy need design.
