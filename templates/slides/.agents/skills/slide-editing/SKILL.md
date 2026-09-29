---
name: slide-editing
description: >-
  Edit individual slides, including content formatting, HTML styling, and
  bounded source and visual-fidelity checks. Use when changing an existing
  slide rather than creating a new deck.
---

# Slide Editing

Slides are HTML content stored inside the deck JSON. Each slide's `content`
field is a self-contained HTML string rendered at the intrinsic dimensions for
its aspect ratio: 16:9 is 960x540, 1:1 is 1080x1080, 9:16 is 540x960, and 4:5
is 864x1080. These canonical dimensions come from the shared aspect-ratio
registry; do not assume a fixed 1920x1080 canvas.

## Slide HTML Structure

Every slide uses the same `--deck-*` wrapper contract. What changes is where
those values come from.

**A design system is linked** - inherit its tokens:

```html
<div class="fmd-slide" style="--deck-bg: var(--ds-bg); --deck-ink: var(--ds-text); --deck-muted: var(--ds-text-muted); --deck-accent: var(--ds-accent); --deck-surface: var(--ds-surface); --deck-heading-font: var(--ds-heading-font); --deck-body-font: var(--ds-body-font); --deck-radius: var(--ds-radius); background: var(--deck-bg); color: var(--deck-ink); padding: 64px 80px; display: flex; flex-direction: column; justify-content: flex-start; font-family: var(--deck-body-font);">
  <!-- Slide content here -->
</div>
```

**No design system is linked** - write the deck's chosen values as literals:

```html
<div class="fmd-slide" style="--deck-bg: #10261C; --deck-ink: #F2EFE6; --deck-muted: #A8B8AC; --deck-accent: #7FB069; --deck-surface: rgba(255,255,255,0.05); --deck-heading-font: 'Fraunces', Georgia, serif; --deck-body-font: 'Inter', sans-serif; --deck-radius: 4px; background: var(--deck-bg); color: var(--deck-ink); padding: 64px 80px; display: flex; flex-direction: column; justify-content: flex-start; font-family: var(--deck-body-font);">
  <!-- Slide content here -->
</div>
```

The renderer publishes `--ds-bg` from the slide's own background, and nothing
else, when no system is linked. Every other `var(--ds-*, ...)` reference
resolves to its fallback, so an unlinked deck that inherits instead of baking
renders as unstyled browser defaults. Bake the values.

## Styling Rules

These are fallback defaults only. When a design system is linked, its hydrated
tokens control color, typography, spacing, borders, imagery, and slide defaults;
a reference deck controls composition and markup idiom only. The generic
Impeccable-inspired quality bar can flag hierarchy, contrast, density, and
anti-pattern issues, but it cannot replace the active system.

When no system is linked, establish one deck-level contract before changing a
slide: choose a subject-appropriate background family, text and surface roles,
one accent treatment, a heading/body type pairing, spacing scale, radius, and
image treatment. Express those choices as the same semantic `--deck-*` values
on every slide wrapper. Keep the canvas, type system, and palette fixed across
the deck while varying composition and information hierarchy. Never alternate
light and dark slides or introduce a new font/palette for a single slide unless
the user explicitly asks for it. Use semantic roles for labels, headings,
body, rules, and surfaces; avoid decorative card grids, gradient text, glass
panels, fake logos, and filler bullets.

## Fit and Density

Fit the main content to the native content area, not merely to the outer
wrapper. For the default 16:9 canvas, the standard `64px 80px` padding leaves
800x412px. Keep titles to two lines, content slides to three short bullets or
three compact cards, and two-column slides to two or three short items per
column. If the source is denser, split it across slides. Never use zoom,
`transform: scale()`, clipping, or scroll overflow to hide a fit issue; body
text must remain at least 16px. Explicitly reduced slide padding is allowed when
the content still needs the space.

## Updating a Slide

To edit a slide's content:

1. **Inspect the current context**: call `view-screen` to get the active deck,
   slide ID, HTML, and any `slides-selection` style/edit target.
   For a focused replacement or translation of currently selected text, if the
   result includes a matching exact `selectedText` range and `currentSlideId`, skip
   `get-deck` and go directly to the bounded `update-slide` edit below.
   For a targeted persisted read, pass that stable `slideId` to `get-deck` so
   only the target slide is returned; use `compact=false` when you need its
   full HTML.
2. **Retrieve before generating**: when the edit changes facts, brand language,
   or layout, follow the `creative-context` skill and query those roles
   separately. Respect opt-out, pinned packs, and the exact reuse ladder.
3. **Modify the content** HTML string for the intended slide. Preserve an
   approved native template or component when it already fits; generate
   net-new structure only when the relevant corpus is empty.
4. **Update the slide** with `update-slide` using `deckId`, `slideId`, and
   ordered `edits`. When `view-screen` returns an exact `selectedText` range,
   edit immediately: send one literal replace with the selected text as
   `find`, `expectedMatches: 1`, and `currentSlideContentHash` as
   `baseContentHash`; do not load the full deck, use `fullContent`, or wait
   for layout-fit. If the text is truncated, ambiguous, contains markup that
   prevents a literal match, or the edit is structural, use targeted
   `get-deck` first, use its `contentHash` as `baseContentHash`, then read
   back. For code-style work, request `compact=false` and `format=true`. Use
   exact replace, insert before/after, replace between markers, or regex
   replace. All edits are
   applied in memory under the deck lock; if one required edit fails, nothing is
   written. Set `format=true` on `update-slide` to persist readable Prettier
   line breaks. Use `fullContent` only for an intentional full rewrite - do not
   regenerate a slide to make a small change. Do not write deck rows directly
   or add raw full-deck writes; use `patch-deck` for browser/editor changes.
   Read a write back with `get-deck` (or a thumbnail's `.slide-content`
   `textContent`), never `document.body.innerText`: sidebar thumbnails use
   `content-visibility: auto`, so `innerText` is empty for them in a hidden
   tab, and the canvas only ever shows the selected slide.
5. For browser/editor code, enqueue granular deck operations through
   `patch-deck` / `DeckContext.tsx` instead of replacing the whole deck JSON.

   For a deck-wide restyle such as "beautify this", report only what the write
   actually returned. `patch-deck` lists genuinely changed slides in
   `updatedSlideIds` and byte-identical ones in `unchangedSlideIds`; a slide in
   `unchangedSlideIds` was not edited and must not be described as restyled.
   `update-slide` fails with `slide_edit_noop` for the same reason. Both
   reject a batch in which nothing changed, so re-read those slides and send
   different content rather than narrating a summary the deck does not show.

6. For factual edits, compare changed text against the retrieved source and
   preserve quote, speaker, date, metric, and uncertainty status. Existing HTML
   or visual similarity is not proof of source fidelity.

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

## Skipping a Slide

Set a slide's `skipped: true` via a `patch-deck` `patch-slide` operation to
exclude it from Present/Presenter playback without deleting it — the slide
stays in the deck, editor, and exports. Set `skipped: false` (or omit it) to
include it again. The rail's right-click menu on each slide thumbnail offers
Cut, Copy, Paste, Delete, New slide, Duplicate slide, and Skip slide as the
same operations.

## Click-to-reveal animations

Animations are metadata over the final slide HTML, not alternate slide markup.
Read the full target slide, keep its existing visual structure, and patch the
complete ordered `animations` list with `elementPath` values from that exact
HTML. Elements omitted from the list remain visible immediately, so labels and
headings need no duplicate markup. Do not add hidden duplicates, layout
spacers, absolute-positioned copies, transforms, or placeholder content to
simulate reveals. When content and reveals change together, send both fields in
one `patch-deck` operation. To remove reveals, send `animations: []` with the
existing content and verify the persisted slide afterward.

Array order is reveal order, and each entry needs a non-empty `id`, a 0-based
`elementIndex`, and a `type` of `appear`, `fade`, `slide-up`, or `zoom`; the
schema rejects the operation otherwise. Nothing checks that ids are unique, but
the editor keys its reveal list by id, so a duplicate makes "remove" and
"change type" hit every entry sharing it.

`elementPath` has to come from the exact final HTML because it is positional:
every segment is a child index, so inserting or removing a sibling anywhere
along the path retargets it. The runtime resolves the path first and falls back
to `elementIndex` only when it fails to resolve, which is why a stale path
silently reveals the wrong element instead of erroring. `get-deck` with
`compact=true` reports each step's order, id, target, and type for verification.

If retrieval produces a new immutable context pack, keep its `contextPackId`
and reuse labels with the deck provenance. Existing slide HTML is not proof of
which source version influenced it.

## Freeform Canvas Objects

Manual text boxes and other freeform canvas objects are absolutely positioned
children of `.fmd-slide`. Give each one a stable `data-slide-object-id`:

```html
<div
  class="fmd-text-box"
  data-slide-object-id="slide-object-unique-id"
  style="position: absolute; left: 160px; top: 120px; width: 420px;"
>
  Editable text
</div>
```

- Preserve `data-slide-object-id` when updating, moving, resizing, or styling an
  existing object.
- Mint a new unique object ID when duplicating an object.
- Do not use runtime-only `data-builder-id` values in saved slide HTML.
- Keep generated flex and grid content in normal flow. Do not silently
  absolute-position a nested layout child just to make it draggable; create a
  deliberate freeform object instead.
- Build editable shapes with styled HTML elements such as `div`. Do not use
  inline SVG, which the slide sanitizer removes.

## Image Placeholders

For visual elements (diagrams, charts, photos), use placeholder divs:

```html
<div class="fmd-img-placeholder" style="width: 100%; height: 300px; border-radius: 12px;">
  Description of the image
</div>
```

Never try to recreate complex visuals with raw HTML/CSS. Use placeholders and generate proper images via the image generation flow.

## Slide Layouts

Common layout patterns:

- **Title slide**: Single centered heading, `justify-content: center`
- **Section divider**: Large single word, centered
- **Content**: Section label + heading + bullet list
- **Two-column**: Flex row with `gap: 40px`, text left, image right
- **Table**: CSS grid with alternating row backgrounds
