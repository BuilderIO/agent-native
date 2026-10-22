# Restyling slides and copying a look across the deck

## Style edits

For a request that changes appearance and nothing else — colors, borders,
shadows, background — send `edits` that change only the requested CSS
declarations, and leave text, element order, and layout properties (padding,
margin, gap, font-size, line-height, dimensions, positioning) as they are:

```jsonc
{
  "deckId": "...",
  "slideId": "...",
  "edits": [
    {
      "find": "background:#111111",
      "replace": "background:#f4f0e8",
      "occurrence": 1,
    },
  ],
}
```

Deck palettes usually live in `--deck-*` variables on the `.fmd-slide`
wrapper; change the variable (`--deck-muted: #647968`) rather than every
element that uses it.

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
   wrapper's own value.
2. Send one `patch-deck` call carrying every affected slide, each as a
   `patch-slide` with `edits: [{"find":"...","replace":"...","occurrence":1}]`
   for the declarations that change, then verify once with `get-deck` using the
   same `slideIds` and `compact=false`. Edits apply to the current HTML and need
   no `baseContentHash`; regenerating full `fields.content` for a color swap
   costs tens of seconds per slide.

Use `update-slide` for a focused single-slide edit or when a person is actively
editing and the smaller scoped mutation matters.

Either way, change only the `.fmd-slide` wrapper's background. Interior card
fills, image backgrounds, and gradients are separate visual elements; leave them
alone unless the user asked for those too. A slide whose wrapper carries no
background declaration needs one added to the wrapper's `style`, not a
find/replace against a declaration that is not there.

After restyling, check text contrast and fit once with `audit-contrast` and
`get-layout-overflows` together.
