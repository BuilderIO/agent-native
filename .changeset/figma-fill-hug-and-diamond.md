---
"@agent-native/core": patch
---

Fix a set of Figma import defects that silently dropped or reshaped content,
found by measuring 26 real designs against Figma's own render of each node.

Across that corpus the import diff falls to 3.1% overall, 0.78% with text boxes
excluded and 0.44% excluding image fills as well — what remains is Chromium and
Figma hinting glyphs and scaling bitmaps differently, not the conversion. The
export hop costs under 2.4% on every design. Per node, 23 of the 26 designs have
nothing off by more than 1.5px, and every offender in the other three is one
glyph: a hugging box holding a `%`, which Google Fonts' Inter draws wider than
the Inter Figma bundles.

A child set to FILL along an axis its auto-layout parent HUGS now keeps the
size Figma resolved for it. Figma treats that pair by falling back to the
child's own size, but `flex-grow: 1; flex-basis: 0%` in an auto-sized flex
container resolves to zero — so the child disappeared and every later sibling
slid up by its height. A 343x240 photo vanished from a real landing page this
way.

An auto-layout frame that HUGS an axis but has no children now keeps the size
Figma resolved for it. Figma does not collapse an empty hug frame, so it still
reports real dimensions; mapping that to `width: auto` collapsed it to nothing,
which deleted a 685x456 image placeholder from a real hero section and let its
FILL sibling take the whole row, so the heading stopped wrapping too.

Mirrored nodes are no longer rendered as half turns. Figma's `rotation` field
is a decomposition that cannot tell a flip from a 180-degree rotation — both
report pi — so a horizontally mirrored group picked up a vertical flip it does
not have, and everything inside it landed on the wrong side. The transform now
comes from `relativeTransform`'s own 2x2 block as a CSS `matrix()`, which
carries mirroring and skew as well as rotation.

Three auto-layout rules now match Figma's own resolution rather than the raw
field values. A row aligned SPACE_BETWEEN no longer also emits `itemSpacing` as
a CSS gap — Figma ignores that field in this mode but still reports it, and CSS
distributes space on top of a gap rather than instead of it. A negative
`itemSpacing` is clamped so the children still fill their container, which is
where Figma stops an overlap — the same rule the `.fig` walker already used,
rather than a second one, and applied on a FILL axis as well as a FIXED one
since a FILL axis takes its parent's definite size. And a rotated auto-layout
child now occupies its rotated footprint: a CSS transform does not change
layout size, so a vertical rule stored as a wide line turned 90 degrees was
taking its full pre-rotation width out of the row.

Three more sizing rules now follow Figma. A HUG container holding a cross-axis
FILL child uses the size Figma resolved: a FILL child does not feed Figma's
hug, while CSS still feeds its max-content into the container's shrink-to-fit
width, so a card column came out 76px too wide and moved every sibling. A FILL
child is allowed to shrink below its own content (`min-width: 0`), which is
what Figma's FILL does. And a zero-thickness LINE is placed from its own size
rather than the already-rotated bounding box — requiring both dimensions to be
positive pushed every rotated rule onto the fallback and squared its rotation.

Break characters Figma does not lay out as breaks no longer become lines.
Figma's stored text can carry them: a real footer holds "Get started for
free.\rAdd your whole team as your needs grow." and Figma draws it as ONE
flowing paragraph, wrapping at the width, while a heading holding "Customise
it\rto your needs" renders "Customise it to / your needs". Both formats say so
and neither walker was reading it — REST `lineTypes` and kiwi `textData.lines`
hold one entry per line Figma actually laid out. Measured across every
break-bearing text node in the corpus that count is never wrong, while counting
break characters overstates it on 8 of 20 REST nodes and 17 of 18 kiwi ones.
Mapping one such CR to a newline made a footer a line taller and, because its
column is vertically centred, moved all 61 nodes in it.

Trailing whitespace goes for the same reason: Figma neither draws it nor lets
it widen a hugging box, while `pre-wrap` does both. Of the 943 hugging text
nodes in the corpus the only three wider than Figma's own box are the three
whose text ends in a space — the other 940 average 0.02px of error.

Angular (conic) gradients now sweep the way Figma sweeps them. Figma computes
the sweep in the node's normalized space — the box treated as a unit square,
then stretched — while CSS `conic-gradient()` sweeps at a true uniform angular
rate in real pixels; the two agree only on the axes, so a non-square tile
landed its mid-sweep colours visibly early. Drawing the gradient into a square
and scaling that square to the box reproduces Figma's definition exactly.

Zero-thickness vector geometry renders again. The SVG spec says a viewBox with
a zero width or height DISABLES rendering of the element, so a stroked path
whose own box is 20x0 — a horizontal rule, or the arrow inside a "Learn more"
button — disappeared silently. A collapsed axis now takes the stroke's own
width, with the geometry centred on it.

Figma's image CROP is now honoured. `scaleMode: STRETCH` with an
`imageTransform` is Figma's Crop mode: the matrix picks a sub-rectangle of the
image and stretches that to fill the box. The transform was being discarded and
the whole image drawn instead, which reads as the artwork zoomed out — every
illustration on a real services page came out visibly smaller than Figma draws
it, and it was the largest non-text difference left on that page (4.04% ->
3.52%). A rotated or skewed crop still takes the raster fallback, which is
exact where a stretch would be wrong.

A hugging TEXT box now takes Figma's rounded width as a minimum. Figma rounds
every hugging text box to a whole pixel and lays its siblings out against that;
hugging to our own fractional width makes each label a fraction narrower, and
in a row of them the fractions add up — a nav came out 5px short across six
items, moving every one of them. As a minimum rather than a fixed width:
pinning the width forces the text to wrap wherever our advances run a hair
wider than Figma's, which is a different layout entirely.

The height is a minimum only where the text can wrap. Figma lays a hugging box
out at `round(lines * lineHeight)` — 206 of the 207 hug-both nodes in the
corpus with a fractional line height — and it rounds DOWN as often as up, so a
minimum could never reach it. Text hugging BOTH axes cannot wrap, so its line
count is fixed by the break characters and always matches Figma's; there the
rounded height is taken outright. Two Space Grotesk headings at 38.28px line
height hugged to 38.28 each where Figma laid out 38, and the 0.56px each pushed
their whole column down.

Diamond gradients are now drawn as the four-pointed shape Figma draws, instead
of being approximated by an ellipse. The falloff is an L1 distance, which is
linear inside each quadrant, so four quadrant-tiled linear gradients reproduce
it exactly rather than approximately.

An image fallback's overflowing ink no longer takes layout space. The `<img>`
is sized from render bounds so an OUTSIDE stroke or shadow is drawn at its
natural size instead of squished into the smaller geometric box, but Figma
stacks siblings against the geometric box and paints the ink outside it. A
horizontal LINE is the extreme case — its box is zero-height and the stroke is
entirely overflow, so every rule on a page pushed everything below it down a
pixel.

`downscaleImageToFit` is new in `ingestion`: it re-encodes an image to fit a
byte budget, keeping the aspect ratio, for callers that must inline one. The
Figma SVG export used it to stop dropping a page's 11.5MB hero shot, which had
been leaving a hole in the exported file — over a budget is a reason to send
fewer pixels, not to send nothing.

Icon-font glyphs no longer import as `.notdef` boxes. A Private Use Area
codepoint means nothing outside the font that assigned it, and fonts reach an
imported screen by family name from Google Fonts, which serves none of these
icon fonts — so Chromium drew a hollow box beside all 16 nav items of a real
admin dashboard, where Figma draws an icon. Such a text node now takes the
rendered-PNG fallback the walker already uses for anything it cannot express
(0.97% -> 0.83% on that design). The `.fig` walker has no render to fall back
on, so it drops the glyph and records the reason against the node instead.
