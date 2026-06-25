---
name: a2a-assets
description: Use Assets from other apps or MCP hosts to generate, refine, export, and insert brand images or videos.
---

# Assets MCP Tool

Use the Assets MCP tool surface when another app or external host needs brand
imagery, video, or reusable source media and Assets owns the library. Prefer the
pure MCP `generate-asset` flow for human-in-the-loop generation because it can
return the inline picker. A2A remains useful for unattended cross-app
delegation, but A2A replies cannot render MCP App pickers.

## Caller Flow

1. For human selection, call `generate-asset` with the brief, `callerAppId`, and
   `libraryId` when known. It will match the library, generate candidates, and
   return the Assets picker filtered to the new run IDs.
2. For unattended A2A-style work, call `match-library` or `list-libraries` when
   the library is ambiguous, then call `generate-image-batch` with one slot per
   destination, such as one hero per slide. Pass `source: "a2a"` and
   `callerAppId` with the calling app id (`slides`, `design`, `content`,
   `mail`) so the Assets audit log can group cross-agent generations.
3. Treat image batches as complete when the action returns. Use returned
   successful `images` entries directly; only regenerate slots that returned
   `ok: false`.
4. For social/blog/diagram slots, call `list-generation-presets` and pass the
   matching `presetId` so output rules travel with the run.
5. When a human designer needs to continue the work, create or update a
   generation session and preserve the returned `sessionId`.
6. For video, call `generate-video` and then `refresh-generation-run` until the run completes.
7. Preserve returned `assetId`, `runId`, `previewUrl`, `downloadUrl`, and
   `embedPath` exactly.
8. Insert chosen/exported URLs into the caller's artifact. Design callers should
   call `insert-asset` after the picker returns a selected asset.
9. On feedback, call `refine-image` with the prior `assetId`, `source: "a2a"`,
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
