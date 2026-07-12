---
name: logo-composite
description: How the generate-then-composite pipeline puts a pixel-perfect canonical logo onto a generated image without letting the LLM regenerate the logo.
---

# Logo composite

LLMs — including Gemini Pro — degrade complex logos. They smear gradients, drop text, and rearrange elements. The Assets app sidesteps this entirely with a **generate-then-composite** pipeline that every serious brand-imagery system uses today.

## How it works

1. The library has a `canonicalLogoUrl` (set via `set-canonical-logo --libraryId --assetId`). The asset's role is `logo_reference`.
2. **Logo compositing is a preset option.** A generation preset carries `includeLogo` (stored in the preset `settings` and surfaced as a first-class field). When a generation resolves to a preset with `includeLogo: true`, `generate-image` composites the logo. A generate call's own `includeLogo` arg, when passed, overrides the preset for that run; when omitted, the preset's value wins.
3. **Preset skeletons generalize logo compositing.** A preset can also carry `settings.skeletonSpec`: background first, generated subject second, foreground layers last. If the skeleton already has a `foreground` layer with `source: "canonicalLogo"`, `includeLogo` is treated as a no-op for that run so the logo is not stamped twice. If the skeleton does not include the logo and `includeLogo` is true, the existing canonical-logo layer is appended at the default upper-right position during compositing.
4. When logo compositing is on, the prompt envelope adds:
   > Leave a clean uncluttered area in the upper-right for the real brand logo; do not draw or approximate the logo yourself.
5. Gemini returns an image with empty space in that corner.
6. `compositeLogo()` from `server/lib/image-processing.ts` (Sharp) loads the canonical logo PNG / SVG, resizes it to ~16% of the image width with reasonable inset, and composites it onto the generated image. Skeleton runs use `applyPresetSkeleton()` at the same seam.
7. Output: the image with the actual logo, pixel-perfect, vector-quality if the source is SVG.

## Preset skeletons

`settings.skeletonSpec` is the prototype storage shape:

```ts
{
  background: { type: "asset"; assetId: string };
  mask?: { type: "asset"; assetId: string };
  contentMode: "fill" | "cutout";
  contentRegion?: { x: number; y: number; w: number; h: number };
  dropShadow?: boolean;
  foreground?: Array<{
    source: "canonicalLogo" | { assetId: string };
    x: number;
    y: number;
    w: number;
  }>;
}
```

- The background is an uploaded or selected brand-library image asset. The compositor cover-fits it to the preset canvas and throws if the asset pixels are unavailable.
- `fill` drops an opaque generation into the content region, so it works through the normal managed provider path.
- When the resolved skeleton model is `gpt-image-2`, the action sends a managed edit/inpaint request instead of generate-then-composite: the uploaded plate is the `edit_target`, an optional same-size `mask` asset becomes the editable-area mask, and `maskFromPlateAlpha()` is only the fallback when no manual mask is set. Transparent mask pixels are editable, opaque pixels are sent as preserved regions, and the returned image is final. The manual mask or plate fallback must have transparent pixels.
- Other `cutout` skeletons ask for an isolated transparent subject, force `gpt-image-1`, attach the background plate as a `background_reference`/composition reference, request `background: "transparent"` through the managed Builder image provider, and only fall back to OpenAI BYOK when the managed provider fails. They clamp only the provider subject ratio to `1:1`, `2:3`, or `3:2`. The final skeleton canvas still uses the preset's requested aspect ratio.
- The prompt envelope for cutout mode asks for an isolated subject on an empty transparent background. The gpt-image-2 inpaint branch instead asks the model to render the requested foreground content inside the mask's transparent/open region while preserving logos, text, framing, and other opaque plate content.
- Background and foreground `assetId` values must belong to the selected brand kit and must be images.

## When to use it

- The user turned on "Composite canonical logo" when creating a generation preset (the preset then stamps the logo on every image made with it).
- The agent infers the user wants the logo for a one-off (e.g. "make a hero with our brand logo") — pass `includeLogo: true` on that single generate call to override the preset.
- The image will appear in a customer-facing context where logo accuracy matters.

## When NOT to use it

- **Logo on a product** (a t-shirt mockup, a billboard scene, a coffee cup).
  Compositing onto a flat corner is fine; compositing onto a curved or perspective surface needs mask-based inpainting. Use a gpt-image-2 skeleton plate with transparent editable regions when that exact layout is required.
- **Multi-logo scenes** (a partner-logo wall, a footer sponsor row). Same reason: use a prepared plate plus mask-inpaint skeleton, or ask the user to mock it up in design.

## Setting a canonical logo

```
upload reference image (role: logo_reference, category: logo) →
set-canonical-logo --libraryId=<id> --assetId=<asset-id>
```

`set-canonical-logo` flips the asset's role to `logo_reference` AND its status to `reference`. This means the reference selector won't pick up generated logo candidates as canonical — only intentionally pinned uploads.

## Sharp composite parameters (current defaults)

In `image-processing.ts:compositeLogo()`:

- Logo width: `max(120, round(imageWidth * 0.16))` — ~16% of the image, but never smaller than 120 px.
- Inset: `max(24, round(min(width, height) * 0.035))` — ~3.5% of the smaller dimension, but never less than 24 px.
- Position: upper-right (`top: inset`, `left: width - logoWidth - inset`).
- Output format: PNG (preserves transparency).

If you change these, also update the corresponding language in the prompt envelope ("upper-right") so the LLM's clean area aligns with where Sharp will composite.

## Why not in-image text?

The same logic applies to body and headline text. Image models still smear small letters and rearrange long strings. The Assets app's prompt envelope explicitly says:

> Do not render headlines, body text, UI labels, or prompt wording inside the image unless the user explicitly asks for exact visible text.

Overlay text in HTML/CSS in the calling app (slides, design, mail) — it's more reliable, more accessible, and the user can edit it without re-running the generation.

## Failure modes & detection

- Gemini ignores the placeholder ask and renders something in the corner. The composite still works, but the hand-drawn-looking element underneath will peek out behind a transparent logo. Fix: re-roll, or ask the user to crop.
- The canonical logo's transparency is lost on a non-PNG source. Fix: re-upload as PNG; SVG works too via Sharp's rasterization.
- The user swaps a logo mid-generation. The action reads `canonicalLogoAssetId` at generate time, so racing here is rare; but the variant slot will reflect whichever logo was current when the call landed.
