---
name: image-generation-via-a2a
description: When a slides deck needs hero images, delegate to the agent-native Images app over A2A so generations are grounded in the user's brand library — instead of generating in-process with the slides-app generic Gemini path.
---

# Image generation via A2A

The slides app's `generate-image` script has two paths:

1. **A2A delegation to the Images app** — preferred when `IMAGES_A2A_URL` (and ideally `IMAGES_A2A_KEY` or a shared `A2A_SECRET`) is configured. The Images app maintains brand libraries with reference images, palette, and style brief; every generation grounds in the user's chosen library.
2. **Direct Gemini provider** — fallback. Uses the slides app's generic `DEFAULT_STYLE_REFERENCE_URLS` and the user's GEMINI/OPENAI key. Works without the Images app, but generations are off-brand by default.

`templates/slides/actions/generate-image.ts` checks `IMAGES_A2A_URL` first; on success it returns the A2A reply verbatim. On any failure (network, timeout, blocked) it falls through to the direct provider — slides keeps working standalone.

## When to use which path

You don't get to choose at the action layer — the script picks based on env. But you should know:

- Workspace deploys with both `slides` and `images` apps mounted should always have A2A configured. Nothing else is needed from the slides agent's side.
- Standalone slides deploys (no Images app) fall through automatically.

## Calling explicitly from the agent

When generating images for slides, call:

```
pnpm action generate-image --prompt "..." --deck-id <id> --slide-id <id>
```

If A2A is configured, the script delegates and prints the Images agent's reply (which contains `previewUrl`, `downloadUrl`, `embedPath`). Parse those URLs out of the reply and drop the `previewUrl` into the slide HTML's `<img src="...">`.

The Images agent must mark delegated generations with `source: "a2a"` and
`callerAppId: "slides"` when it calls `generate-image-batch` or `refine-image`.
That keeps the Images audit log useful for design review.

## Multi-slide image generation

Do not fire parallel `add-slide` calls into the same deck. Keep deck writes
sequential: add one slide, wait for the result, then add the next slide. If a
single slide needs several image variants, the image-generation action may
request multiple variants internally, but the deck write itself should remain a
single `add-slide` or `update-slide` call.

## Iteration

When the user gives feedback ("make slide 3's hero darker, more navy"), call the Images A2A `refine-image` skill with the previous `assetId` (extracted from the `previewUrl` returned earlier) plus the new feedback. Replace only the slide-3 `<img src="...">` with the new URL. Do **not** delete the prior asset — it stays in the library so the user can pick which version to keep.

## What about the existing slides path?

It's preserved on purpose. If a workspace runs slides without images, generation still works — it just uses the slides app's generic style references instead of a curated library. Don't delete the direct path; it's our fallback.

## Cross-app reply parsing

The Images A2A reply comes back as plain text in the `callAgent` return value. The Images agent (per its `a2a-images` skill) is instructed to include `assetId`, `runId`, `previewUrl`, `downloadUrl`, and `embedPath` exactly as returned by the action. Look for those keys in the reply text (they're typically formatted as a structured paragraph or JSON block).

If parsing the reply fails, surface "I couldn't parse the Images agent's response" to the user rather than guessing at URLs.
