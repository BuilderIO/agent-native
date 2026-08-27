---
"@agent-native/core": patch
---

Fix a set of Figma import defects that silently dropped or reshaped content,
found by measuring 26 real designs against Figma's own render of each node.

Across that corpus the import diff falls to 3.4% overall, 0.94% with text boxes
excluded and 0.56% excluding image fills as well — what remains is Chromium and
Figma hinting glyphs and scaling bitmaps differently, not the conversion. The
export hop costs under 2.5% on every design.

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
since a FILL axis takes its parent's definite size. And a rotated auto-layout child now occupies its
rotated footprint: a CSS transform does not change layout size, so a vertical
rule stored as a wide line turned 90 degrees was taking its full pre-rotation
width out of the row.

Three more sizing rules now follow Figma. A HUG container holding a cross-axis
FILL child uses the size Figma resolved: a FILL child does not feed Figma's
hug, while CSS still feeds its max-content into the container's shrink-to-fit
width, so a card column came out 76px too wide and moved every sibling. A FILL
child is allowed to shrink below its own content (`min-width: 0`), which is
what Figma's FILL does. And a zero-thickness LINE is placed from its own size
rather than the already-rotated bounding box — requiring both dimensions to be
positive pushed every rotated rule onto the fallback and squared its rotation.

A trailing line break in Figma text no longer renders as an extra line. Figma
stores paragraph breaks as CR and its text very often ends with one, but it
does not draw a trailing break; `white-space: pre-wrap` does, so every such
label came out a line taller and pushed its siblings down with it.

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

Diamond gradients are now drawn as the four-pointed shape Figma draws, instead
of being approximated by an ellipse. The falloff is an L1 distance, which is
linear inside each quadrant, so four quadrant-tiled linear gradients reproduce
it exactly rather than approximately.
