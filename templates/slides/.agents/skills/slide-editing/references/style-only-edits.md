# Style-only edits and copying a look across the deck

## Style-Only Edits

For a request that changes appearance and nothing else — colors, borders,
shadows, background — set `styleOnly: true` on `update-slide`.

`styleOnly` accepts the structured `edits` array and nothing else. `fullContent`
and the top-level legacy `find` / `replace` / `objectId` fields are rejected in
this mode, so even a single replacement goes as one `edits` entry:

```jsonc
{
  "deckId": "...", "slideId": "...", "styleOnly": true,
  "baseContentHash": "<contentHash from get-deck>",
  "edits": [
    { "find": "background:#111111", "replace": "background:#f4f0e8", "occurrence": 1 }
  ]
}
```

The action then rejects any result that changes text, markup, element order, or
protected layout CSS (padding, margin, gap, font-size, line-height, dimensions,
positioning), so the edit can only move the declarations you targeted.

Use `occurrence: 1` rather than `expectedMatches: 1` when a declaration may
appear more than once on the slide: the `edits` path refuses an ambiguous
literal outright, so `expectedMatches` turns a repeated declaration into a
rejection instead of an edit. Reach for `all: true` when every occurrence on
that slide really should change.

`objectId` is not a style-edit target. It replaces an element's inner content
and leaves the element's own `style` attribute untouched, so it cannot move the
declaration you are usually after.

### Copying one slide's look onto the rest of the deck

"Make every slide match slide 1" is a deck-wide restyle, so it goes through
**one `patch-deck` call** with a `patch-slide` operation per slide. Do not fan
out one `update-slide` per slide: that is the batching the agent instructions
rule out, and because the calls issue in parallel, a mistake in the first one
repeats across all of them before any rejection comes back.

1. Read the reference and targets together: use one `get-deck` call with
   `slideIds` and `compact=false` when their IDs are known, or one full-deck
   `compact=false` read when they are not. Take the reference background from
   its `.fmd-slide` wrapper — not a child. `deckStyle` summarizes the whole
   deck, including interior gradients, so it is not a substitute for the
   wrapper's own value. Keep each returned `contentHash` with its exact HTML.
2. Send one `patch-deck` call carrying every affected slide and its matching
   `baseContentHash`, then verify once with `get-deck` using the same `slideIds`
   and `compact=false`.

Set `styleOnly: true` on each CSS-only content operation. `patch-deck` enforces
that text, markup, element order, and protected layout CSS stay unchanged, and
rejects stale per-slide hashes before writing. For content or structural edits,
omit `styleOnly` and include the complete intended slide HTML. Use
`update-slide` for a focused single-slide edit or when a person is actively
editing and the smaller scoped mutation matters.

When a person is actively editing the deck or making a focused change, use
`update-slide` with `baseContentHash` to keep the write scoped to that slide.

Either way, change only the `.fmd-slide` wrapper's background. Interior card
fills, image backgrounds, and gradients are separate visual elements; leave them
alone unless the user asked for those too. A slide whose wrapper carries no
background declaration needs one added to the wrapper's `style`, not a
find/replace against a declaration that is not there.
