---
record_type: "capability"
spec_version: 2
id: "content.preset.catalog"
name: "Presets"
user_promise: "Understand that older preassembled configurations now live as inspectable Templates rather than a competing product type."
primary_user_job: "Follow historical Preset lineage to its Template successor."
kind: "primitive"
state: "superseded"
publicness: "public"
availability: "universal"
dependencies: ["content.template.graph"]
related_features: []
roadmap_boundary: "superseded"
acceptance_summary: "Presets are superseded by Multi-object Templates: governed preassembled ordinary primitives continue through the Template graph and governance contracts with no alternate hidden engine."
proof_requirements:
  [
    "All new reusable-system work belongs to content.template.graph and its governance/update capabilities.",
    "A former preset must remain inspectable as ordinary Pages, Databases, Views, Properties, Rules, expressions, and bodies.",
    "This record preserves lineage only and does not create a second catalog or migration requirement.",
  ]
evidence: []
superseded_by: "content.template.graph"
last_reviewed: "2026-07-29"
---

# Presets

## Why this exists

Historical Preset terminology can mislead people into looking for a separate engine that no longer exists. The lineage needs to remain legible while all real reuse work proceeds through Templates.

## Example workflow

A team follows a legacy Preset link to its Template graph lineage and adopts a Template version rather than creating a Preset instance.

## Product contract

- All new reusable-system work belongs to content.template.graph and its governance/update capabilities.
- A former preset must remain inspectable as ordinary Pages, Databases, Views, Properties, Rules, expressions, and bodies.
- This record preserves lineage only and does not create a second catalog or migration requirement.

## Boundaries and non-goals

- `content.template.graph`, Template governance, and Template updates own every successor workflow; this record preserves only the historical mapping.
- Presets do not retain a separate catalog, instance type, mutation surface, or migration engine.

## Acceptance stories

### Preserve lineage only

Given historical Preset provenance, when a person opens the legacy entry, then the record points to Template successor and exposes no Preset mutation action.

### Use Template updates

Given an old configuration changes, when its owner reviews it, then Template pinning, diff, selective apply, and detach govern it.

## Current evidence

`docs/product/architecture.md` and `content.template.graph.md` define the successor; no separate Presets implementation is intended.

## Proof plan

1. Resolve historic links to Template records.
2. Confirm no separate Preset discovery/mutation engine.
3. Exercise inspection/adoption/update through Template contracts.
4. Preserve legacy provenance in export/history.

## Open questions

No product question remains.
