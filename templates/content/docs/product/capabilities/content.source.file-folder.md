---
record_type: "capability"
id: "content.source.file-folder"
name: "Files and folders as Sources"
user_promise: "A person can open a folder as a Source without assuming every file shares one Database schema."
kind: "primitive"
state: "exploring"
publicness: "public"
availability: "configured"
dependencies: ["content.source.adapters","content.portability.source-representation"]
related_features: ["content.feature.bring-your-local-work"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: A person can open a folder as a Source without assuming every file shares one Database schema."
proof_requirements: ["A person can open a folder as a Source without assuming every file shares one Database schema."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Files and folders as Sources

## Contract

A person can open a folder as a Source without assuming every file shares one Database schema.

## Acceptance boundary

A complete proof demonstrates: A person can open a folder as a Source without assuming every file shares one Database schema.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
