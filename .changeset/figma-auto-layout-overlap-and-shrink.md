---
"@agent-native/core": patch
---

Fix two Figma auto-layout rules the REST importer could not express in CSS.

Figma allows a negative `itemSpacing`, which overlaps auto-layout children. CSS
rejects a negative `gap` outright, so the declaration was dropped and silently
fell back to 0. On the Positivus landing page the contact block overlaps its
children by -367px; losing that overflowed the row, and because CSS flex items
shrink by default while Figma never shrinks a FIXED or HUG child, the overflow
was redistributed and both children came out the wrong width (1240px rendered
as 825px, 692px as 415px) with the illustration thrown outside its card.

A negative `itemSpacing` is now reproduced as a negative margin on every child
after the first, and children whose main-axis sizing is not FILL are pinned
with `flex-shrink: 0`. Measured against Figma's own geometry for those nodes,
every box now matches to within 0.1px.
