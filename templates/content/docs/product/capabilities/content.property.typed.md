---
record_type: "capability"
spec_version: 2
id: "content.property.typed"
name: "Typed Properties"
user_promise: "Define stored and computed fields whose values and descriptions stay meaningful in every surface."
primary_user_job: "Define fields whose types survive every Content operation."
kind: "primitive"
state: "in_progress"
publicness: "public"
availability: "universal"
dependencies: []
related_features: ["content.feature.data-that-keeps-itself-right"]
roadmap_boundary: "feature"
acceptance_summary: "Properties declare stable stored or computed types, descriptions, configuration, and renderer contracts so values can be authored, queried, validated, rendered, and exported without ambiguous coercion."
proof_requirements:
  [
    "Stored values and computed results both declare exact output types; presentation is a renderer choice, not a hidden data conversion.",
    "Descriptions and typed semantics are available to people, agents, queries, validation, and export.",
    "Unknown, invalid, absent, and unreadable values remain distinct.",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Typed Properties

## Why this exists

A field label alone cannot tell a database, export, or agent what a value means. Without durable types, dates become text and missing access becomes an innocent blank, quietly corrupting later work.

## Example workflow

Dara adds a place field, describes it, and sees the same typed value in property panel, database view, and export.

## Product contract

- Stored values and computed results both declare exact output types; presentation is a renderer choice, not a hidden data conversion.
- Descriptions and typed semantics are available to people, agents, queries, validation, and export.
- Unknown, invalid, absent, and unreadable values remain distinct.

## Boundaries and non-goals

- `content.property.constraints` owns validation/default behavior and `content.expression.language` owns computed semantics; Typed Properties own declared value/output types.
- A renderer may change presentation but cannot change stored meaning or coerce denied/invalid/absent states into a normal value.

## Acceptance stories

### Keep computed type

Given a date formula, when sorted/rendered/exported, then each consumer gets a declared date.

### Do not coerce absence

Given unreadable relation and blank text, then renderers keep them distinct.

## Current evidence

`shared/properties.ts`, `actions/configure-document-property.ts`, and `app/components/editor/DocumentProperties.tsx` are donors; formula output types are not durable general declarations.

## Proof plan

1. Create/query/render/export stored and computed types.
2. Propagate descriptions to UI/actions/agents/serialization.
3. Test absent, invalid, unreadable, unsupported values.
4. Compare UI/action validation.

## Open questions

Computed output taxonomy needs root judgment.
