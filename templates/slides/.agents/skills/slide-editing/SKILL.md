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

## Read before

Read a reference with `docs-search --slug "skill-slide-editing--references-<file>"`,
for example `skill-slide-editing--references-animations`.

| Situation | Read |
| --- | --- |
| Changing only colors, borders, shadows, or backgrounds, or matching every slide to one slide's look | `references/style-only-edits.md` |
| Adding, changing, or removing click-to-reveal animations | `references/animations.md` |
| Adding, moving, duplicating, or restyling hand-placed text boxes and other freeform objects | `references/freeform-objects.md` |
| Adding or editing a video | `references/video.md` |

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
   `slides-selection` target. The user navigates and reselects between turns:
   on any turn that says this, here, that slide, or the selected one, call
   `view-screen` again and never reuse a previous turn's slide ID or
   selection. If nothing is selected or the target is unclear, ask which slide.
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

## Fit and layout checks

The `create-deck` Fit budget applies: on 16:9 with `64px 80px` padding the
content area is 800x412px, so use at most two title lines, three short bullets
or cards, and two or three items per column. When an edit adds or lengthens
text, redo the height arithmetic and split the slide instead of shrinking.
Body text stays at least 16px. Never hide overflow with zoom,
`transform: scale()`, clipping, or scroll; reducing explicit padding is allowed.

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

## Flow layout and the editor

Keep generated flex and grid content in normal flow; create a deliberate
freeform object instead of absolute-positioning a layout child to make it
draggable. The editor presents flow content as flat objects the way Google
Slides does, so write markup that maps cleanly:

- A card is one painted box (background, border, or shadow on a single element)
  that owns its text. Never stack separately positioned text over a card
  background.
- Text containers, including `.fmd-text-box`, have no fixed `height`
  (`min-height` only for a deliberate minimum), so text grows instead of
  overflowing.
- Never write `contain` or `contain-intrinsic-size`; they break the editor's
  measuring and the PPTX export.
- No inline `<svg>`; the sanitizer removes it. Use styled divs or an `<img>`.
- Keep nesting shallow. Unpainted wrappers with no direct text (grid rows,
  columns) are fine; the pointer skips them.
- Ids belong to freeform objects only. Never stamp `data-slide-object-id` on a
  flow region: any id marks an object freeform and `export-pptx` rejects it.
  Preserve existing ids when rewriting a slide, and never save runtime
  `data-builder-id` values.
- An empty hidden `.fmd-layout-spacer[data-slide-layout-spacer-for="ID"]`
  reserves the flow slot of a hand-moved object. Keep it while its owner
  exists and delete both together.
- Keep the empty `<span data-slide-number></span>` and
  `<span data-slide-total></span>` tokens when restyling or rewriting a footer.
  They are empty in the saved HTML on purpose; never type digits over them.
- Use `fmd-img-placeholder` divs whose text names the content to show (see
  `create-deck` `references/slide-templates.md`) for diagrams, charts, and
  photos, then generate real images; never rebuild complex visuals in HTML/CSS.

Slide writes can return `hygieneWarnings` (inline svg and other markup the
sanitizer strips, typed page numbers, fixed px heights on text, `contain`,
stacked absolute text, deep nesting, tiny text). Fix them with `update-slide`
before finishing; a missing field means the lint found nothing.

## Skipping slides

A `patch-deck` `patch-slide` with `skipped: true` hides a slide from
Present/Presenter without deleting it; `skipped: false` restores it. The rail's
right-click Skip slide does the same.
