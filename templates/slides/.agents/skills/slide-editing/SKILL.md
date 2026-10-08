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

## Read before

| Situation | Read |
| --- | --- |
| Changing only colors, borders, shadows, or backgrounds, or matching every slide to one slide's look | `references/style-only-edits.md` |
| Adding, changing, or removing click-to-reveal animations | `references/animations.md` |
| Adding, moving, duplicating, or restyling hand-placed text boxes and other freeform objects | `references/freeform-objects.md` |
| Adding or editing a video | `references/video.md` |

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
a reference deck controls composition and markup idiom only. For "make it
beautiful" or any polish request, read `slide-design`; its craft rules apply
inside the active system and cannot replace it.

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

Edits obey the Fit budget in `create-deck`, measured against the slide's own
padding and aspect ratio. When an edit adds or lengthens text, redo the height
arithmetic for that slide and split it instead of shrinking. Explicitly reduced
slide padding is allowed when the content still needs the space.

After all deck edits, call `get-layout-overflows` once. If you repair a
measured overflow, call it once more; do not check between writes. If status is
unknown, name the unmeasured slide numbers and IDs. The action reads current
measurements from the open editor tab and cannot trigger or wait for them, so
repeating the call this turn will not change the result unless the editor has
produced a new measurement. Never claim the deck fits while any slide is
unknown.

## Contrast

Run `audit-contrast` as the last step of any turn that created or changed
slides, even when the user did not ask: after every other edit, including
layout-fit repairs, and right before the final response. Also use it whenever
the user asks about readability or accessibility. If it cannot run because the
deck is not open in the editor, say contrast was not checked.

Fix failures in one bounded pass: adjust the offending role (`--deck-muted`,
`--deck-ink`, a surface) rather than recoloring one element with a new hex.
Every replacement color must match the deck's theme:

- Design system linked: choose a passing color from that system's own palette
  (from `get-design-system`). If none passes, keep the token and report it
  instead of inventing a color.
- No design system: reuse a color already in the deck, or shift the failing
  color's lightness while keeping its hue.

Never introduce an unrelated hue just to pass contrast. Audit once more, then
stop and report what remains. Unverified text and skipped slides were not
checked; say so rather than calling the deck accessible. If slides come back
skipped as `stale-render`, audit once more before reporting. Remaining
unverified text sits over an image, gradient, or visual effect: name those
slides and objects, and do not call them risky or fine without a measurement.

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
   The user navigates and reselects between turns. On any turn that says
   this, here, that slide, these, or the selected one (including a follow-up
   like "now make it bigger"), call `view-screen` again before acting; never
   reuse the previous turn's slide ID or selection. If it shows nothing
   selected or the target is unclear, ask which slide rather than guessing from
   recent edits.
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

If retrieval produces a new immutable context pack, keep its `contextPackId`
and reuse labels with the deck provenance. Existing slide HTML is not proof of
which source version influenced it.

## Skipping a Slide

Set a slide's `skipped: true` via a `patch-deck` `patch-slide` operation to
exclude it from Present/Presenter playback without deleting it — the slide
stays in the deck, editor, and exports. Set `skipped: false` (or omit it) to
include it again. The rail's right-click menu on each slide thumbnail offers
Cut, Copy, Paste, Delete, New slide, Duplicate slide, and Skip slide as the
same operations.

## Flow Layout and the Editor

Keep generated flex and grid content in normal flow. Do not silently
absolute-position a nested layout child just to make it draggable; create a
deliberate freeform object instead. The editor presents flow content as flat
objects the way Google Slides does, so write markup that maps cleanly:

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
  Preserve existing ids when rewriting a slide.
- An empty hidden `.fmd-layout-spacer[data-slide-layout-spacer-for="ID"]`
  reserves the flow slot of a hand-moved object. Keep it while its owner
  exists and delete both together.

Slide writes can return `hygieneWarnings` (inline svg and other markup the
sanitizer strips, typed page numbers, fixed px heights on text, `contain`,
stacked absolute text, deep nesting, tiny text). Fix them with `update-slide`
before finishing; a missing field means the lint found nothing.

## Image Placeholders

For visual elements (diagrams, charts, photos), use placeholder divs whose text
names the content to show, not its role (see `create-deck` `references/slide-templates.md`):

```html
<div class="fmd-img-placeholder" style="width: 100%; height: 300px; border-radius: 12px;">
  Q3 revenue by region, bar chart
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
