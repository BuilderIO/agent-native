---
record_type: "capability"
id: "content.object.database"
name: "Databases"
user_promise: "Database as a Page-backed typed collection"
kind: "primitive"
state: "verified"
publicness: "public"
availability: "universal"
dependencies: []
related_features: ["content.feature.durable-foundations"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Access-scoped rows, schema/actions, full-page and inline surfaces."
proof_requirements: ["Access-scoped rows, schema/actions, full-page and inline surfaces."]
evidence: ["../../../server/db/schema.ts"]
superseded_by: null
last_reviewed: "2026-07-29"
---

# Databases

## Contract

Database as a Page-backed typed collection

## Acceptance boundary

A complete proof demonstrates: Access-scoped rows, schema/actions, full-page and inline surfaces.

## Evidence boundary

The repository evidence linked in frontmatter supports the complete atomic contract. Feature completion still requires its own end-to-end proof.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
