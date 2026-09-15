---
record_type: "capability"
spec_version: 2
id: "content.capture.enrich"
name: "Capture and enrichment"
user_promise: "Send material to a chosen Database and let its own rules turn it into durable context."
primary_user_job: "Capture a link, file, identifier, or note once without later wondering where it went or whether enrichment changed the original capture."
kind: "workflow"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies:
  [
    "content.source.catalog",
    "content.template.graph",
    "content.event.committed",
  ]
related_features: ["content.feature.capture-into-action"]
roadmap_boundary: "feature"
acceptance_summary: "Every entrance resolves or creates one canonical Page in an explicit or remembered Database, preserves provenance and idempotency, commits its own receipt, and starts target-owned enrichment that can retry independently."
proof_requirements:
  [
    "Cross-entrance idempotency and canonical identifier tests",
    "Database destination, template, permission, provenance, Event, and receipt tests",
    "End-to-end capture with delayed enrichment failure, retry, and repair",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Capture and enrichment

## Why this exists

Capture should be one reliable doorway, not a collection of tiny inboxes that lose provenance in the rain.

## Example workflow

A person shares an interview URL to Research. Capture reuses its canonical Page, records the URL and snapshot handle, adds Database membership, and a Research rule later extracts questions; a failed extraction is visible and retryable.

## Product contract

- Browser, share sheet, Clips, file, identifier, agent, email, and provider entrances call one deterministic Capture contract.
- The caller chooses a Database or uses a visible remembered default; destination permissions, templates, defaults, and validation apply before membership commits.
- Canonical URLs and identifiers deduplicate idempotently, with a deliberate-copy escape hatch. Large assets and snapshots live in file storage, not SQL bodies.
- Capture commits provenance, causality, membership, and a receipt before target-owned Rules or agents enrich. Enrichment never makes capture appear incomplete and retries without duplicating the Page.

## Boundaries and non-goals

The Database owns rules and routing; Sources own provider fidelity. An Inbox is a user or template choice, not capture infrastructure.

## Acceptance stories

### Reuse a canonical capture

Given the same normalized URL already exists in the chosen Database, when it is captured again, then Capture reuses the Page and records a new provenance-aware receipt unless the caller explicitly asks for a copy.

### Repair enrichment separately

Given Capture committed a Page but its downstream classifier fails, when the person retries classification, then the original Page and capture receipt remain intact and only enrichment reruns.

## Current evidence

Donor evidence: `actions/import-content-source.ts`, `actions/import-content-source.db.test.ts`, and source actions establish several intake paths. No common Capture Action or complete entrance-to-enrichment proof exists; this record remains `approved_shape`.

## Proof plan

1. Route representative entrances through one Action and test identity normalization.
2. Test destination selection, access, assets, provenance, Events, and receipts.
3. Exercise delayed enrichment, retry, duplicate delivery, and repair in the interface.

## Open questions

- The exact remembered-destination scope per entrance remains open.
