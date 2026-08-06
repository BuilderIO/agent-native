---
name: slide-images
description: >-
  Source and generate images for slides with Assets-owned style grounding and
  provenance. Use when a slide needs a new visual, logo, or approved media.
---

# Slide Images

Images for slides are generated or sourced through the Slides actions and the
Assets app. The runtime agent must use the Assets-grounded path described below;
the local CLI is only a developer entry point.

## Scripts

| Script | Purpose | Example |
|--------|---------|---------|
| `generate-image` | Local helper for the Assets-grounded generation action | `pnpm action generate-image --prompt "hero image" --count 3` |
| `search-images` | Search Google Images via the configured provider | `pnpm action search-images --q "Acme logo transparent" --count 5` |
| `search-logos` | Resolve company domains and canonical logo URLs | `pnpm action search-logos --q "Acme"` |
| `image-gen-status` | Check configured image providers | `pnpm action image-gen-status` |

## Image Generation Flow

For agent or editor generation, call `generate-image-api`, not a provider or
legacy image action directly:

1. Resolve the deck's active design system, its `imageStyle`, the current slide
   role, and any approved Creative Context references.
2. Call `generate-image-api` with the prompt plus bounded deck and slide
   context. Assets chooses the library, preset, style anchors, model, and
   fallback behavior while preserving provenance.
3. Show each returned variation as an inline rendered preview using markdown
   image syntax (`![Variation 1](url)`), not a plain link (`[Variation 1](url)`)
   — the chat renders `![]()` as an actual image but `[]()` as a bare link.
4. Preserve the returned `assetId`, `runId`, `previewUrl`, and `downloadUrl`.
5. Insert the chosen image into the slide content through the normal action.
6. For feedback, refine the same asset rather than starting an unrelated run.

### Context to pass

The image brief should include the visual role, subject, composition/crop,
format, must-preserve content, and exclusions. Pass `deckId`, `slideId`, and
`slideContent` so Assets can ground the result in the actual slide. Do not use
generic style references to override a linked design system or preset.

`search-images` and `search-logos` remain bounded lookup tools for finding
existing media. They are not a substitute for the active design system or a
style-generation brief.

## Logo Lookup

Two options for company logos:

**Option 1: canonical logo search** (uses Logo.dev search when configured and a bounded domain fallback otherwise):
```bash
pnpm action search-logos --q "Acme"
```

Use a returned `logoUrl` directly. Do not call a second logo-provider action for
each result.

**Option 2: Google Image Search** (fallback):
```bash
pnpm action search-images --q "Acme logo transparent" --count 5
```

## Important Rules

- Use the active design system, library, preset, and approved style anchors for
  visual consistency; do not invent a second style language in the prompt
- Use `.fmd-img-placeholder` divs in slides before real images are generated
- Use one canonical provider action per conceptual search; do not loop legacy
  provider scripts or manually guess provider URLs
- After inserting an image, update the deck via the API
