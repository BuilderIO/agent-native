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

Every slide uses this wrapper:

```html
<div class="fmd-slide" style="padding: 80px 110px; display: flex; flex-direction: column; justify-content: flex-start;">
  <!-- Slide content here -->
</div>
```

## Styling Rules

These are fallback defaults only. When a design system is linked, its hydrated
tokens control color, typography, spacing, borders, imagery, and slide defaults;
a reference deck controls composition and markup idiom only. The generic
Impeccable-inspired quality bar can flag hierarchy, contrast, density, and
anti-pattern issues, but it cannot replace the active system.

When no system is linked, generated slides may use these conventions:

| Element | Style |
|---------|-------|
| Background | `bg-[#000000]` (pure black) |
| Font | `font-family: 'Poppins', sans-serif` on all text |
| Section labels | `font-size: 16px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: #00E5FF` |
| Headings | `font-size: 40px; font-weight: 900; color: #fff; line-height: 1.15; letter-spacing: -1px` |
| Title slides | `font-size: 54px; font-weight: 900` with `justify-content: center` |
| Bullet points | `&#x25CF;` character (8px, white), gap: 20px, font-size: 22px, color: rgba(255,255,255,0.85) |
| Sub-bullets | `&#x25CB;` (open circle), padding-left: 36px |
| Bold terms | `<strong style="font-weight: 800; color: #fff;">Term</strong>` + description in rgba(255,255,255,0.55) |
| Accent color | `#00E5FF` (cyan) for section labels, emphasis, highlights |

## Fit and Density

Fit the main content to the native content area, not merely to the outer
wrapper. For the default 16:9 canvas, the standard `80px 110px` padding leaves
740x380px. Keep titles to two lines, content slides to three short bullets or
three compact cards, and two-column slides to two or three short items per
column. If the source is denser, split it across slides. Never use zoom,
`transform: scale()`, clipping, or scroll overflow to hide a fit issue; body
text must remain at least 16px. Explicitly reduced slide padding is allowed when
the content still needs the space.

## Updating a Slide

To edit a slide's content:

1. **Inspect the current context**: call `view-screen` to get the active deck,
   slide ID, HTML, and any `slides-selection` style/edit target.
2. **Retrieve before generating**: when the edit changes facts, brand language,
   or layout, follow the `creative-context` skill and query those roles
   separately. Respect opt-out, pinned packs, and the exact reuse ladder.
3. **Modify the content** HTML string for the intended slide. Preserve an
   approved native template or component when it already fits; generate
   net-new structure only when the relevant corpus is empty.
4. **Update the slide** with the `update-slide` action using `deckId`,
   `slideId`, and `fullContent`. Do not write deck rows directly or add raw
   full-deck writes for normal slide edits; use `patch-deck` for browser/editor
   changes.
5. **Land the whole request in one write.** Several changes to one slide are one
   call carrying the finished state, not one call per change. Compose the final
   HTML and the final field values first, then send them together. A later call
   re-sending a field overwrites the value the earlier one wrote, so splitting
   one request across calls loses everything but the last.
6. For browser/editor code, enqueue granular deck operations through
   `patch-deck` / `DeckContext.tsx` instead of replacing the whole deck JSON.

7. For factual edits, compare changed text against the retrieved source and
   preserve quote, speaker, date, metric, and uncertainty status. Existing HTML
   or visual similarity is not proof of source fidelity.

If retrieval produces a new immutable context pack, keep its `contextPackId`
and reuse labels with the deck provenance. Existing slide HTML is not proof of
which source version influenced it.

## Element Animations

A slide's click-through reveals live in its `animations` field, not in its HTML,
so they are a `patch-deck` `patch-slide` write rather than an `update-slide`
content edit. Each entry targets one element and takes a `type` of `appear`,
`fade`, `slide-up`, or `zoom`; array order is reveal order.

The field is a full replacement, so send the complete list the slide should end
with. Three reveals is one operation carrying three entries — patching them in
one at a time leaves the slide with only the last.

Every entry needs a unique `id`, a 0-based `elementIndex`, and a `type`; the
schema rejects the operation otherwise. `elementPath`, the 0-based child-index
path from the outer `.fmd-slide` wrapper, is the target the runtime resolves
first and survives sibling edits that shift a flat index, so include it too.
Read both off the final HTML — never invent a path or fall back to 1-based
numbering, since a wrong path silently redirects the reveal to another element.

When one request changes content and reveals, patch the new HTML and the
complete animations list in the same operation; targets read off the old HTML
can point at elements the edit moved. Verify with `get-deck --compact`, which
returns each step's order, id, target, and type.

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
