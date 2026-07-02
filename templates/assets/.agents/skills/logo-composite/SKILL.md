---
name: logo-composite
description: How the generate-then-composite pipeline puts a pixel-perfect canonical logo onto a generated image without letting the LLM regenerate the logo.
---

# Logo composite

LLMs — including Gemini Pro — degrade complex logos. They smear gradients, drop text, and rearrange elements. The Assets app sidesteps this entirely with a **generate-then-composite** pipeline that every serious brand-imagery system uses today.

## How it works

1. The library has a `canonicalLogoUrl` (set via `set-canonical-logo --libraryId --assetId`). The asset's role is `logo_reference`.
2. **Logo compositing is a preset option.** A generation preset carries `includeLogo` (stored in the preset `settings` and surfaced as a first-class field). When a generation resolves to a preset with `includeLogo: true`, `generate-image` composites the logo. A generate call's own `includeLogo` arg, when passed, overrides the preset for that run; when omitted, the preset's value wins.
3. When logo compositing is on, the prompt envelope adds:
   > Leave a clean uncluttered area in the upper-right for the real brand logo; do not draw or approximate the logo yourself.
4. Gemini returns an image with empty space in that corner.
5. `compositeLogo()` from `server/lib/image-processing.ts` (Sharp) loads the canonical logo PNG / SVG, resizes it to ~16% of the image width with reasonable inset, and composites it onto the generated image.
6. Output: the image with the actual logo, pixel-perfect, vector-quality if the source is SVG.

## When to use it

- The user turned on "Composite canonical logo" when creating a generation preset (the preset then stamps the logo on every image made with it).
- The agent infers the user wants the logo for a one-off (e.g. "make a hero with our brand logo") — pass `includeLogo: true` on that single generate call to override the preset.
- The image will appear in a customer-facing context where logo accuracy matters.

## When NOT to use it

- **Logo on a product** (a t-shirt mockup, a billboard scene, a coffee cup).
  Compositing onto a flat corner is fine; compositing onto a curved or perspective surface needs mask-based inpainting that Gemini doesn't expose. v2 will use OpenAI `gpt-image-1`'s edit API for this. v1: tell the user to mock that up in design.
- **Multi-logo scenes** (a partner-logo wall, a footer sponsor row). Same reason. v2.

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
