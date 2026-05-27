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
- Use browser/deep-link fallback when the host cannot render MCP Apps inline.
  Surface the returned picker link instead of inventing a separate UI.

## Image Workflows

1. Pick or match the library with `list-libraries` or `match-library`.
2. For one asset, call `generate-image`; for multiple independent slots, call
   `generate-image-batch` with stable `slotId` values.
3. Preserve returned `assetId`, `runId`, `previewUrl`, and `downloadUrl`.
4. Use `refine-image` for feedback on an existing asset.

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

## Don't

- Do not call image/video providers directly from another app.
- Do not treat `images` as the app identity; the app id is `assets`.
- Do not use picker UI for unattended generation when direct actions are enough.

