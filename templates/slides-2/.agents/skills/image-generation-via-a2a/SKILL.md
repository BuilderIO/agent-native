---
name: image-generation-via-a2a
description: When a slides deck needs images, delegate to the Assets app over A2A so generations are grounded in the user's brand library — never call an image-generation API directly from slides.
---

# Image generation via A2A

Slides never calls an image-generation API itself when Assets is reachable.
Assets owns brand libraries, presets, provenance, and the generation audit log,
so every improvement there has to reach decks for free.

Both entry points share one delegation helper,
`server/lib/assets-image-delegation.ts`:

1. **`generate-image-api`** — the action the agent and the editor's image panel
   use. It delegates to Assets, then returns `source: "assets-a2a"` with the
   Assets reply verbatim (plus `url` when a `previewUrl`/`downloadUrl` was
   parseable).
2. **`pnpm action generate-image`** — the CLI script, for local runs that want
   files on disk. Same delegation, prints the reply verbatim.

The helper resolves Assets through agent discovery (target `assets`, which also
matches `images`), so a workspace with both apps mounted needs no endpoint
configuration. Standalone deployments may provide `IMAGES_A2A_KEY` as a static
transport credential; user and organization credentials still take precedence.

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

There is no direct Builder.io image-generation path in slides. If a user wants
Builder-managed generation, that belongs in Assets, behind the same delegation.

## Calling explicitly from the agent

Call the action with the destination so Assets can ground the generation:

```
generate-image-api { prompt, deckId, slideId, slideContent }
```

For direct insertion, add `insertIntoSlide: true`. This requires both IDs. The
action registers the image in the deck asset collection, then saves
source-backed slides through `update-slide-source` using the current revision
and source hash. Legacy HTML slides use `update-slide` with the registered asset
URL. It only returns `inserted: true` after reading the saved source or HTML back
and verifying the image.
Never say the image was added based on `url`, `previewUrl`, or a completed
Assets reply alone. For preview-only variations, leave `insertIntoSlide` false;
after the user chooses one, call `generate-image-api` with `generatedImageUrl`
set to the chosen preview URL, `insertIntoSlide: true`, the target IDs, and the
original prompt. Do not write the remote preview URL into source or derived
HTML directly.

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

The delegation message already instructs Assets to mark generations with
`source: "a2a"` and `callerAppId: "slides"` when it calls `generate-image-batch`
or `refine-image`. That keeps the Assets audit log useful for design review.

## Multi-slide image generation

Do not fire parallel `add-slide` calls into the same deck. Keep deck writes
sequential: add one slide, wait for the result, then add the next slide. If a
single slide needs several image variants, the image-generation action may
request multiple variants internally, but the deck write itself should remain a
single action call. Use `generate-image-api` for image insertion; it routes
source-backed slides through revision-checked `update-slide-source` and legacy
HTML slides through `update-slide`.

## Iteration

When the user gives feedback ("make slide 3's hero darker, more navy"), ask Assets to run `refine-image` with the previous `assetId` (extracted from the `previewUrl` returned earlier) plus the new feedback. Import the refined preview through `generate-image-api` with `generatedImageUrl` and `insertIntoSlide: true` so it becomes a registered asset and source-backed slides use revision-checked edits. Do **not** delete the prior asset — it stays in the library so the user can pick which version to keep.

## Cross-app reply parsing

The Assets reply comes back as plain text. Assets (per its `a2a-assets` skill)
includes `assetId`, `runId`, `previewUrl`, `downloadUrl`, and `embedPath` exactly
as returned by its actions. `extractAssetUrl` pulls the first `previewUrl` /
`downloadUrl` out of that reply; when it finds none, the action returns the reply
without a `url`.

If parsing the reply fails, surface "I couldn't parse the Assets agent's
response" to the user rather than guessing at URLs.
