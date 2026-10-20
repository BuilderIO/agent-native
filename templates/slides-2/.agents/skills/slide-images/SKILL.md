---
name: slide-images
description: >-
  Source and generate images for slides with Assets-owned style grounding and
  provenance. Use when a slide needs a new still image, logo, or approved
  image asset.
---

# Slide Images

Images for slides are generated or sourced through the Slides actions and the
Assets app. The runtime agent must use the Assets-grounded path described below;
the local CLI is only a developer entry point.

This skill covers still images, not video generation. For video, upload MP4 or
WebM through the visual editor's asset browser, then use `list-assets` with
`media: "video"` or `media: "all"` to find the uploaded `assetId` (`list-assets`
defaults to images). Use that ID in an uploaded `asset://` handle in the
source-backed React `<video>` element. Read `slide-editing/references/video.md`
for insertion, poster, and revision-checked source-update guidance. Do not
invent remote video URLs or pass video through image-generation actions.

When a chat attachment has an HTTPS image URL, import and insert it through
`generate-image-api` with `generatedImageUrl`, `insertIntoSlide: true`, the
target `deckId` and `slideId`, and a short descriptive prompt. The action
registers the image and uses revision-checked source edits for source-backed
slides; never write a remote image URL directly into slide source or derived
HTML.

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
5. For direct insertion, call `generate-image-api` with `insertIntoSlide: true`,
   `deckId`, and `slideId`. The action registers the image in the deck asset
   collection, then uses `update-slide-source` with its revision and hash for
   source-backed slides. Only say the image was added when it returns
   `inserted: true`; a preview URL is not proof of a slide write.
6. For preview-only variations, after the user chooses one call
   `generate-image-api` with `generatedImageUrl` set to that preview URL,
   `insertIntoSlide: true`, the target `deckId` and `slideId`, and the original
   prompt. This registers the chosen image and follows the same source-safe
   insertion path; do not put a remote preview URL into slide source or derived
   HTML directly.
7. For feedback, refine the same asset rather than starting an unrelated run.

### Context to pass

The image brief should include the visual role, subject, composition/crop,
format, must-preserve content, and exclusions. Pass `deckId`, `slideId`, and
`slideContent` so Assets can ground the result in the actual slide. Do not use
generic style references to override a linked design system or preset.

`search-images` and `search-logos` remain bounded lookup tools for finding
existing media. They are not a substitute for the active design system or a
style-generation brief.

Treat both searches as optional enrichment. If a provider is unconfigured or
unavailable, a search has no matches, or an action returns an error, continue
the deck with a useful image-free slide using native typography, diagrams, or
rules. Keep the action error visible; do not retry the lookup in a loop or stop
deck generation because search failed.

## Logo Lookup

Search the public SVGL catalog with `search-svgl-logos`. Choose the light or
dark route when a result provides variants, then call `import-svgl-logo` with
that returned route and title. Pass `deckId` to save it to a deck; omit it for
the global asset collection. Import validates the download and stores it through
the existing SVG sanitizer. It returns an `assetId` but does not place the logo
on a slide. Import requires configured upload storage; if it returns
`image_upload_storage_unavailable`, use the storage setup flow instead of
retrying the import. For agent edits, read the target with `get-slide-source`,
insert the uploaded `asset://` handle through `update-slide-source` using its
revision and source hash, then read the source back. Never put the remote SVGL
URL directly in slide source.

Other company-logo searches use the following options:

**Option 1: canonical logo search** (uses Logo.dev search when configured and a bounded domain fallback otherwise):
```bash
pnpm action search-logos --q "Acme"
```

For insertion, pass a returned `logoUrl` to `generate-image-api` as
`generatedImageUrl` with the target slide IDs and `insertIntoSlide: true`; do not
write the remote URL directly into slide source or derived HTML. Do not call a
second logo-provider action for each result.

**Option 2: Google Image Search** (fallback):
```bash
pnpm action search-images --q "Acme logo transparent" --count 5
```

## Asset Library

Use `list-assets` to find an image by its `assetId`. When selecting media for an
existing deck, include its `deckId` with global scope so results are limited to
assets the deck can use. Call `update-asset` with `filename` to rename it, or
with `replacementId` to replace its stored image while preserving the original
ID and slide references. The replacement must be another uploaded image from
the same user's global collection. Do not delete the original before the
replacement action succeeds.

## Important Rules

- Use the active design system, library, preset, and approved style anchors for
  visual consistency; do not invent a second style language in the prompt
- Use `<ImagePlaceholder label="..." />` in generated `sourceTsx` slides and
  `.fmd-img-placeholder` divs only in legacy HTML slides
- Use one canonical provider action per conceptual search; do not loop legacy
  provider scripts or manually guess provider URLs. Import selected remote
  images through `generate-image-api`, or SVGL logos through `import-svgl-logo`,
  before inserting them.
- Never claim image insertion from a generation response alone; require the
  verified `inserted: true` response. Source-backed slides must use registered
  `asset://` handles and revision-checked `update-slide-source` writes.
