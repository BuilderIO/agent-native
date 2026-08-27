---
"@agent-native/core": patch
---

Fix two Figma import defects that silently dropped or reshaped content.

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

Diamond gradients are now drawn as the four-pointed shape Figma draws, instead
of being approximated by an ellipse. The falloff is an L1 distance, which is
linear inside each quadrant, so four quadrant-tiled linear gradients reproduce
it exactly rather than approximately.
