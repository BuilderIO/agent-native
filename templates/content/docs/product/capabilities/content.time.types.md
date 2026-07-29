---
record_type: "capability"
id: "content.time.types"
name: "Dates, times, and durations"
user_promise: "Date, Instant, ranges, Duration, and explicit timezone conversion"
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.property.typed"]
related_features: ["content.feature.data-that-keeps-itself-right","content.feature.plan-work-across-time"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Separate date-only and timestamp semantics through storage, filters, rendering, export."
proof_requirements: ["Separate date-only and timestamp semantics through storage, filters, rendering, export."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Dates, times, and durations

## Contract

Date, Instant, ranges, Duration, and explicit timezone conversion

## Acceptance boundary

A complete proof demonstrates: Separate date-only and timestamp semantics through storage, filters, rendering, export.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
