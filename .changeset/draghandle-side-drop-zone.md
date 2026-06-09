---
"@agent-native/core": patch
---

Make the Notion-style side drop (drag a block to a neighbour's left/right edge to
build columns) reliably hittable for a real human in the `DragHandle` extension.

The side (column) activation region was a thin edge sliver in the vertical
middle: 28% of the block width capped at 140px, AND only the middle 60% of the
height. On a typical ~820px plan block that left two ~17%-wide edge zones in a
35px-tall band as the only column targets — the entire centre and the top/bottom
slivers reordered instead. A natural "drag beside" gesture released over the
block body, so it almost always reordered and "dragging side by side never made
columns" (and even when the indicator flashed, a human's release drifted out of
the tiny zone before mouse-up).

- Each side zone now claims ~a third of the block width (`SIDE_DROP_ZONE_RATIO`
  0.28 → 0.33, max cap 140 → 320px, min 48 → 56px) and is clamped to at most 45%
  of the width so a centre before/after reorder lane always survives.
- Side zones now span the FULL block height (the vertical-middle-only band is
  removed) — only the horizontal position decides column-vs-reorder.
- The drop indicator gets a `notion-drop-indicator--column` modifier class and is
  drawn as a thicker (4px) vertical bar centred on the seam, so apps can style
  column-build mode distinctly from the thin horizontal reorder line.

Editors that do not opt into `handleDrop` (e.g. the content editor) are
unaffected — side placements stay gated on `handleDrop` existing.

Also fixes the drag grip disappearing before you can grab blocks that are not
flush with the page's left gutter (a right column, a tab body). Their grip sits
in a gap the neighbour's wide forgiving hover zone also claims, so moving the
cursor from the block body toward its grip re-picked hover to the neighbour and
the grip vanished mid-approach. A grip keepalive now holds the shown grip while
the cursor travels left of that block's content toward its glyph (bounded to the
block's own row), so the grip stays grabbable — without changing the
innermost-wins or gutter-grab behaviour over content.
