---
name: image-generation
description: >-
  Generate and refine brand-consistent images from libraries, references, and
  prior candidates. Use before calling image-generation or refinement actions.
---

# Image Generation

Use this skill before calling `generate-image`, `generate-image-batch`, or
`refine-image`.

## Prompt contract

Treat references as evidence, not decoration. The prompt should explain the
asset's job, subject, framing, medium, lighting, palette, exact text policy,
and what must not change. Keep the active library or preset's style brief and
the caller's design-system constraints authoritative; Impeccable-style
composition guidance may improve the result but must not replace them.

Before generating, decide whether the slot needs a produced image, a direct
reuse of an approved asset, or a semantic UI/icon/diagram owned by the caller.
Do not use image generation to paper over missing product facts, customer
evidence, screenshots, or exact logos.

## Rules

- Start from composer `@` mentions when the user tags generation inputs.
  `brand-kit` references map to `libraryId`, `preset` references map to
  `presetId`, and `media-type` references choose image generation versus video
  generation. Call `view-screen` when the user says "this library" or "this
  image" and you need fresh IDs. The image model may default from the composer
  image-model picker.
- A tagged `@preset` (presetId) owns `aspectRatio`, `imageSize`, `model`,
  `tier`, and `category`. When a preset is set, do NOT pass those args yourself —
  leave them out so the preset's saved values are used. You cannot see the
  preset's settings from the presetId, so passing your own guess silently
  overrides the preset (this is the usual cause of a preset's aspect ratio being
  ignored). Pass one of these args alongside a preset ONLY when the user
  explicitly asks for a value that differs from the preset. When there is no
  preset, set them explicitly or rely on the action schema defaults.
- Use category-tagged references. Blog heroes should prefer `hero`; diagrams
  should prefer `diagram`; product imagery should include `product` and `logo`
  references.
- Imported external images with `status: "reference"` are valid generation
  inputs. Use their returned asset IDs in preset reference fills or reference
  boards the same way you would use uploaded reference assets.
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

## Composer Mentions And Tagged Presets

- Composer `@` mentions are the source of generation inputs. Map `brand-kit`
  references to `libraryId`, `preset` references to `presetId`, and `media-type`
  references to choosing image (`generate-image` / `generate-image-batch`) or
  video (`generate-video`) generation.
- The current library view auto-tags its brand kit as a visible removable chip,
  and the generation preset editor auto-tags both its brand kit and preset.
- The image model is the only remaining composer-side default; the image-model
  picker writes `imageGenerationModel`, which image generation actions may use
  when `model` is omitted.
- When a `preset` is tagged, the server embeds that preset's aesthetics and
  creative philosophy (brand style brief, prompt template, text/logo policy,
  output format) into your message inside a `<tagged-generation-presets>` block.
  Study and internalize that brief before you generate — let it drive
  composition, mood, lighting, and subject — then pass the `presetId` to
  `generate-image` / `generate-image-batch` so the saved format/model/tier/logo
  apply automatically. Do not restate those as ad-hoc args.

## Preset-first Generation

- Image requests without a tagged preset are preset-first: the user may not know
  presets exist. Compare the request against each preset's title, description,
  and category, and if one matches the use case (e.g. "livestream poster" -> a
  Livestream Announcement preset), generate with its `presetId` instead of
  ad-hoc settings. Only generate presetless when nothing plausibly matches.
- Before any ad-hoc generation for a brand kit, call
  `list-generation-presets` and scan titles/descriptions/categories for a
  use-case match. A preset encodes the designer's format, model, layout, and
  reference board; using it is always better than improvising.
- If one preset clearly matches: use its `presetId`; do not restate its saved
  aspect ratio/size/model/tier. If several plausibly match: pick the best and
  state which one you used; do not ask the user to choose.
- Match named people/products/backdrops in the request to the preset's
  reference board entry labels in `settings.presetReferences`. Fill required
  variable entries via `presetReferenceFills`: search the library for assets of
  those people first; ask the user for photos only when none exist. Never skip a
  required entry.
- Route exact visible copy such as event titles, dates, and times to
  `embeddedText` per the existing text rules; keep the creative direction in
  `prompt`.
- For exact visible copy inside a generated image, pass `embeddedText` and
  optional `textPlacement` to `generate-image` or each `generate-image-batch`
  slot. Keep the general `prompt` for creative direction; the structured text
  fields are what allow the pipeline to render copy instead of suppressing it.
- If nothing matches: generate ad-hoc, say that no preset fit, and mention a
  preset could be created for this recurring use case.

## Prompting

- Treat references as evidence, not decoration.
- Let the server choose references unless the user named exact assets. Automatic
  generation uses up to 6 relevant current references, seeded by canonical
  style anchors; explicit `referenceAssetIds` are preserved.
- Preset reference boards live on tagged presets as named entries such as a
  usual host, product, backdrop, style sample, or per-event speaker. Fixed
  entries attach automatically. Variable entries may be replaced for a run with
  `presetReferenceFills`; each fill REPLACES that entry's pinned images rather
  than appending. Required variable entries block generation until you provide
  at least one image.
- When a tagged preset brief names required variable references, collect the
  needed images from the user's attachments or the library and pass
  `presetReferenceFills: [{ referenceId, assetIds }]` to `generate-image` or
  `generate-image-batch`. Board images are additive to brand style references.
  User-uploaded per-event people/photos should be uploaded as content images
  (`subject` intent/role), not as reusable brand style references.
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
