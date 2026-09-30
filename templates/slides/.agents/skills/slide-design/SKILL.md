---
name: slide-design
description: >-
  Visual craft for beautiful slides: direction, typography, composition,
  color, imagery, rhythm, and a critique pass. Use when generating slides or
  when asked to make a deck or slide beautiful, polished, prettier, more
  designed, or less generic. Defers to the linked design system and reference
  deck.
---

# Slide Design

"Make it beautiful" is a request for visual craft, not new content. Keep the
user's copy, facts, images, and slide order; change how they look. A beautiful
deck reads as the work of a studio with a point of view, not a template.

## Precedence

This skill supplies craft. It never overrides a choice already made. Resolve
these first, in order (the `design-systems` Precedence list is the authority):

1. Explicit constraints in the current request.
2. The linked design system owns tokens: colors, fonts and weights, type sizes,
   spacing and padding, radius, accent widths, logos, image style, slide
   defaults, and custom CSS. Use its values through the `--ds-*` wrapper form
   in `create-deck`. Never add a font, color, radius, or effect it does not
   define, and never detach or replace the system to make a deck prettier.
3. A reference deck owns composition: its layout patterns, chrome placement,
   and markup idiom. Without a design system it also supplies tokens; with one,
   the system's tokens win. It is a pattern library, not an outline.
4. An attached style reference sets the measured type scale, weights, colors,
   alignment, and margins. Match them.
5. This skill fills whatever is still undecided.

What that means per case:

- **Nothing linked:** apply the whole skill, including Direction.
- **Design system linked:** skip Direction and the font and palette picks. The
  system is the direction. Beauty comes from how you use it: scale contrast
  within its type sizes, composition, negative space, alignment, rhythm, and
  scarcity of its accent. Use fewer of its elements, more deliberately.
- **Reference deck:** keep its layouts and chrome; tighten spacing, hierarchy,
  and detail inside them. When no pattern fits, compose a new slide from the
  same type scale, spacing, color, and markup conventions.
- **Existing deck with an established look** (including one copied from a
  starter template): its own slides are the reference. "Make it beautiful"
  refines that look; it does not replace it. Pick a new direction only when the
  user asks to change the style or the deck has no coherent one.
- **Both:** system tokens, reference layouts, craft rules on top.

If a selected system or reference comes back unavailable, do not fall back to
this skill's defaults silently; tell the user the deck was styled without it.

## Direction

*Only when no design system, reference deck, or style reference applies.*

Generic is the opposite of beautiful. Pick one direction, name it in the
deck brief, and hold it on every slide. For a new open-ended deck, the
`create-deck` direction checkpoint still applies: offer these as the bounded
choice. On an unlinked deck with no coherent look, a "make it beautiful"
request is itself the go-ahead; pick the direction that best fits the subject
and existing content.

- **Swiss:** strict grid, one heavy grotesque (Archivo, Schibsted Grotesk),
  ink on warm paper, one signal red or orange, hairline rules, huge flush-left
  headlines.
- **Editorial:** high-contrast serif display (Playfair Display, Bodoni Moda,
  EB Garamond) over a quiet sans (Inter, Work Sans), generous margins, pull
  quotes, small-caps labels.
- **Dark technical:** near-black canvas, crisp sans (Geist, Space Grotesk),
  mono labels (Geist Mono, JetBrains Mono), one luminous accent, thin precise
  lines, screenshots lit as hero shots.
- **Soft minimal:** tinted off-white, one refined sans (Manrope, DM Sans,
  Figtree) in two weights, lots of air, one muted accent.
- **Poster:** condensed display (Anton, Bebas Neue, Barlow Condensed) at
  maximum scale, few words, one saturated accent.

Only named families that `SlideRenderer` maps to Google Fonts load; anything
else falls back silently. Quote the family in `font-family`. Static-weight
families ship only 400 and 700.

## Typography

Type does most of the work.

- **Extreme scale contrast.** Pair something very large with something very
  small, and let one element dominate. On the 960x540 canvas: statement or big
  number 72-120px, headline 32-56px, body 16-20px, labels 12-14px. A 96px
  number over 13px labels is striking; 40px over 28px is flat. Body stays at or
  above 16px (see Fit budget in `create-deck`).
- **Tighten display type:** letter-spacing -0.02 to -0.05em, line-height
  0.95-1.1. Body line-height 1.35-1.5, about 60 characters per line max.
- **Labels as labels:** small uppercase with +0.06 to +0.12em tracking, or
  mono, for eyebrows, running heads, axis labels, and page numbers.
- **Weight is hierarchy.** Pair one heavy and one regular weight; mid-weights
  everywhere look mushy. Size and weight before color.
- **Details:** curly quotes and apostrophes, en dashes for ranges, tabular
  numerals for aligned figures, no single orphaned word on a headline's last
  line (rebalance breaks with `max-width` or a `<br>`).

## Composition

- **Grid:** 12 columns inside the wrapper padding (the system's padding when
  linked, else `64px 80px`), 16-24px gutters. Snap every edge.
- **Asymmetry over centering.** Headline in 5-7 columns, evidence large in the
  rest. Center only title and statement slides.
- **Negative space is a material.** One line of type in the lower-left third
  of an otherwise empty slide can be the best slide in the deck.
- **Space on one scale** (the system's gap values, else 8/16/24/40/64). Close
  for related, far for unrelated; equal gaps everywhere read as amateur.
- **Optical alignment:** nudge large type to look flush with small text.
- **One focal point.** Squint; one thing should land first.
- Keep generated layout in normal flex/grid flow and never clip or scale
  overflow; `slide-editing` owns those constraints.

## Color

With a system or reference, use only its colors; these rules govern how.

- **Restrained palette:** background, ink, one or two tinted neutrals, one
  accent.
- **No pure defaults.** Warm or tinted off-white (for example `#F4F1EA`) over
  `#FFFFFF`, near-black (`#0E0E0C`, deep navy) over `#000000`, greys leaning
  warm or cool with the palette.
- **Accent is scarce:** one number, bar, word, or rule per slide.
- **Keep the canvas fixed.** Rhythm comes from composition and accent, not
  alternating light and dark slides (`create-deck` treats that as a theme
  failure unless requested).
- Readable contrast is part of beauty; `audit-contrast` is the check.

## Imagery and graphics

- **One treatment:** the same crop style, color grade, and radius on every
  image. Respect the system's `imageStyle` when linked.
- **Go big or leave it out.** Give an image a full-height column or most of
  the canvas; small floating thumbnails read as placeholders.
- **Screenshots as hero shots:** crop to the region the headline is about,
  scale it up, set it on a surface that fits the direction.
- **One graphic vocabulary:** 1-2px rules, large index numbers ("01"), one
  repeated shape motif. Every shape needs a semantic role; no inline SVG.
- **Charts in the deck's type and palette:** thin strokes, direct labels, the
  key series in the accent, the rest in a tinted neutral, no gridline or
  legend clutter.

## Rhythm

- Reuse a small layout family: title, section, statement, big number,
  headline + image, split, grid of 3, quote, closing. Alternate dense and
  sparse; avoid three identical layouts in a row.
- Fixed chrome in the exact same place on every slide: a small running head,
  a page number like `04 / 12`, maybe a hairline. Quiet repetition is what
  makes a deck feel designed.
- Title and section slides carry the strongest expression of the direction.

## What reads as generic

Avoid: everything centered at similar sizes in one weight; purple-to-blue
gradients, glass, glows, gradient text; rows of rounded icon + title +
description cards; emoji or decorative icons; shadows and borders on every
block; stock people-at-laptops; bullet walls or shrunk text; default blue and
default chart colors; mixed radii, alignments, and gaps; decoration filling
space that should stay empty.

## Critique pass

After rendering, before `get-layout-overflows` and `audit-contrast` (see
Bounded visual QA in `create-deck`), check each changed slide:

1. **Squint:** one clear focal point, balanced light and dark masses.
2. **Direction:** the aesthetic is nameable and matches the other slides; with
   a system linked, every color, font, radius, and logo comes from it.
3. **Scale:** real contrast between the largest and smallest type.
4. **Grid:** edges align within and across slides; chrome never moves.
5. **Subtract:** remove what does not serve the slide.
6. **Portfolio:** would a strong designer show this slide? If not, make the one
   change that would get it there.
7. **Craft:** no orphans, straight quotes, awkward breaks, blurry images, or
   off-system colors and fonts.

Fix findings in the same single correction pass.
