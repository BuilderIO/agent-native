---
name: image-generation
description: Generate and refine brand-consistent images from libraries, references, and prior candidates.
---

# Image Generation

Use this skill before calling `generate-image`, `generate-image-batch`, or
`refine-image`.

## Rules

- Start from the current library. Call `view-screen` when the user says "this
  library" or "this image" and you need fresh IDs.
- Use category-tagged references. Blog heroes should prefer `hero`; diagrams
  should prefer `diagram`; product imagery should include `product` and `logo`
  references.
- Generate 2-4 candidates for open-ended requests. Use `generate-image-batch`
  with stable `slotId`s so the UI can show live slots.
- Show previews in chat. In Images, use `/asset/<assetId>/embed`; from another
  app, preserve the returned preview/download URLs exactly.
- Iterate with `refine-image --assetId`. Do not throw away a successful image
  and start over unless the user asks for a totally new direction.
- Cross-agent callers must pass `source: "a2a"` and `callerAppId` to
  `generate-image-batch` / `refine-image`. The design team uses the audit log
  to review quality by app, library, model, prompt, and lineage.

## Prompting

- Treat references as evidence, not decoration.
- Compile the style into a short brief: palette, composition, lighting, medium,
  typography policy, subject framing, and constraints.
- Avoid visible text unless explicitly requested. For diagrams, ask for clear
  hierarchy, exact label placement, consistent line weights, and whitespace.
- For exact logos, use the uploaded canonical logo path. The generation prompt
  should leave a clean area; the server composites the logo after generation.

## Completion

After generation, reply with asset IDs and previews. Ask whether to save,
iterate, or produce another direction.

Every generation is audit logged automatically. When a reviewer asks how images
are performing, use `navigate --view audit`, `list-audit-runs`, or
`get-audit-run`.
