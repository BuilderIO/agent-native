---
name: a2a-images
description: Call the Images agent from other agent-native apps to generate, refine, export, and insert brand images.
---

# A2A Images

Use A2A when another app needs brand imagery and Images owns the library.

## Caller Flow

1. Call `match-library` or `list-libraries` on the Images agent when the library
   is ambiguous.
2. Call `generate-image-batch` with one slot per destination, such as one hero
   per slide. Always pass `source: "a2a"` and `callerAppId` with the calling
   app id (`slides`, `design`, `content`, `mail`) so the Images audit log can
   group cross-agent generations.
3. Preserve returned `assetId`, `runId`, `previewUrl`, `downloadUrl`, and
   `embedPath` exactly.
4. Insert exported URLs into the caller's artifact.
5. On feedback, call `refine-image` with the prior `assetId`, `source: "a2a"`,
   and the same `callerAppId`, then replace only the affected destination.

## Audit Trail

Every Images generation writes an `image_generation_runs` row with the prompt,
compiled prompt, model, aspect ratio, references, source app, owner, org, status,
error, output assets, and refinement lineage. Design reviewers inspect this in
the Images `/audit` route or via `list-audit-runs` / `get-audit-run`.

## Preview Rules

Use same-origin `embed` fences only when the caller can render the Images route.
Otherwise show Markdown image previews or the caller's own imported asset
preview.
