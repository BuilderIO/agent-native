---
record_type: "capability"
id: "content.job.durable"
name: "Durable background jobs"
user_promise: "Imports, exports, migrations, capture, and backfills survive interruption, report honest progress, and resume without duplicate work."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.event.committed","content.agent.action-parity"]
related_features: ["content.feature.collect-structured-input","content.feature.capture-into-action","content.feature.take-the-whole-vault-with-you","content.feature.move-without-starting-over"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Imports, exports, migrations, capture, and backfills survive interruption, report honest progress, and resume without duplicate work."
proof_requirements: ["Imports, exports, migrations, capture, and backfills survive interruption, report honest progress, and resume without duplicate work."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Durable background jobs

## Contract

Imports, exports, migrations, capture, and backfills survive interruption, report honest progress, and resume without duplicate work.

## Acceptance boundary

A complete proof demonstrates: Imports, exports, migrations, capture, and backfills survive interruption, report honest progress, and resume without duplicate work.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
