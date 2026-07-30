---
record_type: "capability"
spec_version: 2
id: "content.renderer.typed"
name: "Typed renderers"
user_promise: "Compatible renderers present typed Content values consistently across surfaces while preserving meaning, accessibility, inheritance, and export fallback."
primary_user_job: "Choose or inherit a useful presentation for a typed value and still understand or export it when the preferred visual renderer is unavailable."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.property.typed"]
related_features:
  [
    "content.feature.see-your-information-your-way",
    "content.feature.build-new-surfaces",
    "content.feature.understand-what-your-data-says",
  ]
roadmap_boundary: "feature"
acceptance_summary: "Typed Renderers provide a registry that validates compatible presentations for typed values, resolves inherited choices predictably, and supplies accessible and export-safe fallbacks without changing query or relationship semantics."
proof_requirements:
  [
    "Typed renderer registry, compatibility checks, registration failure behavior, and stable renderer identity",
    "Inheritance and local override resolution across property, View, Block, embed, and output contexts",
    "Accessible semantic presentation, keyboard behavior, text alternatives, and degraded-runtime fallback",
    "Portable export, SSR or static output, unavailable-renderer behavior, and preservation of canonical typed values",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Typed renderers

## Why this exists

The same typed value may be useful as text, a badge, a date, a chart mark, a map point, or an accessible export summary. Without a shared compatibility and fallback contract, each surface invents a display rule and eventually treats a renderer failure as missing data. Typed Renderers make presentation reusable while leaving the underlying value and its meaning intact.

## Example workflow

A workspace uses a status renderer for a typed status Property in a table, card, and embedded record. A saved View locally overrides the renderer for a compact display without changing the Property’s value or other Views. When the record is exported to a static format where that renderer cannot run, Content emits a compatible text representation and accessible label. An incompatible renderer selection is rejected before it can produce a misleading display.

## Product contract

- A renderer has a stable identity, declared accepted typed inputs, presentation capabilities, semantic text alternative, and supported interactive, static, and export behaviors.
- The registry accepts only compatible renderer/value pairings. An unsupported or unavailable renderer returns a typed failure or compatible fallback; it never silently converts a value to empty content.
- Renderer selection resolves through explicit local override and inherited defaults. A View, Block, embed, or export context may choose a compatible presentation without mutating the canonical Property definition or typed value.
- Renderers present values; they do not own query evaluation, aggregation, relationship traversal, access decisions, or source synchronization. Those inputs arrive already authorized and typed.
- Every interactive renderer has keyboard and assistive-technology behavior appropriate to its semantic role. Every nontextual presentation provides a meaningful text alternative or accessible equivalent.
- Public, SSR, static, and export contexts use a compatible renderer or declared fallback from the same typed value. A rendering runtime failure is visible as a failure state where no safe fallback exists.
- Custom and built-in renderers use the same registry contract; registration does not create a second Action surface or grant access to values.

## Boundaries and non-goals

- `content.property.typed` owns value types, validation, and canonical storage. Typed Renderers own presentation compatibility, not coercion of an invalid stored value.
- Chart owns analytical specifications and drill-down; Graph owns relationship exploration; Canvas owns spatial arrangement. This Capability supplies their common presentation substrate only.
- Mermaid remains an authored code renderer. Typed Renderers do not define a diagram language, query syntax, semantic edge model, or analytics engine.
- This Capability does not make every renderer universally applicable, bypass access control, duplicate source data, or turn a visual fallback into proof that interactive behavior worked.

## Acceptance stories

### Reject incompatible presentation honestly

Given a renderer that accepts numeric measures and a text Property, when a person selects that renderer, then Content rejects the incompatible pairing with repair guidance and preserves the existing typed value and renderer choice.

### Inherit without rewriting the source

Given a Property default renderer and a saved View with a compatible local override, when the View is rendered beside another View, then each uses its resolved presentation while both retain the same canonical value and Property identity.

### Keep information available when a renderer cannot run

Given an export or static context where an interactive renderer is unavailable, when the value is rendered, then Content uses its declared compatible fallback with accessible text. If none exists, it shows a distinct unavailable-renderer state rather than blank content.

### Preserve authorization at the input boundary

Given a renderer used by a Chart, Graph, or embedded View, when the viewer lacks access to part of the input, then the renderer receives only the authorized typed result and cannot expose omitted values through labels, summaries, or fallback output.

## Current evidence

The repository already identifies typed properties and several presentation surfaces, and individual renderer implementations may be reusable donor substrate. No evidence currently proves one registry, cross-surface inheritance, accessible degradation, export behavior, and failure handling as an atomic capability. This Capability remains `approved_shape`.

## Proof plan

1. Register built-in and custom renderer fixtures, validate accepted input types and capabilities, and verify incompatible, missing, and runtime-failure states.
2. Resolve defaults and overrides across Properties, Views, Blocks, embeds, dashboards, and export contexts without mutating canonical values.
3. Test interactive keyboard behavior, semantic roles, accessible names, text alternatives, reduced-capability modes, and assistive-technology reading paths.
4. Render compatible static, SSR, and export outputs; verify declared fallbacks and distinct unavailable states when no fallback exists.
5. Exercise Charts, Graphs, Canvas, and ordinary Properties with access changes to prove renderers cannot widen their typed authorized input.

## Open questions

Registry storage, extension packaging, renderer sandboxing, and the exact inheritance precedence are implementation choices. They must retain stable renderer identity, explicit compatibility, accessible fallback, and the separation from query and relationship semantics.
