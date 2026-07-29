---
record_type: "capability"
id: "content.property.catalog"
name: "Custom Properties"
user_promise: "Governed Custom Properties can be deliberately reused across Databases without making ordinary same-named columns secretly equivalent"
kind: "primitive"
state: "exploring"
publicness: "public"
availability: "universal"
dependencies: ["content.property.typed","content.template.governance"]
related_features: ["content.feature.connect-your-sources","content.feature.share-how-your-organization-works","content.feature.evolve-systems-safely"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Add-column picker distinguishes built-in local types, source-backed fields, and personal/workspace/org Custom Properties; stable definition and owner/scope; typed configuration and descriptions; provenance; query identity; version/update diff; detach-to-local; safe value migration; agent-legible semantics."
proof_requirements: ["Add-column picker distinguishes built-in local types, source-backed fields, and personal/workspace/org Custom Properties; stable definition and owner/scope; typed configuration and descriptions; provenance; query identity; version/update diff; detach-to-local; safe value migration; agent-legible semantics."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Custom Properties

## Contract

Governed Custom Properties can be deliberately reused across Databases without making ordinary same-named columns secretly equivalent

## Acceptance boundary

A complete proof demonstrates: Add-column picker distinguishes built-in local types, source-backed fields, and personal/workspace/org Custom Properties; stable definition and owner/scope; typed configuration and descriptions; provenance; query identity; version/update diff; detach-to-local; safe value migration; agent-legible semantics.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
