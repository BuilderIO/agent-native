---
record_type: "capability"
spec_version: 2
id: "content.author.math"
name: "Math and equations"
user_promise: "Write an equation inline or as a block and have it stay intelligible everywhere I read or export it."
primary_user_job: "Create equations that remain readable across representations."
kind: "primitive"
state: "in_progress"
publicness: "public"
availability: "universal"
dependencies: ["content.object.block", "content.renderer.typed"]
related_features: []
roadmap_boundary: "supporting"
acceptance_summary: "Inline and display math use one editable source value with KaTeX rendering, accessible MathML, visible invalid-source fallback, and source/export parity."
proof_requirements:
  [
    "Inline selection can become an equation and reopen the same source editor.",
    "Invalid math preserves visible source and a diagnostic instead of disappearing or looking valid.",
    "Math remains a built-in Block identity and is not a Custom Block.",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Math and equations

## Why this exists

An equation is both source a writer must correct and meaning a reader must understand. Rendering cannot be allowed to hide malformed notation or make one surface silently disagree with another.

## Example workflow

A scientist selects `E = mc^2`, corrects LaTeX in the inline equation editor, and exports readable math; invalid source stays visible with its error.

## Product contract

- Inline selection can become an equation and reopen the same source editor.
- Invalid math preserves visible source and a diagnostic instead of disappearing or looking valid.
- Math remains a built-in Block identity and is not a Custom Block.

## Boundaries and non-goals

- The typed renderer substrate owns presentation; Math owns equation source, inline/display authoring, and accessible fallback.
- Math is a built-in Block capability, not a Custom Block, arbitrary code executor, or a new formula language.

## Acceptance stories

### Show invalid source

Given malformed LaTeX, when KaTeX rejects it, then the source and diagnostic stay visible.

### Preserve one value

Given copied math is read in editable and read-only surfaces, then both derive from the same LaTeX.

## Current evidence

`app/components/editor/MathRenderer.tsx`, `math-rendering.spec.ts`, `MathRenderer.test.tsx`, and `SlashCommandMenu.tsx` prove KaTeX, MathML, and creation; public/export parity remains unjoined.

## Proof plan

1. Test selection promotion, slash insertion, source editing, and display mode.
2. Assert MathML and invalid fallback in SSR/client output.
3. Copy/paste, source-round-trip, and provider-sync equations.
4. Verify HTML/PDF rendering or fallback.

## Open questions

No product question remains; surface proof is pending.
