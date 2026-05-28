---
name: asset-generation
description: >-
  Use Assets for brand-safe image or video generation, human picker UI,
  search/list/export actions, and cross-app asset selection.
metadata:
  visibility: both
---

# Asset Generation

## Rule

Use the Assets app when a workflow needs reusable brand media, a human picker,
or generated image/video assets that another app can reference by ID and URL.

## Choose The Path

- Use `open-asset-picker` when a person should browse, search, generate, and
  select an asset in UI. Pass `mediaType: "image"` by default, or
  `mediaType: "video"` for video libraries.
- Use unattended actions when the agent already knows what to do:
  `search-assets`, `list-assets`, `generate-image`, `generate-image-batch`,
  `generate-video`, `refresh-generation-run`, and `export-asset`.
- Use generation presets when the user asks for a repeatable output format
  like social image, blog hero, or diagram. Call `list-generation-presets` for
  the library and pass `presetId` through generation/refinement actions.
- Use generation sessions when another person needs to continue improving a
  candidate. Sessions carry the brief, preset, active asset, feedback, and run
  IDs without requiring the original chat thread.
- Use chat-driven `restyle-image` and `edit-image` for preserving subjects,
  applying library style, and making targeted changes. Do not surface separate
  restyle, edit, or quality-tier buttons in host UIs.
- Use browser/deep-link fallback when the host cannot render MCP Apps inline.
  Surface the returned picker link instead of inventing a separate UI.

## Image Workflows

1. Pick or match the library with `list-libraries` or `match-library`.
   If the user wants a default look rather than a brand library, call
   `list-library-presets` and then `create-library-from-preset`; the resulting
   library is editable and reusable like any other library.
2. For one asset, call `generate-image`; for multiple independent slots, call
   `generate-image-batch` with stable `slotId` values.
3. For preset-backed work, pass `presetId`; for handoff work, pass `sessionId`.
4. Let the server choose a small deterministic reference set unless the user
   named exact assets. Canonical style anchors come from
   `assetLibraries.settings.canonicalStyleAssetIds` and
   `assets.metadata.isStyleAnchor`.
5. Pass `tier: "fast"` for exploration, `tier: "best"` for final/high-value
   output, or `tier: "auto"` when there is no clear preference.
6. Preserve returned `assetId`, `runId`, `previewUrl`, and `downloadUrl`.
7. Use `refine-image` for feedback on an existing asset, `edit-image` for
   targeted changes, and `restyle-image` with `subjectAssetId` and
   `styleStrength` for subject-preserving brand restyles.
8. If a designer will take over, call `create-generation-session` or
   `update-generation-session`, then `prepare-generation-session-continuation`
   when they want a chat preloaded with the session context.

For short vague prompts, enhance conservatively with library style context while
preserving the user's original prompt in run metadata. Use
`analyze-collection-style` when a collection needs upgraded vision brand
analysis before generation. Brand QA scoring and best-of-N selection are
deferred.

## Video Workflows

1. Call `generate-video` with `16:9` or `9:16` and relevant image references.
2. Poll `refresh-generation-run` until the run completes and returns a video
   asset.
3. Use `export-asset` when another app needs a download URL or artifact type.

## Cross-App Use

- Hosted default: connect `https://assets.agent-native.com/_agent-native/mcp`.
  Do not put shared secrets in skill files.
- Local customization: run `agent-native app-skill launch --local` from the
  Assets app-skill manifest, or pass `--into <path>` for editable source.
- For A2A or MCP callers, include exact `assetId`, `runId`, media type, and
  URLs in the final response so the caller can attach or embed the media.
  Include `presetId` and `sessionId` when present.

## Don't

- Do not call image/video providers directly from another app.
- Do not treat `images` as the app identity; the app id is `assets`.
- Do not use picker UI for unattended generation when direct actions are enough.
- Do not use copyrighted screenshots or named studio/brand image sets as preset
  references. Use broad textual guidance and user-provided references instead.
