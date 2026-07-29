---
record_type: "capability"
id: "content.embed.mcp-app"
name: "MCP App embedding"
user_promise: "Content itself can appear as a focused MCP App inside compatible external agent hosts"
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "external_host"
dependencies: ["content.embed.surface","content.embed.host-grant"]
related_features: ["content.feature.work-on-content-inside-another-application"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Project a real access-scoped Content route with deep-link fallback; this is an external-host presentation, not another normal in-Content block or navigation surface."
proof_requirements: ["Project a real access-scoped Content route with deep-link fallback; this is an external-host presentation, not another normal in-Content block or navigation surface."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# MCP App embedding

## Contract

Content itself can appear as a focused MCP App inside compatible external agent hosts

## Acceptance boundary

A complete proof demonstrates: Project a real access-scoped Content route with deep-link fallback; this is an external-host presentation, not another normal in-Content block or navigation surface.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
