---
name: slide-editing
description: >-
  Edit individual slides, including content formatting, HTML styling, and
  bounded source and visual-fidelity checks. Use when changing an existing
  slide rather than creating a new deck.
---

# Slide Editing

A slide's `content` is a self-contained HTML string rendered at its aspect
ratio's intrinsic size: 16:9 is 960x540, 1:1 is 1080x1080, 9:16 is 540x960,
and 4:5 is 864x1080. Never assume a 1920x1080 canvas.

## Wrapper and styling

Every slide's outer `.fmd-slide` div carries the semantic `--deck-*` contract;
`create-deck` (Slide Wrapper) shows both forms. With a design system linked,
map `--deck-*` to `--ds-*`. Without one, write literal values: the renderer
publishes only `--ds-bg` for unlinked decks, so any other `var(--ds-*, ...)`
resolves to its fallback and the slide renders unstyled.

Keep one deck-level contract: the same canvas, type pairing, palette, and
accent on every slide, varying composition rather than theme. Never alternate
light and dark slides or add a one-off font or palette unless asked. For polish
or "make it beautiful", read `slide-design`; a linked system's tokens still win.

## Updating a slide

1. Call `view-screen` for the active deck, slide ID, HTML, and any
   `slides-selection` target.
2. When the edit changes facts, brand language, or layout, follow
   `creative-context` first. If retrieval yields a new context pack, keep its
   `contextPackId` with the deck provenance; existing HTML is not proof of
   which source version shaped it. Keep an approved native template or
   component when it fits; generate new structure only when the corpus is
   empty.
3. Write with `update-slide`: `deckId`, `slideId`, and ordered `edits` (exact
   replace, insert before/after, replace between markers, regex). Edits apply
   atomically under the deck lock, so one failed edit writes nothing.
   - **Selected text:** if `view-screen` returns an exact `selectedText` range
     and `currentSlideId`, send one literal replace with the selected text as
     `find`, `expectedMatches: 1`, and `currentSlideContentHash` as
     `baseContentHash`. Skip `get-deck`, `fullContent`, and layout-fit waits.
   - **Otherwise** (truncated, ambiguous, split by markup, or structural): call
     `get-deck` with that `slideId` (`compact=false` for full HTML, plus
     `format=true` for code-style work) and use its `contentHash` as
     `baseContentHash`.
   - Use `fullContent` only for an intentional full rewrite, never to make a
     small change. `format=true` persists readable line breaks.
4. Read back with `get-deck` (or a thumbnail's `.slide-content`
   `textContent`), never `document.body.innerText`: thumbnails use
   `content-visibility: auto`, so their text is empty in a hidden tab, and the
   canvas shows only the selected slide.
5. For factual edits, check changed text against the source: quote, speaker,
   date, metric, and uncertainty status. Visual similarity is not source
   fidelity.

Never write deck rows directly or add raw full-deck writes. Browser/editor code enqueues granular
operations through `patch-deck` / `DeckContext.tsx` instead of replacing the
whole deck JSON.

Report only what writes returned. `patch-deck` lists changed slides in
`updatedSlideIds` and byte-identical ones in `unchangedSlideIds`; an unchanged
slide was not restyled. `update-slide` fails with `slide_edit_noop`, and both
reject a batch where nothing changed, so re-read and send different content
instead of describing changes that did not land.

## Style-only edits

For appearance-only changes (colors, borders, shadows, background), set
`styleOnly: true`. It accepts only the `edits` array (`fullContent` and the
legacy top-level `find` / `replace` / `objectId` are rejected) and refuses any
result that changes text, markup, element order, or protected layout CSS
(padding, margin, gap, font-size, line-height, dimensions, positioning).

```jsonc
{ "deckId": "...", "slideId": "...", "styleOnly": true, "baseContentHash": "<contentHash>",
  "edits": [{ "find": "background:#111111", "replace": "background:#f4f0e8", "occurrence": 1 }] }
```

Use `occurrence: 1`, not `expectedMatches: 1`, when a declaration may repeat:
the edits path rejects ambiguous literals, so `expectedMatches` turns a repeat
into a failure. Use `all: true` when every occurrence should change. `objectId`
replaces inner content only and cannot reach an element's own `style`.

### Matching one slide's look across the deck

Use one `patch-deck` call with a `patch-slide` operation per slide, not
parallel `update-slide` calls: a mistake in one repeats across all of them
before any rejection returns.

1. Read the reference and targets in one `get-deck` call (`slideIds`,
   `compact=false`; the full deck if IDs are unknown). Take the background from
   the reference's `.fmd-slide` wrapper, not a child and not `deckStyle`, which
   also summarizes interior gradients. Keep each `contentHash`.
2. Send one `patch-deck` with every slide, its `baseContentHash`, and
   `styleOnly: true` for CSS-only changes (content changes omit it and send the
   full intended HTML). Verify once with the same `get-deck` read.

Change only the wrapper's background unless asked otherwise; leave card fills,
image backgrounds, and gradients alone. A wrapper with no background
declaration needs one added to its `style`. When a person is actively editing,
prefer a scoped `update-slide` with `baseContentHash`.

## Fit and layout checks

The `create-deck` Fit budget applies: on 16:9 with `64px 80px` padding the
content area is 800x412px, so use at most two title lines, three short bullets
or cards, and two or three items per column, and split dense material. Body
text stays at least 16px. Never hide overflow with zoom, `transform: scale()`,
clipping, or scroll; reducing explicit padding is allowed.

After all edits, call `get-layout-overflows` once, and once more only after
repairing a measured overflow. It reads the open editor's latest measurements
and cannot trigger new ones, so repeating it this turn changes nothing. If
status is unknown, name the unmeasured slide numbers and IDs and never claim
the deck fits.

## Contrast

Run `audit-contrast` as the last step of any turn that created or changed
slides (after layout repairs, right before the final response) and whenever
readability or accessibility comes up. If the deck is not open in the editor,
say contrast was not checked.

Fix failures in one pass by adjusting the role (`--deck-muted`, `--deck-ink`, a
surface), not one element's hex. Replacement colors must fit the theme:

- Design system linked: pick a passing color from its palette
  (`get-design-system`). If none passes, keep the token and report it.
- No design system: reuse a deck color, or shift the failing color's lightness
  while keeping its hue.

Never add an unrelated hue to pass. Audit once more, then report what remains;
re-audit once if slides come back skipped as `stale-render`. Skipped slides and
unverified text (over images, gradients, or effects) were not checked: name
them, and do not call the deck accessible or those slides fine.

## Objects, media, and placeholders

- Freeform objects (text boxes, shapes) are absolutely positioned `.fmd-slide`
  children with a stable `data-slide-object-id`. Preserve it when editing,
  moving, or styling; mint a new one when duplicating. Never save runtime
  `data-builder-id` values.
- Keep generated flex/grid content in normal flow; create a deliberate freeform
  object instead of absolute-positioning a layout child to make it draggable.
- Build shapes from styled HTML such as `div`; the sanitizer strips inline SVG.
- Use `fmd-img-placeholder` divs (see `create-deck`) for diagrams, charts, and
  photos, then generate real images; never rebuild complex visuals in HTML/CSS.
- Video: MP4 or WebM, ideally dropped on the slide (uploaded to file storage,
  50 MB limit) as a positioned `<video controls playsinline preload="metadata">`
  whose `data-slide-object-id` you preserve. It plays on click; `autoplay`
  (muted, inline) starts it when the slide is reached and `loop` repeats.
  Thumbnails and PDF disable autoplay; verify an export keeps playable video
  before claiming it does.

## Skipping slides

A `patch-deck` `patch-slide` with `skipped: true` hides a slide from
Present/Presenter without deleting it; `skipped: false` restores it. The rail's
right-click Skip slide does the same.

## Click-to-reveal animations

Animations are metadata over the final HTML, not alternate markup. Read the
full slide and patch the complete ordered `animations` list; omitted elements
show immediately. Never add hidden duplicates, spacers, absolute copies,
transforms, or placeholders to fake reveals. When content and reveals change
together, send both in one `patch-deck` operation; `animations: []` removes
reveals, then verify the persisted slide.

Array order is reveal order. Each entry needs a non-empty, unique `id` (the
editor keys reveals by id, so duplicates break remove and change-type), a
0-based `elementIndex`, and a `type` of `appear`, `fade`, `slide-up`, or
`zoom`. Take `elementPath` from the exact final HTML: it is positional, and a
stale path silently falls back to `elementIndex` and reveals the wrong element.
`get-deck` with `compact=true` reports each step for verification.
