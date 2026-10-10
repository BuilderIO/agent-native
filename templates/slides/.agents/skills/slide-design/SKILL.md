---
name: slide-design
description: >-
  Visual craft for beautiful slides: typography, composition, color,
  imagery, rhythm, and a critique pass. Use when generating slides or
  when asked to make a deck or slide beautiful, polished, prettier, more
  designed, or less generic. Defers to the linked design system and reference
  deck.
---

# Slide Design

"Make it beautiful" is a request for visual craft, not new content. Keep the
user's copy, facts, images, and slide order; change how they look. A beautiful
deck reads as the work of a studio with a point of view, not a template.

## Precedence

This skill supplies craft, not a direction. The direction comes from the
user's prompt and the brief `create-deck` builds from it; never swap in a
preset style. The `design-systems` Precedence list decides what wins:

- **Design system linked:** it owns tokens (colors, fonts and weights, type
  sizes, spacing, radius, accents, logos, image style, custom CSS) through the
  `--ds-*` wrapper. Add nothing it does not define and never detach it. Beauty
  comes from using fewer of its elements more deliberately: scale contrast
  within its sizes, composition, negative space, alignment, a scarce accent.
- **Reference deck:** owns layouts, chrome, and markup idiom, and tokens too
  when no system is linked. Tighten inside its patterns; when none fits,
  compose from its conventions. It is a pattern library, not an outline.
- **Attached style reference:** match its measured type scale, weights,
  colors, alignment, and margins.
- **Existing deck with an established look** (including a starter template):
  its slides are the reference. Refine it; change the style only when asked.
- **Nothing linked:** realize the direction the prompt implies with this
  whole skill.

Explicit constraints in the current request beat all of these. If a selected
system or reference is unavailable, tell the user the deck was styled without
it instead of silently using this skill's defaults.

## Typography

Type does most of the work.

- **Only fonts the renderer maps load.** `SlideRenderer` loads the Google
  families it knows; anything else falls back silently. Quote the family in
  `font-family`. Static-weight families ship only 400 and 700.
- **Extreme scale contrast.** Let one element dominate. On 960x540: statement
  or big number 72-120px, headline 32-56px, body 16-20px, labels 12-14px. A
  96px number over 13px labels is striking; 40px over 28px is flat. Body never
  drops below 16px.
- **Tight display type:** letter-spacing -0.02 to -0.05em, line-height
  0.95-1.1. Body line-height 1.35-1.5, about 60 characters per line max.
- **Labels as labels:** small uppercase with +0.06 to +0.12em tracking, or
  mono, for eyebrows, running heads, axis labels, and page numbers.
- **Weight is hierarchy.** One heavy and one regular weight; mid-weights
  everywhere look mushy. Size and weight before color.
- **Details:** curly quotes, en dashes for ranges, tabular numerals for aligned
  figures, no orphaned last word on a headline (rebalance with `max-width` or a
  `<br>`).

## Composition

- **Grid:** 12 columns inside the wrapper padding, 16-24px gutters. Snap every
  edge.
- **Asymmetry over centering.** Headline in 5-7 columns, evidence large in the
  rest. Center only title and statement slides.
- **Negative space is a material.** One line of type in the lower-left third of
  an empty slide can be the best slide in the deck.
- **One spacing scale** (the system's gaps, else 8/16/24/40/64): close for
  related, far for unrelated. Equal gaps everywhere read as amateur.
- **Optical alignment:** nudge large type to look flush with small text.
- **One focal point.** Squint; one thing should land first.
- **One idea per slide; split, do not shrink.** A slide over the `create-deck`
  Fit budget becomes two slides, not smaller type or clipped overflow.
- Keep layout in normal flex/grid flow; `slide-editing` owns flow and fit
  constraints.

## Color

With a system or reference, use only its colors; these rules govern how.

- **Restrained palette:** background, ink, one or two tinted neutrals, one
  accent.
- **No pure defaults:** warm or tinted off-white (`#F4F1EA`) over `#FFFFFF`,
  near-black or deep navy over `#000000`, greys leaning with the palette.
- **Accent is scarce:** one number, bar, word, or rule per slide.
- **Fixed canvas:** rhythm comes from composition and accent, not alternating
  light and dark slides.
- Readable contrast is part of beauty; `audit-contrast` is the check.

## Imagery and graphics

- **One treatment:** the same crop, color grade, and radius on every image;
  respect the system's `imageStyle`.
- **Go big or leave it out:** a full-height column or most of the canvas.
  Small floating thumbnails read as placeholders.
- **Screenshots as hero shots:** crop to what the headline is about, scale up,
  set on a fitting surface.
- **One graphic vocabulary:** 1-2px rules, large index numbers ("01"), one
  repeated shape motif. Every shape needs a semantic role.
- **Charts in the deck's type and palette:** thin strokes, direct labels, the
  key series in the accent, the rest neutral, no gridline or legend clutter.

## Rhythm

- Reuse a small layout family: title, section, statement, big number, headline
  + image, split, grid of 3, quote, closing. Alternate dense and sparse; avoid
  three identical layouts in a row.
- Fixed chrome in the same place on every slide: a small running head, a page
  number like `04 / 12` from the `create-deck` slide-number tokens (never typed
  digits, which go stale on reorder), maybe a hairline.
- Title and section slides carry the strongest expression of the direction.

## What reads as generic

Everything centered at similar sizes in one weight; purple-to-blue gradients,
glass, glows, gradient text; rows of rounded icon + title + description cards;
emoji or decorative icons; shadows and borders on every block; stock
people-at-laptops; bullet walls or shrunk text; default blue and default chart
colors; mixed radii, alignments, and gaps; decoration filling space that should
stay empty.

## Critique pass

After rendering, before `get-layout-overflows` and `audit-contrast`, check
each changed slide:

1. **Squint:** one clear focal point, balanced masses.
2. **Direction:** delivers the requested look and matches the other slides;
   with a system linked, every color, font, radius, and logo comes from it.
3. **Scale:** real contrast between the largest and smallest type.
4. **Grid:** edges align within and across slides; chrome never moves.
5. **Subtract:** remove what does not serve the slide.
6. **Portfolio:** would a strong designer show it? If not, make the one change
   that would.
7. **Craft:** no orphans, straight quotes, awkward breaks, blurry images, or
   off-system colors and fonts.

Fix findings in one correction pass.
