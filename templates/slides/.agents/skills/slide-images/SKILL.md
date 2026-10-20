---
name: slide-images
description: >-
  Source and generate images for slides. Use when a slide needs a new visual,
  logo, or approved media; use Assets only for its requested brand library or
  an Assets-exclusive capability.
---

# Slide Images

Images are generated through Slides' local provider by default. Use Assets only
when the user requests its brand library or an Assets-exclusive capability;
local images are not Assets-grounded or stored in its library.

When a chat attachment has an embeddable URL, add it to the current slide with
`update-slide` using `<img src="…">`, then call `view-screen` and re-read the
slide with `get-deck` to confirm it persisted.

## Scripts

| Script | Purpose | Example |
|--------|---------|---------|
| `generate-image` | Generate locally; use Assets only with `--use-brand-library` | `pnpm action generate-image --prompt "hero image" --count 3` |
| `search-images` | Search Google Images via the configured provider | `pnpm action search-images --q "Acme logo transparent" --count 5` |
| `search-logos` | Resolve company domains and canonical logo URLs | `pnpm action search-logos --q "Acme"` |
| `image-gen-status` | Check local image providers; Assets is opt-in | `pnpm action image-gen-status` |

## Image Generation Flow

For agent or editor generation, call `generate-image-api`, not a provider or
legacy image action directly:

1. Resolve the deck's active design system, its `imageStyle`, the current slide
   role, and any approved Creative Context references.
2. Call `generate-image-api` with the prompt plus bounded deck and slide
   context. It uses the local provider by default. Set `useBrandLibrary: true`
   only when the user requests Assets' library or an Assets-exclusive
   capability.
3. Show each returned variation as an inline rendered preview using markdown
   image syntax (`![Variation 1](url)`), not a plain link (`[Variation 1](url)`)
   — the chat renders `![]()` as an actual image but `[]()` as a bare link.
4. Preserve `assetId`, `runId`, `previewUrl`, and `downloadUrl` when Assets
   returns them.
5. For direct insertion, call `generate-image-api` with `insertIntoSlide: true`,
   `deckId`, and `slideId`. Only say the image was added when it returns
   `inserted: true`; a preview URL is not proof of a slide write. If it returns
   `inserted: false`, report the insertion error and keep using the returned
   image URL; do not regenerate solely because insertion failed.
6. For preview-only variations, place the chosen URL with `update-slide`, then
   re-read the deck with `get-deck` using `compact=false` and confirm the
   persisted HTML contains the image source before reporting success.
7. For feedback on an Assets image, refine the same asset. For a local image,
   keep refinement local and replace only the affected slide image.

### Context to pass

The image brief should include the visual role, subject, composition/crop,
format, must-preserve content, and exclusions. Pass `deckId`, `slideId`, and
`slideContent` so the local provider or requested Assets generation can use the
actual slide context. Do not use generic style references to override a linked
design system or preset.

`search-images` and `search-logos` remain bounded lookup tools for finding
existing media. They are not a substitute for the active design system or a
style-generation brief.

Treat both searches as optional enrichment. If a provider is unconfigured or
unavailable, a search has no matches, or an action returns an error, continue
the deck with a useful image-free slide using native typography, diagrams, or
rules. Keep the action error visible; do not retry the lookup in a loop or stop
deck generation because search failed.

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
- Never claim image insertion from a generation response alone; require the
  verified `inserted: true` response, or an `update-slide` plus `get-deck`
  `compact=false` verification for preview-only placement
