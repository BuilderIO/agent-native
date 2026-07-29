---
record_type: "capability"
id: "content.object.page"
name: "Pages"
user_promise: "Durable Page with body, properties, permissions, comments, URL, and source/export identity"
kind: "primitive"
state: "verified"
publicness: "public"
availability: "universal"
dependencies: []
related_features: ["content.feature.durable-foundations"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Keep ordinary Markdown/MDX readable and portable."
proof_requirements: ["Keep ordinary Markdown/MDX readable and portable."]
evidence: ["../../../server/db/schema.ts"]
superseded_by: null
last_reviewed: "2026-07-29"
---

# Pages

## Contract

Durable Page with body, properties, permissions, comments, URL, and source/export identity

## Acceptance boundary

A complete proof demonstrates: Keep ordinary Markdown/MDX readable and portable.

## Evidence boundary

The repository evidence linked in frontmatter supports the complete atomic contract. Feature completion still requires its own end-to-end proof.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
