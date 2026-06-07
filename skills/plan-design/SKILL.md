---
name: plan-design
description: >-
  Use Agent-Native Plans for full-fidelity UI design planning with a Design
  canvas tab and optional interactive Prototype tab before implementation.
metadata:
  visibility: exported
---

# Plan Design

Use `/plan-design` when the user needs a high-fidelity product design before
implementation: polished branded screens, realistic content, visual direction,
and interaction review. It is the full-fidelity companion to `/visual-plan` and
`/prototype-plan`: the top review surface should show `Design` and, when the
flow needs interaction, `Prototype`.

## When To Use

Use this for UI-heavy work where brand, visual hierarchy, polished layout, or
interaction feel are material to the decision. Skip it for small copy, spacing,
or obvious component changes.

## Research First

Before creating the plan:

1. Inspect the real app shell, routes, components, CSS variables, Tailwind
   tokens, theme files, and any relevant screenshots.
2. If `design.md` exists, treat it as the primary design brief and pass its
   important content into `create-plan-design.designMd`.
3. If a `.fig` local-copy file or parsed brand kit is available, use the
   Design/brand-kit parsing actions from the app or shared tooling first, then
   pass the extracted token summary into `brandKit`.
4. Parse existing codebase style info when possible: CSS custom properties,
   Tailwind config, global CSS, font declarations, spacing/radius tokens, and
   component conventions. Pass the compact evidence into `codebaseStyles`.
5. Ground every screen in actual product content. Avoid lorem ipsum, generic
   marketing filler, and placeholder gray boxes unless designing an explicit
   loading state.

## Create The Plan

Call `create-plan-design` with:

- `title`, `brief`, `repoPath`, and any `implementationNotes`.
- `designMd`, `brandKit`, `codebaseStyles`, or `designNotes` when available.
- `screens`: one to six full-fidelity HTML/CSS screen fragments. Each screen
  must include a bounded `html` fragment, optional scoped `css`, a `surface`,
  and stable `data-design-id` attributes on elements a reviewer might edit.
- `transitions` only when the Prototype tab should support true screen/step
  navigation. Use `data-goto="screen-id"` in the screen HTML for those controls.

The Design tab is the visual source of truth. The Prototype tab is for behavior
and should reuse the same visual styling where practical. Do not create a
separate design direction in the prototype.

## Full-Fidelity HTML Rules

- Write bounded fragments only: no `<html>`, `<head>`, `<body>`, `<script>`,
  `<style>`, external imports, iframes, SVG, or executable URLs.
- Put CSS in the screen `css` field. The renderer scopes it to the artboard.
- Use real CSS and CSS variables. Tailwind-like class names are fine only when
  the provided `css` defines them or the classes are harmless semantic hooks.
- Use `renderMode: "design"` on design screen data when authoring full
  structured content directly.
- Add `data-design-id="meaningful-name"` to editable elements such as hero
  panels, key buttons, cards, nav items, pricing rows, chart panels, and state
  chips. Keep ids stable and descriptive.
- Keep the design responsive within the selected surface. Text must not clip,
  overlap, or rely on viewport-sized type.

## Targeted Style Edits

When a reviewer selects an element in the Design tab or asks for a specific
style change, avoid regenerating the whole plan. Use:

```json
{
  "op": "update-design-element-style",
  "frameId": "frame-overview",
  "elementId": "primary-cta",
  "styles": {
    "background-color": "#0f766e",
    "border-radius": "10px"
  }
}
```

Use `frameId` for inline canvas designs or `blockId` for a referenced wireframe
block. Set a style value to `null` to remove it. Use `patch-wireframe-html` or
`patch-prototype-html` for text/content changes inside a fragment.

## Document Handoff

Below the visual surface, keep the document concise and implementation-oriented:
actual files and symbols, state/actions/contracts, open questions, risks, and
verification. The document should not repeat the same screens in prose.

Before implementation, call `get-plan-feedback` and treat comments, selected
element details, and recent review events as the source of truth.

## Related Skills

- `visual-plan`
- `ui-plan`
- `prototype-plan`
- `frontend-design`
