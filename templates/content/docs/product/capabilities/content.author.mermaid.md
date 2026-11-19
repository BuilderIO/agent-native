---
record_type: "capability"
spec_version: 2
id: "content.author.mermaid"
name: "Mermaid diagrams"
user_promise: "Insert a diagram as ordinary Mermaid source and read a faithful rendered diagram when possible."
primary_user_job: "Create portable Mermaid diagrams from ordinary Code source."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.author.code", "content.renderer.typed"]
related_features: []
roadmap_boundary: "supporting"
acceptance_summary: "`/Diagram (Mermaid)` creates a normal Code block with `language = mermaid`; the built-in renderer provides Source and Rendered views, source round trips, accessible/static fallback, and shared export behavior."
proof_requirements:
  [
    "Mermaid is a Code language plus built-in renderer, not a Custom Block or a separate diagram datastore.",
    "The renderer may prefer an Agent-Native style but falls back to faithful Mermaid; errors preserve source and diagnostics.",
    "Public and exported documents never execute source and use a pinned static rendering or readable source fallback.",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Mermaid diagrams

## Why this exists

A diagram should remain editable, portable source rather than becoming a picture that only one editor understands. Authors also need an honest fallback when a renderer does not support the diagram they wrote.

## Example workflow

Noor uses `/Diagram (Mermaid)`, edits its ordinary Code source, and exports a diagram that either renders faithfully or retains source and error.

## Product contract

- Mermaid is a Code language plus built-in renderer, not a Custom Block or a separate diagram datastore.
- The renderer may prefer an Agent-Native style but falls back to faithful Mermaid; errors preserve source and diagnostics.
- Public and exported documents never execute source and use a pinned static rendering or readable source fallback.

## Boundaries and non-goals

- `content.author.code` owns source and optional runtime behavior; Mermaid owns a compatible built-in renderer for `language = mermaid`.
- Mermaid is not a Custom Block, graph database, Canvas replacement, or a license to execute diagram source for viewers.

## Acceptance stories

### Preserve Code identity

Given an imported fenced Mermaid file, when re-exported, then it remains `language = mermaid` Code, not a Custom Block.

### Try compatible fallbacks

Given preferred styling fails, when rendering, then Mermaid fallback runs before source/error display.

## Current evidence

`app/components/editor/extensions/CodeBlockNode.tsx` keeps Code identity and draws `language = mermaid` blocks through `MermaidCodeBlockView.tsx`, which reuses the toolkit Mermaid renderer (Excalidraw style, then plain Mermaid, then source and error). At rest the block shows only the drawing; clicking it, or Enter on the selected block, opens the source above a live drawing, and Escape or Done closes it. Unreadable source stays open beside its error. `mermaid-code-block.spec.ts` covers the rest view, Enter and Escape, arrow selection, the error path, read-only drawing and the plain code fallback; `nfm-editor.roundtrip.test.ts` covers the fence round trip. Public pages turn drawing off and show source, so they never run it; a pinned static rendering for public pages and exports, and SSR, remain gaps.

## Proof plan

1. Create/import Mermaid blocks and verify fences/captions.
2. Test preferred, Mermaid, and double-failure paths.
3. Verify sanitizer, theme, accessibility, SSR, and static export.
4. Confirm no Custom Block catalog entry.

## Open questions

Renderer Auto versus explicit preference remains open.
