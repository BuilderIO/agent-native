---
name: slide-editing
description: >-
  Edit individual slides, including content formatting, HTML styling, and
  bounded source and visual-fidelity checks. Use when changing an existing
  slide rather than creating a new deck.
---

# Slide Editing

Slides are HTML content stored inside the deck JSON. Each slide's `content` field is a self-contained HTML string that renders on the native 960x540 16:9 canvas (other aspect ratios use the same native scale contract).

## Slide HTML Structure

Every slide uses this wrapper:

```html
<div class="fmd-slide" style="box-sizing: border-box; width: 100%; height: 100%; padding: 80px 110px; display: flex; flex-direction: column; justify-content: flex-start;">
  <!-- Slide content here -->
</div>
```

The outer wrapper is persisted and normalized on write. Keep its exact
`box-sizing`, `width`, `height`, and `padding: 80px 110px` values so refresh,
presentation mode, and export share one deterministic content area. Center
title, section, statement, and closing slides with `align-items: center` and
`text-align: center`; content slides should remain left-aligned.

Never use emoji as decorative icons or bullets. Use HTML entities, CSS shapes,
or text labels instead, and keep normal-flow content inside the wrapper rather
than relying on unbounded absolute positioning.

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
   ordered `edits`. For code-style work, first read with `get-deck` using the
   target `slideId`, `compact=false`, and `format=true`, then send the returned
   `contentHash` as `baseContentHash`. Use exact replace, insert before/after,
   replace between markers, or regex replace. Set `expectedMatches` whenever a
   marker could be ambiguous. All edits are applied in memory under the deck
   lock; if one required edit fails, nothing is written. Set `format=true` on
   `update-slide` to persist readable Prettier line breaks. Use `fullContent`
   only for an intentional full rewrite - do not regenerate a slide to make a
   small change. Do not write deck rows directly or add raw full-deck writes;
   use `patch-deck` for browser/editor changes.
5. For browser/editor code, enqueue granular deck operations through
   `patch-deck` / `DeckContext.tsx` instead of replacing the whole deck JSON.

6. For factual edits, compare changed text against the retrieved source and
   preserve quote, speaker, date, metric, and uncertainty status. Existing HTML
   or visual similarity is not proof of source fidelity.

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
