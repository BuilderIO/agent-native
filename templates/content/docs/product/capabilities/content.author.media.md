---
record_type: "capability"
id: "content.author.media"
name: "Media Blocks"
user_promise: "Images, audio, video, files, embeds, captions, and source-aware assets travel through one storage/rendering contract"
kind: "primitive"
state: "in_progress"
publicness: "public"
availability: "universal"
dependencies: ["content.object.block"]
related_features: ["content.feature.read-and-annotate-anything"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Blob handles, access, upload/paste/drop, export degradation, source provenance."
proof_requirements: ["Blob handles, access, upload/paste/drop, export degradation, source provenance."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Media Blocks

## Contract

Images, audio, video, files, embeds, captions, and source-aware assets travel through one storage/rendering contract

## Acceptance boundary

A complete proof demonstrates: Blob handles, access, upload/paste/drop, export degradation, source provenance.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
