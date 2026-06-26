---
name: image-generation
description: Generate and refine brand-consistent images from libraries, references, and prior candidates.
---

# Image Generation

Use this skill before calling `generate-image`, `generate-image-batch`, or
`refine-image`.

## Rules

- Start from composer `@` mentions when the user tags generation inputs.
  `brand-kit` references map to `libraryId`, `preset` references map to
  `presetId`, and `media-type` references choose image generation versus video
  generation. Call `view-screen` when the user says "this library" or "this
  image" and you need fresh IDs. The image model may default from the composer
  image-model picker; all other generation settings should be explicit action
  args, preset values, or action schema defaults.
- Use category-tagged references. Blog heroes should prefer `hero`; diagrams
  should prefer `diagram`; product imagery should include `product` and `logo`
  references.
- Keep reference sets small and deterministic. Prefer anchors listed in
  `assetLibraries.settings.canonicalStyleAssetIds` and assets marked
  `assets.metadata.isStyleAnchor` before sampling other relevant references.
- Honor library custom instructions. They are persistent prompt guidance and
  should be updated when the user wants durable generation behavior.
- Generate the selected candidate count for open-ended requests, usually 2-4.
  Use `generate-image-batch` with stable `slotId`s so the shared generation tray
  can show live slots.
- `generate-image` and `generate-image-batch` are synchronous for images. One
  batch call should produce the requested candidates and return their asset
  IDs/URLs; do not follow it with `get-generation-run`,
  `refresh-generation-run`, or more generation unless the user asks for another
  direction or the returned slot has `ok: false`.
- For repeatable deliverables, honor a `preset` @mention as `presetId` or call
  `list-generation-presets` when choosing one. Pass the preset through
  `generate-image`, `generate-image-batch`, `refine-image`, or
  `rerun-generation-run`.
- For designer handoff, preserve `sessionId` and call
  `update-generation-session` after each new candidate so the active asset,
  feedback, and run lineage stay resumable.
- Show previews in chat. In Assets, use `/asset/<assetId>/embed`; from another
  app, preserve the returned preview/download URLs exactly.
- Iterate with `refine-image --assetId`. Use `edit-image` for targeted edits
  and `restyle-image` when the user wants to preserve a subject image while
  applying library style. Pass `subjectAssetId`, `styleStrength`, and `tier`
  when they matter.
- Use quality `tier` values intentionally: `fast` for exploration, `best` for
  final/high-value output, and `auto` when there is no clear preference.
- Cross-agent callers must pass `source: "a2a"` and `callerAppId` to
  `generate-image-batch` / `refine-image`. The design team uses the audit log
  to review quality by app, library, model, prompt, and lineage.

## Prompting

- Treat references as evidence, not decoration.
- Let the server choose references unless the user named exact assets. Automatic
  generation uses up to 6 relevant current references, seeded by canonical
  style anchors; explicit `referenceAssetIds` are preserved.
- If a collection's style feels underspecified, call `analyze-collection-style`
  and use its vision brand analysis for palette, composition, lighting, subject
  treatment, typography policy, and constraints.
- Compile the style into a short brief: palette, composition, lighting, medium,
  typography policy, subject framing, custom instructions, and constraints.
- For short vague prompts, enhance conservatively with library context while
  preserving the user's exact text as `originalPrompt`.
- Avoid visible text unless explicitly requested. For diagrams, ask for clear
  hierarchy, exact label placement, consistent line weights, and whitespace.
- For exact logos, use the uploaded canonical logo path. The generation prompt
  should leave a clean area; the server composites the logo after generation.
- Do not describe brand QA scoring or best-of-N selection as available yet.

## Completion

After generation, reply with asset IDs and previews. Ask whether to save,
iterate, or produce another direction.

When the user says a designer should pick up the work, create a generation
session with `create-generation-session`, including the active `assetId`,
relevant `runId`s, `presetId`, and the feedback summary. Use
`prepare-generation-session-continuation` to open a new chat with the handoff
context preloaded.

Every generation is audit logged automatically. When a reviewer asks how images
are performing, use `navigate --view audit`, `list-audit-runs`, or
`get-audit-run`.

Use `rerun-generation-run` to rerun the original prompt and settings from an
older generation against the latest library style brief, custom instructions,
collection data, and deterministic references.
