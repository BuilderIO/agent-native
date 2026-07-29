---
record_type: "capability"
id: "content.source.spaces-files"
name: "Content spaces and Files"
user_promise: "Database-backed Content spaces, Files, Workspaces, and Sidebar views"
kind: "primitive"
state: "verified"
publicness: "public"
availability: "configured"
dependencies: []
related_features: ["content.feature.find-your-place-again"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Maintain explicit per-space access and source-as-adapter model."
proof_requirements: ["Maintain explicit per-space access and source-as-adapter model."]
evidence: ["../../../server/db/schema.ts"]
superseded_by: null
last_reviewed: "2026-07-29"
---

# Content spaces and Files

## Contract

Database-backed Content spaces, Files, Workspaces, and Sidebar views

## Acceptance boundary

A complete proof demonstrates: Maintain explicit per-space access and source-as-adapter model.

## Evidence boundary

The repository evidence linked in frontmatter supports the complete atomic contract. Feature completion still requires its own end-to-end proof.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
