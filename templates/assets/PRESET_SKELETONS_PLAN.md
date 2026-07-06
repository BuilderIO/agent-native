# Plan: Preset Skeletons (subject-on-brand-background)

_Revised 2026-07-06. Re-anchored to current code; reconciled with the shipped
gpt-image-2 + Builder-managed image-generation path and verified against the
`air` image-generation service._

## Goal

Let a generation preset carry a **canonical skeleton** — a reusable branded
background layer (brand-gradient/solid/plate + logo + optional foreground chrome)
— and composite every generation made with that preset onto it as a **full-bleed
subject on the brand background**.

This is a direct generalization of the existing generate-then-composite logo
pipeline: today one logo layer is pasted over an opaque image; here the preset
owns an ordered layer stack (background → subject cutout → foreground) applied at
the same seam.

---

## What changed since the original plan (read this first)

The original plan assumed *"default model is Gemini; cutout must route to
gpt-image-2, which lives behind the manual OpenAI fallback; add
`background: 'transparent'` there."* That is no longer how the code is shaped:

1. **gpt-image-2 is now a first-class model** (`shared/api.ts:41`) and routes
   through the **Builder-managed provider**, not the manual OpenAI fallback.
   `toBuilderImageModel` passes `gpt-image-2` straight through
   ([generation.ts:915](server/lib/generation.ts#L915)), so a cutout request
   hits `generateWithRetryingBuilderImageApi` → the Builder `/generations`
   endpoint ([generation.ts:270-304](server/lib/generation.ts#L270)), **not**
   `generateWithOpenAI` ([generation.ts:778](server/lib/generation.ts#L778),
   which is only the BYOK fallback).

2. **Transparency is verified achievable but not yet exposed by the managed
   service.** In `../air/packages/service/image-generation`:
   - gpt-image-2 supports `background: opaque | transparent | auto`
     (verified in `gpt-image-2-integration-plan.md` against OpenAI docs).
   - The shipped OpenAI provider **does not send `background`**
     ([provider-openai.ts:85-105](../air/packages/service/image-generation/provider-openai.ts#L85)),
     so it defaults to OpenAI's `auto` — model-chosen, not guaranteed alpha.
   - The request schema **has no `background` field**
     ([schema.ts:44-77](../air/packages/service/image-generation/schema.ts#L44)),
     so the Assets app cannot request transparency through Builder today.
   - gpt-image-2 is capped to `["1:1","2:3","3:2"]`
     ([catalog.ts:42](../air/packages/service/image-generation/catalog.ts#L42)),
     which matches the Assets-side `MODEL_ASPECT_RATIOS`
     ([shared/api.ts:53](shared/api.ts#L53)).

3. **The preset editor page now exists.** The skeleton editor has a real home at
   `/brand-kits/:libraryId/presets/:presetId`
   ([app/routes/brand-kits.$id_.presets.$presetId.tsx](app/routes/brand-kits.$id_.presets.$presetId.tsx)),
   not just the create dialog. `update-generation-preset` already deep-merges an
   arbitrary `settings` JSON blob
   ([update-generation-preset.ts:76-84](actions/update-generation-preset.ts#L76)),
   so **prototyping `skeletonSpec` in `settings` needs zero backend/action
   change.**

**Net effect:** transparency is a *service capability question first, template
wiring second.* Two routes exist, and Phase 1 must pick one explicitly.

### The two transparency routes

- **Route A — managed (preferred).** Add `background` to the `air`
  image-generation service (schema + OpenAI passthrough), and forward it from the
  Assets Builder payload. Uses managed Builder credits; works for all users with
  Builder connected. Requires a cross-repo change in `air`.
- **Route B — BYOK fallback.** Set `background: "transparent"` directly in the
  template-owned `generateWithOpenAI`
  ([generation.ts:794-801](server/lib/generation.ts#L794)) and force cutout runs
  down the manual OpenAI path. No `air` change, but needs the user's own
  `OPENAI_API_KEY` and bypasses managed credits.

Recommended: build Route B first (fully in-template, unblocks the whole feature
and the compositor), then land Route A in `air` to make it work on managed
credits without a BYOK key.

---

## The seam

Everything hooks into the post-generation block at
[actions/generate-image.ts:476-491](actions/generate-image.ts#L476) — where
`compositeLogo` runs today. That block becomes `applyPresetSkeleton`. The
existing logo overlay (`resolvedIncludeLogo && library.canonicalLogoAssetId`)
becomes one `foreground` entry of the skeleton.

---

## Data model: `skeletonSpec`

Prototype it inside the preset `settings` JSON (no migration — the action already
round-trips `settings`). Graduate to an additive nullable `skeleton_spec` text
column once the shape settles (schema changes must be additive — never
drop/rename).

```ts
interface SkeletonSpec {
  // Background layer painted first (rendered locally with Sharp, NOT by the model).
  background:
    | { type: "gradient"; from: string; to: string; angle?: number } // colors default from styleBrief.palette
    | { type: "solid"; color: string }
    | { type: "asset"; assetId: string }; // uploaded brand plate

  // How the generated art is placed over the background.
  contentMode: "cutout" | "fill";
  // "cutout" = transparent subject composited full-bleed over background (the target intent)
  // "fill"   = opaque art dropped into an inset content window (framed look, no transparency needed)

  contentRegion?: { x: number; y: number; w: number; h: number }; // fraction 0..1; default full-bleed
  dropShadow?: boolean; // synth contact shadow under cutout so it doesn't read as a sticker

  // Foreground layers composited last (logo lockup, brand bar, safe-area, etc.)
  foreground?: Array<{
    source: "canonicalLogo" | { assetId: string };
    x: number; y: number; w: number; // fractions of canvas
  }>;
}
```

Design notes:
- Foreground references library brand tokens (`canonicalLogo`, palette) instead
  of hardcoding, so brand edits propagate.
- The existing `includeLogo` overlay becomes just one `foreground` entry. When a
  skeleton owns the logo, `includeLogo` must be a no-op to avoid double-paste
  (the seam currently always stamps at [generate-image.ts:478](actions/generate-image.ts#L478)).
- **The skeleton owns the *composite* canvas, not the model canvas.** The
  background is rendered locally at any aspect ratio; the *subject* is generated
  at a gpt-image-2-supported ratio (`1:1`/`2:3`/`3:2`) and then scaled into the
  `contentRegion`. Do **not** try to force the skeleton's arbitrary ratio onto
  the model — it will be rejected upstream (`unsupported_aspect_ratio`).

---

## Implementation phases

### Phase 0 — Verify & choose the transparency route (spike, ~no product code)

Already partly done (see "What changed"). Confirm which route ships first:
- If shipping **Route B** first: no `air` work; proceed to Phase 1 with the
  manual OpenAI path.
- If shipping **Route A**: land the `air` changes below before Phase 1 wiring so
  the managed path returns real alpha.

**Route A `air` changes** (`packages/service/image-generation`):
1. Add `background: z.enum(["opaque","transparent","auto"]).optional()` to
   `ImageGenerationRequestSchema` ([schema.ts:44](../air/packages/service/image-generation/schema.ts#L44)).
2. Pass it through in the OpenAI provider `images.generate`/`images.edit` calls
   ([provider-openai.ts:85-105](../air/packages/service/image-generation/provider-openai.ts#L85)),
   defaulting to `opaque`/undefined so existing behavior is unchanged. Gemini
   provider ignores it (no transparent output).
3. Ensure `outputFormat: "png"` when `background === "transparent"` (alpha
   requires png/webp).

### Phase 1 — Cutout (the target intent, smallest lift)

1. **Provider flag.** Add `background?: "transparent" | "opaque"` to
   `GenerateProviderInput` ([generation.ts:39-54](server/lib/generation.ts#L39)).
   - Route B: in `generateWithOpenAI` add `background: "transparent"` to the
     request body ([generation.ts:794-801](server/lib/generation.ts#L794)).
   - Route A: add `background` to the Builder `/generations` payload
     ([generation.ts:277-304](server/lib/generation.ts#L277)).
2. **Route cutout to a transparency-capable model & clamp aspect ratio.** When
   `skeletonSpec.contentMode === "cutout"`, steer the model to `gpt-image-2` (it
   still respects an explicit user model — prefer a clear error over a silent
   swap if the user picked a non-transparent model + cutout), and clamp the
   *subject* aspect ratio to `supportedAspectRatiosForModel("gpt-image-2")`
   ([shared/api.ts:56](shared/api.ts#L56)). Log the override. (Route B
   additionally forces the manual OpenAI path.)

   **Ordering matters — do NOT bolt this on after model resolution.** In the
   action, `resolvedAspectRatio` is computed at
   [generate-image.ts:264](actions/generate-image.ts#L264), *before*
   `resolvedModel` at [generate-image.ts:282](actions/generate-image.ts#L282),
   and it is then consumed by `compilePrompt`, `settingsUsed`, the
   `assetGenerationRuns` row, and the provider call. So: read
   `skeletonSpec`/`isCutout` from `presetSettings` first (parsed at
   [generate-image.ts:272](actions/generate-image.ts#L272)), then compute
   `resolvedAspectRatio` **with the gpt-image-2 clamp already applied** for
   cutout runs, and feed the cutout model choice into (or override the result
   of) `resolveImageModelForRequest`
   ([generation.ts:937](server/lib/generation.ts#L937)) in that same block —
   before any of those five consumers read the values.
3. **Background renderer.** New `renderBackground(spec, size)` in
   `image-processing.ts` — build a Sharp image from an SVG `<linearGradient>` /
   solid fill / decoded asset (colors from `spec.background` or
   `styleBrief.palette`) at the composite canvas size.
4. **Generalized compositor.** New
   `applyPresetSkeleton({ subject, spec, logo, canvasSize })` in
   `image-processing.ts`: background → subject (scaled to `contentRegion` or
   full-bleed) → optional contact shadow → foreground layers. Replaces the
   `compositeLogo` call at the seam; keep `compositeLogo`
   ([image-processing.ts:62](server/lib/image-processing.ts#L62)) as a thin
   wrapper so the legacy logo-only path stays a one-liner.
5. **Prompt envelope.** In `compilePrompt`
   ([generation.ts:1005](server/lib/generation.ts#L1005)) add a cutout
   instruction gated on cutout mode — *"Generate the subject in isolation on an
   empty background; no scenery, no baked-in ground or shadow"* — mirroring the
   existing `includeLogo` line at
   [generation.ts:1033](server/lib/generation.ts#L1033). Clean isolation → clean
   alpha.

### Phase 2 — Framed "fill" mode + Gemini fallback

6. **`contentMode: "fill"`** — opaque art dropped into an inset `contentRegion`,
   brand gradient shows as frame/margin. Needs no transparency, works with the
   default Gemini/managed path. Good for social/hero templates.
7. **Matting fallback** — optional pluggable `removeBackground()` step so Gemini
   runs can also do cutout (hosted matting API or self-hosted). Extra dependency
   + edge-quality risk; behind a flag.

### Phase 3 — Polish

8. Synthetic contact-shadow refinement (blur subject alpha, offset, opacity).
9. Skeleton preview + re-roll affordance for fringey cutouts (hair/glass) in the
   preset editor page.

---

## Four-area checklist (framework tenet)

- **UI** — skeleton editor on the **existing preset editor page**
  ([brand-kits.$id_.presets.$presetId.tsx](app/routes/brand-kits.$id_.presets.$presetId.tsx)):
  background picker seeded from palette, logo placement, content-mode toggle,
  live preview. (Not the create dialog.)
- **Actions** — no new fields required to prototype: `create-generation-preset` /
  `update-generation-preset` already accept an arbitrary `settings` blob
  ([update-generation-preset.ts:76-84](actions/update-generation-preset.ts#L76));
  add Zod validation for `skeletonSpec` shape. `applyPresetSkeleton` runs at the
  generate seam.
- **Skills** — extend `logo-composite` to cover skeletons, cutout mode, the
  gpt-image-2 transparency route, and the aspect-ratio clamp.
- **Application state** — preset selection already flows through generation
  state; ensure the skeleton is reflected in run metadata (`settingsUsed`).

---

## Constraints & gotchas

- **Transparency is a service capability, not just a prompt.** Managed path
  (Route A) requires the `air` schema + provider change above; BYOK path
  (Route B) needs an `OPENAI_API_KEY` and bypasses managed credits. Decide in
  Phase 0.
- **Cutout ties to gpt-image-2**, which supports **only** `1:1`, `2:3`, `3:2`.
  Generate the subject at a supported ratio; the skeleton background can be any
  ratio (rendered locally) and the subject is scaled into `contentRegion`.
- **Model routing is elaborate now** — the cutout override must slot after
  `resolveImageModelForRequest` and respect an explicit user/preset model rather
  than blindly forcing gpt-image-2.
- **Edge quality.** Solid subjects (product, character, icon) key cleanly;
  hair/glass/smoke fringe. Ship preview + re-roll.
- **"Pasted sticker" look.** Mitigate with the synthetic contact shadow.
- **Logo double-composite.** If the skeleton places the logo, suppress the legacy
  `includeLogo` overlay for that run.
- **Cost/latency.** Native transparency via managed credits is cheap once
  Route A lands; the BYOK fallback uses the user's OpenAI billing. A matting API
  (Phase 2) adds a call.
- **Flat only.** No perspective/curved-surface compositing (same limit the
  `logo-composite` skill already notes).
- **Additive schema only.** Prototype in `settings`; if promoting to a column,
  add nullable — never drop/rename.
