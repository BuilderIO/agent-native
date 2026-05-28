---
name: a2a-assets
description: Call the Assets agent from other agent-native apps to generate, refine, export, and insert brand images or videos.
---

# A2A Assets

Use A2A when another app needs brand imagery, video, or reusable source media and Assets owns the library.

## Caller Flow

1. Call `match-library` or `list-libraries` on the Assets agent when the library
   is ambiguous.
2. Call `generate-image-batch` with one slot per destination, such as one hero
   per slide. Always pass `source: "a2a"` and `callerAppId` with the calling
   app id (`slides`, `design`, `content`, `mail`) so the Assets audit log can
   group cross-agent generations.
3. For social/blog/diagram slots, call `list-generation-presets` and pass the
   matching `presetId` so output rules travel with the run.
4. When a human designer needs to continue the work, create or update a
   generation session and preserve the returned `sessionId`.
5. For video, call `generate-video` and then `refresh-generation-run` until the run completes.
6. Preserve returned `assetId`, `runId`, `previewUrl`, `downloadUrl`, and
   `embedPath` exactly.
7. Insert exported URLs into the caller's artifact.
8. On feedback, call `refine-image` with the prior `assetId`, `source: "a2a"`,
   and the same `callerAppId`, then replace only the affected destination.

## Audit Trail

Every Assets generation writes an `image_generation_runs` row with the prompt,
compiled prompt, model, aspect ratio, references, source app, owner, org, status,
error, output assets, and refinement lineage. Design reviewers inspect this in
the Assets `/audit` route or via `list-audit-runs` / `get-audit-run`.

## Preview Rules

Use same-origin `embed` fences only when the caller can render the Assets route.
Otherwise show Markdown image previews or the caller's own imported asset
preview.
