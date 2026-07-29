---
record_type: "capability"
id: "content.capture.enrich"
name: "Capture and enrichment"
user_promise: "Send anything to a chosen Content Database and let its Rules and agents immediately turn it into durable, structured context"
kind: "workflow"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.source.catalog","content.template.graph","content.event.committed"]
related_features: ["content.feature.capture-into-action"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Browser, share-sheet, Clips, file, identifier, agent, email, and provider entrances share one deterministic capture action; explicit/remembered target; template and unambiguous view defaults; canonical URL/identifier deduplication; snapshots/assets outside SQL; provenance; committed entry/membership Events; target-owned Rules/agent enrichment; retry, causality, repair, and visible receipts. Inbox is an optional user/template design, not infrastructure."
proof_requirements: ["Browser, share-sheet, Clips, file, identifier, agent, email, and provider entrances share one deterministic capture action; explicit/remembered target; template and unambiguous view defaults; canonical URL/identifier deduplication; snapshots/assets outside SQL; provenance; committed entry/membership Events; target-owned Rules/agent enrichment; retry, causality, repair, and visible receipts. Inbox is an optional user/template design, not infrastructure."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Capture and enrichment

## Contract

Send anything to a chosen Content Database and let its Rules and agents immediately turn it into durable, structured context

## Acceptance boundary

A complete proof demonstrates: Browser, share-sheet, Clips, file, identifier, agent, email, and provider entrances share one deterministic capture action; explicit/remembered target; template and unambiguous view defaults; canonical URL/identifier deduplication; snapshots/assets outside SQL; provenance; committed entry/membership Events; target-owned Rules/agent enrichment; retry, causality, repair, and visible receipts. Inbox is an optional user/template design, not infrastructure.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
