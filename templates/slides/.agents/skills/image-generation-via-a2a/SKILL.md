---
name: image-generation-via-a2a
description: Generate slide images locally by default; use Assets over A2A only for a user-requested brand-library generation or an Assets-exclusive capability.
---

# Slide Image Generation

Generate images through Slides' local provider by default. Call Assets only when
the user asks for its brand library or the image requires an asset or capability
only Assets provides. Do not delegate because Assets is available or because a
deck has a linked design system. Set `useBrandLibrary: true` on
`generate-image-api` only for that explicit Assets need.

When `useBrandLibrary: true`, both entry points use the delegation helper in
`server/lib/assets-image-delegation.ts`:

1. **`generate-image-api`** — the action the agent and the editor's image panel
   use. With `useBrandLibrary: true`, it delegates to Assets, then returns `source: "assets-a2a"` with the
   Assets reply verbatim (plus `url` when a `previewUrl`/`downloadUrl` was
   parseable).
2. **`pnpm action generate-image`** — the CLI script, for local runs that want
   files on disk. Pass `--use-brand-library` to delegate; otherwise it uses the
   local provider.

The helper resolves Assets through agent discovery (target `assets`, which also
matches `images`), so a workspace with both apps mounted needs no configuration.
`IMAGES_A2A_URL` / `IMAGES_A2A_KEY` remain as overrides for standalone deploys
that point at a remote Assets instance.

## Outcomes

The helper distinguishes four outcomes, because "Assets did not return an
image" has very different right answers:

| Outcome | Meaning | What happens |
| --- | --- | --- |
| `delegated` | Task completed | Use the reply's `previewUrl` |
| `rejected` | Task ended `failed`/`canceled`/`input-required` | Surface the reason; do NOT silently generate locally |
| `pending` | Caller-side timeout; the Assets run is still going and owns a `taskId` | Tell the user to check Assets; generating again would duplicate the run |
| `unavailable` | Assets could not be resolved or reached at all | Local fallback |

A `delegated` reply can still say the generation is a draft pending approval.
That means the user may draft in that brand kit but not save into it: the image
is real and usable in the deck, and only the copy kept in Assets is waiting on a
kit editor. Use the image, pass that along, and do not retry or fall back
locally.

Only `unavailable` falls through to the local Gemini/OpenAI providers under
`server/handlers/image-providers/`, so a slides-only deploy still works. They
try the organization's Image generation provider first (the
`manage-service-providers` action), then Gemini, then OpenAI. That
output is **not** brand-grounded and the action says so: it returns
`source: "slides-fallback"` with a `fallbackReason`. Report that honestly
rather than presenting a fallback image as a library generation.

There is no direct Builder.io image-generation path in Slides. If a user asks
for Builder-managed generation, that belongs in Assets, behind the explicit
brand-library delegation.

## Brand-library generation

Only when the user asks for Assets' brand library or an Assets-exclusive
capability, call the action with `useBrandLibrary: true` and the destination:

```
generate-image-api { prompt, useBrandLibrary: true, deckId, slideId, slideContent }
```

For ordinary image generation, call `generate-image-api` without
`useBrandLibrary`; it uses the local provider and never contacts Assets.

For direct insertion, add `insertIntoSlide: true`. This requires both IDs and
only returns `inserted: true` after Slides writes the transformed HTML through
`update-slide` and re-reads it through `get-deck` with `compact=false` to find
the image source.
Never say the image was added based on `url`, `previewUrl`, or a completed
Assets reply alone. For preview-only variations, leave `insertIntoSlide` false;
after choosing one, use `update-slide` and verify the persisted source with
`get-deck` with `compact=false` before claiming insertion.

Do **not** reach for the generic `call-agent` tool to ask Assets for an image.
It talks to the same app, so it looks equivalent, but it skips the slide
grounding, the completed-vs-failed task handling, and the ready-to-render
preview markdown this action returns — which is how image results end up in
chat as bare links instead of visible images.

Slides owns the semantic job of the image: its slide role, audience, crop, and
must-preserve content. Assets owns library and preset selection, style anchors,
generation settings, and provenance. Include the active design system's
image-style guidance in the prompt context, but do not ask Assets to invent a
competing brand direction.

Use the returned `previewUrl` for previews. Do not drop it into slide HTML
without the verified insertion workflow above.

## Showing the result in chat

Always show a generated image as an inline markdown image:

```md
![Monstera deliciosa](https://…/preview.png)
```

The chat renders `![]()` as a real image but `[]()` as a bare link, so a
plain link (or a "View the photo" / "Open preview" link) leaves the user with
nothing to look at. Use the action's `url` field, or the `previewUrl` from the
Assets reply when the action could not parse one. This applies whether the
request came from the editor's image panel or from a plain chat message like
"generate a photo of a monstera".

When the user requests the Assets brand library, the delegation marks images
with `source: "a2a"` and `callerAppId: "slides"` in the Assets audit log.

## Multi-slide image generation

Do not fire parallel `add-slide` calls into the same deck. Keep deck writes
sequential: add one slide, wait for the result, then add the next slide. If a
single slide needs several image variants, the image-generation action may
request multiple variants internally, but the deck write itself should remain a
single `add-slide` or `update-slide` call.

## Iteration

When the user gives feedback on an Assets image, or explicitly asks for Assets
to refine it, call `refine-image` with the previous `assetId` (from its
`previewUrl`) and the new feedback. Replace only the affected slide image. Do
not delete the prior Assets asset; it stays in the library so the user can pick
which version to keep. For a locally generated image, keep refinement local.

## Cross-app reply parsing

The Assets reply comes back as plain text. Assets (per its `a2a-assets` skill)
includes `assetId`, `runId`, `previewUrl`, `downloadUrl`, and `embedPath` exactly
as returned by its actions. `extractAssetUrl` pulls the first `previewUrl` /
`downloadUrl` out of that reply; when it finds none, the action returns the reply
without a `url`.

If parsing the reply fails, surface "I couldn't parse the Assets agent's
response" to the user rather than guessing at URLs.
